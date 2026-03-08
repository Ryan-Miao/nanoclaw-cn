# 容器挂载架构改进

## Context

**问题**：Main 群组挂载整个项目根目录 `/workspace/project`（可写），Agent 可以修改源码，存在风险。

**用户需求**：
1. `groups/` 目录应该是**只读**（配置/规则）
2. 记忆存储在 `data/` 目录（已实现）
3. Skills 支持动态安装，持久化到 `data/`（当前机制已支持）

## 当前架构分析

### 目录用途

| 目录 | Git 状态 | 用途 |
|-----|---------|------|
| `data/` | 不提交 | 运行时数据：会话、IPC、环境变量、Skills |
| `groups/` | 部分提交 | CLAUDE.md（配置），其他不提交 |
| `container/skills/` | 提交 | 项目自带的 Skills |
| `src/` | 提交 | 源代码 |

### 当前挂载（Main 群组）

| 容器内路径 | 主机路径 | 权限 | 问题 |
|-----------|---------|------|------|
| `/workspace/project` | 项目根目录 | 可写 | **风险：可修改源码** |
| `/workspace/group` | `groups/main/` | 可写 | |
| `/workspace/global` | `groups/global/` | 只读 | |
| `/home/node/.claude` | `data/sessions/main/.claude/` | 可写 | |
| `/workspace/ipc` | `data/ipc/main/` | 可写 | |

### Skills 复制机制

```
container/skills/{skill}/ → 复制 → data/sessions/{group}/.claude/skills/{skill}/
                                           ↓ 挂载
                                     /home/node/.claude/skills/{skill}/
```

**关键**：复制逻辑只覆盖同名文件，**不删除**其他 skill，所以动态安装的 skills 会保留。

## 新架构方案

### 挂载配置

| 容器内路径 | 主机路径 | 权限 | 用途 |
|-----------|---------|------|------|
| `/workspace/group` | `groups/{folder}/` | **只读** | 群组配置/规则 |
| `/workspace/global` | `groups/global/` | 只读 | 全局配置 |
| `/workspace/data` | `data/workspace/{folder}/` | **可写** | Agent 工作空间（项目/文件） |
| `/home/node/.claude` | `data/sessions/{folder}/.claude/` | 可写 | 会话、记忆、Skills |
| `/workspace/ipc` | `data/ipc/{folder}/` | 可写 | IPC 通信 |
| `/workspace/env-dir` | `data/env/` | 只读 | 环境变量 |

**关键变化**：
1. **移除 `/workspace/project`** - 不再挂载项目根目录
2. **`/workspace/group` 改为只读** - 容器不能修改配置
3. **新增 `/workspace/data`** - Agent 的工作空间，持久化到 `data/workspace/`

## 实现步骤

### 1. 修改 container-runner.ts

**Before (当前)：**
```typescript
if (isMain) {
  mounts.push({
    hostPath: projectRoot,
    containerPath: '/workspace/project',
    readonly: false,
  });
  mounts.push({
    hostPath: path.join(GROUPS_DIR, group.folder),
    containerPath: '/workspace/group',
    readonly: false,
  });
}
// 工作目录在 /workspace/group
```

**After (新)：**
```typescript
// 所有群组统一配置

// groups/ 只读（配置/规则）
mounts.push({
  hostPath: path.join(GROUPS_DIR, group.folder),
  containerPath: '/workspace/group',
  readonly: true,  // 只读
});

// data/workspace/ 可写（Agent 工作空间）
const workspaceDir = path.join(DATA_DIR, 'workspace', group.folder);
fs.mkdirSync(workspaceDir, { recursive: true });
mounts.push({
  hostPath: workspaceDir,
  containerPath: '/workspace/data',
  readonly: false,  // 可写
});
```

### 2. 修改 agent-runner/src/index.ts

```typescript
// 工作目录从 /workspace/group 改为 /workspace/data
options: {
  cwd: '/workspace/data',  // 改为新的工作目录
  // ...
}
```

### 3. 更新 .gitignore

```
# Agent workspace data
data/workspace/
```

### 需要验证的文件

检查是否有代码依赖 `/workspace/project` 路径：
- `src/long-running-framework.ts`
- `groups/main/CLAUDE.md`

## 验证步骤

1. 修改代码
2. 重启服务
3. 测试：
   - 发送消息，验证 Agent 正常响应
   - 发送 "创建一个 test-project 项目" - 应该在 `data/workspace/main/` 下创建
   - 发送 "读取 /workspace/project/src/index.ts" - 应该失败
   - 发送 "帮我安装一个 test skill" - 应该成功
   - 重启服务，验证 skill 和项目仍然存在

## 目录结构对比

**Before:**
```
groups/main/           ← Agent 工作空间（可写）
  ├── CLAUDE.md        ← 配置
  ├── conversations/   ← 对话历史
  └── [用户创建的项目]
```

**After:**
```
groups/main/           ← 只读配置
  └── CLAUDE.md        ← 配置

data/workspace/main/   ← Agent 工作空间（可写）
  └── [用户创建的项目]

data/sessions/main/.claude/  ← 会话、Skills（可写）
```

## 影响评估

**修改文件**：
- `src/container-runner.ts` - 挂载配置
- `container/agent-runner/src/index.ts` - 工作目录
- `.gitignore` - 忽略 data/workspace/

**回滚方案**：
恢复上述文件的修改

## 数据迁移

如果 `groups/main/` 下有用户创建的项目，需要手动迁移到 `data/workspace/main/`
