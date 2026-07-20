import AiBot from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';
import { query, qodercliAuth } from '@qoder-ai/qoder-agent-sdk';

const BOT_ID = process.env.WECOM_BOT_ID;
const BOT_SECRET = process.env.WECOM_BOT_SECRET;
const QODER_CWD = process.env.QODER_CWD || '/root';

if (!BOT_ID || !BOT_SECRET) {
  console.error('请设置环境变量 WECOM_BOT_ID 和 WECOM_BOT_SECRET');
  process.exit(1);
}

const userSessions = new Map();

function getSessionKey(body) {
  return body.chattype === 'group'
    ? `group:${body.chatid}:${body.from.userid}`
    : `single:${body.from.userid}`;
}

function getOrCreateSession(frame) {
  const key = getSessionKey(frame.body);
  if (!userSessions.has(key)) {
    userSessions.set(key, { sessionId: null, createdAt: Date.now(), callCount: 0 });
  }
  return userSessions.get(key);
}

async function callQoder(prompt, session, onChunk) {
  const options = {
    auth: qodercliAuth(),
    permissionMode: 'bypassPermissions',
    cwd: QODER_CWD,
    maxTurns: 30,
    includePartialMessages: true,
    ...(session.sessionId ? { resume: session.sessionId } : {}),
  };

  let result = '';
  const q = query({ prompt, options });
  try {
    for await (const msg of q) {
      if (msg.type === 'system' && msg.session_id) {
        session.sessionId = msg.session_id;
      } else if (msg.type === 'stream_event') {
        if (msg.event?.type === 'content_block_delta' && msg.event?.delta?.type === 'text_delta') {
          result += msg.event.delta.text;
          onChunk?.(result);
        }
      } else if (msg.type === 'result') {
        if (msg.subtype !== 'success') {
          const errors = msg.errors?.join('; ') || msg.subtype;
          throw new Error(`Agent 执行失败: ${errors}`);
        }
      }
    }
  } finally {
    q.close();
  }

  if (!result) {
    throw new Error('未收到回复');
  }

  session.callCount++;
  return result;
}

const wsClient = new AiBot.WSClient({
  botId: BOT_ID,
  secret: BOT_SECRET,
  maxReconnectAttempts: -1,
});

wsClient.connect();
wsClient.on('authenticated', () => console.log('[bridge] 认证成功'));
wsClient.on('disconnected', (r) => console.log('[bridge] 断开:', r));
wsClient.on('error', (e) => console.error('[bridge] 错误:', e.message));

wsClient.on('event.enter_chat', async (frame) => {
  try {
    await wsClient.replyWelcome(frame, {
      msgtype: 'text',
      text: { content: '你好！我是 QoderCN 智能助手，有什么可以帮你的？' },
    });
  } catch (err) {
    console.error('[bridge] 欢迎语发送失败:', err.message);
  }
});

wsClient.on('message.text', async (frame) => {
  try {
    const content = frame.body.text?.content?.trim();
    if (!content) return;

    const from = frame.body.from.userid;
    const chattype = frame.body.chattype;
    const chatid = chattype === 'group' ? frame.body.chatid : from;

    console.log(`[bridge] 收到${chattype === 'group' ? '群聊' : '单聊'}消息 from ${from}: ${content.slice(0, 50)}`);

    const session = getOrCreateSession(frame);
    const streamId = generateReqId('stream');

    await wsClient.replyStream(frame, streamId, '⏳ 正在思考...', false);

    let lastSentLen = 0;
    const result = await callQoder(content, session, (text) => {
      if (text.length - lastSentLen > 50) {
        wsClient.replyStream(frame, streamId, text, false).catch(() => {});
        lastSentLen = text.length;
      }
    });

    await wsClient.replyStream(frame, streamId, result, true);
    console.log(`[bridge] 回复成功 to ${from}, 长度: ${result.length}, session: ${session.sessionId}`);
  } catch (err) {
    console.error('[bridge] 消息处理失败:', err.message);
    try {
      const streamId = generateReqId('stream');
      await wsClient.replyStream(frame, streamId, `处理出错: ${err.message}`, true);
    } catch (e) {
      console.error('[bridge] 发送错误消息也失败:', e.message);
    }
  }
});

wsClient.on('message.voice', async (frame) => {
  try {
    const transcription = frame.body.voice?.transcription;
    if (!transcription) return;

    const from = frame.body.from.userid;
    console.log(`[bridge] 收到语音 from ${from}: ${transcription.slice(0, 50)}`);

    const session = getOrCreateSession(frame);
    const streamId = generateReqId('stream');

    await wsClient.replyStream(frame, streamId, '⏳ 正在处理语音...', false);

    let lastSentLen = 0;
    const result = await callQoder(transcription, session, (text) => {
      if (text.length - lastSentLen > 50) {
        wsClient.replyStream(frame, streamId, text, false).catch(() => {});
        lastSentLen = text.length;
      }
    });

    await wsClient.replyStream(frame, streamId, result, true);
  } catch (err) {
    console.error('[bridge] 语音处理失败:', err.message);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userSessions) {
    if (now - v.createdAt > 30 * 60 * 1000) userSessions.delete(k);
  }
}, 5 * 60 * 1000);

process.on('SIGINT', () => { wsClient.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { wsClient.disconnect(); process.exit(0); });
process.on('unhandledRejection', (err) => console.error('[bridge] 未处理 Promise 错误:', err));
process.on('uncaughtException', (err) => console.error('[bridge] 未捕获异常:', err));

console.log('[bridge] 企业微信 ↔ QoderCN 桥接服务启动中...');
