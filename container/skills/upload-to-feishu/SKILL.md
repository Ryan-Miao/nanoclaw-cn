---
name: upload-to-feishu
description: 上传长文本文档到飞书云盘并发送链接卡片。用于 plan、design 等文档的分享。
---

# 上传到飞书 (Upload to Feishu)

## 概述

将 `docs/**/*.md` 文件上传到飞书云盘，返回可分享的链接卡片。

**适用场景：**
- 设计文档 (docs/plans/*-design.md)
- 实现计划 (docs/plans/*-implementation.md)
- 其他长文本 markdown 文件

## 使用方式

### 手动调用
```
/upload-to-feishu                    # 自动找最新的 docs/**/*.md 文件
/upload-to-feishu docs/plans/xxx.md  # 上传指定文件
```

### 链式调用
其他 skill 完成后可自动调用此 skill：
```
在 writing-plans 完成后，调用此 skill 上传生成的计划文档
```

## 配置

配置文件位置: `~/.claude/feishu.env`

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_FOLDER_TOKEN=xxx
```

## 工作流程

1. 读取 `~/.claude/feishu.env` 配置
2. 确定要上传的文件
   - 手动指定 → 使用指定路径
   - 未指定 → 找最新的 `docs/**/*.md` 文件
3. 调用飞书 API 上传文件
4. 返回结果：
   - **成功**: 发送飞书链接卡片
   - **失败**: 降级处理，直接发送文件内容给用户

## 输出格式

### 成功时
```
📄 **文件已上传到飞书**

*文件名*: 2026-03-04-memory-universe-design.md
*链接*: https://jcnqdavl0ba3.feishu.cn/file/xxx
```

### 失败时（降级）
直接将文件内容发送给用户，并提示上传失败原因。

## 实现指南

**Step 1: 读取配置**
```bash
source ~/.claude/feishu.env
```

**Step 2: 获取访问令牌**
```bash
curl -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d "{\"app_id\": \"$FEISHU_APP_ID\", \"app_secret\": \"$FEISHU_APP_SECRET\"}"
```

**Step 3: 上传文件**
```bash
curl -X POST "https://open.feishu.cn/open-apis/drive/v1/files/upload_all" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file_name=$FILE_NAME" \
  -F "parent_type=explorer" \
  -F "parent_node=$FEISHU_FOLDER_TOKEN" \
  -F "size=$FILE_SIZE" \
  -F "file=@$FILE_PATH"
```

**Step 4: 返回链接**
从响应中提取 `file_token`，构建链接：
```
https://jcnqdavl0ba3.feishu.cn/file/{file_token}
```

## 错误处理

- 配置文件不存在 → 提示用户创建配置
- 认证失败 → 降级发送文件内容
- 网络错误 → 降级发送文件内容
- 文件不存在 → 提示错误

## 注意事项

- 飞书应用需要开启 `drive:drive:file:all` 和 `drive:drive:permission:all` 权限
- 单文件最大 20MB
- 支持的文件格式：所有文本文件（优先 markdown）
