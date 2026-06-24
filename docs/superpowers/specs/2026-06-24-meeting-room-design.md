# 会议室申请 webapp 设计稿（2026-06-24）

## 目标
为钉钉企业内部应用 OpenCode助手（unifiedAppId `f458c0cd-8225-44f6-99cb-95a30db54591`）开发一个会议室申请 H5。
核心：先跑通端到端原型，再迭代优化。

## 功能范围（原型）
1. 钉钉账号登录（完整 OIDC，单应用方案，身份源=OpenCode助手）
2. 会议室列表查询（初始化 10 间，编号 A~J）
3. 会议室预定 / 取消预定（按整天）
4. 会议室详情：预订人 / 预定时间

## 架构（单应用）
- OpenCode助手 同时作 H5 容器（工作台入口 + 首页地址）与 OIDC 身份源（用其 appKey/secret）
- 前端：静态 H5（`web/index.html`）→ GitHub Pages
- 登录：Supabase Auth Custom OAuth Provider `custom:dingtalk` → Edge Function `dingtalk-oauth` 适配层（钉钉新版统一 OAuth2）
- 业务：Edge Function `rooms-api` + Postgres 两张表 + RLS
- 部署：`auto-provision.sh`（Supabase + GitHub + Pages）+ dingtalk-dev（钉钉侧配置发版）

## 登录流程（新版统一 OAuth2）
1. 前端 `signInWithOAuth({provider:"custom:dingtalk"})` → Supabase 跳 `/dingtalk-oauth/authorize`
2. 适配层 302 → `https://login.dingtalk.com/oauth2/auth?client_id=<appKey>&response_type=code&scope=openid&prompt=consent&redirect_uri=<Supabase回调>&state=...`
3. 钉钉回跳 Supabase → Supabase 调 `/dingtalk-oauth/token`（带 code）
4. 适配层 `POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken {clientId,clientSecret,code,grantType}` → accessToken
   → `GET /v1.0/contact/users/me`（header `x-acs-dingtalk-access-token`）→ {unionId, nick}
   → 把用户信息打包进 access_token
5. 适配层 `/userinfo` 解出 `sub=unionId, name=nick, email=合成` → Supabase 签发 session JWT
6. 前端带 JWT 调 `rooms-api`，RLS 用 `auth.uid()` 鉴权

钉钉侧需配（dingtalk-dev 自动化）：
- 个人信息读权限（scopeValue）+ 版本发布
- 安全配置 redirect-urls 白名单 = `https://<ref>.supabase.co/auth/v1/callback`
- webapp 首页地址 = Pages 地址

## 数据模型（按整天）
```
meeting_rooms(id, code text unique, name text, created_at)   -- 种子 A~J
bookings(id, room_id fk, booking_date date, user_id uuid=auth.uid(),
         user_name text, created_at, unique(room_id, booking_date))
```
RLS：
- meeting_rooms：authenticated 可读
- bookings：authenticated 可读（人人能看预订人）；insert 仅本人；delete 仅本人

## rooms-api 接口（JWT 透传走 RLS）
- `GET ?action=list&date=YYYY-MM-DD` → 10 间房 + 当天 {booked, booking_id, booked_by, is_mine}
- `GET ?action=detail&room_id=&date=` → 房间 + 当天预订人/预定时间
- `POST {action:"book", room_id, date}` → 预定（撞唯一约束 → 409）
- `POST {action:"cancel", booking_id}` → 取消（RLS 限本人）
- date 缺省 = 今天

## 前端
单页 H5，移动优先：日期选择（默认今天）+ A~J 卡片网格（空闲/已订+预订人）+ 订/取消 + 详情。
原型用干净内联样式；优化轮用 ui-ux-pro-max。

## 待核实/风险
- Supabase Custom OAuth Provider 是否可经 Management API `config/auth` 自动配（否则一步手动）
- 新版统一 OAuth2 在钉钉客户端内是否静默授权（真机验证）
- 个人信息读权限是否需审批（check-approval 判定）
