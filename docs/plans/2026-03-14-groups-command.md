# /groups 命令实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 添加 `/groups` 命令，让用户可以在聊天中查看所有已注册群组的信息。

**Architecture:** 在 `src/index.ts` 的命令处理循环中添加 `/groups` 命令检测，使用已有的 `getAllRegisteredGroups()` 函数获取数据，格式化输出为表格。

**Tech Stack:** TypeScript, better-sqlite3 (已有)

---

### Task 1: 实现 /groups 列表命令

**Files:**
- Modify: `src/index.ts` (命令处理部分)

**Step 1: 找到命令处理位置**

在 `src/index.ts` 中找到 `/help` 命令处理的位置（约第 830 行），在其后添加 `/groups` 命令处理。

**Step 2: 添加 /groups 命令处理代码**

在 `/help` 命令处理之后，添加以下代码：

```typescript
// Check for /groups command - list all registered groups
const groupsMessage = groupMessages.find(
  (m) => m.content.trim().toLowerCase() === '/groups',
);
if (groupsMessage) {
  logger.info(
    { chatJid, group: group.name },
    '/groups command received',
  );
  const groupsList = Object.entries(registeredGroups);
  let response: string;

  if (groupsList.length === 0) {
    response = '📁 暂无已注册的群组';
  } else {
    const lines = [`📁 **已注册群组 (${groupsList.length}个)**\n`];

    // Table header
    lines.push('| Folder | 名称 | 触发词 | 输出模式 |');
    lines.push('|--------|------|--------|----------|');

    // Sort: main first, then alphabetically
    const sorted = groupsList.sort((a, b) => {
      if (a[1].isMain) return -1;
      if (b[1].isMain) return 1;
      return a[1].folder.localeCompare(b[1].folder);
    });

    for (const [jid, grp] of sorted) {
      const trigger = grp.isMain ? '无' : grp.trigger;
      const outputLevel = grp.containerConfig?.outputLevel || 'quiet';
      lines.push(`| ${grp.folder} | ${grp.name} | ${trigger} | ${outputLevel} |`);
    }

    response = lines.join('\n');
  }

  await channel.sendMessage(chatJid, response);
  lastAgentTimestamp[chatJid] = groupsMessage.timestamp;
  saveState();
  continue;
}
```

**Step 3: 更新 /help 命令输出**

在 `/help` 命令的 response 中添加 `/groups` 说明：

```typescript
const response = `📖 **可用命令**

• /status - 查看容器运行状态
• /new - 创建新会话（清除当前会话）
• /usage - 查看 token 使用情况
• /compact - 压缩会话（生成摘要并创建新会话）
• /skills - 查看当前支持的技能列表
• /groups - 查看所有已注册群组
• /verbose - 开启详细输出（助手思考 + 工具调用）
• /quiet - 只发送最终结果（默认）
• /help - 显示此帮助信息

📡 当前输出级别: ${currentLevel}

💡 提示：
- 普通消息需要以触发词开头（如 @Andy）
- 主频道无需触发词，所有消息都会被处理`;
```

**Step 4: 构建并测试**

Run: `npm run build`
Expected: 编译成功，无错误

**Step 5: 提交**

```bash
git add src/index.ts
git commit -m "feat: add /groups command to list registered groups"
```

---

### Task 2: 实现 /groups <folder> 详情命令

**Files:**
- Modify: `src/index.ts` (命令处理部分)

**Step 1: 扩展 /groups 命令支持参数**

将 Task 1 中的 `/groups` 命令处理替换为支持参数的版本：

```typescript
// Check for /groups command - list all registered groups or show details
const groupsMessage = groupMessages.find((m) =>
  m.content.trim().toLowerCase().startsWith('/groups'),
);
if (groupsMessage) {
  logger.info(
    { chatJid, group: group.name },
    '/groups command received',
  );

  const args = groupsMessage.content.trim().slice(7).trim(); // Remove '/groups'
  let response: string;

  if (!args) {
    // List all groups
    const groupsList = Object.entries(registeredGroups);

    if (groupsList.length === 0) {
      response = '📁 暂无已注册的群组';
    } else {
      const lines = [`📁 **已注册群组 (${groupsList.length}个)**\n`];

      // Table header
      lines.push('| Folder | 名称 | 触发词 | 输出模式 |');
      lines.push('|--------|------|--------|----------|');

      // Sort: main first, then alphabetically
      const sorted = groupsList.sort((a, b) => {
        if (a[1].isMain) return -1;
        if (b[1].isMain) return 1;
        return a[1].folder.localeCompare(b[1].folder);
      });

      for (const [jid, grp] of sorted) {
        const trigger = grp.isMain ? '无' : grp.trigger;
        const outputLevel = grp.containerConfig?.outputLevel || 'quiet';
        lines.push(`| ${grp.folder} | ${grp.name} | ${trigger} | ${outputLevel} |`);
      }

      response = lines.join('\n');
    }
  } else {
    // Show details for specific group
    const folder = args;
    const [jid, grp] =
      Object.entries(registeredGroups).find(
        ([_, g]) => g.folder === folder,
      ) || [];

    if (!grp) {
      response = `❌ 未找到群组: ${folder}\n\n使用 /groups 查看所有群组列表。`;
    } else {
      const trigger = grp.isMain ? '无' : grp.trigger;
      const outputLevel = grp.containerConfig?.outputLevel || 'quiet';
      const timeout = grp.containerConfig?.timeout
        ? `${Math.round(grp.containerConfig.timeout / 60000)}分钟`
        : '30分钟 (默认)';
      const addedAt = grp.added_at
        ? new Date(grp.added_at).toLocaleDateString('zh-CN')
        : '未知';

      const lines = [
        `📁 **群组: ${grp.folder}**\n`,
        `• 名称: ${grp.name}`,
        `• JID: ${jid}`,
        `• 触发词: ${trigger}`,
        `• 输出模式: ${outputLevel}`,
        `• 添加时间: ${addedAt}`,
        `• 容器超时: ${timeout}`,
      ];

      if (grp.isMain) {
        lines.push('• 类型: 主控群组');
      }

      response = lines.join('\n');
    }
  }

  await channel.sendMessage(chatJid, response);
  lastAgentTimestamp[chatJid] = groupsMessage.timestamp;
  saveState();
  continue;
}
```

**Step 2: 构建并测试**

Run: `npm run build`
Expected: 编译成功，无错误

**Step 3: 提交**

```bash
git add src/index.ts
git commit -m "feat: add /groups <folder> detail view"
```

---

### Task 3: 手动测试验证

**Files:**
- 无文件修改

**Step 1: 重启服务**

```bash
systemctl --user restart nanoclaw
```

**Step 2: 在飞书群组中测试**

发送 `/groups` 命令，验证：
- 显示所有已注册群组的表格
- main 群组排在第一位
- 输出模式正确显示

**Step 3: 测试详情查看**

发送 `/groups feishu_cc439a`（使用实际存在的 folder 名），验证：
- 显示该群组的详细信息
- JID、触发词、输出模式正确

**Step 4: 测试不存在的群组**

发送 `/groups nonexistent`，验证：
- 显示"未找到群组"错误提示

**Step 5: 更新 /help 测试**

发送 `/help`，验证：
- 显示 `/groups` 命令说明

---

## 完成标准

- [ ] `/groups` 命令显示所有群组的表格视图
- [ ] `/groups <folder>` 显示指定群组的详细信息
- [ ] `/help` 命令包含 `/groups` 说明
- [ ] 编译无错误
- [ ] 手动测试通过
