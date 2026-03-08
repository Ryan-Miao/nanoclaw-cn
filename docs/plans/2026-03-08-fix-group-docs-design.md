# 修复群组文档描述

## 问题

`groups/main/CLAUDE.md` 包含错误的群组查询命令：
- 第 76-85 行引用不存在的 `config.json` 文件
- 第 103-113 行描述虚构的 `config.json` 结构

## 解决方案

删除错误内容，替换为简单的文件系统命令。

## 修改

### 删除
- 第 66-88 行：错误的 "查看当前 Group 信息" 脚本
- 第 103-113 行：错误的 "飞书群配置" 结构描述

### 替换为

```bash
# 查看所有群组文件夹
ls -la /workspace/project/groups/

# 查看某群组的内容
ls -la /workspace/project/groups/feishu_65a3b8/
```

### 群组管理说明
- 文件夹存在 = 群组有工作空间
- 群组元数据在主机数据库，容器不可直接访问
