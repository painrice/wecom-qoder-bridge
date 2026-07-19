import AiBot from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

const BOT_ID = process.env.WECOM_BOT_ID;
const BOT_SECRET = process.env.WECOM_BOT_SECRET;
const QODER_BIN = process.env.QODER_BIN || '/root/.qoder-cn/bin/qoderclicn/qoderclicn-1.0.48';
const QODER_CWD = process.env.QODER_CWD || '/root';
const QODER_TIMEOUT = parseInt(process.env.QODER_TIMEOUT || '120000', 10);

if (!BOT_ID || !BOT_SECRET) {
  console.error('请设置环境变量 WECOM_BOT_ID 和 WECOM_BOT_SECRET');
  process.exit(1);
}

const userSessions = new Map();

function getSessionKey(frame) {
  const body = frame.body;
  if (body.chattype === 'group') {
    return `group:${body.chatid}:${body.from.userid}`;
  }
  return `single:${body.from.userid}`;
}

function getOrCreateSession(frame) {
  const key = getSessionKey(frame);
  if (!userSessions.has(key)) {
    userSessions.set(key, {
      sessionId: randomUUID(),
      createdAt: Date.now(),
    });
  }
  return userSessions.get(key);
}

async function callQoder(prompt, session) {
  const args = [
    '-p',
    '-o', 'json',
    '--no-session-persistence',
    '--session-id', session.sessionId,
    '-w', QODER_CWD,
    '--permission-mode', 'bypass_permissions',
    prompt,
  ];

  const { stdout } = await execFileAsync(QODER_BIN, args, {
    timeout: QODER_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    cwd: QODER_CWD,
    env: { ...process.env, HOME: process.env.HOME || '/root' },
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  if (result.is_error) {
    throw new Error(result.result || 'QoderCN 执行出错');
  }
  return result.result;
}

function splitIntoChunks(text, maxLen = 2000) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

const wsClient = new AiBot.WSClient({
  botId: BOT_ID,
  secret: BOT_SECRET,
  maxReconnectAttempts: -1,
});

wsClient.connect();

wsClient.on('authenticated', () => {
  console.log('[bridge] 企业微信长连接认证成功');
});

wsClient.on('disconnected', (reason) => {
  console.log('[bridge] 连接断开:', reason);
});

wsClient.on('error', (err) => {
  console.error('[bridge] 连接错误:', err.message);
});

wsClient.on('event.enter_chat', (frame) => {
  wsClient.replyWelcome(frame, {
    msgtype: 'text',
    text: { content: '你好！我是 QoderCN 智能助手，有什么可以帮你的？' },
  });
});

wsClient.on('message.text', async (frame) => {
  const content = frame.body.text?.content?.trim();
  const from = frame.body.from.userid;
  const chattype = frame.body.chattype;

  if (!content) return;

  console.log(`[bridge] 收到${chattype === 'group' ? '群聊' : '单聊'}消息 from ${from}: ${content.slice(0, 50)}`);

  const chatid = chattype === 'group' ? frame.body.chatid : from;
  const session = getOrCreateSession(frame);

  // 立即发送"正在思考"提示
  await wsClient.sendMessage(chatid, {
    msgtype: 'text',
    text: { content: '⏳ 正在思考...' },
  });

  try {
    const result = await callQoder(content, session);
    await wsClient.sendMessage(chatid, {
      msgtype: 'markdown',
      markdown: { content: result },
    });
    console.log(`[bridge] 回复成功 to ${from}, 长度: ${result.length}`);
  } catch (err) {
    console.error(`[bridge] 调用 QoderCN 失败:`, err.message);
    await wsClient.sendMessage(chatid, {
      msgtype: 'text',
      text: { content: `❌ 处理出错: ${err.message}` },
    });
  }
});

wsClient.on('message.voice', async (frame) => {
  const transcription = frame.body.voice?.transcription;
  if (!transcription) return;

  const from = frame.body.from.userid;
  console.log(`[bridge] 收到语音消息 from ${from}: ${transcription.slice(0, 50)}`);

  const session = getOrCreateSession(frame);

  await wsClient.sendMessage(from, {
    msgtype: 'text',
    text: { content: '⏳ 正在处理语音...' },
  });

  try {
    const result = await callQoder(transcription, session);
    await wsClient.sendMessage(from, {
      msgtype: 'markdown',
      markdown: { content: result },
    });
  } catch (err) {
    console.error(`[bridge] 语音处理失败:`, err.message);
    await wsClient.sendMessage(from, {
      msgtype: 'text',
      text: { content: `❌ 处理出错: ${err.message}` },
    });
  }
});

setInterval(() => {
  const now = Date.now();
  const expireMs = 30 * 60 * 1000;
  for (const [key, val] of userSessions) {
    if (now - val.createdAt > expireMs) {
      userSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

process.on('SIGINT', () => {
  console.log('[bridge] 正在关闭...');
  wsClient.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wsClient.disconnect();
  process.exit(0);
});

console.log('[bridge] 企业微信 ↔ QoderCN 桥接服务启动中...');
