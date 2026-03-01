/**
 * 测试飞书长消息文档创建功能
 * 运行: npx tsx test-feishu-doc.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { FeishuChannel } from './feishu.js';

async function main() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('请配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    process.exit(1);
  }

  // 创建 channel（不启动 WebSocket）
  const channel = new FeishuChannel({
    appId,
    appSecret,
    onMessage: () => {},
    onChatMetadata: () => {},
    registeredGroups: () => ({}),
  });

  // 模拟连接（等待初始化）
  console.log('正在连接飞书...');
  await channel.connect();
  console.log('已连接');

  // 生成一条超过 2000 字的测试消息
  const testChatId = process.env.TEST_CHAT_ID;
  if (!testChatId) {
    console.error('请配置 TEST_CHAT_ID（目标聊天ID）');
    process.exit(1);
  }

  // 生成 3000 字的测试内容
  const testContent = `【测试长消息 - 飞书文档创建功能】

这是一条测试消息，用于验证飞书长消息自动转换为飞书文档的功能。

${'='.repeat(50)}

## 测试内容

${Array(50).fill(0).map((_, i) =>
  `第 ${i + 1} 段：这是一段测试文本，用于模拟长消息内容。我们需要确保当消息超过 2000 字符时，系统能够自动创建飞书文档而不是分块发送。`
).join('\n\n')}

${'='.repeat(50)}

测试完成！如果你看到这条消息是以飞书文档链接的形式发送的，说明功能正常。

文档应该创建在 Plans/{群组名称}/ 目录下。
`;

  console.log(`\n测试消息长度: ${testContent.length} 字符`);
  console.log(`目标聊天: ${testChatId}`);
  console.log('\n正在发送消息...\n');

  try {
    await channel.sendMessage(testChatId, testContent);
    console.log('✅ 消息发送成功！');
  } catch (err) {
    console.error('❌ 发送失败:', err);
  }

  // 等待一下确保消息发送完成
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n测试完成');
  process.exit(0);
}

main().catch(console.error);
