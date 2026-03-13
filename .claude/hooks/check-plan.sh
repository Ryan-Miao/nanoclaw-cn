#!/bin/bash
# PreToolUse Hook: 检查今天是否有计划文档
# 没有 plan.md 不应该进入编码

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# 解析 JSON 获取 file_path
FILE_PATH=""
if [[ "$TOOL_INPUT" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    FILE_PATH="${BASH_REMATCH[1]}"
elif [[ "$TOOL_INPUT" =~ \"path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    FILE_PATH="${BASH_REMATCH[1]}"
fi

# 如果不是文件操作，放行
if [ -z "$FILE_PATH" ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# 只检查源代码文件
IS_SOURCE_CODE=0
if [[ "$FILE_PATH" =~ \.(kt|java|py|js|ts|go|rs|cpp|c|h|swift)$ ]]; then
    if [[ ! "$FILE_PATH" =~ /docs/ ]]; then
        IS_SOURCE_CODE=1
    fi
fi

if [ "$IS_SOURCE_CODE" -eq 0 ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# 检查今天是否有计划文档
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLANS_DIR="$PROJECT_ROOT/docs/plans"
TODAY=$(date +%Y-%m-%d)

if [ -d "$PLANS_DIR" ]; then
    PLAN_COUNT=$(find "$PLANS_DIR" -name "${TODAY}-*.md" -type f 2>/dev/null | wc -l)
    if [ "$PLAN_COUNT" -gt 0 ]; then
        echo '{"decision": "approve"}'
        exit 0
    fi
fi

# 没有今天的计划，阻止
echo '{
  "decision": "reject",
  "reason": "🚫 今天没有计划文档！\n\n编码前必须先创建计划：\n1. 调用 brainstorming skill 挖掘需求\n2. 生成 docs/plans/'"$TODAY"'-*-design.md\n3. 用户确认后才能写代码\n\n📖 详见 docs/workflow-guide.md"
}'
exit 0
