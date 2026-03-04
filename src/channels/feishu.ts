/**
 * Feishu Channel - Uses official @larksuiteoapi/node-sdk
 * Documentation: https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { logger } from '../logger.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup, NewMessage } from '../types.js';
import { FEISHU_DOC_THRESHOLD } from '../config.js';

export interface FeishuChannelOpts {
  appId: string;
  appSecret: string;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  onAutoRegister?: (chatId: string) => void;
}

export class FeishuChannel implements Channel {
  name = 'feishu';
  prefixAssistantName = true;

  private opts: FeishuChannelOpts;
  private client: Lark.Client;
  private wsClient: Lark.WSClient;
  private connected = false;
  private outgoingQueue: Array<{ chatId: string; text: string }> = [];

  // Folder cache: chatId -> subFolderToken
  private folderCache: Map<string, string> = new Map();
  // Plans parent folder token
  private plansFolderToken: string | null = null;
  // Group name cache: chatId -> groupName
  private groupNameCache: Map<string, string> = new Map();

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;

    const baseConfig = {
      appId: opts.appId,
      appSecret: opts.appSecret,
    };

    this.client = new Lark.Client(baseConfig);
    this.wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info,
    });
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        logger.info('Starting Feishu WebSocket connection...');

        this.wsClient.start({
          eventDispatcher: new Lark.EventDispatcher({})
            .register({
              'im.message.receive_v1': async (data: any) => {
                await this.handleMessage(data);
              },
            }),
        });

        // Wait for connection to establish
        setTimeout(() => {
          this.connected = true;
          logger.info('Connected to Feishu');
          this.flushOutgoingQueue().catch(err =>
            logger.error({ err }, 'Failed to flush outgoing queue')
          );
          resolve();
        }, 2000);

      } catch (err) {
        logger.error({ err }, 'Failed to connect to Feishu');
        reject(err);
      }
    });
  }

  private async handleMessage(data: any): Promise<void> {
    try {
      const { message } = data;
      if (!message) return;

      const chatId = message.chat_id;
      const timestamp = new Date(parseInt(message.create_time)).toISOString();

      // Notify chat metadata
      this.opts.onChatMetadata(chatId, timestamp);

      // Auto-register new groups
      const groups = this.opts.registeredGroups();
      if (!groups[chatId]) {
        logger.info({ chatId }, 'Auto-registering new Feishu chat');
        if (this.opts.onAutoRegister) {
          this.opts.onAutoRegister(chatId);
        }
      }

      // Parse message content
      let content = '';
      if (message.message_type === 'text') {
        try {
          const contentObj = JSON.parse(message.content);
          content = contentObj.text || '';
        } catch {
          content = message.content;
        }
      }

      if (!content.trim()) return;

      const newMessage: NewMessage = {
        id: message.message_id,
        chat_jid: chatId,
        sender: message.sender?.sender_id?.open_id || '',
        sender_name: message.sender?.sender_id?.open_id || 'Unknown',
        content,
        timestamp,
        is_from_me: message.sender?.sender_type === 'app',
      };

      logger.info({ chatId, sender: newMessage.sender, content: content.slice(0, 50) }, 'Received Feishu message');

      // Send acknowledgment before processing
      await this.sendMessage(chatId, '收到，正在处理...');

      this.opts.onMessage(chatId, newMessage);

    } catch (err) {
      logger.error({ err }, 'Error handling Feishu message');
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.connected) {
      this.outgoingQueue.push({ chatId, text });
      logger.info({ chatId, queueSize: this.outgoingQueue.length }, 'Feishu disconnected, message queued');
      return;
    }

    try {
      // Check message length, create document if exceeds threshold
      if (text.length > FEISHU_DOC_THRESHOLD) {
        await this.createDocumentAndShare(chatId, text);
        return;
      }

      const resp = await this.client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (resp.code !== 0) {
        throw new Error(`Failed to send message: code=${resp.code}, msg=${resp.msg}`);
      }

      logger.info({ chatId, length: text.length }, 'Message sent to Feishu');
    } catch (err) {
      this.outgoingQueue.push({ chatId, text });
      logger.warn({ chatId, err, queueSize: this.outgoingQueue.length }, 'Failed to send, message queued');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    // Feishu chat_id format: oc_xxx (groups) or ou_xxx (users)
    return jid.startsWith('oc_') || jid.startsWith('ou_');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // @larksuiteoapi/node-sdk WSClient doesn't have explicit stop method
    // Connection closes on process exit
    logger.info('Disconnected from Feishu');
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't support typing indicator
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.outgoingQueue.length === 0) return;

    logger.info({ count: this.outgoingQueue.length }, 'Flushing outgoing message queue');

    while (this.outgoingQueue.length > 0) {
      const item = this.outgoingQueue.shift()!;
      await this.sendMessage(item.chatId, item.text);
    }
  }

  /**
   * Get group name
   */
  private async getGroupName(chatId: string): Promise<string> {
    // Check cache
    if (this.groupNameCache.has(chatId)) {
      return this.groupNameCache.get(chatId)!;
    }

    try {
      // Get group info
      const resp = await this.client.im.v1.chat.get({
        path: {
          chat_id: chatId,
        },
      });

      if (resp.code === 0 && resp.data?.name) {
        const name = resp.data.name;
        this.groupNameCache.set(chatId, name);
        return name;
      }
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to get group name, using fallback');
    }

    // Fallback: use chatId last 6 chars
    const fallback = chatId.slice(-6);
    this.groupNameCache.set(chatId, fallback);
    return fallback;
  }

  /**
   * Get "My Space" root folder token
   */
  private async getMySpaceRootToken(): Promise<string | null> {
    try {
      // Try listing files in "My Space" (no folder_token specified)
      const listResp = await this.client.drive.v1.file.list({
        params: {
          page_size: 10,
        },
      });

      if (listResp.code === 0 && listResp.data?.files && listResp.data.files.length > 0) {
        // Get first file's parent_token - this is the root token
        const firstFile = listResp.data.files[0] as { parent_token?: string };
        if (firstFile.parent_token) {
          logger.info({ rootToken: firstFile.parent_token }, 'Found MySpace root token');
          return firstFile.parent_token;
        }
      }

      logger.warn('Could not determine MySpace root token - no files or no parent_token');
      return null;
    } catch (err) {
      logger.warn({ err }, 'Failed to get MySpace root token, will create document without folder');
      return null;
    }
  }

  /**
   * Get or create Plans parent folder
   */
  private async getPlansFolderToken(): Promise<string | null> {
    // Return cached value
    if (this.plansFolderToken) {
      return this.plansFolderToken;
    }

    const PLANS_FOLDER_NAME = 'Plans';

    try {
      // Get "My Space" root folder token
      const rootToken = await this.getMySpaceRootToken();
      if (!rootToken) {
        logger.warn('Cannot create Plans folder without root token, documents will be created in default location');
        return null;
      }

      // Look for existing Plans folder
      const listResp = await this.client.drive.v1.file.list({
        params: {
          folder_token: rootToken,
          page_size: 50,
        },
      });

      if (listResp.code === 0 && listResp.data?.files) {
        const existingFolder = listResp.data.files.find(
          (f: { name?: string; type?: string; token?: string }) =>
            f.name === PLANS_FOLDER_NAME && f.type === 'folder'
        );
        if (existingFolder?.token) {
          this.plansFolderToken = existingFolder.token;
          logger.info({ folderToken: this.plansFolderToken }, 'Found existing Plans folder');

          // Grant admin permission to existing folder
          await this.grantFolderPermission(this.plansFolderToken);

          return this.plansFolderToken;
        }
      }

      // Create Plans folder
      const createResp = await this.client.drive.v1.file.createFolder({
        data: {
          name: PLANS_FOLDER_NAME,
          folder_token: rootToken,
        },
      });

      if (createResp.code === 0 && createResp.data?.token) {
        this.plansFolderToken = createResp.data.token;
        logger.info({ folderToken: this.plansFolderToken }, 'Created Plans folder');

        // Grant admin permission to folder
        await this.grantFolderPermission(this.plansFolderToken);

        return this.plansFolderToken;
      }

      logger.warn(`Failed to create Plans folder: code=${createResp.code}, msg=${createResp.msg}`);
      return null;
    } catch (err) {
      logger.warn({ err }, 'Failed to get/create Plans folder, documents will be created in default location');
      return null;
    }
  }

  /**
   * Grant admin permission to folder
   */
  private async grantFolderPermission(folderToken: string): Promise<void> {
    const adminUserId = process.env.FEISHU_ADMIN_USER_ID;
    if (!adminUserId) {
      logger.warn('FEISHU_ADMIN_USER_ID not set, skipping folder permission grant');
      return;
    }

    try {
      // Grant admin edit permission to folder
      await this.client.drive.permissionMember.create({
        params: {
          type: 'folder',
          need_notification: false,
        },
        path: {
          token: folderToken,
        },
        data: {
          member_type: 'userid',
          member_id: adminUserId,
          perm: 'full_access',
          type: 'user',
        },
      });

      logger.info({ folderToken, adminUserId }, 'Granted folder permission to admin');

    } catch (err) {
      // Error if already granted - ignore
      logger.warn({ err, folderToken }, 'Failed to grant folder permission (may already exist)');
    }
  }

  /**
   * Get or create group subfolder
   */
  private async getOrCreateGroupFolder(chatId: string): Promise<string | null> {
    // Check cache
    if (this.folderCache.has(chatId)) {
      return this.folderCache.get(chatId)!;
    }

    // Get group name
    const groupName = await this.getGroupName(chatId);
    // Clean special characters from group name
    const safeName = groupName.replace(/[\/\\:\*\?"<>\|]/g, '_');
    // Generate folder name: GroupName_chatIdLast6
    const folderName = `${safeName}_${chatId.slice(-6)}`;

    try {
      const parentToken = await this.getPlansFolderToken();
      if (!parentToken) {
        // Cannot create folder, return null (document will be created in default location)
        return null;
      }

      // Look for existing group folder
      const listResp = await this.client.drive.v1.file.list({
        params: {
          folder_token: parentToken,
          page_size: 100,
        },
      });

      if (listResp.code === 0 && listResp.data?.files) {
        const existingFolder = listResp.data.files.find(
          (f: { name?: string; type?: string; token?: string }) =>
            f.name === folderName && f.type === 'folder'
        );
        if (existingFolder?.token) {
          this.folderCache.set(chatId, existingFolder.token);
          logger.info({ chatId, folderName, folderToken: existingFolder.token }, 'Found existing group folder');
          return existingFolder.token;
        }
      }

      // Create group folder
      const createResp = await this.client.drive.v1.file.createFolder({
        data: {
          name: folderName,
          folder_token: parentToken,
        },
      });

      if (createResp.code === 0 && createResp.data?.token) {
        const newFolderToken = createResp.data.token;
        this.folderCache.set(chatId, newFolderToken);
        logger.info({ chatId, folderName, folderToken: newFolderToken }, 'Created group folder');

        // Grant admin permission to group folder
        await this.grantFolderPermission(newFolderToken);

        return newFolderToken;
      }

      logger.warn({ chatId, folderName }, `Failed to create group folder: code=${createResp.code}, msg=${createResp.msg}`);
      return null;
    } catch (err) {
      logger.warn({ err, chatId, folderName }, 'Failed to get/create group folder');
      return null;
    }
  }

  /**
   * Generate document title from content
   */
  private generateDocumentTitle(content: string): string {
    const lines = content.split('\n');

    // Look for first Markdown header
    for (const line of lines) {
      const trimmed = line.trim();
      const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
      if (headerMatch) {
        const title = headerMatch[1].trim();
        return title.length > 80 ? title.substring(0, 77) + '...' : title;
      }
    }

    // Fallback: use first non-empty line (skip separators and AI prefixes)
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed === '***' || trimmed === '___') {
        continue;
      }
      // Skip common AI reply prefixes
      if (/^(好的[！!]?|这是|以下是|我来|让我|完美|✅)/.test(trimmed)) {
        continue;
      }
      if (trimmed.length >= 5) {
        return trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
      }
    }

    // Final fallback: use timestamp
    return `NanoClaw Document - ${new Date().toLocaleString('zh-CN')}`;
  }

  /**
   * Create Feishu document and share link
   * Upload Markdown file directly, Feishu will auto-convert and render
   */
  private async createDocumentAndShare(chatId: string, content: string): Promise<void> {
    let tempFilePath: string | null = null;

    try {
      logger.info({ contentLength: content.length, chatId }, 'Uploading Markdown file to Feishu');

      // Get group folder token
      const folderToken = await this.getOrCreateGroupFolder(chatId);

      // Generate filename: title_timestamp.md
      const title = this.generateDocumentTitle(content);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeTitle = title.replace(/[\/\\:\*\?"<>\|]/g, '_').slice(0, 50);
      const fileName = `${safeTitle}_${timestamp}.md`;

      // Write temp file
      const tempDir = os.tmpdir();
      tempFilePath = path.join(tempDir, `nanoclaw-${Date.now()}.md`);
      fs.writeFileSync(tempFilePath, content, 'utf-8');

      const fileSize = fs.statSync(tempFilePath).size;
      const fileStream = fs.createReadStream(tempFilePath);

      logger.info({
        fileName,
        fileSize,
        folderToken,
      }, 'Uploading file to Feishu Drive');

      // Upload file to Feishu Drive
      const uploadResult = await this.client.drive.file.uploadAll({
        data: {
          file_name: fileName,
          parent_type: 'explorer',
          parent_node: folderToken || '',
          size: fileSize,
          file: fileStream,
        },
      });

      if (!uploadResult || !uploadResult.file_token) {
        throw new Error('Failed to upload file: no file_token returned');
      }

      const fileToken = uploadResult.file_token;

      logger.info({
        fileToken,
        fileName,
      }, 'File uploaded successfully');

      // Grant admin permission to file
      const adminUserId = process.env.FEISHU_ADMIN_USER_ID;
      if (adminUserId && fileToken) {
        try {
          await this.client.drive.permissionMember.create({
            params: {
              type: 'file',
              need_notification: false,
            },
            path: {
              token: fileToken,
            },
            data: {
              member_type: 'userid',
              member_id: adminUserId,
              perm: 'edit',
              type: 'user',
            },
          });
          logger.info({ fileToken, adminUserId }, 'Granted file permission to admin');
        } catch (permErr) {
          logger.warn({ err: permErr }, 'Failed to grant file permission');
        }
      }

      // Send file link
      const fileUrl = `https://feishu.cn/file/${fileToken}`;
      const linkMsg = `内容过长，已上传 Markdown 文件\n\n查看文件: ${fileUrl}\n\n文件: ${fileName} (${content.length} 字符)\n\n提示：可在「共享给我」中查看完整目录结构`;

      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: linkMsg }),
        },
      });

      logger.info({ fileToken, fileName }, 'File link sent');

    } catch (err) {
      logger.error({ err }, 'Failed to upload Markdown file, using chunk fallback');
      // Fallback to chunked sending
      await this.handleLongContent(chatId, content);
    } finally {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // Ignore cleanup failure
        }
      }
    }
  }

  /**
   * Handle long content: chunked sending (fallback when document creation fails)
   * Feishu message length limit is about 4000-5000 characters
   */
  private async handleLongContent(chatId: string, content: string): Promise<void> {
    const MAX_LENGTH = 3800;
    const chunks: string[] = [];

    // Split content by paragraphs
    let currentChunk = '';
    const paragraphs = content.split('\n');

    for (const para of paragraphs) {
      const testChunk = currentChunk + para + '\n';

      if (testChunk.length > MAX_LENGTH) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = para + '\n';
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    logger.info({ totalLength: content.length, chunkCount: chunks.length }, 'Splitting long message into chunks');

    // Send chunked messages
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}] ` : '';
      const chunkContent = prefix + chunks[i];

      await this.client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: chunkContent }),
        },
      });

      // Add delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    logger.info({ chatId, chunkCount: chunks.length }, 'Sent message in chunks');
  }
}
