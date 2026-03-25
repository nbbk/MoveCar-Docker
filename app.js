/**
 * MoveCar 多用户智能挪车系统 - Docker v2.2
 * 优化：使用 Redis 实现 30分钟断点续传 + 域名优先级二维码 + 多用户隔离
 */

const express = require('express');
const redis = require('redis');
const app = express();
const port = process.env.PORT || 3000;

// --- 核心配置 ---
const CONFIG = {
    KV_TTL: 3600,         // 坐标等数据有效期：1 小时
    SESSION_TTL: 1800,    // 挪车会话有效期：30 分钟 (1800秒)
    RATE_LIMIT_TTL: 60    // 频率限制：60 秒
}

// --- 初始化 Redis 客户端 ---
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', err => console.error('Redis Client Error', err));

// 连接 Redis 数据库
(async () => {
    await redisClient.connect();
    console.log('✅ Connected to Redis');
})();

// --- 中间件 ---
app.use(express.json()); // 解析 JSON 请求体

/** 配置读取助手 **/
function getUserConfig(userKey, envPrefix) {
    // 读取特定的环境变量，例如 PUSHPLUS_TOKEN_USER1
    const specificKey = `${envPrefix}_${userKey.toUpperCase()}`;
    if (process.env[specificKey]) return process.env[specificKey];
    // 降级读取默认环境变量，例如 PUSHPLUS_TOKEN
    if (process.env[envPrefix]) return process.env[envPrefix];
    return null;
}

// --- 坐标转换逻辑 (无变化) ---
function wgs84ToGcj02(lat, lng) {
    const a = 6378245.0; const ee = 0.00669342162296594323;
    if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng };
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    let magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: lat + dLat, lng: lng + dLng };
}
function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
}
function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
}
function generateMapUrls(lat, lng) {
    const gcj = wgs84ToGcj02(lat, lng);
    return {
        amapUrl: "https://uri.amap.com/marker?position=" + gcj.lng + "," + gcj.lat + "&name=扫码者位置",
        appleUrl: "https://maps.apple.com/?ll=" + gcj.lat + "," + gcj.lng + "&q=扫码者位置"
    };
}

/** 获取请求基础URL的助手函数 **/
function getBaseDomain(req) {
    // 如果设置了外部 URL 环境便利，优先使用 (例如 https://move.car.com)
    if (process.env.EXTERNAL_URL) {
        return process.env.EXTERNAL_URL.replace(/\/$/, "");
    }
    // 降级使用请求头中的 Host (不推荐，某些反代环境下可能不准)
    return `${req.protocol}://${req.get('host')}`;
}


// ==========================================
//                 路由逻辑
// ==========================================

// --- 1. 二维码生成工具工具 ---
app.get('/qr', (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
    
    const targetUrl = getBaseDomain(req) + "/?u=" + userKey;
    
    res.setHeader('Content-Type', 'text/html;charset=UTF-8');
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>制作挪车码</title>
  <style>
    body { font-family: sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .qr-card { background: white; padding: 40px 20px; border-radius: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.05); text-align: center; width: 90%; max-width: 380px; }
    .qr-img { width: 250px; height: 250px; margin: 25px auto; border: 1px solid #f1f5f9; padding: 8px; border-radius: 12px; }
    .btn { display: block; background: #0093E9; color: white; text-decoration: none; padding: 16px; border-radius: 16px; font-weight: bold; margin-top: 20px; }
    .url-info { font-size: 11px; color: #cbd5e1; margin-top: 15px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="qr-card">
    <h2 style="color:#1e293b">${carTitle} 的专属挪车码</h2>
    <p style="color:#64748b; font-size:14px; margin-top:8px">扫码通知，保护隐私</p>
    <img class="qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(targetUrl)}">
    <a href="javascript:window.print()" class="btn">🖨️ 立即打印挪车牌</a>
    <div class="url-info">${targetUrl}</div>
  </div>
</body>
</html>
`);
});

// --- 2. API 路由: 发送通知 (核心重构) ---
app.post('/api/notify', async (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    
    try {
        const lockKey = "movecar:lock:" + userKey;
        // 频率限制：检查 Redis 中是否存在锁
        const isLocked = await redisClient.get(lockKey);
        if (isLocked) {
            return res.status(429).json({ success: false, error: '发送频率过快，请一分钟后再试' });
        }

        const body = req.body;
        const sessionId = body.sessionId; 

        const ppToken = getUserConfig(userKey, 'PUSHPLUS_TOKEN');
        const barkUrl = getUserConfig(userKey, 'BARK_URL');
        const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
        
        // 构造车主确认链接
        const confirmUrl = getBaseDomain(req) + "/owner-confirm?u=" + userKey;

        let notifyText = "🚗 挪车请求【" + carTitle + "】\\n💬 留言: " + (body.message || '车旁有人等待');
        
        // --- 数据存储 (迁移至 Redis) ---
        const statusData = { status: 'waiting', sessionId: sessionId };
        
        // 1. 如果有位置，存储位置，有效期 1 小时
        if (body.location && body.location.lat) {
            const maps = generateMapUrls(body.location.lat, body.location.lng);
            await redisClient.set("movecar:loc:" + userKey, JSON.stringify({ ...body.location, ...maps }), { EX: CONFIG.KV_TTL });
        }

        // 2. 存储会话状态，有效期 30 分钟 (实现断点续传的关键)
        await redisClient.set("movecar:status:" + userKey, JSON.stringify(statusData), { EX: CONFIG.SESSION_TTL });
        
        // 3. 设置频率限制锁，有效期 60 秒
        await redisClient.set(lockKey, '1', { EX: CONFIG.RATE_LIMIT_TTL });

        // --- 发送通知 ---
        const tasks = [];
        // PushPlus 通知
        if (ppToken) {
            tasks.push(fetch('http://www.pushplus.plus/send', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    token: ppToken, 
                    title: "🚗 挪车请求：" + carTitle, 
                    content: notifyText.replace(/\\n/g, '<br>') + '<br><br><a href="' + confirmUrl + '" style="font-size:18px;color:#0093E9">【点击处理】</a>', 
                    template: 'html' 
                }) 
            }).catch(e => console.error('PushPlus error', e)));
        }
        // Bark 通知
        if (barkUrl) {
            tasks.push(fetch(barkUrl + "/" + encodeURIComponent('挪车请求') + "/" + encodeURIComponent(notifyText) + "?url=" + encodeURIComponent(confirmUrl))
            .catch(e => console.error('Bark error', e)));
        }

        // 不等待通知结果，立即响应前端
        Promise.all(tasks); 
        return res.json({ success: true });

    } catch (e) {
        console.error('Notify Error:', e);
        return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
});

// --- 3. API 路由: 查询状态 (迁移至 Redis) ---
app.get('/api/check-status', async (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    const clientSessionId = req.query.s;

    const data = await redisClient.get("movecar:status:" + userKey);
    if (!data) return res.json({ status: 'none' });

    const statusObj = JSON.parse(data);
    // 校验 Session ID，防止跨设备干扰
    if (statusObj.sessionId !== clientSessionId) {
        return res.json({ status: 'none' });
    }

    const ownerLoc = await redisClient.get("movecar:owner_loc:" + userKey);
    return res.json({ 
        status: statusObj.status, 
        ownerLocation: ownerLoc ? JSON.parse(ownerLoc) : null 
    });
});

// --- 4. API 路由: 车主获取扫码者位置 ---
app.get('/api/get-location', async (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    const data = await redisClient.get("movecar:loc:" + userKey);
    res.setHeader('Content-Type', 'application/json');
    res.send(data || '{}');
});

// --- 5. API 路由: 车主确认处理 ---
app.post('/api/owner-confirm', async (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    const body = req.body;
    
    const data = await redisClient.get("movecar:status:" + userKey);
    if (data) {
        const statusObj = JSON.parse(data);
        statusObj.status = 'confirmed'; // 更新状态为已确认
        
        // 如果车主分享了位置
        if (body.location) {
            const urls = generateMapUrls(body.location.lat, body.location.lng);
            // 存储车主位置，有效期 10 分钟
            await redisClient.set("movecar:owner_loc:" + userKey, JSON.stringify({ ...body.location, ...urls }), { EX: 600 });
        }
        
        // 确认后状态继续保持，延长有效期到 10 分钟，供扫码者查询
        await redisClient.set("movecar:status:" + userKey, JSON.stringify(statusObj), { EX: 600 });
    }
    return res.json({ success: true });
});

// --- 6. 页面路由: 默认挪车首页 (html无变化，后端渲染 userKey) ---
app.get('/', (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    
    const phone = getUserConfig(userKey, 'PHONE_NUMBER') || '';
    const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
    const phoneHtml = phone ? '<a href="tel:' + phone + '" class="btn-phone">📞 拨打车主电话</a>' : '';

    res.setHeader('Content-Type', 'text/html;charset=UTF-8');
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <title>挪车通知</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(160deg, #0093E9 0%, #80D0C7 100%); min-height: 100vh; padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 15px; }
    .card { background: white; border-radius: 24px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
    .header { text-align: center; }
    .icon-wrap { width: 64px; height: 64px; background: #0093E9; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-size: 32px; color: white; }
    textarea { width: 100%; min-height: 90px; border: 1px solid #eee; border-radius: 14px; padding: 15px; font-size: 16px; outline: none; margin-top: 10px; background:#fcfcfc; resize:none; }
    .tag { display: inline-block; background: #f1f5f9; padding: 10px 16px; border-radius: 20px; font-size: 14px; margin: 5px 3px; cursor: pointer; color:#475569; }
    .btn-main { background: #0093E9; color: white; border: none; padding: 18px; border-radius: 18px; font-size: 18px; font-weight: bold; cursor: pointer; width: 100%; }
    .btn-phone { background: #ef4444; color: white; border: none; padding: 15px; border-radius: 15px; text-decoration: none; text-align: center; font-weight: bold; display: block; margin-top: 10px; }
    .hidden { display: none !important; }
    .map-links { display: flex; gap: 10px; margin-top: 15px; }
    .map-btn { flex: 1; padding: 14px; border-radius: 14px; text-align: center; text-decoration: none; color: white; font-weight: bold; }
    .amap { background: #1890ff; } .apple { background: #000; }
  </style>
</head>
<body>
  <div class="container" id="mainView">
    <div class="card header">
      <div class="icon-wrap">🚗</div>
      <h2 style="color:#1e293b">呼叫 ${carTitle}</h2>
      <p style="color:#64748b; font-size:14px; margin-top:5px">提示：车主将收到即时提醒</p>
    </div>
    <div class="card">
      <textarea id="msgInput" placeholder="请输入留言..."></textarea>
      <div style="margin-top:5px">
        <div class="tag" onclick="setTag('麻烦挪下车，谢谢')">🚧 挡路了</div>
        <div class="tag" onclick="setTag('临时停靠，请包涵')">⏱️ 临停</div>
        <div class="tag" onclick="setTag('有急事外出，速来')">🏃 急事</div>
      </div>
    </div>
    <div class="card" id="locStatus" style="font-size:13px; color:#94a3b8; text-align:center;">定位请求中...</div>
    <button id="notifyBtn" class="btn-main" onclick="sendNotify()">🔔 发送通知</button>
  </div>

  <div class="container hidden" id="successView">
    <div class="card" style="text-align:center">
      <div style="font-size:64px; margin-bottom:15px">📧</div>
      <h2 style="color:#1e293b">通知已送达</h2>
      <p style="color:#64748b">车主已收到挪车请求，请在车旁稍候</p>
    </div>
    <div id="ownerFeedback" class="card hidden" style="text-align:center; border: 2.5px solid #10b981;">
      <div style="font-size:40px">👨‍✈️</div>
      <h3 style="color:#059669">车主回复：马上到</h3>
      <div class="map-links">
        <a id="ownerAmap" href="#" class="map-btn amap">高德地图</a>
        <a id="ownerApple" href="#" class="map-btn apple">苹果地图</a>
      </div>
    </div>
    <div>
      <button class="btn-main" style="background:#f59e0b; margin-top:10px;" onclick="location.reload()">🔄 刷新状态</button>
      ${phoneHtml}
    </div>
  </div>

  <script>
    let userLoc = null;
    const userKey = "${userKey}";
    
    // 会话持久化 (断点续传的关键)
    let sessionId = localStorage.getItem('movecar_session_' + userKey);
    if (!sessionId) {
      sessionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('movecar_session_' + userKey, sessionId);
    }

    window.onload = async () => {
      checkActiveSession();
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
          userLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
          document.getElementById('locStatus').innerText = '📍 位置已锁定';
          document.getElementById('locStatus').style.color = '#10b981';
        }, () => {
          document.getElementById('locStatus').innerText = '📍 无法获取精确位置';
        });
      }
    };

    async function checkActiveSession() {
      try {
        const res = await fetch('/api/check-status?u=' + userKey + '&s=' + sessionId);
        const data = await res.json();
        if (data.status && data.status !== 'none') {
          showSuccess(data);
          pollStatus();
        }
      } catch(e){}
    }

    function setTag(t) { document.getElementById('msgInput').value = t; }

    async function sendNotify() {
      const btn = document.getElementById('notifyBtn');
      btn.disabled = true; btn.innerText = '正在联络车主...';
      try {
        const res = await fetch('/api/notify?u=' + userKey, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ 
            message: document.getElementById('msgInput').value, 
            location: userLoc,
            sessionId: sessionId 
          })
        });
        const data = await res.json();
        if (data.success) {
          showSuccess({status: 'waiting'});
          pollStatus();
        } else { alert(data.error); btn.disabled = false; btn.innerText = '🔔 发送通知'; }
      } catch(e) { alert('服务暂时不可用'); btn.disabled = false; }
    }

    function showSuccess(data) {
      document.getElementById('mainView').classList.add('hidden');
      document.getElementById('successView').classList.remove('hidden');
      updateUI(data);
    }

    function updateUI(data) {
      if (data.status === 'confirmed') {
        document.getElementById('ownerFeedback').classList.remove('hidden');
        if (data.ownerLocation) {
          document.getElementById('ownerAmap').href = data.ownerLocation.amapUrl;
          document.getElementById('ownerApple').href = data.ownerLocation.appleUrl;
        }
      }
    }

    function pollStatus() {
      // 传统的轮询，每 5 秒检查一次后端状态
      setInterval(async () => {
        try {
          const res = await fetch('/api/check-status?u=' + userKey + '&s=' + sessionId);
          const data = await res.json();
          updateUI(data);
        } catch(e){}
      }, 5000);
    }
  </script>
</body>
</html>
`);
});

// --- 7. 页面路由: 车主确认页 (html无变化，后端渲染 userKey) ---
app.get('/owner-confirm', (req, res) => {
    const userParam = req.query.u || 'default';
    const userKey = userParam.toLowerCase();
    const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
    
    res.setHeader('Content-Type', 'text/html;charset=UTF-8');
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>挪车处理</title>
  <style>
    body { font-family: sans-serif; background: #4f46e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin:0; padding:20px; }
    .card { background: white; padding: 35px 25px; border-radius: 30px; text-align: center; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
    .btn { background: #10b981; color: white; border: none; width: 100%; padding: 20px; border-radius: 18px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 20px; box-shadow: 0 5px 15px rgba(16,185,129,0.3); }
    .map-box { display: none; background: #f8fafc; padding: 20px; border-radius: 20px; margin-top: 15px; border: 1px solid #e2e8f0; }
    .map-btn { display: inline-block; padding: 12px 18px; background: #2563eb; color: white; text-decoration: none; border-radius: 12px; margin: 5px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:50px">📣</div>
    <h2 style="margin:15px 0; color:#1e293b">${carTitle}</h2>
    <p style="color:#64748b">有人正在车旁等您，请确认：</p>
    <div id="mapArea" class="map-box">
      <p style="font-size:14px; color:#2563eb; margin-bottom:12px; font-weight:bold">对方实时位置 📍</p>
      <a id="amapLink" href="#" class="map-btn">高德地图</a>
      <a id="appleLink" href="#" class="map-btn" style="background:#000">苹果地图</a>
    </div>
    <button id="confirmBtn" class="btn" onclick="confirmMove()">🚀 我已知晓，马上过去</button>
  </div>
  <script>
    const userKey = "${userKey}";
    window.onload = async () => {
      // 页面加载时立即获取扫码者位置
      const res = await fetch('/api/get-location?u=' + userKey);
      const data = await res.json();
      if(data.amapUrl) {
        document.getElementById('mapArea').style.display = 'block';
        document.getElementById('amapLink').href = data.amapUrl;
        document.getElementById('appleLink').href = data.appleUrl;
      }
    };
    async function confirmMove() {
      const btn = document.getElementById('confirmBtn');
      btn.innerText = '已告知对方 ✓'; btn.disabled = true; btn.style.background = '#94a3b8';
      // 尝试获取车主位置并发送确认
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async p => {
          await fetch('/api/owner-confirm?u=' + userKey, { 
              method: 'POST', 
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ location: {lat: p.coords.latitude, lng: p.coords.longitude} }) 
          });
        }, async () => {
          // 如果车主拒绝定位，仅发送确认状态
          await fetch('/api/owner-confirm?u=' + userKey, { 
              method: 'POST', 
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ location: null }) 
          });
        });
      }
    }
  </script>
</body>
</html>
`);
});


// --- 启动服务器 ---
app.listen(port, () => {
    console.log(`🚀 MoveCar App listening at http://localhost:${port}`);
});