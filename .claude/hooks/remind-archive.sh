#!/bin/bash
# Stop Hook: 提醒归档已完成的计划

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLANS_DIR="$PROJECT_ROOT/docs/plans"

# 如果 plans 目录不存在或为空，跳过
if [ ! -d "$PLANS_DIR" ] || [ -z "$(ls -A "$PLANS_DIR" 2>/dev/null)" ]; then
    exit 0
fi

# 检查是否有任何计划文件
PLAN_FILES=$(find "$PLANS_DIR" -name "*.md" -type f 2>/dev/null | wc -l)

if [ "$PLAN_FILES" -gt 0 ]; then
    echo '{
  "message": "📦 提醒: 如果功能已完成，记得归档 docs/plans/ 中的文件到 docs/archive/"
}'
fi
