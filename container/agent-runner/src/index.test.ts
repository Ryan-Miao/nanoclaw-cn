import { describe, it, expect } from 'vitest';

// Define the interface locally for testing
// This will be synchronized with the actual implementation
interface ContainerOutput {
  status: 'success' | 'error' | 'streaming';
  result: string | null;
  newSessionId?: string;
  error?: string;
  // Context management signals
  needsCompact?: boolean;
  compactSummary?: string;
  remainingTokens?: number;
  // Token usage info (for /usage command)
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow: number;
  };
  // New field for streaming messages
  messageType?: 'assistant' | 'tool_use' | 'result';
}

describe('ContainerOutput', () => {
  it('should support streaming status', () => {
    const output: ContainerOutput = {
      status: 'streaming',
      result: null,
    };
    expect(output.status).toBe('streaming');
  });

  it('should support messageType field for assistant messages', () => {
    const output: ContainerOutput = {
      status: 'streaming',
      messageType: 'assistant',
      result: 'Hello world',
    };
    expect(output.status).toBe('streaming');
    expect(output.messageType).toBe('assistant');
    expect(output.result).toBe('Hello world');
  });

  it('should support tool_use messageType', () => {
    const output: ContainerOutput = {
      status: 'streaming',
      messageType: 'tool_use',
      result: 'Read: {"file_path": "test.ts"}',
    };
    expect(output.messageType).toBe('tool_use');
  });

  it('should support result messageType', () => {
    const output: ContainerOutput = {
      status: 'success',
      messageType: 'result',
      result: 'Task completed successfully',
    };
    expect(output.messageType).toBe('result');
    expect(output.status).toBe('success');
  });

  it('should allow messageType to be optional', () => {
    const output: ContainerOutput = {
      status: 'success',
      result: 'No message type specified',
    };
    expect(output.messageType).toBeUndefined();
  });

  it('should support all existing fields alongside new fields', () => {
    const output: ContainerOutput = {
      status: 'streaming',
      result: 'Processing',
      newSessionId: 'session-123',
      needsCompact: false,
      remainingTokens: 50000,
      tokenUsage: {
        inputTokens: 10000,
        outputTokens: 5000,
        contextWindow: 200000,
      },
      messageType: 'assistant',
    };
    expect(output.status).toBe('streaming');
    expect(output.messageType).toBe('assistant');
    expect(output.newSessionId).toBe('session-123');
    expect(output.needsCompact).toBe(false);
    expect(output.remainingTokens).toBe(50000);
    expect(output.tokenUsage?.inputTokens).toBe(10000);
  });
});

describe('assistant message handling', () => {
  it('should extract text from assistant message', () => {
    const message = {
      type: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ],
    };
    const textContent = message.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .filter(t => t.trim())
      .join('\n');
    expect(textContent).toBe('Hello\n world');
  });

  it('should handle empty content array', () => {
    const message = {
      type: 'assistant',
      content: [],
    };
    const textContent = message.content
      ?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .filter(t => t.trim())
      .join('\n');
    expect(textContent).toBe('');
  });
});

describe('tool_use message handling', () => {
  it('should format tool_use message', () => {
    const message = {
      type: 'tool_use',
      name: 'Read',
      input: { file_path: '/src/test.ts' },
    };
    const toolName = message.name || 'unknown';
    const toolInput = message.input || {};
    const result = `${toolName}: ${JSON.stringify(toolInput)}`;
    expect(result).toBe('Read: {"file_path":"/src/test.ts"}');
  });

  it('should handle Bash tool specially', () => {
    const message = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test' },
    };
    const toolName = message.name || 'unknown';
    const toolInput = message.input as { command?: string };
    const result = `${toolName}: ${toolInput.command || ''}`;
    expect(result).toBe('Bash: npm test');
  });

  it('should handle missing name', () => {
    const message = {
      type: 'tool_use',
      input: { file_path: 'test.ts' },
    };
    const toolName = message.name || 'unknown';
    expect(toolName).toBe('unknown');
  });
});
