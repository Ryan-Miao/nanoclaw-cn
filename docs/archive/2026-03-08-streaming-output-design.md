# Claude Code SDK 消息流式输出到 Channel

## 背景

当前 NanoClaw 只把 SDK 的 `result` 类型消息推送到 Feishu，用户看不到 Claude Code 的处理过程。

## 目标

把 SDK 的所有消息类型（`assistant`、`system`、`tool_use`、`result`）都推送到 Channel，让用户能看到实时状态。

## 设计

### 消息类型

| 类型 | 内容 | 显示格式 |
|------|------|----------|
| `assistant` | 助手文本响应 | `[助手] {content}` |
| `tool_use` | 工具调用 | `[工具:{name}] {input}` |
| `result` | 最终结果 | `{content}` (无前缀) |

### 行为示例

```
用户: 帮我分析代码

→ [助手] 我来看看...
→ [工具:Read] {"file_path": "src/index.ts"}
→ [工具:Read] {"file_path": "src/router.ts"}
→ [助手] 我发现问题是...
→ [结果] 修复完成。
```

每条消息独立推送，不做编辑。

## 技术实现

### 1. agent-runner 修改

文件: `container/agent-runner/src/index.ts`

```typescript
for await (const message of query({...})) {
  if (message.type === 'assistant') {
    const textContent = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    if (textContent) {
      writeOutput({
        status: 'streaming',
        messageType: 'assistant',
        result: textContent
      });
    }
  }

  if (message.type === 'tool_use') {
    writeOutput({
      status: 'streaming',
      messageType: 'tool_use',
      result: `${message.name}: ${JSON.stringify(message.input)}`
    });
  }

  if (message.type === 'result') {
    writeOutput({
      status: 'success',
      messageType: 'result',
      result: textResult
    });
  }
}
```

### 2. IPC 透传

文件: `src/ipc.ts`

确保 `streaming` 状态的消息也能被读取并路由到 Channel。

### 3. Channel 格式化

文件: `src/router.ts`

根据 `messageType` 添加前缀标记：
- `assistant` → `[助手] `
- `tool_use` → `[工具:{name}] `
- `result` → 无前缀

### 4. 配置选项（可选）

文件: `groups/{name}/config.json`

```json
{
  "showAllMessageTypes": true
}
```

## 范围

### 包含
- agent-runner 消息处理
- IPC 透传
- Router 格式化
- Feishu Channel 显示

### 不包含
- Extended Thinking
- `<thinking>` 标签
- 消息编辑/合并

## 风险

- 消息条数多可能刷屏（用户可接受，这是预期行为）
- 需要测试各种消息类型的处理

## 验收标准

1. 在 Feishu 发送消息后，能看到助手响应、工具调用、最终结果
2. 每条消息有正确的类型标记
3. 不影响现有 `result` 消息的处理
