#!/bin/bash
set -e

cd /app

# 编译 TypeScript
npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist

# 读取 stdin 到临时文件
cat > /tmp/input.json

# 从输入中提取 sessionId
SESSION_ID=$(cat /tmp/input.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j.sessionId||'')")

# 启动 API gateway (后台运行)
export GATEWAY_LOG_DIR="/workspace/group/logs/api"
export GATEWAY_LOG_BODY="true"  # 记录完整请求/响应体
export GATEWAY_SESSION_ID="$SESSION_ID"
node /app/gateway/server.js &
GATEWAY_PID=$!

# 配置 SDK 使用本地 gateway（需要包含完整路径前缀）
export ANTHROPIC_BASE_URL="http://localhost:8080/api/anthropic"

# 等待 gateway 启动
sleep 1

# 检查 gateway 是否启动成功
if ! kill -0 $GATEWAY_PID 2>/dev/null; then
    echo "[entrypoint] Warning: Gateway failed to start, continuing without it"
fi

# 运行主程序
node /tmp/dist/index.js < /tmp/input.json
EXIT_CODE=$?

# 停止 gateway
if kill -0 $GATEWAY_PID 2>/dev/null; then
    kill $GATEWAY_PID 2>/dev/null
    wait $GATEWAY_PID 2>/dev/null
fi

exit $EXIT_CODE
