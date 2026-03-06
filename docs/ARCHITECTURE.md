# NanoClaw 系统架构

## 1. 概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Channels                           │
│                    (WhatsApp / 飞书 / Telegram)                     │
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
- 多渠道支持：WhatsApp、飞书（通过 Channel 接口抽象）

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
│   │   ├── logs/             # 容器日志
│   │   └── images/           # 图片文件
│   └── global/CLAUDE.md       # 全局共享记忆
│
├── src/                       # 源码 ──────▶ GitHub ✅
│   ├── channels/
│   │   ├── whatsapp.ts       # WhatsApp 渠道
│   │   └── feishu.ts          # 飞书渠道
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
│  data/logs/{folder}/container-{timestamp}.log                  │
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
- 会话压缩时，归档到 `data/workspace/{folder}/conversations/`

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

| 渠道 | JID 格式 | 连接方式 | 特性 |
|------|---------|---------|------|
| WhatsApp | `xxx@g.us` / `xxx@s.whatsapp.net` | WebSocket | 打字指示器 |
| 飞书 | `oc_xxx` (群) / `ou_xxx` (用户) | WebSocket | 图片收发、自动注册 |

### 9.3 消息路由

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

### 10.1 接收图片

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

### 10.2 发送图片

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
