/**
 * 飞书 Channel - 使用官方 @larksuiteoapi/node-sdk
 * 文档: https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case
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

  // 文件夹缓存: chatId -> subFolderToken
  private folderCache: Map<string, string> = new Map();
  // Plans 父文件夹 token
  private plansFolderToken: string | null = null;
  // 群组名称缓存: chatId -> groupName
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

        // 监听连接状态
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

      // 通知 chat metadata
      this.opts.onChatMetadata(chatId, timestamp);

      // 自动注册新群组
      const groups = this.opts.registeredGroups();
      if (!groups[chatId]) {
        logger.info({ chatId }, 'Auto-registering new Feishu chat');
        if (this.opts.onAutoRegister) {
          this.opts.onAutoRegister(chatId);
        }
      }

      // 解析消息内容
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
      // 检查消息长度，超过阈值则创建飞书文档
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
    // 飞书的 chat_id 格式是 oc_xxx (群组) 或 ou_xxx (用户)
    return jid.startsWith('oc_') || jid.startsWith('ou_');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // @larksuiteoapi/node-sdk 的 WSClient 没有显式的 stop 方法
    // 连接会在进程退出时自动关闭
    logger.info('Disconnected from Feishu');
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    // 飞书不支持打字指示器
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
   * 获取群组名称
   */
  private async getGroupName(chatId: string): Promise<string> {
    // 检查缓存
    if (this.groupNameCache.has(chatId)) {
      return this.groupNameCache.get(chatId)!;
    }

    try {
      // 获取群组信息
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

    // 回退：使用 chatId 后6位
    const fallback = chatId.slice(-6);
    this.groupNameCache.set(chatId, fallback);
    return fallback;
  }

  /**
   * 获取"我的空间"根目录 token
   * 通过列出文件并获取其 parent_token 来推断根目录
   * @returns 根目录 token，如果无法获取则返回 null
   */
  private async getMySpaceRootToken(): Promise<string | null> {
    try {
      // 尝试列出"我的空间"中的文件（不指定 folder_token）
      const listResp = await this.client.drive.v1.file.list({
        params: {
          page_size: 10,
        },
      });

      if (listResp.code === 0 && listResp.data?.files && listResp.data.files.length > 0) {
        // 获取第一个文件的 parent_token，这就是根目录 token
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
   * 获取或创建 Plans 父文件夹
   * 自动在"我的空间"根目录下创建 Plans 文件夹
   * @returns Plans 文件夹 token，如果无法创建则返回 null（文档将创建在默认位置）
   */
  private async getPlansFolderToken(): Promise<string | null> {
    // 如果已缓存，直接返回
    if (this.plansFolderToken) {
      return this.plansFolderToken;
    }

    const PLANS_FOLDER_NAME = 'Plans';

    try {
      // 获取"我的空间"根目录 token
      const rootToken = await this.getMySpaceRootToken();
      if (!rootToken) {
        logger.warn('Cannot create Plans folder without root token, documents will be created in default location');
        return null;
      }

      // 在根目录下查找 Plans 文件夹
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

          // 给管理员授权已有的文件夹（确保权限）
          await this.grantFolderPermission(this.plansFolderToken);

          return this.plansFolderToken;
        }
      }

      // 创建 Plans 文件夹
      const createResp = await this.client.drive.v1.file.createFolder({
        data: {
          name: PLANS_FOLDER_NAME,
          folder_token: rootToken,
        },
      });

      if (createResp.code === 0 && createResp.data?.token) {
        this.plansFolderToken = createResp.data.token;
        logger.info({ folderToken: this.plansFolderToken }, 'Created Plans folder');

        // 给管理员授权整个文件夹
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
   * 给管理员授权文件夹
   */
  private async grantFolderPermission(folderToken: string): Promise<void> {
    const adminUserId = process.env.FEISHU_ADMIN_USER_ID;
    if (!adminUserId) {
      logger.warn('FEISHU_ADMIN_USER_ID not set, skipping folder permission grant');
      return;
    }

    try {
      // 给管理员授权文件夹的编辑权限
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
          perm: 'full_access', // 完全访问权限
          type: 'user',
        },
      });

      logger.info({ folderToken, adminUserId }, 'Granted folder permission to admin');

    } catch (err) {
      // 如果已经授权过，会报错，忽略即可
      logger.warn({ err, folderToken }, 'Failed to grant folder permission (may already exist)');
    }
  }

  /**
   * 获取或创建群组子文件夹
   * @returns 群组文件夹 token，如果无法创建则返回 null
   */
  private async getOrCreateGroupFolder(chatId: string): Promise<string | null> {
    // 检查缓存
    if (this.folderCache.has(chatId)) {
      return this.folderCache.get(chatId)!;
    }

    // 获取群组名称
    const groupName = await this.getGroupName(chatId);
    // 清理群组名称中的特殊字符
    const safeName = groupName.replace(/[\/\\:\*\?\"<>\|]/g, '_');
    // 生成文件夹名：群组名称_chatId后6位
    const folderName = `${safeName}_${chatId.slice(-6)}`;

    try {
      const parentToken = await this.getPlansFolderToken();
      if (!parentToken) {
        // 无法创建文件夹，返回 null（文档将创建在默认位置）
        // 但缓存群组名称以便在标题中使用
        return null;
      }

      // 查找是否已存在该群组文件夹
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

      // 创建群组文件夹
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

        // 给管理员授权群组文件夹
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
   * 从内容生成文档标题
   * 搜索整个内容找第一个 Markdown 标题（# 开头）
   */
  private generateDocumentTitle(content: string): string {
    const lines = content.split('\n');

    // 遍历所有行，找第一个 Markdown 标题
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 Markdown 标题（# 到 ######）
      const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
      if (headerMatch) {
        const title = headerMatch[1].trim();
        return title.length > 80 ? title.substring(0, 77) + '...' : title;
      }
    }

    // 回退：使用第一个非空行（跳过分隔线和 AI 前缀）
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed === '***' || trimmed === '___') {
        continue;
      }
      // 跳过常见的 AI 回复前缀
      if (/^(好的[！!]?|这是|以下是|我来|让我|完美|✅)/.test(trimmed)) {
        continue;
      }
      if (trimmed.length >= 5) {
        return trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
      }
    }

    // 最终回退：使用时间戳
    return `NanoClaw 文档 - ${new Date().toLocaleString('zh-CN')}`;
  }

  /**
   * 创建飞书文档并发送分享链接
   * 直接上传 Markdown 文件，飞书会自动转换并渲染
   */
  private async createDocumentAndShare(chatId: string, content: string): Promise<void> {
    let tempFilePath: string | null = null;

    try {
      logger.info({ contentLength: content.length, chatId }, 'Uploading Markdown file to Feishu');

      // 获取群组文件夹 token
      const folderToken = await this.getOrCreateGroupFolder(chatId);

      // 生成文件名：标题_时间戳.md
      const title = this.generateDocumentTitle(content);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeTitle = title.replace(/[\/\\:\*\?"<>\|]/g, '_').slice(0, 50);
      const fileName = `${safeTitle}_${timestamp}.md`;

      // 写入临时文件
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

      // 上传文件到飞书云空间
      // uploadAll 返回 { file_token?: string } 或抛出错误
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

      // 给管理员授权文件
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

      // 发送文件链接
      // Markdown 文件在飞书中可以通过 file token 直接访问
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
      // 失败时使用分块方案
      await this.handleLongContent(chatId, content);
    } finally {
      // 清理临时文件
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // 忽略清理失败
        }
      }
    }
  }

  /**
   * 处理长内容：分块发送（文档创建失败时的后备方案）
   * 飞书消息长度限制约 4000-5000 字符
   */
  private async handleLongContent(chatId: string, content: string): Promise<void> {
    const MAX_LENGTH = 3800; // 飞书消息长度限制（留余地避免超限）
    const chunks: string[] = [];

    // 按段落分割内容
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

    // 发送分块消息
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

      // 分块之间添加延迟，避免频率限制
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    logger.info({ chatId, chunkCount: chunks.length }, 'Sent message in chunks');
  }
}
