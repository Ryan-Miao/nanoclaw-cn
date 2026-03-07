import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  COMPACT_THRESHOLD_TOKENS,
  DISABLE_WHATSAPP,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  MEMORY_FLUSH_PROMPT,
  MEMORY_FLUSH_THRESHOLD_TOKENS,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  hasFeishuConfig,
} from './config.js';
import { readEnvFile } from './env.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { FeishuChannel } from './channels/feishu.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
  getContainersStatus,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import {
  findChannel,
  formatMessages,
  formatOutbound,
  processAndSendImages,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

// Cache for token usage info per group (updated on each agent response)
let tokenUsageCache: Record<
  string,
  { inputTokens: number; outputTokens: number; contextWindow: number; timestamp: string }
> = {};

// Read gateway logs and aggregate usage for a group
interface GatewayUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestCount: number;
  lastRequest: string;
}

function getGatewayUsage(groupFolder: string): GatewayUsage | null {
  const date = new Date().toISOString().split('T')[0];
  const logPath = path.join(process.cwd(), 'groups', groupFolder, 'logs', 'api', `api-${date}.jsonl`);

  if (!fs.existsSync(logPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let lastRequest = '';

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const usage = entry.response?.usage || {};
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheReadTokens += usage.cache_read_input_tokens || 0;
        cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        if (entry.timestamp) {
          lastRequest = entry.timestamp;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      requestCount: lines.length,
      lastRequest,
    };
  } catch (err) {
    logger.error({ err, logPath }, 'Failed to read gateway log');
    return null;
  }
}

let whatsapp: WhatsAppChannel;
let feishu: FeishuChannel | undefined;
const channels: Channel[] = [];

// Cache Feishu secrets from .env (not loaded into process.env for security)
const feishuSecrets = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        // Process markdown images: download and send via sendImage
        const processedText = await processAndSendImages(
          text,
          channel,
          chatJid,
          group.folder,
        );
        // Send remaining text (with image links removed)
        if (processedText) {
          await channel.sendMessage(chatJid, processedText);
        }
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        // Update token usage cache
        if (output.tokenUsage) {
          logger.info(
            { group: group.name, tokenUsage: output.tokenUsage },
            'Token usage received',
          );
          tokenUsageCache[group.folder] = {
            ...output.tokenUsage,
            timestamp: new Date().toISOString(),
          };
        }
        // Handle compact signal from container
        if (output.needsCompact) {
          logger.info(
            { group: group.name, remaining: output.remainingTokens },
            'Context threshold reached, session will compact on next run',
          );
          // Clear session to start fresh next time
          delete sessions[group.folder];
          setSession(group.folder, '');
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        compactThresholdTokens: COMPACT_THRESHOLD_TOKENS,
        memoryFlushThresholdTokens: MEMORY_FLUSH_THRESHOLD_TOKENS,
        memoryFlushPrompt: MEMORY_FLUSH_PROMPT,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    // Only update session if not compacting (wrappedOnOutput already handled compact case)
    if (output.newSessionId && !output.needsCompact) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    // Handle compact signal from container
    if (output.needsCompact) {
      logger.info(
        { group: group.name, summary: output.compactSummary?.slice(0, 100) },
        'Context threshold reached, clearing session for compact',
      );
      // Clear session to start fresh next time
      delete sessions[group.folder];
      setSession(group.folder, '');
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          // Check for /status command - handle directly without agent
          const statusMessage = groupMessages.find((m) =>
            m.content.trim().toLowerCase() === '/status',
          );
          if (statusMessage) {
            logger.info({ chatJid }, 'Status command received');
            const statusReport = getContainersStatus();
            await channel.sendMessage(chatJid, statusReport);
            // Update cursor to mark this message as processed
            lastAgentTimestamp[chatJid] = statusMessage.timestamp;
            saveState();
            continue;
          }

          // Check for /new command - start a fresh session
          const newSessionMessage = groupMessages.find((m) =>
            m.content.trim().toLowerCase() === '/new',
          );
          if (newSessionMessage) {
            logger.info({ chatJid, group: group.name }, '/new command received');
            const hadSession = !!sessions[group.folder];
            delete sessions[group.folder];
            setSession(group.folder, '');
            const response = hadSession
              ? '✅ 已创建新会话，下次对话将重新开始。'
              : 'ℹ️ 当前没有活跃会话，本来就是新会话。';
            await channel.sendMessage(chatJid, response);
            lastAgentTimestamp[chatJid] = newSessionMessage.timestamp;
            saveState();
            continue;
          }

          // Check for /usage command - show token usage
          const usageMessage = groupMessages.find((m) =>
            m.content.trim().toLowerCase() === '/usage',
          );
          if (usageMessage) {
            logger.info({ chatJid, group: group.name }, '/usage command received');
            const currentSessionId = sessions[group.folder];
            const sessionStatus = currentSessionId
              ? `活跃 (${currentSessionId.slice(0, 8)}...)`
              : '新会话';

            // Get usage from gateway logs (accurate daily total)
            const gatewayUsage = getGatewayUsage(group.folder);
            // Get context window info from SDK (current session)
            const sdkUsage = tokenUsageCache[group.folder];
            let response: string;

            if (gatewayUsage && gatewayUsage.requestCount > 0) {
              const totalTokens = gatewayUsage.inputTokens + gatewayUsage.outputTokens;
              const age = Math.round((Date.now() - new Date(gatewayUsage.lastRequest).getTime()) / 60000);

              let contextInfo = '';
              if (sdkUsage) {
                const remaining = sdkUsage.contextWindow - sdkUsage.inputTokens;
                const usedPercent = ((sdkUsage.inputTokens / sdkUsage.contextWindow) * 100).toFixed(1);
                contextInfo = `\n- 上下文: ${sdkUsage.inputTokens.toLocaleString()} / ${sdkUsage.contextWindow.toLocaleString()} (${usedPercent}%)\n` +
                  `- 剩余: ${remaining.toLocaleString()} tokens`;
              }

              response = `📊 **今日 Token 使用情况**\n\n` +
                `- 输入: ${gatewayUsage.inputTokens.toLocaleString()} tokens\n` +
                `- 输出: ${gatewayUsage.outputTokens.toLocaleString()} tokens\n` +
                `- 缓存命中: ${gatewayUsage.cacheReadTokens.toLocaleString()} tokens\n` +
                `- 缓存创建: ${gatewayUsage.cacheCreationTokens.toLocaleString()} tokens\n` +
                `- 总计: ${totalTokens.toLocaleString()} tokens\n` +
                `- 请求数: ${gatewayUsage.requestCount}${contextInfo}\n` +
                `- 会话: ${sessionStatus}\n` +
                `- 更新: ${age} 分钟前`;
            } else {
              response = `📊 暂无今日 token 使用数据，请先发送一条消息。\n\n- 会话: ${sessionStatus}`;
            }
            await channel.sendMessage(chatJid, response);
            lastAgentTimestamp[chatJid] = usageMessage.timestamp;
            saveState();
            continue;
          }

          // Check for /help command - show available commands
          const helpMessage = groupMessages.find((m) =>
            m.content.trim().toLowerCase() === '/help',
          );
          if (helpMessage) {
            logger.info({ chatJid, group: group.name }, '/help command received');
            const response = `📖 **可用命令**

• /status - 查看容器运行状态
• /new - 创建新会话（清除当前会话）
• /usage - 查看 token 使用情况
• /compact - 压缩会话（生成摘要并创建新会话）
• /help - 显示此帮助信息

💡 提示：
- 普通消息需要以触发词开头（如 @Andy）
- 主频道无需触发词，所有消息都会被处理`;
            await channel.sendMessage(chatJid, response);
            lastAgentTimestamp[chatJid] = helpMessage.timestamp;
            saveState();
            continue;
          }

          // Check for /compact command - generate summary and clear session
          const compactMessage = groupMessages.find((m) =>
            m.content.trim().toLowerCase() === '/compact',
          );
          if (compactMessage) {
            logger.info({ chatJid, group: group.name }, '/compact command received');
            const hadSession = !!sessions[group.folder];
            if (hadSession) {
              // First, ask the agent to generate summary and memory files
              await channel.sendMessage(chatJid, '📝 正在生成会话摘要和记忆文件...');
              await channel.setTyping?.(chatJid, true);

              const compactPrompt = `[SYSTEM] User requested session compact. Generate summary and memory files for the next session.

## Task 1: Generate Compact Summary
Use the Write tool to save to: /workspace/group/.nanoclaw/compact-summary.md

Format:
# Session Summary - ${new Date().toISOString().split('T')[0]}

## Current Task
(What were we doing?)

## Key Decisions
- (Important decisions made)

## Pending Actions
- (What's left to do)

## Important Context
(Any other context needed for continuation)

Keep it SHORT - max 50 lines.

## Task 2: Update Memory Files
1. **MEMORY.md** (Routing Index - keep under 50 lines)
   - Point to detailed files, don't dump knowledge here
   - Only add NEW stable info: preferences, key decisions

2. **memory/${new Date().toISOString().split('T')[0]}.md** (Today's Log - append-only)
   - What we did today
   - Key outcomes
   - Pending items

Rules:
1. READ existing files first - don't duplicate
2. Be CONCISE - bullet points, not paragraphs
3. Skip if nothing new to store

Reply "done" when finished. This is silent - user won't see the response.`;

              let gotResult = false;
              try {
                await runAgent(
                  group,
                  compactPrompt,
                  chatJid,
                  async (output) => {
                    // When we get a result, close the container
                    if (output.result && !gotResult) {
                      gotResult = true;
                      logger.info({ group: group.name }, 'Compact summary generated');
                      // Close stdin to let container exit
                      queue.closeStdin(chatJid);
                    }
                  },
                );
              } catch (err) {
                logger.warn({ group: group.name, err }, 'Compact summary generation failed, continuing anyway');
              }

              await channel.setTyping?.(chatJid, false);

              // Now clear the session
              delete sessions[group.folder];
              setSession(group.folder, '');
              delete tokenUsageCache[group.folder];
              await channel.sendMessage(chatJid, '✅ 会话已压缩，下次对话将使用新会话（会自动加载之前的摘要）。');
            } else {
              await channel.sendMessage(chatJid, 'ℹ️ 当前没有活跃会话，无需压缩。');
            }
            lastAgentTimestamp[chatJid] = compactMessage.timestamp;
            saveState();
            continue;
          }

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect channels in parallel
  if (!DISABLE_WHATSAPP) {
    whatsapp = new WhatsAppChannel(channelOpts);
    channels.push(whatsapp);
  }

  // Conditionally create Feishu channel if configured
  logger.info(
    { hasFeishu: hasFeishuConfig() },
    'Checking Feishu configuration',
  );
  if (hasFeishuConfig()) {
    logger.info('Creating Feishu channel');
    feishu = new FeishuChannel({
      ...channelOpts,
      appId: process.env.FEISHU_APP_ID || feishuSecrets.FEISHU_APP_ID!,
      appSecret:
        process.env.FEISHU_APP_SECRET || feishuSecrets.FEISHU_APP_SECRET!,
      onAutoRegister: (chatId: string) => {
        // Auto-register new feishu groups with a generated folder name
        // Feishu groups don't require @ trigger by default
        const folder = `feishu_${chatId.slice(-6)}`;
        registerGroup(chatId, {
          name: `Feishu Group ${chatId.slice(-6)}`,
          folder,
          trigger: '',
          added_at: new Date().toISOString(),
          requiresTrigger: false,
        });
      },
    });
    channels.push(feishu);
  }

  // Connect all channels in parallel (non-blocking - channels reconnect in background)
  Promise.all(channels.map((ch) => ch.connect())).catch((err) => {
    logger.warn(
      { err },
      'Some channels failed to connect initially, will retry',
    );
  });

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    sendImage: (jid, imagePath) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (!channel.sendImage)
        throw new Error(`Channel does not support sendImage: ${channel.name}`);
      return channel.sendImage(jid, imagePath);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) =>
      whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
