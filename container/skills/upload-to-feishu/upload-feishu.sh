#!/bin/bash
# 飞书云盘文件上传脚本
# 用法: ./upload-feishu.sh <file_path>

set -e

# 读取配置
FEISHU_ENV_FILE="${FEISHU_ENV_FILE:-$HOME/.claude/feishu.env}"

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

FILE_PATH="$1"

# 如果没有指定文件，找最新的 docs/**/*.md
if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(find . -path "*/docs/**/*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [ -z "$FILE_PATH" ]; then
        echo "错误: 未找到 docs/**/*.md 文件"
        exit 1
    fi
    echo "自动选择文件: $FILE_PATH"
fi

# 检查文件是否存在
if [ ! -f "$FILE_PATH" ]; then
    echo "错误: 文件不存在: $FILE_PATH"
    exit 1
fi

FILE_NAME=$(basename "$FILE_PATH")
FILE_SIZE=$(stat -c%s "$FILE_PATH")

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

# 上传文件
if [ -n "$FEISHU_FOLDER_TOKEN" ]; then
    UPLOAD_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/drive/v1/files/upload_all" \
        -H "Authorization: Bearer $TENANT_ACCESS_TOKEN" \
        -F "file_name=$FILE_NAME" \
        -F "parent_type=explorer" \
        -F "parent_node=$FEISHU_FOLDER_TOKEN" \
        -F "size=$FILE_SIZE" \
        -F "file=@$FILE_PATH")
else
    UPLOAD_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/drive/v1/files/upload_all" \
        -H "Authorization: Bearer $TENANT_ACCESS_TOKEN" \
        -F "file_name=$FILE_NAME" \
        -F "parent_type=explorer" \
        -F "size=$FILE_SIZE" \
        -F "file=@$FILE_PATH")
fi

# 检查上传结果
if echo "$UPLOAD_RESPONSE" | grep -q '"code":0'; then
    FILE_TOKEN=$(echo "$UPLOAD_RESPONSE" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "SUCCESS"
    echo "FILE_NAME=$FILE_NAME"
    echo "FILE_TOKEN=$FILE_TOKEN"
    echo "FILE_URL=https://jcnqdavl0ba3.feishu.cn/file/$FILE_TOKEN"
else
    echo "FAILED"
    echo "RESPONSE=$UPLOAD_RESPONSE"
    exit 1
fi
