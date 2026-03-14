<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<h1 align="center">NanoClaw</h1>

<p align="center">
  <strong>个人 AI 助手</strong>
</p>

<p align="center">
  安全 · 轻量 · 可定制
</p>

<p align="center">
  <a href="https://nanoclaw.dev">文档</a> •
  <a href="https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes">Docker 沙箱</a> •
  <a href="https://discord.gg/VDdww8qS42">Discord</a>
</p>

<p align="center">
  <a href="https://github.com/qwibitai/nanoclaw/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/qwibitai/nanoclaw/main?label=CI" alt="CI">
  </a>
  <a href="https://github.com/qwibitai/nanoclaw/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/qwibitai/nanoclaw" alt="License">
  </a>
  <img src="repo-tokens/badge.svg" alt="Token count">
</p>

---

## 简介

NanoClaw 是一个个人 AI 助手，运行在容器化沙箱中，通过飞书、Telegram、Discord、Slack、Gmail 等渠道与你交互。

**为什么选择 NanoClaw？**

- **轻量** — 单进程、SQLite 数据库、 无微服务架构
- **安全** — Agent 运行在隔离的 Linux 容器中，只能访问明确挂载的目录
- **AI 原生** — 通过 Claude Code 设置、调试和定制
- **易于定制** — 直接修改代码，无需配置文件
- **技能系统** — 通过技能添加功能，保持代码库精简

## 快速开始

```bash
gh repo fork qwibitai/nanoclaw --clone
cd nanoclaw
claude
```

然后运行 `/setup`。 Claude Code 会处理一切：依赖安装、身份认证、容器构建和服务配置。

> **注意：**
> - 以 `/` 开头的命令（如 `/setup`、`/add-feishu`）是 [Claude Code 技能](https://code.claude.com/docs/zh/skills)
。
> - 在 `claude` CLI 提示符中输入，而不是在普通终端中。
 如果还没有安装 Claude Code，请访问 [claude.com/product/claude-code](https://claude.com/product/claude-code)。

## 设计理念

**小而精。** 一个进程、几个源文件，无微服务。如果你想理解完整的 NanoClaw 代码库，直接让 Claude Code 为你讲解。

**安全隔离。** Agent 运行在 Linux 容器中，只能看到明确挂载的内容。 Bash 访问是安全的，因为命令在容器内运行，不在你的主机上。

**为个人用户设计。** NanoClaw 不是臃肿的框架，而是适合每个用户的软件。 Fork 你自己的版本，让 Claude Code 根据你的需求修改它。

**定制即修改代码。** 没有配置文件。想要不同的行为？ 修改代码。 代码库足够小，修改是安全的。

**AI 原生。**
- 没有安装向导； Claude Code 指导设置
- 没有监控面板； 询问 Claude 发生了什么
- 没有调试工具； 描述问题，Claude 修复

**技能优先。** 不向代码库添加功能，而是贡献者提交 [Claude Code 技能](https://code.claude.com/docs/zh/skills)，，如 `/add-telegram` 来转换你的 fork。最终你得到完全符合需求的精简代码。

**最佳框架，最佳模型。** NanoClaw 运行在 Claude Agent SDK 上，意味着你直接运行 Claude Code。 Claude Code 的编码和问题解决能力可以修改和扩展 NanoClaw，为每个用户量身定制。

## 支持的渠道

- **飞书** — 通过 WebSocket 连接，无需公网 URL，支持私聊和群聊
 DM bot 直接
 群聊中 @机器人 触发
 图片收发、 长消息上传到云盘
 通过 `/add-feishu` 添加
- **Telegram** — 支持 DM 和群聊，通过 `/add-telegram` 添加
- **Discord** — 机器人频道集成。 通过 `/add-discord` 添加
- **Slack** — Socket Mode（无需公网 URL）。通过 `/add-slack` 添加
- **Gmail** — 读取和发送邮件。 通过 `/add-gmail` 添加
- **WhatsApp** — 支持 QR 码配对。 通过 `/add-whatsapp` 添加

## 功能特性

- **多渠道消息** — 从飞书、Telegram、Discord、Slack、Gmail 或 WhatsApp 与助手交互。可同时运行多个渠道
- **隔离的群组上下文** — 每个群组有自己的 `CLAUDE.md` 内存、隔离的文件系统，运行在独立的容器沙箱中
- **主频道** — 你的私聊频道用于管理控制；每个群组完全隔离
- **定时任务** — 定期运行 Claude 并回复你
- **网络访问** — 搜索和获取网络内容
- **容器隔离** — Agent 在 [Docker 沙箱](https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes) 中运行（微 VM 隔离）、或 Apple Container（macOS）或 Docker（macOS/Linux）
）
- **Agent 团队** — 启动专门的 agent 团队协作处理复杂任务
- **可选集成** — 通过技能添加 Gmail 等

## 使用方法

 使用触发词（默认：`@Andy`）与助手交互：

```
@Andy 每个工作日早上 9 点发送销售管道概览（可以访问我的 Obsidian 库文件夹）
 @Andy 每周五审查过去一周的 git 历史，如果有变化就更新 README
 @Andy 每周一早上 8 点，从 Hacker News 和 TechCrunch 收集 AI 发展新闻并发送简报
```

在主频道（你的自聊）中，可以管理群组和任务：
 ```
@Andy 列出所有群组的定时任务
 @Andy 暂停周一简报任务
 @Andy 加入家庭聊天群组
```

## 定制

NanoClaw 不使用配置文件。要修改，直接告诉 Claude Code 你想要什么：

- "把触发词改成 @Bob"
- "以后回复要更简短直接"
- "早上好时添加自定义问候"
- "每周存储对话摘要"

或运行 `/customize` 进行引导式修改。

代码库足够小，Claude 可以安全地修改它。

## 贡献

**不要添加功能。添加技能。**

如果你想添加 Telegram 支持？不要创建向核心代码库添加 Telegram 的 PR。而是 fork NanoClaw，在分支上进行代码修改，然后开 PR。我们会从你的 PR 创建 `skill/telegram` 分支，其他用户可以合并到他们的 fork。

用户然后在他们的 fork 上运行 `/add-telegram`，得到完全符合需求的精简代码，而不是一个试图支持所有用例的臃肿系统。

### 技能需求 (RFS)

 我们想要的技能：

**通讯渠道**
- `/add-signal` — 添加 Signal 渠道

**会话管理**
- `/clear` — 添加 `/clear` 命令压缩对话（保留关键信息的同时总结上下文）。需要通过 Claude Agent SDK 以编程方式触发压缩。

## 系统要求

 - macOS 或 Linux
 - Node.js 20+
- [Claude Code](https://claude.ai/download)
 - [Apple Container](https://github.com/apple/container) (macOS) 或 [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

 - 飞书渠道：飞书自建应用（在 [飞书开放平台](https://open.feishu.cn) 创建）

## 架构

```
Channels --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

单个 Node.js 进程。渠道通过技能添加并在启动时自注册 — 编排器连接所有有凭据的渠道。Agent 在隔离的 Linux 容器中执行，具有文件系统隔离。只能访问挂载的目录。每群组消息队列带并发控制。通过文件系统进行 IPC。

完整架构细节见 [docs/SPEC.md](docs/SPEC.md)。

关键文件：
- `src/index.ts` — 编排器：状态、消息循环、agent 调用
- `src/channels/registry.ts` — 渠道注册表（启动时自注册）
- `src/channels/feishu.ts` — 飞书渠道实现
- `src/ipc.ts` — IPC 监视器和任务处理
- `src/router.ts` — 消息格式化和出站路由
- `src/config.ts` — 触发词、路径、间隔
- `src/container-runner.ts` — 启动 agent 容器并挂载
- `src/task-scheduler.ts` — 运行定时任务
- `src/db.ts` — SQLite 操作
- `groups/*/CLAUDE.md` — 每群组内存（隔离）

## FAQ

**为什么用 Docker？**

Docker 提供跨平台支持（macOS、Linux 甚至通过 WSL2 的 Windows）和成熟的生态系统。在 macOS 上，可以通过 `/convert-to-apple-container` 切换到 Apple Container 获得更轻量的原生运行时。

**可以在 Linux 上运行吗？**

可以。Docker 是默认运行时，在 macOS 和 Linux 上都能工作。直接运行 `/setup`。

**安全吗？**

Agent 运行在容器中，不是应用级权限检查后面。它们只能访问明确挂载的目录。你仍然应该审查正在运行的内容，但代码库足够小，你实际上可以审查。 完整安全模型见 [docs/SECURITY.md](docs/SECURITY.md)。

**为什么没有配置文件？**

我们不欢配置文件泛滥。每个用户都应该定制 NanoClaw，让代码完全符合需求，而不是配置一个通用系统。如果你喜欢配置文件，可以让 Claude 添加。

**可以使用第三方或开源模型吗？**

可以。NanoClaw 支持任何 Claude API 兼容的模型端点。在 `.env` 文件中设置这些环境变量：

 ```bash
ANTHROPIC_BASE_URL=https://your-api-endpoint.com
ANTHROPIC_AUTH_TOKEN=your-token-here
 ```

这允许你使用：
- 通过 [Ollama](https://ollama.ai) 和 API 代理的本地模型
- 托管在 [Together AI](https://together.ai)、[Fireworks](https://fireworks.ai) 等平台的开源模型
- 具有 Anthropic 兼容 API 的自定义模型部署

注意： 模型必须支持 Anthropic API 格式以获得最佳兼容性。

**如何调试问题？**

问 Claude Code。"为什么调度器没有运行？" "最近的日志有什么？" "为什么这条消息没有得到回复？" 这就是 NanoClaw 背后的 AI 原生方法。

**为什么设置对我不起作用？**

如果设置过程中遇到问题，Claude 会尝试动态修复。如果不行，运行 `claude`，然后运行 `/debug`。如果 Claude 发现可能影响其他用户的问题，请开 PR 修改 setup SKILL.md。

**什么样的更改会被接受到代码库？**

只有安全修复、bug 修复和明确的改进会被接受到基础配置中。仅此而已。

其他所有内容（新功能、OS 兼容性、硬件支持、增强功能）都应该作为技能贡献。

 这保持基础系统最小化，让每个用户定制他们的安装而不继承不需要的功能。

## 社区

有问题？想法？[加入 Discord](https://discord.gg/VDdww8qS42)。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md) 了解破坏性更改和迁移说明。

## 许可证

MIT
