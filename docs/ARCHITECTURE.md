# NanoClaw 系统架构

## 1. 概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Channels                           │
│              (飞书 / +skills: Telegram, Discord, Slack...)          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ 消息
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      主进程 (Node.js)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ Channel  │  │  Queue   │  │   DB     │  │   IPC Watcher        │ │
│  │ (WA/FS)  │─▶│ (Group)  │  │ (SQLite) │  │   (消息/任务/图片)    │ │
│  └──────────┘  └────┬─────┘  └──────────┘  └──────────────────────┘ │
│                     │                                                │
│                     │  (主进程不加载 Claude，只做调度)                │
└─────────────────────┼────────────────────────────────────────────────┘
                      │ spawn
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Docker Container (nanoclaw-agent)                  │
│  ┌────────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │
│  │ Claude Agent   │  │ MCP Server  │  │ 挂载目录                │   │
│  │ SDK            │◀─│ (IPC Tools) │  │ (group/ipc/.claude/...) │   │
│  └────────────────┘  └─────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**核心设计**：
- 单 Node.js 进程 + 按需启动的容器
- 主进程不加载 Claude，只负责调度和路由
- 容器内运行 Claude Agent SDK，拥有完整能力
- 渠道系统：核心仅含飞书，其他渠道（Telegram、Discord、Slack、Gmail）通过 skills 安装

---

## 2. 认证与配置传递

### 2.1 主进程 vs 容器

| 组件 | 是否加载 Claude | 职责 |
|------|----------------|------|
| 主进程 | ❌ | 消息路由、队列管理、容器调度、IPC 处理 |
| 容器 | ✅ | 执行 Claude Agent SDK，调用工具，生成响应 |

### 2.2 环境变量传递流程

```
.env (主机)
    │
    ▼ 主进程启动时过滤 (readEnvFile)
┌─────────────────────────────────────────────────────────────────┐
│ 仅提取 Claude 认证相关变量:                                      │
│   - CLAUDE_CODE_OAUTH_TOKEN                                     │
│   - ANTHROPIC_API_KEY                                           │
│   - ANTHROPIC_AUTH_TOKEN                                        │
│   - ANTHROPIC_BASE_URL                                          │
│   - ANTHROPIC_DEFAULT_*_MODEL                                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ 通过 Docker -e 参数传递
docker run -e CLAUDE_CODE_OAUTH_TOKEN=xxx -e ANTHROPIC_API_KEY=xxx ...
    │
    ▼
Claude Agent SDK 获得认证，可正常调用 API
```

**安全设计**：
- 完整 `.env` 不会被挂载（含 Channel 密钥等）
- 只提取 Claude 需要的变量
- 通过环境变量传递，不写入容器文件系统

---

## 3. 数据持久化哲学

### 3.1 目录分层

```
nanoclaw/
├── groups/                    # 配置 ──────▶ GitHub ✅
│   ├── main/
│   │   ├── CLAUDE.md         # 主群组记忆
│   │   ├── MEMORY.md         # 永久记忆（决策、偏好）
│   │   ├── memory/           # 每日日志目录
│   │   │   └── 2026-03-14.md
│   │   ├── logs/             # 容器日志
│   │   │   └── container-{ts}.log
│   │   ├── images/           # 图片文件
│   │   └── .nanoclaw/        # NanoClaw 元数据
│   │       └── compact-summary.md
│   └── global/CLAUDE.md       # 全局共享记忆
│
├── src/                       # 源码 ──────▶ GitHub ✅
│   ├── channels/
│   │   ├── registry.ts       # 渠道注册表
│   │   └── feishu.ts         # 飞书渠道（核心）
│   ├── router.ts              # 消息路由、图片处理
│   └── ...
├── container/                 # 容器定义 ──▶ GitHub ✅
│   ├── agent-runner/          # Agent 运行时
│   └── skills/                # 共享技能
├── package.json
│
├── data/                      # 运行时数据 ─▶ GitHub ❌ (本地持久化)
│   ├── sessions/{folder}/     # Claude 会话、设置、技能副本
│   │   ├── .claude/           # Claude 配置
│   │   └── agent-runner-src/  # 运行时代码副本
│   ├── ipc/{folder}/          # IPC 通信
│   └── nanoclaw.db            # SQLite 数据库
│
├── store/                     # Channel 认证 ─▶ GitHub ❌
├── .env                       # 密钥 ────────▶ GitHub ❌
└── logs/                      # 主进程日志 ──▶ GitHub ❌
```

### 3.2 设计原则

| 内容 | 存储 | 版本控制 | 原因 |
|------|------|---------|------|
| 源码、配置模板 | 项目目录 | ✅ GitHub | 标准项目流程，可复现 |
| 运行时数据 | `data/` | ❌ 本地 | 用户特定，私密，可能很大 |
| Channel 认证 | `store/` | ❌ 本地 | 安全敏感 |
| API 密钥 | `.env` | ❌ 本地 | 安全敏感 |

### 3.3 备份策略

如需持久化 `data/`：
```bash
# 简单备份
tar -czf nanoclaw-data-$(date +%Y%m%d).tar.gz data/

# 同步到云存储
rsync -avz data/ remote:nanoclaw-data/

# 或使用云盘同步工具
```

---

## 4. 消息流

### 4.1 入站：从 Channel 到 Claude

```
用户消息 ──▶ Channel.receive() ──▶ DB.storeMessage() ──▶ Queue.enqueue()
                                                              │
                                                              ▼
                                              Queue 检查：容器是否运行？
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                                 运行中          空闲/未启动      并发超限
                              标记待处理         启动容器        排队等待
                                                    │
                                                    ▼
                                            processGroupMessages()
                                                    │
                        ┌───────────────────────────┼───────────────────┐
                        ▼                           ▼                   ▼
                  DB.getMessagesSince()     writeTasksSnapshot()  writeGroupsSnapshot()
                  (获取未读消息)              (任务列表)            (可用群组)
                        │
                        ▼
                  formatMessages() ──▶ runContainerAgent()
                  (XML 格式化)             │
                                           ▼
                                   spawn('docker', args)
                                   stdin: JSON input
```

### 4.2 出站：从 Claude 到用户

```
容器内 Claude 响应
        │
        ├──▶ stdout (最终输出)
        │         │
        │         ▼
        │   OUTPUT_START_MARKER
        │   JSON.stringify({status, result})
        │   OUTPUT_END_MARKER
        │         │
        │         ▼
        │   主进程解析 ──▶ onOutput() ──▶ channel.sendMessage()
        │
        └──▶ MCP Tool: send_message (即时消息)
                    │
                    ▼
              写入 /workspace/ipc/messages/*.json
                    │
                    ▼
              主进程 IPC Watcher 轮询
                    │
                    ▼
              channel.sendMessage()
```

### 4.3 会话连续性

```
首次对话 ──▶ sessionId = undefined ──▶ Claude 创建新会话
                                           │
                                           ▼
                               返回 newSessionId
                                           │
                                           ▼
                     主进程: sessions[groupFolder] = newSessionId
                     数据库: 持久化 sessionId
                                           │
                                           ▼
                     下次对话: 读取 sessionId
                                           │
                                           ▼
                               Claude 恢复完整上下文
```

---

## 5. 容器挂载

### 5.1 主群组 (Main Group)

| 主机路径 | 容器路径 | 权限 | 用途 |
|---------|---------|:----:|------|
| `项目根目录` | `/workspace/project` | 🔒 | 项目源码（仅限主群组） |
| `groups/main` | `/workspace/group` | ✏️ | 群组配置和工作目录 |
| `data/sessions/main/.claude` | `/home/node/.claude` | ✏️ | Claude 会话、设置、技能 |
| `data/ipc/main` | `/workspace/ipc` | ✏️ | IPC 通信目录 |
| `data/sessions/main/agent-runner-src` | `/app/src` | ✏️ | 运行时代码（可定制） |

### 5.2 普通群组 (Non-Main Groups)

| 主机路径 | 容器路径 | 权限 | 用途 |
|---------|---------|:----:|------|
| `groups/{folder}` | `/workspace/group` | ✏️ | 群组配置和工作目录 |
| `groups/global` | `/workspace/global` | 🔒 | 全局共享记忆 |
| `data/sessions/{folder}/.claude` | `/home/node/.claude` | ✏️ | Claude 会话、设置、技能 |
| `data/ipc/{folder}` | `/workspace/ipc` | ✏️ | IPC 通信目录 |
| `data/sessions/{folder}/agent-runner-src` | `/app/src` | ✏️ | 运行时代码（可定制） |

### 5.3 共享挂载（所有群组）

| 主机路径 | 容器路径 | 权限 | 用途 |
|---------|---------|:----:|------|
| `data/gradle-cache` | `/home/node/.gradle/caches` | ✏️ | Gradle 依赖缓存（加速构建） |
| `~/.ssh` | `/home/node/.ssh` | 🔒 | SSH keys（git 推送） |

### 5.4 设计说明

**群组目录可写**：`/workspace/group` 是读写挂载，Agent 可以在其中创建和修改文件（如生成的图表、报告等）。

**运行时代码可定制**：`agent-runner/src` 首次运行时从 `container/agent-runner/src` 复制到 `data/sessions/{folder}/agent-runner-src`，每个群组可以独立定制 MCP 工具而不影响其他群组。

**Gradle 缓存共享**：所有群组共享 `data/gradle-cache`，首次构建后依赖被缓存，后续构建大幅加速。

**SSH keys 只读**：挂载主机 `~/.ssh` 为只读，Agent 可以推送代码到 GitHub/GitLab，但无法修改密钥。

**额外挂载**：通过 `containerConfig.additionalMounts` 配置，需通过 `~/.config/nanoclaw/mount-allowlist.json` 白名单验证。

---

## 6. 日志流

```
┌────────────────────────────────────────────────────────────────┐
│                        容器执行期间                             │
│                                                                 │
│  container.stdout ──▶ 累积到内存变量 `stdout`                  │
│  container.stderr ──▶ 累积到内存变量 `stderr`                  │
│                      (实时打印到 logger.debug)                  │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼ 容器退出
┌────────────────────────────────────────────────────────────────┐
│                        写入日志文件                             │
│                                                                 │
│  groups/{folder}/logs/container-{timestamp}.log                │
│                                                                 │
│  内容取决于 LOG_LEVEL 和退出码:                                 │
│  - 正常退出: 元数据 + Input 摘要                                │
│  - 错误退出: 完整记录 (Input/Stdout/Stderr)                     │
│  - 超时: 简化日志 (标记 TIMEOUT)                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. 上下文感知

### 7.1 消息上下文

```xml
<messages>
  <message sender="张三" time="2026-02-14T10:00:00Z">你好</message>
  <message sender="李四" time="2026-02-14T10:01:00Z">@Andy 帮我查天气</message>
</messages>
```

由 `formatMessages()` 从数据库获取上次响应后的所有消息。

### 7.2 会话上下文

- **sessionId** 持久化在 `data/sessions/` 和数据库
- Claude SDK 通过 sessionId 恢复完整对话历史
- 会话压缩时，归档到 `groups/{folder}/conversations/`

### 7.3 文件记忆

- `CLAUDE.md` 定义 Agent 规则和能力
- `conversations/` 存储历史对话 (可搜索)
- 用户自定义文件 (如 `customers.md`)

---

## 8. 技能加载

```
容器启动前 (主进程):
  container/skills/          ──copy──▶  data/sessions/{folder}/.claude/skills/
                                        │
                                        ▼
                               挂载到容器 /home/node/.claude/skills/
                                        │
                                        ▼
容器启动后:
                               Claude SDK 自动加载 SKILL.md
```

**设计要点**：
- 技能从 `container/skills/` 复制到每个群组的 sessions 目录
- 每个群组拥有独立的技能副本，可以定制
- 复制发生在每次容器启动前，确保技能更新生效

---

## 9. Channel 抽象

### 9.1 Channel 接口

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  sendImage?(jid: string, imagePath: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}
```

### 9.2 已实现渠道

> **注意**：核心代码仅包含飞书渠道。其他渠道通过 skills 安装（`/add-telegram`、`/add-discord` 等）。

| 渠道 | JID 格式 | 连接方式 | 安装方式 | 特性 |
|------|---------|---------|---------|------|
| 飞书 | `oc_xxx` (群) / `ou_xxx` (用户) | WebSocket | 核心 | 图片收发、长消息上传、自动注册、真实群名 |
| WhatsApp | `xxx@g.us` / `xxx@s.whatsapp.net` | WebSocket | `/add-whatsapp` | 打字指示器 |
| Telegram | `tg:xxx` | HTTP API | `/add-telegram` | 打字指示器 |
| Discord | `dc:xxx` | WebSocket | `/add-discord` | 机器人频道 |
| Slack | `slack:xxx` | Socket Mode | `/add-slack` | 打字指示器 |
| Gmail | `gmail:xxx` | OAuth2 | `/add-gmail` | 邮件读写 |

### 9.3 飞书渠道详细说明

**连接方式**：WebSocket（无需公网 URL，支持 NAT/防火墙环境）

**消息类型支持**：
- 文本消息：直接处理
- 图片消息：下载到 `groups/{folder}/images/`，路径注入消息内容

**长消息处理**：
- 阈值：`FEISHU_DOC_THRESHOLD`（默认 2000 字符）
- 超过阈值时上传 Markdown 文件到飞书云盘
- 文件组织：`Plans/{GroupName}/{title}_{timestamp}.md`
- 自动生成标题：从内容中提取 Markdown 标题或首行

**群组自动注册**：
- 新群组收到消息时自动注册
- 通过 API 获取真实群组名称
- 文件夹命名：`feishu_{chatId后6位}`

**配置项**：
| 环境变量 | 说明 | 默认值 |
|---------|------|-------|
| `FEISHU_APP_ID` | 飞书应用 ID | 必填 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 必填 |
| `FEISHU_ADMIN_USER_ID` | 管理员用户 ID（用于文件权限） | 可选 |
| `FEISHU_DOC_THRESHOLD` | 长消息阈值 | 2000 |

### 9.4 消息路由

```
消息到达 → findChannel(channels, jid) → channel.sendMessage()
                │
                ├── WhatsApp: jid.startsWith('@g.us') 或 '@s.whatsapp.net'
                └── 飞书: jid.startsWith('oc_') 或 'ou_'
```

---

## 10. IPC 通信

容器通过 MCP Tools 与主进程通信：

| Tool | 写入目录 | 主进程处理 |
|------|---------|-----------|
| `send_message` | `ipc/{folder}/messages/` | IPC Watcher → Channel |
| `send_image` | `ipc/{folder}/messages/` | IPC Watcher → Channel.sendImage |
| `schedule_task` | `ipc/{folder}/tasks/` | IPC Watcher → DB |
| `pause_task` | `ipc/{folder}/tasks/` | IPC Watcher → DB |
| `register_group` | `ipc/{folder}/tasks/` | IPC Watcher → 注册 |

**安全隔离**：每个群组只能访问自己的 IPC 目录。

---

## 11. 图片处理

### 11.1 接收图片

```
用户发送图片 (飞书)
        │
        ▼
FeishuChannel.downloadAndSaveImage()
        │
        ▼
保存到 groups/{folder}/images/downloaded-{hash}.jpg
        │
        ▼
消息内容替换为: [用户发送了图片] 图片路径: /workspace/group/images/xxx.jpg
        │
        ▼
Agent 使用 Read 工具查看图片
```

### 11.2 发送图片

```
Agent 生成图片 (markdown 格式)
        │
        ▼
输出: ![描述](https://example.com/chart.png)
        │
        ▼
router.processAndSendImages() 检测 markdown 图片链接
        │
        ▼
downloadImage() 下载到 groups/{folder}/images/
        │
        ▼
channel.sendImage() 上传并发送
        │
        ▼
从文本中移除 markdown 链接
```

**设计要点**：
- 自动处理：Agent 无需手动调用 send_image，输出 markdown 图片链接即可
- 支持所有渠道：飞书已实现 sendImage，其他渠道可扩展
- 图片持久化：下载的图片保存在群组目录，便于后续引用

---

## 12. 上下文管理

### 12.1 问题背景

GLM-5 等 200K context 模型在长期对话中会耗尽上下文窗口，导致 API 错误：
```
API Error: The model has reached its context window limit.
```

### 12.2 三层防御机制

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: Memory Flush (60K threshold)                              │
│  接近 compact 阈值时，触发静默 turn 让模型写入记忆                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: Auto Compact (50K threshold)                              │
│  当剩余 tokens < 阈值时，结束当前会话，下次启动新会话                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: Persistent Memory (文件系统)                              │
│  - MEMORY.md: 永久记忆（决策、偏好、关键信息）                       │
│  - memory/YYYY-MM-DD.md: 每日日志（append-only）                     │
│  新会话自动加载这些文件作为上下文                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.3 Auto Compact vs Manual /compact

系统提供两种 compact 方式：

| 特性 | Auto Compact | Manual `/compact` |
|------|-------------|------------------|
| **触发方式** | 自动（剩余 tokens < 50K） | 手动发送 `/compact` 命令 |
| **控制权** | 系统自动管理 | 用户主动控制 |
| **会话处理** | 结束会话，生成 summary，下次启动新会话 | 生成 summary，清空当前会话 |
| **适用场景** | 防止 API 上下文超限报错 | 用户感觉"对话太长"时主动清理 |
| **权限** | 无限制（系统自动） | 所有群组可用 |

**工作流程对比**：

```
Auto Compact (自动):
  remainingTokens < 50K
      → 静默 prompt: "生成 summary"
      → 模型写入 .nanoclaw/compact-summary.md
      → 容器退出，主进程清除 sessionId
      → 下次消息 → 新会话 + 注入 summary

Manual /compact (手动):
  用户发送: "/compact"
      → 静默 prompt: "生成 summary"
      → 模型写入 .nanoclaw/compact-summary.md
      → 主进程清除 sessionId
      → 后续消息 → 新会话 + 注入 summary
```

两种方式都会生成 `compact-summary.md` 并归档完整对话到 `conversations/`。

### 12.4 Memory Flush + Compact Summary 流程

```
Agent 返回 result 消息
        │
        ├── 检查 usage.contextWindow - usage.inputTokens
        │
        ├── 如果 remaining < MEMORY_FLUSH_THRESHOLD (60K)
        │       │
        │       ▼
        │   注入静默 prompt:
        │   "[SYSTEM] Context approaching limit.
        │    Write important info to MEMORY.md or memory/YYYY-MM-DD.md.
        │    Reply with NO_REPLY if nothing to store."
        │       │
        │       ▼
        │   模型写入记忆文件
        │       │
        │       ▼
        │   继续处理后续消息
        │
        └── 如果 remaining < COMPACT_THRESHOLD (50K)
                │
                ▼
            生成 Compact Summary:
            "[SYSTEM] Session about to compact.
             Write summary to .nanoclaw/compact-summary.md"
                │
                ▼
            模型写入 summary 文件
                │
                ▼
            返回 needsCompact: true
                │
                ▼
            主进程清除 sessionId
                │
                ▼
            下次启动新会话时:
            读取 .nanoclaw/compact-summary.md
            注入为上下文 "[CONTEXT FROM PREVIOUS SESSION]"
```

### 12.5 Compact Summary 文件

位置：`groups/{folder}/.nanoclaw/compact-summary.md`

```markdown
# Session Summary - 2026-03-06

## Current Task
- Working on Android app build optimization
- Gradle cache mount added, testing speed improvements

## Key Decisions
- Use Apple Container on macOS, Docker on Linux
- Memory flush threshold: 60K tokens
- Compact threshold: 50K tokens

## Pending Actions
- [ ] Test build performance after cache warmup
- [ ] Update documentation with new mount config

## Important Context
- User prefers concise responses in Chinese
- Main channel is self-chat for admin control
```

### 12.6 配置项

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `COMPACT_THRESHOLD_TOKENS` | 50000 | 剩余 tokens < 此值时触发 compact |
| `MEMORY_FLUSH_THRESHOLD_TOKENS` | 60000 | 剩余 tokens < 此值时触发 memory flush |
| `MEMORY_FLUSH_PROMPT` | (内置) | 自定义 memory flush 提示 |
| `CONTEXT_WINDOW` | 200000 | 上下文窗口大小 |

**配置原则**：
- `MEMORY_FLUSH_THRESHOLD` > `COMPACT_THRESHOLD`（让 flush 先触发）
- 两者差值约 10K，给 flush 留出足够空间
- 设为 0 可禁用对应功能

### 12.7 Token 计算机制（Gateway Tokenizer）

系统使用 **Gateway Sidecar + Tokenizer** 方式计算 token，比依赖 API 返回更可靠：

```
SDK 请求 ──▶ Gateway (sidecar) ──▶ API
                  │
                  ├── tokenizer.countTokens(request)
                  │
                  ▼
         .nanoclaw/usage-cache.json
                  │
                  ▼
         /usage 命令 / auto compact 读取
```

**缓存文件** (`groups/{folder}/.nanoclaw/usage-cache.json`):
```json
{
  "timestamp": "2026-03-14T10:00:00Z",
  "inputTokens": 50000,
  "outputTokens": 1000,
  "contextWindow": 200000,
  "remainingTokens": 150000,
  "model": "glm-5",
  "success": true
}
```

**优点**：
| 特性 | 说明 |
|------|------|
| **准确性** | 使用 `gpt-tokenizer` 自计算，不依赖 API 响应 |
| **实时性** | 每次请求后立即更新 |
| **独立性** | 不依赖特定 API 提供商的响应格式 |
| **可靠性** | 即使 API 返回 usage 为空也能工作 |

**数据流**：
```
1. SDK 发送请求 → Gateway
2. Gateway 使用 tokenizer 计算 inputTokens
3. 转发请求到 API
4. 收到响应后，更新 usage-cache.json
   - 优先使用 API 返回的 usage（如果有）
   - fallback 到 tokenizer 计算值
5. /usage 和 auto compact 从缓存读取
```

### 12.8 记忆文件结构

```
groups/{folder}/
├── MEMORY.md                    # 永久记忆（手动/自动维护）
│   - 用户偏好
│   - 重要决策
│   - 关键项目信息
│
├── memory/                      # 每日日志目录
│   ├── 2026-03-06.md           # 当天日志 (append-only)
│   ├── 2026-03-07.md
│   └── ...
│
├── CLAUDE.md                    # Agent 行为规则（手动编辑）
│
└── conversations/               # 历史对话归档
    ├── 2026-03-06-conversation-xxx.md
    └── ...
```

### 12.8 数据流

**Container → Host**:
```typescript
interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  needsCompact?: boolean;        // 触发 compact 信号
  remainingTokens?: number;      // 剩余 tokens
}
```

**Host 处理**:
```typescript
// src/index.ts
if (output.needsCompact) {
  logger.info('Context threshold reached, clearing session');
  delete sessions[group.folder];
  setSession(group.folder, '');
  // Summary is already saved by container in .nanoclaw/compact-summary.md
}
```

**Container 内部 - Memory Flush**:
```typescript
// container/agent-runner/src/index.ts
if (remainingTokens < memoryFlushThreshold && !memoryFlushed) {
  await runQuery(flushPrompt, ...);  // 写入 MEMORY.md + memory/YYYY-MM-DD.md
  memoryFlushed = true;
}
```

**Container 内部 - Compact Summary**:
```typescript
// 生成 compact summary
if (needsCompact) {
  await runQuery(summaryPrompt, ...);  // 写入 .nanoclaw/compact-summary.md
  writeOutput({ needsCompact: true, remainingTokens });
  break;
}
```

**新 Session 启动**:
```typescript
// 读取 compact summary 并注入
if (!sessionId) {
  const summaryPath = path.join('/workspace/group', '.nanoclaw/compact-summary.md');
  if (fs.existsSync(summaryPath)) {
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    prompt = `[CONTEXT FROM PREVIOUS SESSION]\n${summary}\n\n[NEW MESSAGE]\n${prompt}`;
  }
}
```

---

## 13. 会话命令

用户可以通过发送 `/command` 格式的消息执行会话管理操作：

### 13.1 可用命令列表

| 命令 | 说明 | 示例 |
|------|------|------|
| `/status` | 查看容器运行状态 | `/status` |
| `/new` | 创建新会话（清除当前会话） | `/new` |
| `/usage` | 查看 token 使用情况 | `/usage` |
| `/compact` | 手动压缩会话（生成摘要并创建新会话） | `/compact` |
| `/skills` | 查看当前支持的技能列表 | `/skills` |
| `/groups` | 查看所有已注册群组 | `/groups` |
| `/groups <folder>` | 查看指定群组详情 | `/groups main` |
| `/verbose` | 开启详细输出（助手思考 + 工具调用） | `/verbose` |
| `/quiet` | 只发送最终结果（默认） | `/quiet` |
| `/help` | 显示帮助信息 | `/help` |

### 13.2 命令处理流程

```
消息到达 → 检查是否为 /command
              │
              ├── Yes → 直接执行命令，返回结果
              │         （不经过 Agent，主进程处理）
              │
              └── No → 正常消息流程
                        （检查触发词 → 进入队列 → Agent 处理）
```

### 13.3 输出模式

| 模式 | 说明 |
|------|------|
| `quiet` | 只发送最终结果（默认） |
| `verbose` | 显示助手思考过程和工具调用详情 |

**切换方式**：
- `/verbose` - 开启详细输出
- `/quiet` - 切换回安静模式

### 13.4 /usage 命令输出示例

```
📊 **会话 Token 使用情况**

- 上下文: 45,230 / 200,000 (22.6%)
- 剩余: 154,770 tokens
- 会话: 活跃 (a1b2c3d4...)
- 更新: 5 分钟前
```

### 13.5 /groups 命令输出示例

**列表模式** (`/groups`):
```
📁 **已注册群组 (3个)**

| Folder | 名称 | 触发词 | 输出模式 |
|--------|------|--------|----------|
| main | 主控 | 无 | quiet |
| feishu_9953d4 | 产品讨论群 | @Andy | verbose |
| feishu_65a3b8 | 技术交流群 | @Andy | quiet |
```

**详情模式** (`/groups main`):
```
📁 **群组: main**

• 名称: 主控
• JID: ou_xxxx
• 触发词: 无
• 输出模式: quiet
• 添加时间: 2026/3/1
• 容器超时: 30分钟 (默认)
• 类型: 主控群组
```

