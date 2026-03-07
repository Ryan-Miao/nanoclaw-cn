/**
 * API Gateway - 代理 Claude Code SDK 请求到 AI API
 * 记录请求和响应的 usage 信息
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.GATEWAY_PORT || 8080;
const TARGET_HOST = process.env.GATEWAY_TARGET_HOST || 'open.bigmodel.cn';
const TARGET_PORT = parseInt(process.env.GATEWAY_TARGET_PORT || '443');
const LOG_DIR = process.env.GATEWAY_LOG_DIR || '/workspace/group/logs/api';
const LOG_BODY = process.env.GATEWAY_LOG_BODY === 'true'; // 是否记录完整请求/响应体

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

  const proxyReq = https.request(options, (proxyRes) => {
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

        // 记录日志
        logRequest({
          timestamp: new Date().toISOString(),
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
