# wecom-bridge

企业微信 ↔ QoderCN CLI 桥接服务

通过 WebSocket 长连接将企业微信智能机器人对接 QoderCN CLI，无需公网域名。

## 快速开始

```bash
npm install @wecom/aibot-node-sdk
WECOM_BOT_ID=xxx WECOM_BOT_SECRET=xxx node index.js
```

## 作为 QoderCN Skill 安装

```bash
npx skills add <github-repo-url> --skill -g -y
```

安装后在 QoderCN 中输入 `/wecom-bridge` 即可一键启动。

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `WECOM_BOT_ID` | 企微机器人 ID（必填） | - |
| `WECOM_BOT_SECRET` | 企微机器人 Secret（必填） | - |
| `QODER_CWD` | CLI 工作目录 | `/root` |
| `QODER_TIMEOUT` | 超时（ms） | `120000` |

## 获取 botId 和 secret

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)
2. 应用管理 → 智能机器人 → 你的机器人 → API设置
3. 复制 Bot ID 和 Secret（注意区分 `l` 和 `I`）

## 功能

- 文本消息处理
- 语音消息处理（语音转文字）
- 多轮对话上下文（每用户独立 session）
- 群聊/单聊支持
- 自动重连
- 进入会话欢迎语

## 安全提示

- 建议将 `QODER_CWD` 设为隔离目录
- 默认使用 `bypass_permissions` 模式，生产环境请评估风险
