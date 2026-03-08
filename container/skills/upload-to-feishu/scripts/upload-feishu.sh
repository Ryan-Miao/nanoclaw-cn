#!/bin/bash
# Upload file to Feishu Drive
# Usage: ./upload-feishu.sh [file_path]

set -e

# Config file location
FEISHU_ENV_FILE="${FEISHU_ENV_FILE:-$HOME/.claude/feishu.env}"

if [ ! -f "$FEISHU_ENV_FILE" ]; then
    echo "ERROR: Config file not found: $FEISHU_ENV_FILE"
    echo "Create it with:"
    echo "  FEISHU_APP_ID=xxx"
    echo "  FEISHU_APP_SECRET=xxx"
    echo "  FEISHU_FOLDER_TOKEN=xxx"
    exit 1
fi

source "$FEISHU_ENV_FILE"

FILE_PATH="$1"

# Auto-find latest docs/**/*.md if not specified
if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(find . -path "*/docs/**/*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [ -z "$FILE_PATH" ]; then
        echo "ERROR: No docs/**/*.md files found"
        exit 1
    fi
    echo "Auto-selected: $FILE_PATH"
fi

if [ ! -f "$FILE_PATH" ]; then
    echo "ERROR: File not found: $FILE_PATH"
    exit 1
fi

FILE_NAME=$(basename "$FILE_PATH")
# Cross-platform file size (Linux and macOS)
if stat --version &>/dev/null; then
    FILE_SIZE=$(stat -c%s "$FILE_PATH")  # Linux
else
    FILE_SIZE=$(stat -f%z "$FILE_PATH")  # macOS
fi

# Get tenant_access_token
TOKEN_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\": \"$FEISHU_APP_ID\", \"app_secret\": \"$FEISHU_APP_SECRET\"}")

# Parse token (prefer jq, fallback to grep)
if command -v jq &>/dev/null; then
    TENANT_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.tenant_access_token // empty')
else
    TENANT_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"tenant_access_token":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$TENANT_ACCESS_TOKEN" ]; then
    echo "ERROR: Failed to get access token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

# Upload file
UPLOAD_ARGS="-H Authorization: Bearer $TENANT_ACCESS_TOKEN"
UPLOAD_ARGS="$UPLOAD_ARGS -F file_name=$FILE_NAME"
UPLOAD_ARGS="$UPLOAD_ARGS -F parent_type=explorer"
UPLOAD_ARGS="$UPLOAD_ARGS -F size=$FILE_SIZE"
UPLOAD_ARGS="$UPLOAD_ARGS -F file=@$FILE_PATH"

if [ -n "$FEISHU_FOLDER_TOKEN" ]; then
    UPLOAD_ARGS="$UPLOAD_ARGS -F parent_node=$FEISHU_FOLDER_TOKEN"
fi

UPLOAD_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/drive/v1/files/upload_all" $UPLOAD_ARGS)

# Parse result
if command -v jq &>/dev/null; then
    CODE=$(echo "$UPLOAD_RESPONSE" | jq -r '.code // -1')
    FILE_TOKEN=$(echo "$UPLOAD_RESPONSE" | jq -r '.data.file_token // .file_token // empty')
else
    CODE=$(echo "$UPLOAD_RESPONSE" | grep -o '"code":[0-9]*' | cut -d: -f2)
    FILE_TOKEN=$(echo "$UPLOAD_RESPONSE" | grep -o '"file_token":"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -z "$FILE_TOKEN" ] && FILE_TOKEN=$(echo "$UPLOAD_RESPONSE" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [ "$CODE" = "0" ] && [ -n "$FILE_TOKEN" ]; then
    echo "SUCCESS"
    echo "FILE_NAME=$FILE_NAME"
    echo "FILE_TOKEN=$FILE_TOKEN"
    echo "FILE_URL=https://jcnqdavl0ba3.feishu.cn/file/$FILE_TOKEN"
else
    echo "FAILED"
    echo "RESPONSE=$UPLOAD_RESPONSE"
    exit 1
fi
