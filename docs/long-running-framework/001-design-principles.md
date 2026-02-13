# 长时间运行系统框架 - 设计原理详解

## 目录
1. [问题背景](#问题背景)
2. [核心挑战](#核心挑战)
3. [设计原理](#设计原理)
4. [架构设计](#架构设计)
5. [关键技术](#关键技术)
6. [实现规划](#实现规划)

---

## 问题背景

### 什么是长时间运行任务？

**定义**：需要数小时、数天甚至数周才能完成的复杂任务，无法在单个 AI 上下文窗口内完成。

**典型场景**：
- 开发一个完整的 Web 应用
- 实现复杂的软件功能
- 进行深入的技术研究
- 构建大型文档系统

### 为什么这是个问题？

AI 模型的**上下文窗口（Context Window）是有限的**：

```
单个会话生命周期：
用户提示 → AI 处理 → 输出结果 → 会话结束
         ↑___________________________|
              上下文窗口边界
```

**关键问题**：
- 当任务超过上下文窗口限制时，会话被迫结束
- 新会话从零开始，没有任何之前工作的记忆
- 无法保持工作的连续性和一致性

**类比**：
想象一个软件项目，工程师按轮班工作，但每个新工程师接班时：
- ❌ 不知道之前做了什么
- ❌ 看不到代码变更历史
- ❌ 不知道哪些功能已完成
- ❌ 不知道当前有什么 bug

这会导致大量重复工作和混乱。

---

## 核心挑战

### 挑战 1：跨上下文记忆缺失

**问题**：每个新会话都是"白板"状态，没有任何之前工作的记忆。

**表现**：
```
会话 1：实现了用户登录功能的一半
会话 2：（重新开始）又实现了一遍用户登录
会话 3：（又重新开始）再次实现用户登录
```

**后果**：
- 大量重复工作
- 时间和资源浪费
- 任务无法完成

### 挑战 2：状态不一致

**问题**：无法追踪当前的工作状态。

**表现**：
```
会话 1：修改了文件 A.js
会话 2：不知道 A.js 被修改过，又修改了一次
结果：代码冲突或覆盖
```

**后果**：
- 代码版本混乱
- 功能被意外破坏
- 难以回滚

### 挑战 3：过早完成声明

**问题**：AI 代理容易过早认为任务完成。

**表现**：
```
用户：构建一个 Web 应用
会话 1：创建了基础 HTML
        ✅ "任务完成！"（实际只完成了 5%）

会话 2：看了一下代码
        ✅ "看起来不错，已完成！"
```

**原因**：
- AI 缺乏完整的"完成定义"
- 没有明确的功能清单
- 缺少验证机制

### 挑战 4：增量进展困难

**问题**：AI 倾向于"一次性完成所有事"。

**表现**：
```
会话 1：
- 尝试实现功能 A
- 尝试实现功能 B
- 尝试实现功能 C
- 尝试实现功能 D
→ 上下文窗口用尽，所有功能都只完成了一半
```

**后果**：
- 留下大量半成品代码
- 下一会话难以接手
- 系统处于不稳定状态

### 挑战 5：测试不足

**问题**：AI 修改代码后缺乏充分测试。

**表现**：
```
会话 1：
- 修改了登录逻辑
- 运行了单元测试（通过）
- ✅ 标记为"完成"

实际情况：
- 前端没有连接到后端
- 用户体验完全无法工作
- 单元测试没有覆盖端到端场景
```

**后果**：
- 功能看似完成，实际不可用
- Bug 在后续才发现，难以定位

---

## 设计原理

### 原理 1：外部记忆系统

**核心理念**：不要依赖 AI 的内部记忆，而是创建可靠的外部记忆系统。

**为什么**：
- AI 上下文窗口是临时的
- 外部存储是持久的
- 可以跨会话访问

**实现**：
```
外部记忆系统包含：
├── 功能清单（feature_list.json）
│   └── 所有需要完成的功能及其状态
├── 进度日志（project_progress.md）
│   └── 每次会话做了什么
├── Git 历史
│   └── 所有代码变更的完整记录
└── 会话日志（数据库）
    └── 结构化的会话记录
```

**效果**：
```
会话 1：
- 阅读 feature_list.json：知道要做 100 个功能
- 完成功能 #1
- 更新 feature_list.json：标记 #1 为完成
- 提交 git
- 更新 project_progress.md

会话 2（全新上下文）：
- 阅读 feature_list.json：知道还有 99 个功能待完成
- 阅读 project_progress.md：知道上次做了什么
- 阅读 git log：看到了代码变更
- 继续做功能 #2
```

### 原理 2：增量式进展

**核心理念**：每次只做一件事，把它做好。

**为什么**：
- 复杂任务由简单任务组成
- 单个任务可以在上下文窗口内完成
- 每次完成都留下稳定的中间状态

**对比**：

❌ **错误方式（一次性完成）**：
```
会话 1：
尝试实现：
- 用户认证
- 数据库连接
- API 路由
- 前端 UI
- 测试
→ 上下文窗口溢出，所有都是半成品
```

✅ **正确方式（增量式）**：
```
会话 1：只做用户认证（完成 + 测试 + 提交）
会话 2：只做数据库连接（完成 + 测试 + 提交）
会话 3：只做 API 路由（完成 + 测试 + 提交）
会话 4：只做前端 UI（完成 + 测试 + 提交）
会话 5：只做测试（完成 + 测试 + 提交）
→ 每个会话都留下可工作的状态
```

**实现机制**：
1. 功能清单将大任务分解为小任务
2. 强制每次只选择一个未完成功能
3. 必须完成当前功能才能选择下一个
4. 每次会话结束必须留下"清洁状态"

### 原理 3：清洁状态

**核心理念**：每次会话结束时，系统应该处于可以安全地开始下一项工作的状态。

**定义**：
清洁状态 = 可以合并到主分支的代码状态

**清洁状态的特征**：
```
✅ 没有 major bugs
✅ 代码整洁，有注释
✅ 功能已测试
✅ Git 已提交
✅ 进度已更新
```

**对比**：

❌ **脏状态（不要留下）**：
```
会话 1 结束时：
- 修改了 5 个文件，只提交了 2 个
- 引入了新 bug，但没发现
- 代码格式混乱
- 测试失败，但被忽略
→ 下一会话无法安全地继续工作
```

✅ **清洁状态**：
```
会话 1 结束时：
- 所有变更已提交到 git
- 功能已端到端测试
- 没有已知 bug
- 代码整洁
- 进度文件已更新
→ 下一会话可以安全地开始新功能
```

**为什么重要**：
- 每次会话都从稳定状态开始
- 不会累积技术债务
- 可以随时回滚

### 原理 4：强制验证

**核心理念**：不要相信代码"看起来正确"，要证明它工作。

**问题**：
AI 倾向于标记功能为"完成"，但实际不工作。

**解决方案**：强制端到端测试

**测试层次**：
```
1. 单元测试（代码级）
   └─ 验证单个函数正确性

2. 集成测试（系统级）
   └─ 验证模块间交互

3. 端到端测试（用户级）⭐ 最重要
   └─ 像真实用户一样操作整个系统
```

**实现示例**：
```typescript
// ❌ 不够的测试
function testLogin() {
  assert(validateCredentials("user", "pass") === true)
}
// 这只测试了函数，但没有测试整个登录流程

// ✅ 足够的测试
async function testLoginEndToEnd() {
  // 1. 打开浏览器
  await browser.open('http://localhost:3000')

  // 2. 点击登录按钮
  await browser.click('#login-button')

  // 3. 输入用户名密码
  await browser.type('#username', 'user')
  await browser.type('#password', 'pass')

  // 4. 提交表单
  await browser.click('#submit')

  // 5. 验证登录成功
  await browser.waitForURL('/dashboard')
  assert(await browser.text('#welcome') === 'Welcome, user!')
}
```

**强制机制**：
- 标记功能为"完成"前必须通过端到端测试
- 会话开始时先运行测试验证现有功能
- 发现问题立即修复，不能留给下一会话

### 原理 5：结构化进度追踪

**核心理念**：用结构化数据而不是自然语言来追踪进度。

**问题**：
自然语言模糊、有歧义。

**对比**：

❌ **自然语言进度**：
```
会话 1：
"做了一些功能，进度不错"

会话 2：
"看起来完成了一些东西"

→ 无法知道具体做了什么
```

✅ **结构化进度**：
```json
{
  "feature_id": "auth-001",
  "description": "用户可以登录系统",
  "status": "passing",  // 明确的布尔状态
  "test_steps": [
    "打开登录页面",
    "输入用户名和密码",
    "点击登录按钮",
    "验证跳转到首页"
  ],
  "git_commit": "abc123",
  "session_number": 3
}
```

**为什么 JSON**：
- 机器可读
- 不易被误解
- 容易验证
- 易于生成报告

**实现**：
```sql
-- 数据库表结构
CREATE TABLE project_features (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  passes INTEGER DEFAULT 0,  -- 布尔值
  test_steps TEXT,           -- JSON
  git_commit TEXT,
  session_number INTEGER
);
```

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   用户接口层                              │
│  (WhatsApp / 其他消息渠道)                                │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  命令路由层                               │
│  (/project:create, /project:work, etc.)                 │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
┌────────▼──────────┐  ┌────────▼────────────┐
│  项目管理器        │  │  长时间运行框架      │
│  (Project Manager)│  │  (Long-running      │
│                   │  │   Framework)         │
└────────┬──────────┘  └────────┬────────────┘
         │                       │
         │              ┌────────┴────────┐
         │              │                 │
┌────────▼─────────┐ ┌──▼──────────┐ ┌───▼──────────┐
│  功能生成器      │ │ Git 管理器   │ │ 会话管理器    │
│  (Feature        │ │ (Git        │ │ (Session     │
│   Generator)     │ │  Manager)   │ │  Manager)    │
└──────────────────┘ └─────────────┘ └──────────────┘
         │              │                 │
         └──────────────┴─────────────────┘
                        │
┌───────────────────────▼───────────────────────────┐
│                  持久化层                          │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ SQLite 数据库│  │ Git 仓库  │  │ 文件系统      │ │
│  │             │  │          │  │              │ │
│  │ • projects  │  │ • 代码   │  │ • 进度文件   │ │
│  │ • features  │  │ • 历史   │  │ • 功能清单   │ │
│  │ • sessions  │  │ • 版本   │  │ • 初始化脚本 │ │
│  └─────────────┘  └──────────┘  └──────────────┘ │
└───────────────────────────────────────────────────┘
```

### 核心组件详解

#### 1. 初始化代理（Initializer Agent）

**职责**：
- 首次运行时设置项目环境
- 将用户需求扩展为详细功能清单
- 初始化 Git 仓库
- 创建必要的脚本和配置

**工作流程**：
```
用户输入："构建一个实时协作编辑器"
         │
         ▼
┌─────────────────────────┐
│ 1. 分析需求              │
│    - 识别核心功能        │
│    - 评估复杂度          │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 2. 生成功能清单          │
│    - 扩展为 100+ 功能    │
│    - 每个功能包含：       │
│      • 描述             │
│      • 测试步骤         │
│      • 优先级           │
│      • 状态 (failing)   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 3. 初始化 Git            │
│    - git init            │
│    - 创建 .gitignore     │
│    - 初始 commit         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 4. 创建 init.sh          │
│    - 启动开发服务器      │
│    - 设置环境变量        │
│    - 运行基础测试        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 5. 创建进度文件          │
│    - project_progress.md│
│    - feature_list.json  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 6. 初始提交              │
│    - git add .          │
│    - git commit         │
└─────────────────────────┘
         │
         ▼
✅ 项目初始化完成，可以开始工作
```

**关键输出**：

1. **feature_list.json** - 功能清单
```json
{
  "features": [
    {
      "id": "f-001",
      "category": "functional",
      "description": "用户可以创建新文档",
      "steps": [
        "点击'新建文档'按钮",
        "验证新文档创建成功",
        "验证文档出现在列表中"
      ],
      "passes": false,
      "priority": 10
    },
    // ... 100+ 更多功能
  ]
}
```

2. **init.sh** - 初始化脚本
```bash
#!/bin/bash
# 启动开发服务器
npm run dev &

# 等待服务器启动
sleep 5

# 运行基础测试
npm run test:smoke

echo "环境已就绪"
```

3. **project_progress.md** - 进度日志
```markdown
# 项目进度

## 项目信息
- 名称：实时协作编辑器
- 创建时间：2026-02-13
- 状态：活跃

## 会话历史

### 会话 #1（2026-02-13）
- 状态：初始化完成
- 功能总数：127
- 已完成：0
- 待完成：127

## 下一步
选择优先级最高的功能开始工作。
```

#### 2. 工作代理（Working Agent）

**职责**：
- 每次会话实现一个功能
- 保持环境清洁状态
- 更新进度和文档

**工作流程**：
```
会话开始
    │
    ▼
┌─────────────────────────┐
│ 1. 环境确认              │
│    - pwd（当前目录）     │
│    - ls（查看文件）       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 2. 读取上下文            │
│    - git log（历史）     │
│    - project_progress.md│
│    - feature_list.json   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 3. 启动环境              │
│    - 运行 init.sh       │
│    - 等待服务启动        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 4. 验证现有功能          │
│    - 运行端到端测试      │
│    - 确保没有回归        │
└────────┬────────────────┘
         │
    发现问题？
         │
    ┌────┴────┐
    │         │
    ▼         ▼
   是        否
    │         │
    ▼         ▼
┌─────────┐  │
│先修复   │  │
│现有问题 │  │
└────┬────┘  │
     │       │
     └───┬───┘
         │
         ▼
┌─────────────────────────┐
│ 5. 选择功能             │
│    - 读取功能清单        │
│    - 选择优先级最高的    │
│      未完成功能         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 6. 实现功能             │
│    - 编写代码           │
│    - 本地测试           │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 7. 端到端验证           │
│    - 像用户一样操作      │
│    - 验证功能完整工作    │
└────────┬────────────────┘
         │
    通过？
         │
    ┌────┴────┐
    │         │
    ▼         ▼
   否        是
    │         │
    ▼         │
┌─────────┐  │
│修复bug │  │
└────┬────┘  │
     │       │
     └───┬───┘
         │
         ▼
┌─────────────────────────┐
│ 8. Git 提交             │
│    - git add .         │
│    - git commit -m "..."│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 9. 更新状态             │
│    - 标记功能为 passing │
│    - 更新进度日志        │
│    - 记录会话信息        │
└────────┬────────────────┘
         │
         ▼
      会话结束
```

**关键原则**：

1. **一次只做一件事**
```
❌ 不要：
会话 1：
- 实现功能 A
- 实现功能 B
- 实现功能 C

✅ 要：
会话 1：只实现功能 A
会话 2：只实现功能 B
会话 3：只实现功能 C
```

2. **先测试再标记**
```
❌ 不要：
- 修改了代码
- 看起来正确
- 标记为完成

✅ 要：
- 修改了代码
- 运行端到端测试
- 验证通过
- 标记为完成
```

3. **总是留下清洁状态**
```
会话结束时：
✅ 所有变更已提交
✅ 没有临时文件
✅ 没有已知 bug
✅ 代码可以运行
```

#### 3. 项目管理器（Project Manager）

**职责**：
- 管理多个项目的生命周期
- 提供项目查询和统计
- 处理项目暂停/恢复/归档

**功能列表**：

```
项目创建：
- createProject(name, description, group)
  └─ 初始化新项目

项目查询：
- listProjects(filter)
  └─ 列出所有或筛选项目

- getProjectStatus(projectId)
  └─ 获取项目详细状态

- getProjectProgress(projectId)
  └─ 获取项目进度报告

项目控制：
- pauseProject(projectId)
  └─ 暂停项目

- resumeProject(projectId)
  └─ 恢复项目

- archiveProject(projectId)
  └─ 归档已完成项目

会话管理：
- startSession(projectId)
  └─ 开始新的工作会话

- getSessionHistory(projectId)
  └─ 获取会话历史
```

---

## 关键技术

### 技术 1：Git 作为版本控制和回滚机制

**为什么用 Git**：
- ✅ 完整的变更历史
- ✅ 可以回滚到任意状态
- ✅ 分支管理实验性功能
- ✅ 天然适合代码版本控制

**如何使用**：

1. **初始化**
```bash
git init
git add .
git commit -m "Initial project setup"
```

2. **每次会话**
```bash
# 会话开始
git status  # 查看当前状态

# 工作中...
git add file1.ts
git commit -m "Implement feature X: Add user login"

# 会话结束
git add .
git commit -m "Session complete: Feature X passing"
```

3. **回滚机制**
```bash
# 如果出现问题
git log --oneline -10  # 查看历史
git revert abc123      # 回滚到之前状态
```

### 技术 2：JSON 功能清单

**为什么用 JSON**：
- ✅ 结构化，机器可读
- ✅ 不易被 AI 误解
- ✅ 易于验证和解析
- ✅ 支持复杂嵌套结构

**结构设计**：
```json
{
  "project_id": "collab-editor-2026",
  "features": [
    {
      "id": "f-001",
      "category": "functional",
      "description": "用户可以创建新文档",
      "steps": [
        "打开应用",
        "点击'新建文档'按钮",
        "验证文档列表中出现新文档",
        "验证编辑器打开新文档"
      ],
      "passes": false,
      "priority": 10,
      "dependencies": [],
      "estimated_effort": "1 session"
    }
  ]
}
```

**优势**：
1. **明确性**：布尔状态（passes）不是模糊的自然语言
2. **可验证**：AI 可以直接读取和验证
3. **可报告**：容易生成进度报告
4. **可追踪**：每个功能有唯一 ID

### 技术 3：增量会话模式

**核心思想**：
每次会话只做一件事，做好为止。

**实施**：

1. **会话边界明确**
```
会话 #1：
- 开始：读取上下文
- 工作：功能 A
- 结束：提交和更新

--- 上下文窗口结束 ---

会话 #2：
- 开始：读取上下文（包含 #1 的变更）
- 工作：功能 B
- 结束：提交和更新
```

2. **状态传递机制**
```
会话 N 结束时的状态
    │
    ├─ Git 提交（代码状态）
    ├─ feature_list.json（功能状态）
    ├─ project_progress.md（文字描述）
    └─ 数据库会话记录（结构化数据）
         │
         ▼
    会话 N+1 开始时的状态
    （可以完全恢复）
```

3. **上下文恢复流程**
```
新会话启动：
1. 读取 feature_list.json
   └─ 哪些功能已完成？哪些待完成？

2. 读取 project_progress.md
   └─ 上次做了什么？遇到了什么问题？

3. 读取 git log
   └─ 代码变更历史是什么？

4. 运行 init.sh
   └─ 启动环境，准备开始工作

5. 运行测试
   └─ 验证现有功能仍然工作

6. 选择下一个功能
   └─ 选择优先级最高的未完成功能

7. 开始工作
```

### 技术 4：端到端测试

**为什么需要端到端测试**：

单元测试的局限：
```
✅ 单元测试：函数验证
function validateEmail(email) {
  return email.includes('@')
}

测试：
assert(validateEmail('test@test.com') === true)  // 通过
assert(validateEmail('invalid') === false)       // 通过

但是：
- 前端是否调用了这个函数？
- 表单是否正确传递了数据？
- 用户是否看到了错误提示？
→ 单元测试不知道
```

端到端测试的优势：
```
✅ 端到端测试：真实用户场景
1. 打开登录页面
2. 输入无效邮箱
3. 点击提交
4. 验证看到"邮箱格式无效"提示
5. 验证表单未提交

→ 测试整个系统，不仅仅是函数
```

**实施工具**：
- Puppeteer（浏览器自动化）
- Playwright（现代替代品）
- Selenium（传统方案）

**测试示例**：
```typescript
import { chromium } from 'playwright';

async function testUserLogin() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 导航到登录页面
  await page.goto('http://localhost:3000/login');

  // 2. 填写表单
  await page.fill('#email', 'user@example.com');
  await page.fill('#password', 'password123');

  // 3. 提交表单
  await page.click('#login-button');

  // 4. 验证结果
  await page.waitForURL('/dashboard');
  const welcomeText = await page.textContent('#welcome');
  if (welcomeText?.includes('Welcome')) {
    console.log('✅ 登录功能正常');
  } else {
    console.log('❌ 登录功能失败');
  }

  await browser.close();
}
```

### 技术 5：强制测试机制

**如何强制 AI 测试**：

在提示词中使用强烈措辞：
```
❌ 弱要求：
"请测试这个功能"

AI 可能：
- 跑一下单元测试
- 看起来没问题
- 标记为完成
（实际功能不工作）

✅ 强要求：
"你必须进行端到端测试：
1. 启动应用
2. 像真实用户一样操作
3. 验证每个步骤的结果
4. 只有当功能完整工作时才能标记为完成
5. 这不是可选的，是强制的"
```

**验证机制**：
```json
// feature_list.json
{
  "test_required": true,
  "test_type": "end-to-end",
  "verification": "manual",  // 需要手动验证
  "cannot_mark_complete_without_test": true
}
```

---

## 实现规划

### 阶段 1：数据层（1-2 天）

**任务**：
1. 设计数据库 schema
2. 创建数据库表
3. 实现数据库操作函数

**输出**：
```sql
-- 3 个新表
- long_running_projects
- project_features
- project_sessions
```

```typescript
// db-extensions.ts
export async function createProject(project: Project): Promise<void>
export async function getProject(id: string): Promise<Project>
export async function listProjects(): Promise<Project[]>
export async function createFeature(feature: Feature): Promise<void>
export async function updateFeature(id: string, updates: Partial<Feature>): Promise<void>
// ... etc
```

### 阶段 2：核心框架（2-3 天）

**任务**：
1. 实现功能生成器
2. 实现 Git 管理器
3. 实现会话管理器
4. 实现核心框架逻辑

**输出**：
```typescript
// feature-generator.ts
export async function generateFeatureList(requirements: string): Promise<Feature[]>

// git-manager.ts
export class GitManager {
  async init(): Promise<void>
  async commit(message: string): Promise<void>
  async rollback(commitHash: string): Promise<void>
  // ... etc
}

// session-manager.ts
export class SessionManager {
  async startSession(projectId: string): Promise<Session>
  async endSession(sessionId: string, summary: string): Promise<void>
  // ... etc
}

// long-running-framework.ts
export class LongRunningFramework {
  async initializeProject(name: string, description: string): Promise<string>
  async getSessionContext(projectId: string): Promise<SessionContext>
  async updateProgress(projectId: string, updates: ProgressUpdate): Promise<void>
  // ... etc
}
```

### 阶段 3：用户接口（1-2 天）

**任务**：
1. 实现命令行接口
2. 集成到路由系统
3. 实现消息格式化

**输出**：
```typescript
// long-running-cli.ts
export const commands = {
  create: async (name: string, description: string) => { ... },
  list: async () => { ... },
  status: async (projectId: string) => { ... },
  work: async (projectId: string) => { ... },
  // ... etc
}

// router.ts (修改)
router.register('/project:create', commands.create)
router.register('/project:list', commands.list)
router.register('/project:status', commands.status)
// ... etc
```

### 阶段 4：提示词模板（1 天）

**任务**：
1. 创建初始化代理提示词
2. 创建工作代理提示词
3. 创建会话启动检查清单

**输出**：
```
/templates/prompts/
├── initializer-agent.md
├── working-agent.md
└── session-startup.md
```

### 阶段 5：测试和验证（1-2 天）

**任务**：
1. 创建测试项目
2. 运行完整工作流
3. 修复发现的问题

**测试场景**：
```
场景 1：创建项目
1. 用户调用 /project:create
2. 验证数据库记录创建
3. 验证文件系统初始化
4. 验证 Git 仓库初始化
5. 验证功能清单生成

场景 2：工作会话
1. 用户调用 /project:work
2. 验证会话记录创建
3. 验证上下文正确加载
4. 模拟工作并提交
5. 验证进度更新

场景 3：跨会话连续性
1. 创建会话 #1，完成功能 A
2. 结束会话 #1
3. 创建会话 #2
4. 验证可以看到功能 A 已完成
5. 完成功能 B
6. 验证两个功能都在 git 历史

场景 4：错误恢复
1. 创建会话，故意引入 bug
2. 提交 bug
3. 下一个会话应该：
   - 运行测试
   - 发现 bug
   - 修复 bug
   - 验证修复
```

### 阶段 6：文档和示例（1 天）

**任务**：
1. 编写用户文档
2. 创建示例项目
3. 编写故障排查指南

**输出**：
```
/docs/long-running-framework/
├── user-guide.md
├── api-reference.md
├── troubleshooting.md
└── examples/
    ├── simple-web-app/
    └── research-project/
```

---

## 总结

### 核心原理回顾

1. **外部记忆系统** - 用持久化存储弥补 AI 记忆限制
2. **增量式进展** - 一次只做一件事，做好为止
3. **清洁状态** - 每次会话结束留下可工作的代码
4. **强制验证** - 端到端测试证明功能工作
5. **结构化追踪** - JSON 而不是自然语言记录进度

### 关键技术

- **Git** - 版本控制和回滚
- **JSON** - 结构化数据
- **SQLite** - 持久化存储
- **端到端测试** - 功能验证
- **增量会话** - 跨上下文连续性

### 预期效果

实施这个框架后：

✅ AI 可以处理需要数天才能完成的复杂任务
✅ 每次会话都从前一次结束的地方继续
✅ 不会有重复工作或功能遗漏
✅ 所有变更都有完整的历史记录
✅ 可以随时回滚到任意状态
✅ 进度可追踪、可报告

---

## 下一步

阅读完这个设计文档后，你可以：

1. **批准实现** - 我开始按照规划编码
2. **提出修改意见** - 调整设计细节
3. **要求更详细的说明** - 深入某个具体部分
4. **查看代码示例** - 看具体的实现代码

请告诉我你的想法！
