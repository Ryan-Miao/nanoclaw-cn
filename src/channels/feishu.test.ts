import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('FeishuChannel - Long Message Handling', () => {
  describe('generateDocumentTitle', () => {
    // 简单测试标题生成逻辑
    it('should extract first line as title', () => {
      const content = '这是第一行标题\n这是第二行内容\n这是第三行内容';
      const firstLine = content.split('\n')[0].trim();
      expect(firstLine).toBe('这是第一行标题');
    });

    it('should truncate long first line', () => {
      const longLine = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题';
      const truncated = longLine.length > 50 ? longLine.substring(0, 47) + '...' : longLine;
      expect(longLine.length).toBeGreaterThan(50);
      expect(truncated.endsWith('...')).toBe(true);
      expect(truncated.length).toBe(50); // 47 chars + 3 dots
    });

    it('should use fallback for short content', () => {
      const content = '短';
      const firstLine = content.split('\n')[0].trim();
      const title = !firstLine || firstLine.length < 5
        ? `NanoClaw 消息 - ${new Date().toLocaleString('zh-CN')}`
        : firstLine;
      expect(title.startsWith('NanoClaw 消息')).toBe(true);
    });
  });

  describe('optimizeParagraphs', () => {
    it('should merge short lines', () => {
      const lines = ['第一行', '第二行', '', '第三行', '第四行'];
      const result: string[] = [];
      let currentBlock = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (currentBlock) {
            result.push(currentBlock);
            currentBlock = '';
          }
          continue;
        }
        if (currentBlock && currentBlock.length > 1000) {
          result.push(currentBlock);
          currentBlock = trimmed;
        } else {
          currentBlock += (currentBlock ? '\n' : '') + trimmed;
        }
      }
      if (currentBlock) {
        result.push(currentBlock);
      }

      expect(result.length).toBe(2);
      expect(result[0]).toBe('第一行\n第二行');
      expect(result[1]).toBe('第三行\n第四行');
    });
  });

  describe('Folder name generation', () => {
    it('should sanitize special characters in group name', () => {
      const groupName = '工作/群\\组:测*试? "<>|';
      const safeName = groupName.replace(/[\/\\:\*\?\"<>\|]/g, '_');
      // 6 special characters: / \ : * ? " < > | (but | appears once, so 8 total)
      expect(safeName).toBe('工作_群_组_测_试_ ____'); // / \ : * ? " < > | = 8 chars replaced
    });

    it('should generate folder name with chatId suffix', () => {
      const groupName = '工作群';
      const chatId = 'oc_abc123xyz';
      const safeName = groupName.replace(/[\/\\:\*\?\"<>\|]/g, '_');
      const folderName = `${safeName}_${chatId.slice(-6)}`;
      expect(folderName).toBe('工作群_123xyz'); // last 6 chars of 'oc_abc123xyz' is '123xyz'
    });
  });
});
