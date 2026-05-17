# 紫薯通告 Skills

紫薯通告官方 Agent Skills 仓库。

当前发布：

- `zs-openapi`: 紫薯通告 OpenAPI / Webhook / 增量同步一键接入 Skill

## 安装

```bash
npx skills add https://github.com/zs-openapi/skills --skill zs-openapi -g -y
```

## 使用示例

安装后，在 Claude Code、Cursor 或其他支持 Agent Skills 的 IDE 中直接描述你的接入目标：

```txt
接入紫薯通告数据同步
生成一个 Node.js 接收紫薯通告 webhook 的服务
生成一个 Java Spring Boot 接收紫薯通告 webhook 的服务
用 ZSK_API_KEY 每 5 分钟增量同步达人到我们的 CRM
根据紫薯通告 /open-api/* 写一个 TypeScript client
帮我校验紫薯通告 webhook 的 HMAC-SHA256 签名
```

Skill 会根据场景读取对应 references 和 examples，生成接收端、主动拉 client、增量同步脚本、`.env.example` 与错误处理逻辑。

## 更新

```bash
npx skills check
npx skills update
```

## 版本

`zs-openapi` api-version: `2026.05`

## 反馈

请在 GitHub Issues 提交接入问题、字段建议或示例代码改进：

https://github.com/zs-openapi/skills/issues
