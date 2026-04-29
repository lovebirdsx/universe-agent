# ACP Client

用于调试与学习 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 的命令行客户端。

## 功能

- **协议观测**（`-P`）：以语法高亮展示所有 JSON-RPC 消息
- **交互式 REPL**：发送 prompt、切换模式、管理会话
- **权限模拟**：interactive / auto-approve / deny-all 三种模式
- **文件系统代理**：响应 Agent 的文件读写请求
- **终端管理**：响应 Agent 的终端创建/执行请求

## 快速开始

```bash
# 交互模式 + 协议观测
pnpm start:dev -- -P

# 详细输出
pnpm start:dev -- -P -V

# 单次执行
pnpm start:dev -- "你好"

# 自动批准所有权限
pnpm start:dev -- -P --permission auto-approve
```

## CLI 选项

```
用法: universe-agent-acp-client [options] [prompt...]

选项:
  --command <cmd>        服务端启动命令 (默认: tsx packages/acp/src/cli.ts)
  --args <args>          服务端额外参数，逗号分隔
  -w, --workspace <dir>  工作区目录 (默认: cwd)
  -P, --protocol         启用协议观测模式
  -V, --verbose          显示详细内容
  --permission <mode>    权限模式: interactive | auto-approve | deny-all
  --mode <mode>          初始会话模式: agent | plan | ask
  --session <id>         加载已有会话
  -v, --version          显示版本信息
  -h, --help             显示帮助信息
```

## REPL 命令

| 命令                 | 功能         |
| -------------------- | ------------ |
| `/help`              | 显示帮助     |
| `/quit` `/exit`      | 退出         |
| `/session new`       | 新建会话     |
| `/session load <id>` | 加载会话     |
| `/session info`      | 查看会话信息 |
| `/mode <mode>`       | 切换模式     |
| `/protocol`          | 开关协议观测 |
| `/verbose`           | 开关详细输出 |
| `/cancel`            | 取消当前请求 |
| `/clear`             | 清屏         |
