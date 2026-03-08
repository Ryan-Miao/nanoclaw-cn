# Task Events Output Design

> **Date:** 2026-03-08
> **Status:** Completed

## Problem

SDK 返回的 `task_notification` system 消息只记录日志，不发送给用户。用户希望看到子代理任务的状态变化。

## Solution

在 `container/agent-runner/src/index.ts` 中添加：

1. **新消息类型** - `messageType: 'system'` 用于 system 消息输出
2. **格式化函数** - `formatTaskNotification()` 将任务数据转换为可读格式
3. **输出逻辑** - task_notification 现在会发送格式化消息给用户

## Output Format

```
🔄 Task abc12345: running - Searching for files...
✅ Task abc12345: completed - Found 5 files
❌ Task abc12345: failed - Permission denied
```

## Files Modified

- `container/agent-runner/src/index.ts`
  - Added `'system'` to `messageType` union (line 52)
  - Added `formatTaskNotification()` function (line 137)
  - Modified task_notification handling to output to user (lines 573-590)

## Future Extensions

- Other system subtypes (e.g., `task_started`) can be added similarly
- The `formatTaskNotification` function can be extended with more status types
