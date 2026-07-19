---
name: wecom-bridge
description: 一键启动企业微信 ↔ QoderCN 桥接服务，让企业微信用户通过长连接直接与 QoderCN CLI 对话。当用户想要将企业微信机器人对接 QoderCN、搭建企微 AI 助手、或配置企微长连接聊天时使用。
version: 1.1.0
author: user
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [wecom, wechat-work, bridge, bot, websocket]
---

# 企业微信 ↔ QoderCN 桥接服务

## 概述

将企业微信智能机器人通过 WebSocket 长连接对接 QoderCN CLI，实现企微用户直接与 QoderCN 对话。无需公网域名，无需回调地址。

## 何时使用

- 用户想将企业微信机器人对接 QoderCN
- 用户想搭建企微 AI 助手
- 用户提到"企业微信长连接"、"企微机器人"、"wecom bot"
- 用户想在群里或单聊中使用 QoderCN 的能力

## 前置条件

1. 已安装 QoderCN CLI 并登录
2. 已安装 Node.js >= 18
3. 在企业微信管理后台创建了智能机器人，获取了 `botId` 和 `secret`

## 操作步骤

### 第一步：收集配置信息

向用户询问以下信息（如果用户未提供）：

- **botId**：企业微信后台的机器人 ID（API设置页面获取）
- **botSecret**：企业微信后台的机器人 Secret（API设置页面获取）
- **工作目录**（可选）：QoderCN 执行时的工作目录，默认 `/root`

### 第二步：安装依赖

```bash
mkdir -p /root/wecom-bridge && cd /root/wecom-bridge
npm init -y --silent
npm pkg set type="module"
npm install @wecom/aibot-node-sdk
```

### 第三步：创建桥接服务

将以下代码写入 `/root/wecom-bridge/index.js`：

```javascript
import AiBot from '@wecom/aibot-node-sdk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { readdirSync, accessSync, constants } from 'fs';

const execFileAsync = promisify(execFile);

const BOT_ID = process.env.WECOM_BOT_ID;
const BOT_SECRET = process.env.WECOM_BOT_SECRET;
const QODER_CWD = process.env.QODER_CWD || '/root';
const QODER_TIMEOUT = parseInt(process.env.QODER_TIMEOUT || '120000', 10);

function findQoderBin() {
  if (process.env.QODER_BIN) return process.env.QODER_BIN;
  const dir = '/root/.qoder-cn/bin/qoderclicn';
  try {
    const files = readdirSync(dir).filter(f => f.startsWith('qoderclicn-')).sort();
    const latest = files[files.length - 1];
    const path = `${dir}/${latest}`;
    accessSync(path, constants.X_OK);
    return path;
  } catch { return 'qoderclicn'; }
}

const QODER_BIN = findQoderBin();

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
    userSessions.set(key, { sessionId: randomUUID(), createdAt: Date.now() });
  }
  return userSessions.get(key);
}

async function callQoder(prompt, session) {
  const { stdout } = await execFileAsync(QODER_BIN, [
    '-p', '-o', 'json',
    '--no-session-persistence',
    '--session-id', session.sessionId,
    '-w', QODER_CWD,
    '--permission-mode', 'bypass_permissions',
    prompt,
  ], {
    timeout: QODER_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    cwd: QODER_CWD,
    env: { ...process.env, HOME: process.env.HOME || '/root' },
  });
  const result = JSON.parse(stdout.trim().split('\n').pop());
  if (result.is_error) throw new Error(result.result || 'QoderCN 执行出错');
  return result.result;
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

wsClient.on('event.enter_chat', (frame) => {
  wsClient.replyWelcome(frame, {
    msgtype: 'text',
    text: { content: '你好！我是 QoderCN 智能助手，有什么可以帮你的？' },
  });
});

wsClient.on('message.text', async (frame) => {
  const content = frame.body.text?.content?.trim();
  if (!content) return;

  const from = frame.body.from.userid;
  const chattype = frame.body.chattype;
  const chatid = chattype === 'group' ? frame.body.chatid : from;

  console.log(`[bridge] 收到${chattype === 'group' ? '群聊' : '单聊'}消息 from ${from}: ${content.slice(0, 50)}`);

  const session = getOrCreateSession(frame);

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
    console.error(`[bridge] 失败:`, err.message);
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
  console.log(`[bridge] 收到语音 from ${from}: ${transcription.slice(0, 50)}`);

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
  for (const [k, v] of userSessions) {
    if (now - v.createdAt > 30 * 60 * 1000) userSessions.delete(k);
  }
}, 5 * 60 * 1000);

process.on('SIGINT', () => { wsClient.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { wsClient.disconnect(); process.exit(0); });

console.log('[bridge] 企业微信 ↔ QoderCN 桥接服务启动中...');
```

### 第四步：启动服务

```bash
cd /root/wecom-bridge
WECOM_BOT_ID=<botId> WECOM_BOT_SECRET=<secret> node index.js
```

### 第五步：验证

1. 在企业微信中找到该机器人，发送一条消息
2. 确认先收到"⏳ 正在思考..."提示
3. 确认随后收到 QoderCN 的完整回复

## 安全注意事项

- 桥接服务使用 `--permission-mode bypass_permissions`，意味着企微消息可以执行任何操作
- **强烈建议** 将 `QODER_CWD` 设置为隔离的工作目录，不要指向敏感代码目录
- 如果需要限制权限，改用 `--permission-mode default`（但需要手动审批，不适合自动化）
- botSecret 是敏感信息，不要提交到代码仓库

## 常见问题

- **认证失败 (853000)**：检查 botId 和 secret 是否正确，注意 `l` 和 `I`、`0` 和 `O` 的区别
- **回复超时**：调大 `QODER_TIMEOUT` 环境变量（默认 120 秒）
- **群聊中不响应**：群聊中需要 @机器人 才会触发消息回调
- **多用户隔离**：每个用户自动使用独立 session，互不影响
- **流式回复不可用**：企微客户端对 `replyStream` 支持有限，当前使用 `sendMessage` 主动推送模式
