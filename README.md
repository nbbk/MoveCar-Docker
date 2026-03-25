# 🚗 MoveCar - 多用户智能挪车系统 (Docker 部署版)

一个基于 Node.js + Redis 构建的轻量级、保护隐私的智能挪车通知系统。专为 NAS (如飞牛 fnOS、群晖) 和个人云服务器设计，支持一键 Docker Compose 部署。

## ✨ 核心特性

* **🛡️ 隐私保护**：车主无需在车窗留下真实手机号，扫码即可直接发送通知。
* **👨‍👩‍👧 多用户隔离**：支持单系统无限多辆车/多个车主独立配置，互不干扰。
* **🚀 稳定推送**：原生支持 [PushPlus](https://www.pushplus.plus/) (微信) 和 [Bark](https://bark.day.app/) (苹果设备) 推送。
* **🌐 突破阻断**：内置代理支持配置，完美解决国内宽带对海外 Bark 节点的网络阻断问题。
* **⏳ 断点续传**：基于 Redis 的会话保持，扫码者 30 分钟内重新扫码无需重复发送，直接查看最新状态。
* **🗺️ 智能导航**：扫码者位置精准纠偏 (WGS-84 转 GCJ-02)，为车主提供一键高德/苹果地图精确导航。

---

## 🔗 访问链接说明

系统部署成功并配置好域名后，通过 URL 参数 `?u=用户名` 来区分不同车主：

* **扫码者主页 (呼叫车主页)**：`https://你的域名/?u=用户名`
* **车主确认页 (在通知中点击)**：`https://你的域名/owner-confirm?u=用户名`
* **专属挪车码生成页**：`https://你的域名/qr?u=用户名` (在电脑端打开此页，按 `Ctrl + P` 直接打印贴在车窗上)

> 💡 **提示**：如果不带 `?u=` 参数（即直接访问 `https://你的域名/`），系统会读取基础环境变量，使用“默认车主”的配置。

---

## 📦 快速部署指南

本系统采用标准化的 Docker Compose 架构，只需简单几步即可完成私有化部署。

### 0. 准备工作
请确保你的服务器或 NAS 上已经安装了 Docker 和 Docker Compose。

### 1. 选择目录并克隆代码 (⚠️ 重要)
通过 SSH 登录你的 NAS 或服务器后，**请先进入你平时专门存放 Docker 项目的承载目录**（例如飞牛 NAS 的 `/vol1/1000/Docker` 或群晖的 `/volume1/docker`），然后再执行下载命令：
(直接下载项目文件，然后手动上传也行，看个人习惯)
```bash
# 1. 进入你的 Docker 数据存放目录（请根据你的实际路径修改）
cd /你的/Docker/专属/目录

# 2. 克隆本项目代码
git clone https://github.com/nbbk/MoveCar-Docker.git

# 3. 进入刚刚下载好的项目根目录
cd MoveCar-Docker
```

### 2. 配置环境变量
使用文本编辑器打开 `docker-compose.yml` 文件，修改其中的核心环境变量：
* 必须将 `EXTERNAL_URL` 修改为你自己准备使用的外网域名。
* 根据需求填写 `PUSHPLUS_TOKEN` 或 `BARK_URL`。

### 3. 一键构建并启动
在项目根目录下，执行以下启动命令：
```bash
docker compose up -d --build
```
等待镜像构建完成后，服务将运行在宿主机的 `13000` 端口。配合反向代理（如 Nginx、Lucky 或 Cloudflare Tunnel）绑定 HTTPS 域名即可正式使用！

---

## ⚙️ 环境变量配置详解

在 `docker-compose.yml` 中，修改以下环境变量来定制你的系统：

| 变量名 | 必填 | 说明 |
| :--- | :--- | :--- |
| `EXTERNAL_URL` | **是** | 你的外网访问域名（必须带 `https://`），用于生成专属二维码和拼接确认链接。 |
| `CAR_TITLE` | 否 | 默认车主的称呼或车牌号，例如 `京A88888`。 |
| `PHONE_NUMBER` | 否 | 默认车主的手机号，例如 `13800138000`。 |
| `PUSHPLUS_TOKEN` | 否 | 默认车主的 PushPlus 推送 Token（用于微信接收通知）。 |
| `BARK_URL` | 否 | 默认车主的 Bark 推送链接（例如 `https://api.day.app/你的Key`，用于苹果设备接收通知）。 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 否 | 局域网代理地址（例如 `http://192.168.1.9:7890`），**NAS 用户解决 Bark 阻断必备**。 |

### 👨‍👩‍👧 多用户高级配置 (变量名后缀加 `_大写用户名`)
为了给家人或朋友的车也用上这个系统，你可以直接在 `docker-compose.yml` 中追加带后缀的环境变量（后缀必须大写）。
例如，你想配置一个用户参数为 `zhangsan`：
* `CAR_TITLE_ZHANGSAN=张三(京A88888)`
* `PUSHPLUS_TOKEN_ZHANGSAN=你的PushPlusToken`
* `BARK_URL_ZHANGSAN=https://api.day.app/你的BarkKey`
* `PHONE_NUMBER_ZHANGSAN=你的手机号码`

---

## ⚠️ 避坑指南：NAS 上 Bark 收不到通知怎么办？

由于 Bark 的服务器 (`api.day.app`) 位于海外，国内许多宽带运营商会对该节点进行物理拦截或导致连接超时。表现为：PushPlus 能瞬间收到，但 Bark 毫无反应，且 Docker 日志中出现 `ConnectTimeoutError`。

**✅ 终极解决方案：**
如果你在 NAS 上遇到了这个问题，请务必在 `docker-compose.yml` 的 `environment` 节点下配置代理（前提是你的局域网内有代理服务如 Clash/v2ray）：
```yaml
environment:
  - HTTP_PROXY=http://你的代理机IP:代理端口
  - HTTPS_PROXY=http://你的代理机IP:代理端口
```
配置完成后，重新执行 `docker compose down` 和 `docker compose up -d`。让 Node.js 发出的 Bark 请求走代理通道，即可实现通知秒推！

---

## 🤝 鸣谢与贡献
如果你觉得这个项目对你有帮助，欢迎点亮 ⭐️ Star！