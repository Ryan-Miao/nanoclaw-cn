# NanoClaw 系统架构

## 1. 概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Channels                           │
│                    (WhatsApp / Feishu / Telegram)                   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ 消息
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      主进程 (Node.js)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ Channel  │  │  Queue   │  │   DB     │  │   IPC Watcher        │ │
│  │ (WA/FS)  │─▶│ (Group)  │  │ (SQLite) │  │   (消息/任务)         │ │
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
│  │ SDK            │◀─│ (IPC Tools) │  │ (env/group/data/...)   │   │
│  └────────────────┘  └─────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**核心设计**：
- 单 Node.js 进程 + 按需启动的容器
- 主进程不加载 Claude，只负责调度和路由
- 容器内运行 Claude Agent SDK，拥有完整能力

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
    ▼ 主进程启动时过滤
┌─────────────────────────────────────────────────────────────────┐
│ data/env/env  (过滤后的安全子集)                                │
│                                                                 │
│ 仅包含 Claude 认证相关:                                          │
│   - CLAUDE_CODE_OAUTH_TOKEN                                     │
│   - ANTHROPIC_API_KEY                                           │
│   - ANTHROPIC_AUTH_TOKEN                                        │
│   - ANTHROPIC_BASE_URL                                          │
│   - ANTHROPIC_DEFAULT_*_MODEL (可选映射)                         │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ 挂载到容器
/workspace/env-dir/env (只读)
    │
    ▼ entrypoint.sh 加载
export $(cat /workspace/env-dir/env | xargs)
    │
    ▼
Claude Agent SDK 获得认证，可正常调用 API
```

**安全设计**：
- 完整 `.env` 不会被挂载（含 Channel 密钥等）
- 只提取 Claude 需要的变量
- 容器内只读挂载，防止篡改

---

## 3. 数据持久化哲学

### 3.1 目录分层

```
nanoclaw/
├── groups/                    # 配置 ──────▶ GitHub ✅
│   ├── main/CLAUDE.md
│   └── global/CLAUDE.md
│
├── src/                       # 源码 ──────▶ GitHub ✅
├── container/                 # 容器定义 ──▶ GitHub ✅
├── package.json
│
├── data/                      # 运行时数据 ─▶ GitHub ❌ (本地持久化)
│   ├── workspace/{folder}/   # 工作文件
│   ├── sessions/{folder}/    # Claude 会话
│   ├── ipc/{folder}/         # IPC 通信
│   ├── logs/{folder}/        # 执行日志
│   └── nanoclaw.db           # SQLite 数据库
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

| 主机路径 | 容器路径 | 权限 | 用途 |
|---------|---------|------|------|
| `data/env` | `/workspace/env-dir` | **ro** | Claude 认证 (API Key) |
| `groups/{folder}` | `/workspace/group` | **ro** | 群组配置 (CLAUDE.md) |
| `groups/global` | `/workspace/global` | **ro** | 全局共享记忆 |
| `data/workspace/{folder}` | `/workspace/data` | **rw** | 工作目录，持久化文件 |
| `data/sessions/{folder}/.claude` | `/home/node/.claude` | **rw** | Claude 会话、设置、技能 |
| `data/ipc/{folder}` | `/workspace/ipc` | **rw** | IPC 通信目录 |
| `container/agent-runner/src` | `/app/src` | **ro** | 运行时代码 (绕过缓存) |

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
容器启动时:
  container/skills/          ──copy──▶  data/sessions/{folder}/.claude/skills/
                                        │
                                        ▼
                               挂载到容器 /home/node/.claude/skills/
                                        │
                                        ▼
                               Claude SDK 自动加载 SKILL.md
```

---

## 9. IPC 通信

容器通过 MCP Tools 与主进程通信：

| Tool | 写入目录 | 主进程处理 |
|------|---------|-----------|
| `send_message` | `ipc/{folder}/messages/` | IPC Watcher → Channel |
| `schedule_task` | `ipc/{folder}/tasks/` | IPC Watcher → DB |
| `pause_task` | `ipc/{folder}/tasks/` | IPC Watcher → DB |
| `register_group` | `ipc/{folder}/tasks/` | IPC Watcher → 注册 |

**安全隔离**：每个群组只能访问自己的 IPC 目录。
