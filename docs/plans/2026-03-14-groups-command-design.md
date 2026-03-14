# /groups 命令设计

## 概述

添加 `/groups` 命令，允许用户在聊天中查看已注册群组的信息。

## 功能

- `/groups` - 列出所有已注册群组（表格格式）
- `/groups <folder>` - 查看指定群组的详细配置

## 输出格式

### 列表视图 (`/groups`)

```
📁 已注册群组 (5个)

| Folder          | 名称        | 触发词  | 输出模式 |
|-----------------|-------------|---------|----------|
| main            | 主控群组     | 无      | quiet    |
| feishu_cc439a   | 测试群       | @Andy   | verbose  |
| feishu_d3345f   | 开发群       | @Andy   | quiet    |
```

### 详情视图 (`/groups feishu_cc439a`)

```
📁 群组: feishu_cc439a

• 名称: 测试群
• JID: oc_xxx@feishu
• 触发词: @Andy
• 输出模式: verbose
• 添加时间: 2025-03-14
• 容器超时: 30分钟
```

## 权限

- 所有群组都可以使用查看功能
- 不涉及修改操作（只读）

## 数据来源

使用 `getAllRegisteredGroups()` 从数据库获取群组信息，包含：
- `name` - 群组名称
- `folder` - 文件夹名
- `trigger` - 触发词
- `containerConfig.outputLevel` - 输出模式
- `added_at` - 添加时间

## 实现位置

在 `src/index.ts` 的命令处理部分添加，与其他命令（`/status`, `/help` 等）并列。
