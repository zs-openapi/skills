# CLOUD vs LOCAL 数据模式

`Organization.dataMode` 决定企业的达人数据归属、能否调主动拉接口。本期支持两种模式，由企业管理员在管理端「企业管理」→「数据模式」切换。

## 语义

| 模式 | 达人数据归属 | `Blogger.ownerUserId` |
|------|-------------|----------------------|
| **CLOUD（云端共享）** | 全企业共享一份达人池 | `null`（所有成员都能看到 + 编辑） |
| **LOCAL（成员私有）** | 每位成员维护私有队列 | `<userId>`（仅本人可见 + 编辑） |

CLOUD 适合：企业内部协作型团队、统一的达人 CRM、跨成员复用同一份数据。

LOCAL 适合：每个成员有自己的客户池、达人列表不外露给同事、按成员独立结算。

## 支持矩阵

| 能力 | CLOUD | LOCAL |
|------|-------|-------|
| 主动推 webhook | ✅ 全功能 | ✅ 全功能（推送当前成员维度的 Blogger） |
| 主动拉 `/open-api/*` | ✅ 全功能 | ❌ 全部接口返 403 |
| 桌面端达人导入 / 采集 | ✅ | ✅ |
| 桌面端 ApiKey 管理 | ✅ 可见 | ❌ 隐藏（LOCAL 没有意义） |

**关键点**：

- 主动推不依赖 dataMode；两种模式都能推。
- 主动拉强依赖 CLOUD：LOCAL 调任何 `/open-api/*` 都返固定 403。这是设计——LOCAL 模式下达人是成员私产，不通过企业级 ApiKey 暴露。

## LOCAL 调主动拉的 403 响应

```bash
curl -sS https://api.zishutonggao.com/open-api/bloggers \
  -H "X-API-Key: $ZSK_API_KEY"
```

```json
{
  "code": 403,
  "message": "开启云端共享数据模式后可用",
  "data": null
}
```

文案固定。客户端可作为 LOCAL 检测信号——发现 403 + 该文案 → 提示用户去切 CLOUD，不要默默重试。

## LOCAL → CLOUD 切换流程

1. 企业管理员登录管理端
2. 进「企业管理」→「数据模式」
3. 点「切换到 CLOUD」→ 弹二次确认
4. 确认后：
   - 所有成员的 `Blogger.ownerUserId` 清空
   - 重复达人按 `(platform, platformBloggerId)` 合并为企业共享池一条
   - 企业获得调用 `/open-api/*` 的能力
5. **不可逆**：CLOUD → LOCAL 本期不支持（避免误操作导致共享数据按成员错乱）。如必须切，联系 zoho.allen@gmail.com。

## 切换前的检查清单

- [ ] 通知所有成员：私有达人将合并为企业共享
- [ ] 导出当前 LOCAL 数据备份（管理端「达人列表」按成员筛选导出 Excel）
- [ ] 确认企业 ApiKey 接收方已就绪（一旦 CLOUD 化即可调 `/open-api/*`）

## AI 助手怎么处理

生成主动拉客户端代码之前，必须先确认企业 dataMode：

```
你> 用紫薯通告 API 拉一下所有达人
AI> 主动拉接口需要企业 dataMode = CLOUD。请确认你的企业当前模式：
    - 如果是 LOCAL：先去管理端「企业管理」→「数据模式」切到 CLOUD（不可逆）
    - 如果是 CLOUD：把 ZSK_API_KEY 给我，我直接生成客户端
```

不要直接生成代码再让用户撞 403。
