import { describe, it, expect } from 'vitest';
import { FeishuChannel } from './channels/feishu.js';

describe('FeishuChannel', () => {
  it('should identify feishu jids', () => {
    const channel = new FeishuChannel({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });

    expect(channel.ownsJid('oc_xxxxxxxx')).toBe(true);
    expect(channel.ownsJid('ou_xxxxxxxx')).toBe(true);
    expect(channel.ownsJid('123456789')).toBe(false);
  });

  it('should have correct name', () => {
    const channel = new FeishuChannel({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });

    expect(channel.name).toBe('feishu');
    expect(channel.prefixAssistantName).toBe(true);
  });
});
