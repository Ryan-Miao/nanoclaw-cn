#!/bin/bash
# PreToolUse Hook: TDD 强制检查
# 在写入实现代码前，检查是否有对应的测试文件

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# 简单 JSON 解析（不依赖 jq）
FILE_PATH=$(echo "$TOOL_INPUT" | grep -oP '"file_path"\s*:\s*"\K[^"]*' 2>/dev/null || echo "")

# 如果没有 file_path，尝试 path
if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(echo "$TOOL_INPUT" | grep -oP '"path"\s*:\s*"\K[^"]*' 2>/dev/null || echo "")
fi

# 如果没有文件路径，放行
if [ -z "$FILE_PATH" ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# 检查是否是源代码文件（排除 test 目录和 docs 目录）
IS_SOURCE_CODE=0
if [[ "$FILE_PATH" =~ \.(kt|java|py|js|ts|swift|go|rs|cpp|c)$ ]]; then
    if [[ ! "$FILE_PATH" =~ docs/ ]] && [[ ! "$FILE_PATH" =~ /test/ ]] && [[ ! "$FILE_PATH" =~ Test\. ]]; then
        IS_SOURCE_CODE=1
    fi
fi

# 不是源代码，放行
if [ "$IS_SOURCE_CODE" -eq 0 ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# 检查是否是纯数据类/枚举（无业务逻辑）
# 优化：检查文件中是否有 data class/enum class 且没有 fun 关键字
if [ -f "$FILE_PATH" ]; then
    HAS_DATA_OR_ENUM=$(grep -cE "(data class|enum class)" "$FILE_PATH" 2>/dev/null || echo "0")
    HAS_FUNCTION=$(grep -cE "fun [a-z]" "$FILE_PATH" 2>/dev/null || echo "0")
    if [ "$HAS_DATA_OR_ENUM" -gt 0 ] && [ "$HAS_FUNCTION" -eq 0 ]; then
        echo '{"decision": "approve"}'
        exit 0
    fi
fi

# 构建测试文件路径
BASENAME=$(basename "$FILE_PATH" | sed 's/\.[^.]*$//')
DIRNAME=$(dirname "$FILE_PATH")
TEST_DIR="${DIRNAME//\/main\//\/test\/}"

# 根据语言确定测试文件后缀
if [[ "$FILE_PATH" =~ \.kt$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}Test.kt"
elif [[ "$FILE_PATH" =~ \.java$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}Test.java"
elif [[ "$FILE_PATH" =~ \.py$ ]]; then
    TEST_FILE="${TEST_DIR}/test_${BASENAME}.py"
elif [[ "$FILE_PATH" =~ \.(js|ts)$ ]]; then
    EXT="${FILE_PATH##*.}"
    TEST_FILE="${TEST_DIR}/${BASENAME}.test.${EXT}"
elif [[ "$FILE_PATH" =~ \.swift$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}Tests.swift"
elif [[ "$FILE_PATH" =~ \.go$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}_test.go"
elif [[ "$FILE_PATH" =~ \.rs$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}_test.rs"
elif [[ "$FILE_PATH" =~ \.(cpp|c)$ ]]; then
    TEST_FILE="${TEST_DIR}/${BASENAME}_test.cpp"
else
    # 未知类型，放行
    echo '{"decision": "approve"}'
    exit 0
fi

# 检查测试文件是否存在
if [ -f "$TEST_FILE" ]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# 测试文件不存在，阻止操作
REASON="🚫 TDD 检查失败: 未找到对应测试文件\n\n实现文件: $FILE_PATH\n期望测试: $TEST_FILE\n\n必须先创建测试文件，遵循 TDD 原则:\n1. 创建测试文件\n2. 写失败测试\n3. 运行测试确认失败\n4. 再写实现代码"

# JSON 转义
REASON_ESCAPED=$(echo "$REASON" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

echo "{\"decision\": \"reject\", \"reason\": \"$REASON_ESCAPED\"}"
exit 0
