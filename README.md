# ding-supabase — 钉钉登录 + Supabase 最小开发闭环

应用"后半段"业务层的可运行验证：用户用**钉钉账号登录**，进来读写**自己的数据**，前端/后端/数据库三位一体。

> 配套方案文档（含完整背景与对齐结论）：
> https://alidocs.dingtalk.com/i/nodes/GZLxjv9VGGDA9Ro2u6BY5ewyV6EDybno

## 目录结构

```
ding-supabase/
├── M0-setup.md                                  环境准备 + 部署命令清单
├── supabase/
│   ├── migrations/
│   │   └── 20260616120000_notes.sql             notes 表 + RLS（行级隔离，每人只看自己的）
│   └── functions/
│       ├── dingtalk-oauth/index.ts              身份适配层：钉钉非标准 OAuth → 标准 OAuth
│       └── notes-api/index.ts                   业务接口：带登录态读写本人 notes
└── web/index.html                               前端：钉钉登录 → 读写 notes
```

## 端到端数据流

```
用户点"钉钉登录"
  → signInWithOAuth("custom:dingtalk")
  → https://login.dingtalk.com/oauth2/auth 扫码 → 回调带 code
  → Supabase 调适配层 /dingtalk-oauth/token（换 token）+ /userinfo（取 unionId）
  → Supabase 签发 session（sub = unionId，稳定唯一）
前端拿 JWT 调 notes-api
  → RLS 用 auth.uid() 只放行本人数据
  → 页面展示"我的 notes"
```

## 为什么要适配层

钉钉 OAuth2.0 不是标准实现（token 用 JSON body / 字段 accessToken·expireIn / userinfo 用 header `x-acs-dingtalk-access-token`），Supabase Custom Provider 不能直连，故用一个 Edge Function 包成标准 OAuth2。详见方案文档**附录 B**。

## 快速跑起来

前置见 [M0-setup.md](./M0-setup.md)（装 CLI、建 project、连 GitHub）。然后：

```bash
# 1. 建表
supabase db push

# 2. 部署两个函数
supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref <PROJECT_REF>
supabase functions deploy notes-api --project-ref <PROJECT_REF>

# 3. 配钉钉应用凭证（自建应用步骤见方案文档附录 C）
supabase secrets set DINGTALK_CLIENT_ID=<x> DINGTALK_CLIENT_SECRET=<x> --project-ref <PROJECT_REF>

# 4. Supabase Dashboard 建 Custom OAuth2 Provider「custom:dingtalk」：
#    Authorization URL = https://login.dingtalk.com/oauth2/auth
#    Token URL         = https://<PROJECT_REF>.functions.supabase.co/dingtalk-oauth/token
#    User Info URL     = https://<PROJECT_REF>.functions.supabase.co/dingtalk-oauth/userinfo
#    复制表单里的 Callback URL → 登记进钉钉应用 redirect_uri 白名单

# 5. 改 web/index.html 顶部 SUPABASE_URL / ANON_KEY，本地起前端
cd web && python3 -m http.server 8080   # 浏览器开 http://localhost:8080
```

## 验收（M0 闭环）

- [ ] `supabase db push` 后 Dashboard 能看到 `notes` 表
- [ ] 两个 Edge Function 部署成功
- [ ] 前端点"钉钉登录"→ 扫码 → 回到页面显示用户 unionId
- [ ] 新增一条 note → 刷新仍在；换个账号登录看不到别人的 note（RLS 生效）

## 待补（依赖外部）

- 钉钉应用的 `clientId/secret`：自建（[附录 C](https://alidocs.dingtalk.com/i/nodes/GZLxjv9VGGDA9Ro2u6BY5ewyV6EDybno)）或找大柚要
- redirect_uri 白名单登记：在钉钉应用后台（自建可自助）
