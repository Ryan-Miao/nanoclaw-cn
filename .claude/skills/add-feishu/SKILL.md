---
name: add-feishu
description: Add Feishu (飞书) as a channel to NanoClaw. Supports WebSocket connection (no public URL needed), DM/group messaging, and long message handling via Markdown file upload.
---

# Add Feishu Channel

This skill adds Feishu (飞书/Lark) as a messaging channel to NanoClaw, allowing users to interact with the AI assistant through Feishu.

## Phase 1: Pre-flight

### Check prerequisites

1. Ensure you have a Feishu self-built app created on [Feishu Open Platform](https://open.feishu.cn)
2. Get your `App ID` and `App Secret` from the credentials page
3. Enable required permissions (see below)
4. Configure event subscriptions (WebSocket mode recommended)

### Required Permissions

| Permission | Description |
|------------|-------------|
| `im:message` | Send and receive messages |
| `im:message.p2p_msg:readonly` | Read direct messages to bot |
| `im:message.group_at_msg:readonly` | Receive @mention messages in groups |
| `im:message:send_as_bot` | Send messages as the bot |
| `im:resource` | Upload files (for long message handling) |

### Event Subscriptions

In Feishu Open Platform console, go to **Events & Callbacks**:
1. Select **Long connection** (WebSocket mode - no public URL needed)
2. Subscribe to `im.message.receive_v1` event

## Phase 2: Check if already applied

Read `.nanoclaw/state.yaml`. If `add-feishu` is in `applied_skills`, skip to verification.

## Phase 3: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-feishu
```

### Validate changes

```bash
npm run build
npm test
```

## Phase 4: Configuration

Add the following to your `.env` file:

```bash
# Feishu Configuration
FEISHU_APP_ID=cli_xxxxxx
FEISHU_APP_SECRET=your_app_secret
FEISHU_ADMIN_USER_ID=your_user_id  # Optional: for folder permission grants
```

### Start the service

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## What Changed

| File | Change |
|------|--------|
| `src/channels/feishu.ts` | New file: Feishu channel implementation |
| `src/config.ts` | Added feishu config exports |
| `src/index.ts` | Register feishu channel |
| `package.json` | Added `@larksuiteoapi/node-sdk` dependency |

## Features

- **WebSocket connection** — No public URL needed, works behind NAT/firewall
- **Direct messages** — Users can DM the bot directly
- **Group chats** — Bot responds to @mentions in groups
- **Long message handling** — Uploads Markdown files to Feishu Drive for messages exceeding threshold
- **Auto-registration** — New groups are automatically registered
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
# 2. Check that you bot responds
```

