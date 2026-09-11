#!/bin/bash
# ==========================================
# 愤怒的小鸟 · 元素纪元 —— 一键部署脚本
# 宿主机对外端口：3011
# 用法：在项目根目录执行  ./deploy.sh
# ==========================================
set -euo pipefail

PORT=3011
CONTAINER=angry_birds_3011

echo ">>> [1/4] 拉取最新代码..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull origin main || echo "ℹ️  拉取失败（可检查网络/权限），继续使用当前代码"
else
  echo "ℹ️  当前目录不是 git 仓库，跳过拉取"
fi

echo ">>> [2/4] 构建并启动容器（宿主机端口 ${PORT}）..."
# 纯静态文件，无需编译，秒级启动
docker compose up -d --build

echo ">>> [3/4] 等待服务就绪并自检..."
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done

if [ "$ok" -ne 1 ]; then
  echo "❌ 自检失败：20 秒内无法访问 http://127.0.0.1:${PORT}/"
  echo "---- 最近 30 行容器日志 ----"
  docker logs --tail 30 "$CONTAINER" 2>&1 || true
  exit 1
fi
echo "✅ 自检通过：http://127.0.0.1:${PORT}/ 已可访问"

echo ">>> [4/4] 清理无用镜像..."
docker image prune -f >/dev/null || true

echo "=========================================="
echo "✅ 部署完成"
echo "🌐 访问地址：http://<服务器IP>:${PORT}/"
echo "📦 容器状态：$(docker ps --filter "name=${CONTAINER}" --format '{{.Status}}')"
echo "📜 查看日志：docker logs -f ${CONTAINER}"
echo "=========================================="
