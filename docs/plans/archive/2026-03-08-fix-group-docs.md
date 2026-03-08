# 修复群组文档 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `groups/main/CLAUDE.md` 中关于群组查询的错误文档

**Architecture:** 纯文档修改，删除不存在的 config.json 引用，替换为简单的文件系统命令

**Tech Stack:** Markdown

---

### Task 1: 修复群组文档

**Files:**
- Modify: `groups/main/CLAUDE.md:66-88` (删除错误脚本)
- Modify: `groups/main/CLAUDE.md:103-113` (删除错误配置描述)

**Step 1: 删除错误的 "查看当前 Group 信息" 部分**

删除第 66-88 行的整个脚本块，替换为：

```markdown
### 查看群组信息

群组元数据存储在主机 SQLite 数据库，容器不可直接访问。

可通过文件系统查看群组文件夹：

\`\`\`bash
# 查看所有群组文件夹
ls -la /workspace/project/groups/

# 查看某群组的内容
ls -la /workspace/project/groups/feishu_65a3b8/
\`\`\`

**注意**：容器内没有 docker 命令。
```

**Step 2: 删除错误的 "飞书群配置" 部分**

删除第 103-113 行的整个配置结构描述。

**Step 3: 验证修改**

```bash
# 确认文件语法正确
cat groups/main/CLAUDE.md
```

**Step 4: Commit**

```bash
git add groups/main/CLAUDE.md
git commit -m "docs: 修复群组查询文档 - 移除不存在的 config.json 引用"
```
