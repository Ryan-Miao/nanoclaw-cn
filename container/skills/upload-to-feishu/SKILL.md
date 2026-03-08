---
name: upload-to-feishu
description: |
  Upload files to Feishu Drive and return shareable link.
  Use when: (1) Sharing long documents like plans or designs with user, (2) User asks to upload/share a file to Feishu,
  (3) After creating markdown docs that should be shared, (4) User mentions "飞书" + "上传" or "分享文档".
---

# Upload to Feishu

Upload  files to Feishu Drive, return shareable link card.

## Usage

```bash
# Run the upload script
./scripts/upload-feishu.sh                     # Auto-find latest docs/**/*.md
./scripts/upload-feishu.sh path/to/file.md     # Upload specific file
```

**Output on success:**
```
SUCCESS
FILE_NAME=xxx.md
FILE_TOKEN=xxx
FILE_URL=https://jcnqdavl0ba3.feishu.cn/file/xxx
```

## Config

Required: `~/.claude/feishu.env`

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_FOLDER_TOKEN=xxx    # Optional: target folder
```

## Output Format to User

On success, send link card:
```
📄 *文件已上传到飞书*

文件名: {file_name}
链接: {file_url}
```

On failure, fallback to sending file content directly with error explanation.

## Permissions Required

Feishu app needs: `drive:drive:file:all`, `drive:drive:permission:all`

