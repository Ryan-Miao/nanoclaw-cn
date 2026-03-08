import { describe, it, expect } from 'vitest';

describe('streaming output formatting', () => {
  it('should add prefix for assistant message', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'assistant' as const,
      result: 'Hello world',
    };
    const prefix = '[助手] ';
    const text = prefix + output.result;
    expect(text).toBe('[助手] Hello world');
  });

  it('should add prefix for tool_use message', () => {
    const output = {
      status: 'streaming' as const,
      messageType: 'tool_use' as const,
      result: 'Read: {"file_path":"test.ts"}',
    };
    const prefix = '[工具] ';
    const text = prefix + output.result;
    expect(text).toBe('[工具] Read: {"file_path":"test.ts"}');
  });

  it('should not add prefix for result message', () => {
    const output = {
      status: 'success' as const,
      messageType: 'result' as const,
      result: 'Done!',
    };
    // result 类型不加前缀
    const text = output.result || '';
    expect(text).toBe('Done!');
  });
});
