# ==========================================
# 愤怒的小鸟 · 元素纪元 —— 纯静态站点镜像
# 零依赖前端（HTML / CSS / JS），由 Nginx 托管
# 容器内监听 80，外部通过 3011 端口映射
# ==========================================
FROM nginx:stable-alpine

# 清掉 Nginx 自带的欢迎页
RUN rm -rf /usr/share/nginx/html/*

# 只拷贝真正的站点资源（白名单方式）。
# 不要用 COPY . ，否则 tools/ .github/ Dockerfile nginx.conf 等
# 开发文件会被一并发布，并可通过 HTTP 直接访问到。
COPY index.html /usr/share/nginx/html/
COPY favicon.svg favicon-32.png favicon-180.png /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/

# 站点配置
COPY nginx.conf /etc/nginx/nginx.conf

# 健康检查：容器内 80 端口能正常响应即视为健康
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
