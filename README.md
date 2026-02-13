<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  我的安全容器化个人 Claude 助手。轻量且易于定制，满足您的个人需求。
</p>

<p align="center">
  <a href="https://discord.gg/VGWXrf8x"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord"></a>
</p>

**全新特性：** 首个支持 [Agent 群体](https://code.claude.com/docs/en/agent-teams) 的 AI 助手。在聊天中组建 agent 团队协作完成任务。

---

## 本项目说明

本项目 fork 自 [gavrielc/nanoclaw](https://github.com/gavrielc/nanoclaw.git)，主要改造如下：

| 改造项 | 说明 |
|-------|------|
| **飞书机器人** | 原版支持 WhatsApp，本版改造为支持飞书机器人作为消息通道 |
| **Docker 容器** | 默认容器运行时改为 Docker（原版默认为 Apple Container） |
| **智谱 AI** | 支持配置 zhipu（智谱 AI）作为模型提供商 |

---

## 为什么构建这个项目

[OpenClaw](https://github.com/openclaw/openclaw) 是一个愿景很棒的项目。但我无法安心运行那些我不理解且能访问我生活的软件。OpenClaw 有 52+ 个模块、8 个配置管理文件、45+ 个依赖项，以及 15 个通道提供商的抽象层。安全性处于应用级别（允许列表、配对代码），而非操作系统隔离。所有内容运行在一个共享内存的 Node 进程中。

NanoClaw 在您 8 分钟就能理解的代码库中提供相同的核心功能。单进程，少量文件。Agent 运行在真正的 Linux 容器中，具有文件系统隔离，而非依赖权限检查。

## 快速开始

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
claude
```

然后运行 `/setup`。Claude Code 会处理一切：依赖、认证、容器设置、服务配置。

## 设计理念

**足够小巧，易于理解。** 单进程，几个源文件。没有微服务，没有消息队列，没有抽象层。让 Claude Code 带您了解它。

**隔离即安全。** Agent 运行在 Linux 容器中（macOS 上使用 Apple Container，或其他平台使用 Docker）。它们只能看到显式挂载的内容。Bash 访问是安全的，因为命令在容器内运行，而非在主机上。

**为单人用户而建。** 这不是框架。这是符合我确切需求的可用软件。您 fork 它，然后让 Claude Code 使其匹配您的确切需求。

**定制 = 代码修改。** 没有配置文件混乱。想要不同的行为？修改代码。代码库足够小，这样做很安全。

**AI 原生。** 没有安装向导；Claude Code 指导设置。没有监控仪表板；询问 Claude 发生了什么。没有调试工具；描述问题，Claude 修复它。

**技能胜过功能。** 贡献者不应向代码库添加功能（例如 Telegram 支持）。相反，他们贡献 [claude code 技能](https://code.claude.com/docs/en/skills)，如 `/add-telegram`，来转换您的 fork。最终您得到的是完全符合需求的干净代码。

**最佳工具链，最佳模型。** 这运行在 Claude Agent SDK 上，意味着您直接运行 Claude Code。工具链很重要。糟糕的工具链会让聪明的模型显得愚蠢，好的工具链赋予它们超能力。Claude Code（在我看来）是可用的最佳工具链。

## 功能支持

- **WhatsApp 输入/输出** - 从手机向 Claude 发送消息
- **隔离的群组上下文** - 每个群组都有自己的 `CLAUDE.md` 记忆、隔离的文件系统，并在自己的容器沙箱中运行，仅挂载该文件系统
- **主通道** - 您的私人通道（自聊）用于管理控制；其他群组完全隔离
- **定时任务** - 运行 Claude 并可以回复您的周期性作业
- **网络访问** - 搜索和获取内容
- **容器隔离** - Agent 在 Apple Container（macOS）或 Docker（macOS/Linux）中沙箱化
- **Agent 群体** - 组建专业 agent 团队协作处理复杂任务（首个支持此功能的个人 AI 助手）
- **可选集成** - 通过技能添加 Gmail (`/add-gmail`) 等

## 使用方法

使用触发词（默认：`@Andy`）与您的助手交谈：

```
@Andy 每个工作日上午 9 点发送销售管道概览（可以访问我的 Obsidian vault 文件夹）
@Andy 每周五回顾过去一周的 git 历史，如果有偏离则更新 README
@Andy 每周一上午 8 点，从 Hacker News 和 TechCrunch 收集 AI 新闻并发送简报给我
```

从主通道（您的自聊），您可以管理群组和任务：
```
@Andy 列出所有群组的定时任务
@Andy 暂停周一简报任务
@Andy 加入家庭聊天群组
```

## 定制化

无需学习配置文件。只需告诉 Claude Code 您想要什么：

- "将触发词改为 @Bob"
- "以后记住让回复更简洁直接"
- "说早安时添加自定义问候"
- "每周存储对话摘要"

或运行 `/customize` 进行引导式更改。

代码库足够小，Claude 可以安全地修改它。

## 贡献

**不要添加功能。添加技能。**

如果您想添加 Telegram 支持，不要创建与 WhatsApp 一起添加 Telegram 的 PR。相反，贡献一个技能文件（`.claude/skills/add-telegram/SKILL.md`），教 Claude Code 如何转换 NanoClaw 安装以使用 Telegram。

用户然后在他们的 fork 上运行 `/add-telegram`，获得完全符合需求的干净代码，而不是一个试图支持每个用例的臃肿系统。

### 技能征集 (RFS)

我们希望看到的技能：

**通信通道**
- `/add-telegram` - 添加 Telegram 作为通道。应该给用户选择替换 WhatsApp 或作为额外通道添加。还应该可以将其作为控制通道（可以触发操作）或仅在别处触发的操作中使用的通道添加
- `/add-slack` - 添加 Slack
- `/add-discord` - 添加 Discord

**平台支持**
- `/setup-windows` - 通过 WSL2 + Docker 支持 Windows

**会话管理**
- `/add-clear` - 添加一个 `/clear` 命令，压缩对话（在同一会话中保留关键信息的同时总结上下文）。需要弄清楚如何通过 Claude Agent SDK 以编程方式触发压缩。

## 系统要求

- macOS 或 Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Apple Container](https://github.com/apple/container) (macOS) 或 [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

## 架构

```
WhatsApp (baileys) --> SQLite --> 轮询循环 --> 容器 (Claude Agent SDK) --> 响应
```

单 Node.js 进程。Agent 在挂载目录的隔离 Linux 容器中执行。每群组消息队列，带并发控制。通过文件系统进行 IPC。

核心文件：
- `src/index.ts` - 编排器：状态、消息循环、agent 调用
- `src/channels/whatsapp.ts` - WhatsApp 连接、认证、发送/接收
- `src/ipc.ts` - IPC 监听器和任务处理
- `src/router.ts` - 消息格式化和出站路由
- `src/group-queue.ts` - 每群组队列，带全局并发限制
- `src/container-runner.ts` - 生成流式 agent 容器
- `src/task-scheduler.ts` - 运行定时任务
- `src/db.ts` - SQLite 操作（消息、群组、会话、状态）
- `groups/*/CLAUDE.md` - 每群组记忆

## 常见问题

**为什么用 WhatsApp 而不是 Telegram/Signal 等？**

因为我用 WhatsApp。Fork 它并运行技能来更改它。这就是重点。

**为什么用 Apple Container 而不是 Docker？**

在 macOS 上，Apple Container 轻量、快速，并针对 Apple silicon 进行了优化。但也完全支持 Docker——在 `/setup` 期间，您可以选择使用哪个运行时。在 Linux 上，自动使用 Docker。

**我可以在 Linux 上运行吗？**

可以。运行 `/setup`，它会自动配置 Docker 作为容器运行时。感谢 [@dotsetgreg](https://github.com/dotsetgreg) 贡献 `/convert-to-docker` 技能。

**这安全吗？**

Agent 运行在容器中，而非应用级权限检查之后。它们只能访问显式挂载的目录。您仍应审查运行内容，但代码库足够小，实际上可以做到。参见 [docs/SECURITY.md](docs/SECURITY.md) 了解完整安全模型。

**为什么没有配置文件？**

我们不想要配置混乱。每个用户都应该自定义它，使代码完全匹配他们想要的内容，而不是配置通用系统。如果您喜欢配置文件，告诉 Claude 添加它们。

**如何调试问题？**

询问 Claude Code。"为什么调度器没有运行？" "最近的日志里有什么？" "为什么这条消息没有回复？" 这就是 AI 原生方法。

**为什么设置对我不起作用？**

我不知道。运行 `claude`，然后运行 `/debug`。如果 claude 发现的问题可能影响其他用户，请打开 PR 修改 setup SKILL.md。

**哪些更改将被接受到代码库中？**

安全修复、bug 修复和对基础配置的明确改进。就这样。

其他所有内容（新功能、操作系统兼容性、硬件支持、增强）都应该作为技能贡献。

这保持基础系统最小化，并让每个用户定制他们的安装，而无需继承他们不想要的功能。

## 社区

有问题？想法？[加入 Discord](https://discord.gg/VGWXrf8x)。

## 许可证

MIT
