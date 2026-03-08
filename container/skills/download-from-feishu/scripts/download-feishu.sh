#!/bin/bash
# 飞书云盘文件下载脚本
# 用法: ./download-feishu.sh <file_url_or_token> [output_path]

set -e

# 读取配置
FEISHU_ENV_FILE="${FEISHU_ENV_FILE:-$HOME/.claude/feishu.env}"

# 尝试多个配置文件位置
if [ ! -f "$FEISHU_ENV_FILE" ]; then
    if [ -f "/workspace/group/.feishu.env" ]; then
        FEISHU_ENV_FILE="/workspace/group/.feishu.env"
    fi
fi

if [ ! -f "$FEISHU_ENV_FILE" ]; then
    echo "错误: 配置文件不存在: $FEISHU_ENV_FILE"
    echo "请创建配置文件，内容如下:"
    echo ""
    echo "FEISHU_APP_ID=your_app_id"
    echo "FEISHU_APP_SECRET=your_app_secret"
    echo "FEISHU_FOLDER_TOKEN=your_folder_token"
    exit 1
fi

source "$FEISHU_ENV_FILE"

INPUT="$1"
OUTPUT_PATH="${2:-/tmp/feishu_download}"

# 从 URL 提取 FILE_TOKEN
if [[ "$INPUT" == *"feishu.cn/file/"* ]]; then
    FILE_TOKEN=$(echo "$INPUT" | sed 's/.*\/file\///')
else
    FILE_TOKEN="$INPUT"
fi

if [ -z "$FILE_TOKEN" ]; then
    echo "错误: 请提供飞书文件链接或 FILE_TOKEN"
    echo "用法: $0 <file_url_or_token> [output_path]"
    exit 1
fi

# 获取 tenant_access_token
TOKEN_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{
        \"app_id\": \"$FEISHU_APP_ID\",
        \"app_secret\": \"$FEISHU_APP_SECRET\"
    }")

TENANT_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"tenant_access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TENANT_ACCESS_TOKEN" ]; then
    echo "错误: 获取访问令牌失败"
    echo "响应: $TOKEN_RESPONSE"
    exit 1
fi

# 下载文件
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$OUTPUT_PATH" -X GET \
    "https://open.feishu.cn/open-apis/drive/v1/files/$FILE_TOKEN/download" \
    -H "Authorization: Bearer $TENANT_ACCESS_TOKEN")

if [ "$HTTP_CODE" = "200" ]; then
    FILE_SIZE=$(stat -c%s "$OUTPUT_PATH" 2>/dev/null || stat -f%z "$OUTPUT_PATH" 2>/dev/null || echo "unknown")

    echo "SUCCESS"
    echo "FILE_TOKEN=$FILE_TOKEN"
    echo "OUTPUT_PATH=$OUTPUT_PATH"
    echo "FILE_SIZE=$FILE_SIZE bytes"

    # 检测文件类型
    FILE_TYPE=$(file -b "$OUTPUT_PATH" 2>/dev/null || echo "unknown")
    echo "FILE_TYPE=$FILE_TYPE"
else
    echo "FAILED"
    echo "HTTP_CODE=$HTTP_CODE"
    if [ -f "$OUTPUT_PATH" ]; then
        echo "ERROR_MESSAGE=$(cat $OUTPUT_PATH)"
    fi
    exit 1
fi
