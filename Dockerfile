# 使用轻量级 Node.js 镜像
FROM node:18-alpine

# 设置容器内工作目录
WORKDIR /app

# 先复制 package.json 并安装依赖 (利用 Docker 缓存加速构建)
COPY package.json ./

# 【关键修复】设置国内淘宝 npm 镜像源，解决网络超时报错
RUN npm config set registry https://registry.npmmirror.com/

# 【优化】使用新版 npm 推荐的参数安装生产依赖
RUN npm install --omit=dev

# 复制所有源代码
COPY . .

# 暴露端口 (需与 app.js 中一致)
EXPOSE 3000

# 启动应用
CMD [ "npm", "start" ]