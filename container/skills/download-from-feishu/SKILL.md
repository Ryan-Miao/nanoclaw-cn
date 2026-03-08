---
name: download-from-feishu
description: This skill should be used when a user sends a Feishu file link and needs to analyze the content. Triggers when user shares feishu.cn/file/ URLs for backup files, logs, databases, or documents.
---

# Download from Feishu

Download files from Feishu cloud drive for analysis when users share Feishu links.

## When to Use

- User sends a Feishu document link (feishu.cn/file/...)
- Need to analyze backup files, logs, or databases uploaded by user
- User wants to share files for debugging or review

## Usage

Execute the download script with the file URL or token:

```bash
~/.claude/skills/download-from-feishu/scripts/download-feishu.sh <file_url_or_token> [output_path]
```

The script accepts:
- Full Feishu URL: `https://xxx.feishu.cn/file/xxx`
- File token only: `xxx`

Default output path is `/tmp/feishu_download`.

## Configuration

Required environment variables in `~/.claude/feishu.env` or `/workspace/group/.feishu.env`:

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_FOLDER_TOKEN=xxx
```

## Output

**Success:**
```
SUCCESS
FILE_TOKEN=xxx
OUTPUT_PATH=/tmp/feishu_download
FILE_SIZE=12345 bytes
FILE_TYPE=SQLite 3.x database
```

**Failure:**
```
FAILED
HTTP_CODE=404
ERROR_MESSAGE=<error details>
```

## File Analysis

After downloading, analyze the file based on its type:

| File Type | Analysis Command |
|-----------|------------------|
| `.db` | `sqlite3 <file> ".schema"` and SQL queries |
| `.txt/.md/.log` | `cat <file>` or `Read` tool |
| `.json` | Parse with `jq` or read directly |
| `.apk` | `aapt dump badging <file>` |

## Workflow

1. Extract FILE_TOKEN from the Feishu URL (last path segment)
2. Execute the download script
3. Parse the output for SUCCESS/FAILED status
4. On success, analyze the downloaded file at OUTPUT_PATH
5. Report findings to the user

## Requirements

- Feishu app permission: `drive:drive:file:read`
- Downloads to `/tmp/` by default (session-temporary)
