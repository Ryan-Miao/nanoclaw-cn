# SDK 消息流式输出 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 SDK 的所有消息类型（assistant、tool_use、result）都推送到 Channel，用户能看到实时状态。

**Architecture:** 在 agent-runner 中处理所有消息类型，通过现有的 stdout marker 机制传递给 host，host 通过 onOutput callback 发送到 Channel。

**Tech Stack:** TypeScript, Claude Agent SDK

---

## Task 1: 扩展 ContainerOutput 接口

**Files:**
- Modify: `container/agent-runner/src/index.ts:36-51` (ContainerOutput interface)
- Modify: `src/container-runner.ts:48-63` (ContainerOutput interface - 需同步)

**Step 1: Write the test**

创建测试文件验证新的 messageType 字段。

```typescript
// container/agent-runner/src/index.test.ts (新增)
import { describe, it, expect } from 'vitest';

describe('ContainerOutput', () => {
  it('should support messageType field for streaming messages', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'assistant' as const,
      result: 'Hello world',
    };
    expect(output.status).toBe('streaming');
    expect(output.messageType).toBe('assistant');
  });

  it('should support tool_use messageType', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'tool_use' as const,
      result: 'Read: {"file_path": "test.ts"}',
    };
    expect(output.messageType).toBe('tool_use');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/agent-runner && npm test`
Expected: FAIL - ContainerOutput interface doesn't have messageType

**Step 3: Write minimal implementation**

在 `container/agent-runner/src/index.ts` 中扩展接口：

```typescript
// 在 ContainerOutput 接口中添加 (line 36-51)
interface ContainerOutput {
  status: 'success' | 'error' | 'streaming';  // 添加 'streaming'
  result: string | null;
  newSessionId?: string;
  error?: string;
  // 新增字段
  messageType?: 'assistant' | 'tool_use' | 'result';
  // ... 其他现有字段
}
```

在 `src/container-runner.ts` 中同步更新接口 (line 48-63)：

```typescript
export interface ContainerOutput {
  status: 'success' | 'error' | 'streaming';  // 添加 'streaming'
  result: string | null;
  newSessionId?: string;
  error?: string;
  // 新增字段
  messageType?: 'assistant' | 'tool_use' | 'result';
  // ... 其他现有字段
}
```

**Step 4: Run test to verify it passes**

Run: `cd container/agent-runner && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add container/agent-runner/src/index.ts src/container-runner.ts
git commit -m "feat: 扩展 ContainerOutput 支持 streaming 状态和 messageType

- 添加 'streaming' 状态
- 添加 messageType 字段用于区分消息类型

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 处理 assistant 消息类型

**Files:**
- Modify: `container/agent-runner/src/index.ts:536-620` (runQuery 函数)

**Step 1: Write the test**

```typescript
// container/agent-runner/src/index.test.ts
describe('assistant message handling', () => {
  it('should extract text from assistant message', () => {
    const message = {
      type: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ],
    };
    const textContent = message.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n');
    expect(textContent).toBe('Hello\nworld');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd container/agent-runner && npm test`
Expected: PASS (纯逻辑测试)

**Step 3: Write implementation**

在 `runQuery` 函数中添加 assistant 消息处理 (line 555 之前)：

```typescript
// 在 if (message.type === 'result') { 之前添加

if (message.type === 'assistant') {
  // 提取文本内容
  const textContent = (message as { content?: Array<{ type: string; text?: string }> }).content
    ?.filter(b => b.type === 'text')
    .map(b => b.text || '')
    .filter(t => t.trim())
    .join('\n');

  if (textContent) {
    log(`Assistant message: ${textContent.slice(0, 100)}...`);
    writeOutput({
      status: 'streaming',
      messageType: 'assistant',
      result: textContent,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd container/agent-runner && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "feat: 处理 SDK assistant 消息类型

- 提取 assistant 消息中的文本内容
- 通过 writeOutput 发送 streaming 状态消息

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 处理 tool_use 消息类型

**Files:**
- Modify: `container/agent-runner/src/index.ts` (在 assistant 处理之后)

**Step 1: Write the test**

```typescript
// container/agent-runner/src/index.test.ts
describe('tool_use message handling', () => {
  it('should format tool_use message', () => {
    const message = {
      type: 'tool_use',
      name: 'Read',
      input: { file_path: '/src/test.ts' },
    };
    const result = `${message.name}: ${JSON.stringify(message.input)}`;
    expect(result).toBe('Read: {"file_path":"/src/test.ts"}');
  });

  it('should handle Bash tool specially', () => {
    const message = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test' },
    };
    const result = `${message.name}: ${message.input.command}`;
    expect(result).toBe('Bash: npm test');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd container/agent-runner && npm test`
Expected: PASS

**Step 3: Write implementation**

在 assistant 处理之后添加 tool_use 处理：

```typescript
// 在 assistant 处理之后添加

if (message.type === 'tool_use') {
  const toolMsg = message as { name?: string; input?: unknown };
  const toolName = toolMsg.name || 'unknown';
  const toolInput = toolMsg.input || {};

  // Bash 命令只显示 command，不显示完整 JSON
  let result: string;
  if (toolName === 'Bash' && typeof toolInput === 'object' && toolInput !== null) {
    const input = toolInput as { command?: string };
    result = `${toolName}: ${input.command || ''}`;
  } else {
    result = `${toolName}: ${JSON.stringify(toolInput)}`;
  }

  log(`Tool use: ${result}`);
  writeOutput({
    status: 'streaming',
    messageType: 'tool_use',
    result,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd container/agent-runner && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "feat: 处理 SDK tool_use 消息类型

- 格式化工具调用信息
- Bash 命令特殊处理，只显示 command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 在 host 端处理 streaming 消息

**Files:**
- Modify: `src/index.ts:289-324` (processGroupMessages 中的 onOutput callback)

**Step 1: Write the test**

```typescript
// src/index.test.ts (新增)
import { describe, it, expect } from 'vitest';

describe('streaming output formatting', () => {
  it('should add prefix for assistant message', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'assistant' as const,
      result: 'Hello world',
    };
    const prefix = '[助手] ';
    const text = prefix + output.result;
    expect(text).toBe('[助手] Hello world');
  });

  it('should add prefix for tool_use message', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'tool_use' as const,
      result: 'Read: {"file_path":"test.ts"}',
    };
    const prefix = '[工具] ';
    const text = prefix + output.result;
    expect(text).toBe('[工具] Read: {"file_path":"test.ts"}');
  });

  it('should not add prefix for result message', () => {
    const output = {
      status: 'success' as const,
      messageType: 'result' as const,
      result: 'Done!',
    };
    // result 类型不加前缀
    const text = output.result || '';
    expect(text).toBe('Done!');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - 新测试文件需要创建

**Step 3: Write implementation**

修改 `src/index.ts` 中的 onOutput callback：

```typescript
// 修改 processGroupMessages 中的 callback (line 289-324)
const output = await runAgent(group, prompt, chatJid, async (result) => {
  // 处理 streaming 状态的消息
  if (result.status === 'streaming') {
    if (result.result) {
      // 根据消息类型添加前缀
      let text: string;
      if (result.messageType === 'assistant') {
        text = `[助手] ${result.result}`;
      } else if (result.messageType === 'tool_use') {
        text = `[工具] ${result.result}`;
      } else {
        text = result.result;
      }

      logger.info({ group: group.name, messageType: result.messageType }, `Streaming: ${text.slice(0, 100)}`);
      await channel.sendMessage(chatJid, text);
    }
    return; // streaming 消息不重置 idle timer
  }

  // 原有的 result 处理逻辑
  if (result.result) {
    const raw =
      typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result);
    const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
    logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
    if (text) {
      const processedText = await processAndSendImages(
        text,
        channel,
        chatJid,
        group.folder,
      );
      if (processedText) {
        await channel.sendMessage(chatJid, processedText);
      }
      outputSentToUser = true;
    }
    resetIdleTimer();
  }

  if (result.status === 'success') {
    queue.notifyIdle(chatJid);
  }

  if (result.status === 'error') {
    hadError = true;
  }
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: 在 host 端处理 streaming 消息并发送到 Channel

- 根据 messageType 添加前缀标记
- assistant 消息加 [助手] 前缀
- tool_use 消息加 [工具] 前缀
- result 消息不加前缀

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 重新构建 container 并测试

**Files:**
- Modify: `container/agent-runner/dist/` (构建产物)

**Step 1: 重新构建 container**

Run: `./container/build.sh`
Expected: 构建成功

**Step 2: 手动测试**

在 Feishu 发送消息，验证能看到：
- `[助手] ...` 消息
- `[工具] Read: ...` 消息
- 最终 result 消息

**Step 3: 提交最终更改**

```bash
git add -A
git commit -m "build: 重新构建 container 包含 streaming 功能

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

1. 在 Feishu 发送消息后，能看到助手响应（带 [助手] 前缀）
2. 能看到工具调用（带 [工具] 前缀）
3. 最终结果正常显示（无前缀）
4. 不影响现有功能

## 风险

- 消息数量多可能刷屏 - 用户已接受
- 需要测试各种消息类型的处理
