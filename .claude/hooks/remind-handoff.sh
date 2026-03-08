#!/bin/bash
# Stop Hook: 会话结束时提醒更新 handoff.md

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_FILE="$PROJECT_ROOT/docs/handoff.md"

if [ -f "$HANDOFF_FILE" ]; then
    # 获取上次修改时间
    LAST_MODIFIED=$(stat -c %Y "$HANDOFF_FILE" 2>/dev/null || echo "0")
    CURRENT_TIME=$(date +%s)
    DIFF=$((CURRENT_TIME - LAST_MODIFIED))

    # 如果超过 1 小时未更新，提醒
    if [ "$DIFF" -gt 3600 ]; then
        echo ""
        echo "⏰ 提醒: docs/handoff.md 已超过 1 小时未更新"
        echo "   建议更新会话交接文档，记录："
        echo "   - 完成了什么"
        echo "   - 下一步是什么"
        echo "   - 阻塞点/待决策"
        echo ""
    fi
fi
