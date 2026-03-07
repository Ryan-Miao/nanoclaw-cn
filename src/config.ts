import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile(['ASSISTANT_NAME', 'ASSISTANT_HAS_OWN_NUMBER']);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Feishu document settings
export const FEISHU_DOC_THRESHOLD = parseInt(
  process.env.FEISHU_DOC_THRESHOLD || '2000',
  10,
); // characters threshold - if message is longer, create a document
export const FEISHU_DOC_TITLE = 'NanoClaw 消息文档';

// Feishu configuration check (secrets read directly where needed, not exported here)
// Cache the env values to avoid re-reading the file
const feishuEnvConfig = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
export const hasFeishuConfig = (): boolean => {
  return !!(
    (process.env.FEISHU_APP_ID || feishuEnvConfig.FEISHU_APP_ID) &&
    (process.env.FEISHU_APP_SECRET || feishuEnvConfig.FEISHU_APP_SECRET)
  );
};

// Disable WhatsApp (use only Feishu)
export const DISABLE_WHATSAPP =
  process.env.DISABLE_WHATSAPP === 'true' ||
  readEnvFile(['DISABLE_WHATSAPP']).DISABLE_WHATSAPP === 'true';

// Context management: trigger compact when remaining tokens < threshold
// Default 50K for 200K context models (like GLM-5)
// Set to 0 to disable automatic compact
export const COMPACT_THRESHOLD_TOKENS = parseInt(
  process.env.COMPACT_THRESHOLD_TOKENS || '50000',
  10,
);

// Memory flush: trigger silent turn to write memories before compact
// Should be higher than COMPACT_THRESHOLD_TOKENS to flush first
// Default 60K (10K buffer before compact)
// Set to 0 to disable memory flush
export const MEMORY_FLUSH_THRESHOLD_TOKENS = parseInt(
  process.env.MEMORY_FLUSH_THRESHOLD_TOKENS || '60000',
  10,
);

// Memory flush prompt - sent silently to trigger memory writing
// Uses OpenClaw-style dual memory structure:
// - MEMORY.md: routing index (~50 lines, points to detail files)
// - memory/YYYY-MM-DD.md: daily log (append-only)
// - memory/topic.md: detailed topic files (e.g., projects.md, network.md)
export const MEMORY_FLUSH_PROMPT = process.env.MEMORY_FLUSH_PROMPT ||
  `[SYSTEM] Session nearing compaction. Store durable memories now.

## What to write where:

**MEMORY.md** (Routing Index - keep under 50 lines)
- Point to detailed files, don't dump knowledge here
- Example: "See memory/projects.md for project details"
- Only add NEW stable info: preferences, key decisions

**memory/YYYY-MM-DD.md** (Today's Log - append-only)
- What we did today
- Key outcomes
- Pending items

## Rules:
1. READ existing files first - don't duplicate
2. Be CONCISE - bullet points, not paragraphs
3. Reply with NO_REPLY if nothing new to store

This is silent - user won't see it.`;
