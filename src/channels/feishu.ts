/**
 * 飞书 Channel - 使用官方 @larksuiteoapi/node-sdk
 * 文档: https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case
 */
import * as Lark from '@larksuiteoapi/node-sdk';

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
      // 检查消息长度，超过阈值则分块发送
      if (text.length > FEISHU_DOC_THRESHOLD) {
        await this.handleLongContent(chatId, text);
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

  /**
   * 处理长内容：分块发送或截断
   * 飞书消息长度限制约 4000 字符
   */
  private async handleLongContent(chatId: string, content: string): Promise<void> {
    const MAX_LENGTH = 3500; // 飞书消息长度限制
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
}
