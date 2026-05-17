# 平台识别

紫薯通告达人数据库的 platform 字段是「官方达人广告平台」粒度，6 个值：

| enum | 中文 | 主要识别 URL host |
|------|------|------------------|
| STARMAP | 抖音星图 | star.toutiao.com / douyin.com / iesdouyin.com |
| PGY | 小红书蒲公英 | pgy.xiaohongshu.com / xiaohongshu.com / xhslink.com |
| VIDEO_HUXUAN | 视频号互选 | channels.weixin.qq.com |
| MP_HUXUAN | 公众号互选 | mp.weixin.qq.com |
| BILIBILI_HUAHUO | B 站花火 | cm.bilibili.com / space.bilibili.com / bilibili.com / b23.tv |
| KUAISHOU_JLJX | 快手磁力聚星 | xingtu.kuaishou.com / kuaishou.com / v.kuaishou.com |

注意：

- 不再有「小红书原生」「抖音原生」等 C 端粒度
- 旧的 XHS / DOUYIN / KUAISHOU / BILIBILI / WEIBO 已废弃，旧数据迁移：XHS→PGY、DOUYIN→STARMAP、KUAISHOU→KUAISHOU_JLJX、BILIBILI→BILIBILI_HUAHUO、WEIBO 删除
- Excel 导入按行内 URL host 自动归类到 6 个平台之一，未识别行静默跳过

## 给 AI 的归类提示

用户对话中出现下列关键词时，按括号内 enum 归类后再继续：

- 「小红书」/「蒲公英」/「PGY」/「xhslink」→ `PGY`
- 「抖音」/「星图」/「Star Map」/「toutiao」→ `STARMAP`
- 「视频号」/「微信视频号」/「channels.weixin」→ `VIDEO_HUXUAN`
- 「公众号」/「微信公众号」/「mp.weixin」→ `MP_HUXUAN`
- 「B 站」/「哔哩哔哩」/「bilibili」/「花火」→ `BILIBILI_HUAHUO`
- 「快手」/「磁力聚星」/「xingtu」→ `KUAISHOU_JLJX`

如果用户说「微博」/「WEIBO」，明确告知：当前平台不支持微博，不在 6 个官方广告平台范围内。
