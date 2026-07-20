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
- **流式输出**（边生成边显示）

## 实现方式对比

本项目使用 **Qoder Agent SDK** 方式实现，以下是与 CLI 方式的对比：

### SDK 方式（当前实现）

使用 `@qoder-ai/qoder-agent-sdk` 官方 SDK：

```javascript
import { query, qodercliAuth } from '@qoder-ai/qoder-agent-sdk';

const q = query({ prompt, options: { auth: qodercliAuth(), resume: sessionId } });
for await (const msg of q) {
  // 处理流式消息
}
```

**优势：**
- ✅ 支持流式输出，用户体验更好
- ✅ 可获取 thinking、tool_use 等中间事件
- ✅ 官方推荐的集成方式，更规范

**劣势：**
- ❌ 依赖更多（157MB node_modules）
- ❌ 主进程内存占用更大（~83MB）
- ❌ 需要设置 `QODERCLI_PATH` 环境变量

### CLI 方式（备选方案）

直接调用 `qoderclicn` 二进制：

```javascript
import { execFile } from 'child_process';

const { stdout } = await execFileAsync('qoderclicn', [
  '-p', '-o', 'json',
  '--resume', sessionId,
  prompt
]);
```

**优势：**
- ✅ 代码简单，依赖少（~10MB）
- ✅ 主进程内存占用小（~20-30MB）
- ✅ 认证自动处理，无需额外配置

**劣势：**
- ❌ 无法流式输出，需等待完整响应
- ❌ 无法获取中间过程

### 资源消耗对比

| 项目 | SDK 方式 | CLI 方式 |
|------|---------|---------|
| 桥接服务内存 | ~83MB | ~20-30MB |
| node_modules 大小 | 157MB | ~10MB |
| 每次查询 | 启动 qodercli 子进程 | 启动 qodercli 子进程 |
| 额外依赖 | SDK + MCP + express 等 | 仅 WeChat SDK |

**说明：** 两种方式每次查询都会启动 qodercli 子进程，因此单次查询的 CPU 和临时内存消耗相近。主要差别在于桥接服务本身的常驻内存和磁盘占用。

### 选择建议

- **选 SDK 方式**：如果看重流式输出体验，服务器内存充足（>2GB）
- **选 CLI 方式**：如果追求简单稳定，或服务器资源紧张（<1GB）

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `WECOM_BOT_ID` | 企微机器人 ID（必填） | - |
| `WECOM_BOT_SECRET` | 企微机器人 Secret（必填） | - |
| `QODERCLI_PATH` | qodercli 可执行文件路径（SDK 方式必填） | `qodercli` |
| `QODER_CWD` | CLI 工作目录 | `/root` |
| `QODER_TIMEOUT` | 超时（ms） | `180000` |

## 安全提示

- 建议将 `QODER_CWD` 设为隔离目录
- 默认使用 `bypass_permissions` 模式，生产环境请评估风险
- botSecret 是敏感信息，不要提交到代码仓库
