/**
 * API Gateway - 代理 Claude Code SDK 请求到 AI API
 * 记录请求和响应的 usage 信息
 * 使用 tokenizer 自计算 token 数量（不依赖 API 返回）
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encode } from 'gpt-tokenizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.GATEWAY_PORT || 8080;
const TARGET_HOST = process.env.GATEWAY_TARGET_HOST || 'open.bigmodel.cn';
const TARGET_PORT = parseInt(process.env.GATEWAY_TARGET_PORT || '443');
const TARGET_USE_HTTPS = TARGET_PORT === 443;  // 只有 443 端口使用 HTTPS
const LOG_DIR = process.env.GATEWAY_LOG_DIR || '/workspace/group/logs/api';
const LOG_BODY = process.env.GATEWAY_LOG_BODY === 'true'; // 是否记录完整请求/响应体
const SESSION_ID = process.env.GATEWAY_SESSION_ID || ''; // 当前会话 ID
const CONTEXT_WINDOW = parseInt(process.env.CONTEXT_WINDOW || '200000');

// Usage 缓存文件路径
const USAGE_CACHE_FILE = '/workspace/group/.nanoclaw/usage-cache.json';

// 确保 .nanoclaw 目录存在
const usageCacheDir = path.dirname(USAGE_CACHE_FILE);
try {
  fs.mkdirSync(usageCacheDir, { recursive: true });
} catch (err) {
  // 目录可能已存在，忽略错误
}

/**
 * 使用 tokenizer 计算请求的 token 数量
 * 直接计算整个请求 body 的 JSON 字符串
 */
function countRequestTokens(request) {
  // 直接计算整个请求 body 的 token 数
  // 这是最准确的方式，因为包含了所有内容：
  // - system prompt
  // - messages (包括 role、content 等)
  // - tools 定义
  // - 其他字段
  const requestStr = JSON.stringify(request);
  return encode(requestStr).length;
}

/**
 * 更新 usage 缓存文件
 * 供 /usage 命令和 auto compact 读取
 */
function updateUsageCache(data) {
  const cacheData = {
    timestamp: new Date().toISOString(),
    sessionId: SESSION_ID,
    ...data,
  };

  try {
    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(cacheData, null, 2));
  } catch (err) {
    console.error(`[gateway] Failed to write usage cache: ${err.message}`);
  }
}

// 确保日志目录存在
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  console.log(`[gateway] Log directory: ${LOG_DIR}`);
} catch (err) {
  console.error(`[gateway] Failed to create log directory: ${err.message}`);
}

// 获取日志文件路径
function getLogFile() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `api-${date}.jsonl`);
}

// 解析流式响应中的 usage
function parseStreamUsage(chunks) {
  let usage = {};

  // 先合并所有 chunks，确保行不会被切断
  const fullText = chunks.join('');
  const lines = fullText.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        try {
          const data = JSON.parse(jsonStr);
          // 从 message_delta 或最后一条消息中提取 usage
          if (data.usage) {
            usage = data.usage;
          }
          if (data.message?.usage) {
            usage = data.message.usage;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  return usage;
}

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 读取请求体
  let requestBody = '';
  for await (const chunk of req) {
    requestBody += chunk;
  }

  let parsedRequest = {};
  try {
    parsedRequest = JSON.parse(requestBody);
  } catch {
    parsedRequest = { _raw: requestBody.slice(0, 500) };
  }

  // 使用 tokenizer 计算请求的 token 数量
  const computedInputTokens = countRequestTokens(parsedRequest);

  // 检查是否是流式请求
  const isStreaming = parsedRequest.stream === true;

  // 转发到真实 API
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET_HOST,
      'content-length': Buffer.byteLength(requestBody),
    },
  };

  // 如果原来是 localhost，替换 host
  if (options.headers.Host) {
    options.headers.Host = TARGET_HOST;
  }

  const proxyReq = (TARGET_USE_HTTPS ? https : http).request(options, (proxyRes) => {
    const chunks = [];
    let responseSize = 0;

    // 对于流式响应，需要收集所有 chunks 来计算 usage
    if (isStreaming) {
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk.toString());
        responseSize += chunk.length;
        // 直接转发给客户端
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();

        const duration = Date.now() - startTime;

        // 解析流式响应中的 usage
        const usage = parseStreamUsage(chunks);

        // 检测错误响应并输出更详细的信息
        if (proxyRes.statusCode !== 200) {
          const fullResponse = chunks.join('');
          let errorMsg = 'Unknown error';
          try {
            // 尝试解析 SSE 格式的错误
            for (const line of fullResponse.split('\n')) {
              if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6).trim());
                if (data.error) {
                  errorMsg = data.error.message || data.error.code || JSON.stringify(data.error);
                  break;
                }
              }
            }
          } catch {
            // 尝试直接解析 JSON
            try {
              const json = JSON.parse(fullResponse);
              errorMsg = json.error?.message || json.error?.code || fullResponse.slice(0, 200);
            } catch {
              errorMsg = fullResponse.slice(0, 200);
            }
          }
          console.error(`[gateway] API Error (${proxyRes.statusCode}): ${errorMsg}`);
        }

        // 记录日志
        logRequest({
          timestamp: new Date().toISOString(),
          sessionId: SESSION_ID,
          requestId,
          duration,
          streaming: true,
          request: {
            model: parsedRequest.model,
            messages_count: parsedRequest.messages?.length,
            system_length: parsedRequest.system?.length,
            max_tokens: parsedRequest.max_tokens,
            // 完整请求体（可选）
            ...(LOG_BODY && { body: parsedRequest }),
          },
          response: {
            status: proxyRes.statusCode,
            response_size: responseSize,
            usage: {
              input_tokens: usage.input_tokens || usage.prompt_tokens,
              output_tokens: usage.output_tokens || usage.completion_tokens,
              cache_read_input_tokens: usage.cache_read_input_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens,
            },
            // 完整响应体（可选）
            ...(LOG_BODY && { body: chunks.join('') }),
          },
        });

        // 更新 usage 缓存（使用 tokenizer 计算的值）
        const apiInputTokens = usage.input_tokens || usage.prompt_tokens || 0;
        const apiCacheTokens = usage.cache_read_input_tokens || 0;
        const outputTokens = usage.output_tokens || usage.completion_tokens || 0;

        // 使用我们计算的值作为 context 使用量（更准确反映当前请求大小）
        // API 的值保留用于调试和对比
        updateUsageCache({
          inputTokens: computedInputTokens,
          outputTokens: outputTokens,
          computedInputTokens,  // 我们计算的值
          apiInputTokens,       // API 返回的新输入 tokens
          apiCacheTokens,       // API 返回的缓存 tokens
          apiTotalTokens: apiInputTokens + apiCacheTokens,  // API 总计
          contextWindow: CONTEXT_WINDOW,
          remainingTokens: CONTEXT_WINDOW - computedInputTokens,
          model: parsedRequest.model,
          success: proxyRes.statusCode === 200,
        });
      });
    } else {
      // 非流式请求
      let responseBody = '';

      proxyRes.on('data', (chunk) => {
        responseBody += chunk;
      });

      proxyRes.on('end', () => {
        const duration = Date.now() - startTime;

        let parsedResponse = {};
        try {
          parsedResponse = JSON.parse(responseBody);
        } catch {
          parsedResponse = { _raw: responseBody.slice(0, 500) };
        }

        const usage = parsedResponse.usage || {};

        // 记录日志
        logRequest({
          timestamp: new Date().toISOString(),
          sessionId: SESSION_ID,
          requestId,
          duration,
          streaming: false,
          request: {
            model: parsedRequest.model,
            messages_count: parsedRequest.messages?.length,
            system_length: parsedRequest.system?.length,
            max_tokens: parsedRequest.max_tokens,
            // 完整请求体（可选）
            ...(LOG_BODY && { body: parsedRequest }),
          },
          response: {
            status: proxyRes.statusCode,
            usage: {
              input_tokens: usage.input_tokens || usage.prompt_tokens,
              output_tokens: usage.output_tokens || usage.completion_tokens,
              cache_read_input_tokens: usage.cache_read_input_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens,
            },
            stop_reason: parsedResponse.stop_reason || parsedResponse.choices?.[0]?.finish_reason,
            // 完整响应体（可选）
            ...(LOG_BODY && { body: parsedResponse }),
          },
        });

        // 更新 usage 缓存（使用 tokenizer 计算的值）
        const apiInputTokens = usage.input_tokens || usage.prompt_tokens || 0;
        const apiCacheTokens = usage.cache_read_input_tokens || 0;
        const outputTokens = usage.output_tokens || usage.completion_tokens || 0;

        // 使用我们计算的值作为 context 使用量（更准确反映当前请求大小）
        updateUsageCache({
          inputTokens: computedInputTokens,
          outputTokens: outputTokens,
          computedInputTokens,  // 我们计算的值
          apiInputTokens,       // API 返回的新输入 tokens
          apiCacheTokens,       // API 返回的缓存 tokens
          apiTotalTokens: apiInputTokens + apiCacheTokens,  // API 总计
          contextWindow: CONTEXT_WINDOW,
          remainingTokens: CONTEXT_WINDOW - computedInputTokens,
          model: parsedRequest.model,
          success: proxyRes.statusCode === 200,
        });

        // 返回响应
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(responseBody);
      });
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[gateway] Proxy error: ${err.message}`);
    logRequest({
      timestamp: new Date().toISOString(),
      sessionId: SESSION_ID,
      requestId,
      error: err.message,
      request: {
        model: parsedRequest.model,
      },
    });
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  });

  proxyReq.write(requestBody);
  proxyReq.end();
});

function logRequest(entry) {
  try {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getLogFile(), logLine);

    // 简短的控制台输出
    const usage = entry.response?.usage || {};
    const input = usage.input_tokens || '?';
    const output = usage.output_tokens || '?';
    console.log(`[gateway] ${entry.requestId.slice(-8)} ${entry.duration}ms tokens=${input}/${output}`);
  } catch (err) {
    console.error(`[gateway] Failed to log: ${err.message}`);
  }
}

server.listen(PORT, () => {
  console.log(`[gateway] API proxy listening on port ${PORT}`);
  console.log(`[gateway] Forwarding to https://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`[gateway] Logging to ${LOG_DIR}`);
  console.log(`[gateway] Log full body: ${LOG_BODY}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[gateway] SIGTERM received, shutting down');
  server.close(() => {
    console.log('[gateway] Server closed');
    process.exit(0);
  });
});
