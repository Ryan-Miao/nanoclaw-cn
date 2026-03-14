---
name: add-feishu
description: Add Feishu (飞书) as a channel to NanoClaw. Supports WebSocket connection (no public URL needed), DM/group messaging, and long message handling via Markdown file upload.
---

# Add Feishu Channel

This skill adds Feishu (飞书/Lark) as a messaging channel to NanoClaw, allowing users to interact with the AI assistant through Feishu.

## Step 1: Merge the skill branch

```bash
git merge skill/feishu
npm install
npm run build
```

## Step 2: Create a Feishu Self-Built App

1. Go to [Feishu Open Platform](https://open.feishu.cn)
2. Create a new self-built app (自建应用)
3. Note your `App ID` and `App Secret` from the credentials page

## Step 3: Configure Permissions

Enable these permissions in your Feishu app:

| Permission | Description |
|------------|-------------|
| `im:message` | Send and receive messages |
| `im:message.p2p_msg:readonly` | Read direct messages to bot |
| `im:message.group_at_msg:readonly` | Receive @mention messages in groups |
| `im:message:send_as_bot` | Send messages as the bot |
| `im:resource` | Upload files (for long message handling) |
| `drive:drive` | Access to Feishu Drive (for document upload) |

## Step 4: Configure Event Subscriptions

In Feishu Open Platform console, go to **Events & Callbacks**:

1. Select **Long connection** (WebSocket mode - no public URL needed)
2. Subscribe to `im.message.receive_v1` event

## Step 5: Configure Environment Variables

Add to your `.env` file:

```bash
# Feishu Configuration
FEISHU_APP_ID=cli_xxxxxx
FEISHU_APP_SECRET=your_app_secret
FEISHU_ADMIN_USER_ID=your_user_id  # Optional: for folder permission grants
```

## Step 6: Restart the Service

```bash
# Linux (systemd)
systemctl --user restart nanoclaw

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Features

- **WebSocket connection** — No public URL needed, works behind NAT/firewall
- **Direct messages** — Users can DM the bot directly
- **Group chats** — Bot responds to @mentions in groups
- **Long message handling** — Uploads Markdown files to Feishu Drive for messages exceeding threshold
- **Auto-registration** — New groups are automatically registered
- **Image support** — Send and receive images
- **Folder organization** — Long messages are organized in Plans/{GroupName}/ folders

## Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `FEISHU_APP_ID` | Feishu App ID | Required |
| `FEISHU_APP_SECRET` | Feishu App Secret | Required |
| `FEISHU_ADMIN_USER_ID` | Admin user ID for folder permissions | Optional |
| `FEISHU_DOC_THRESHOLD` | Character threshold for document creation | 2000 |

## Verification

After setup, verify:

```bash
# Check logs for feishu connection
tail -f logs/nanoclaw.log | grep -i feishu

# Test sending a message
# 1. DM the bot in Feishu
# 2. Check that the bot responds
```
