# M0 预研 — 命令清单（可直接照做）

> 目标：建 Supabase project + 连 GitHub + 跑通 1 个 migration + 1 个 Edge Function。
> A.1–A.3 不依赖钉钉/大柚，现在就能全部跑完。

## 0. 前置（一次性）

```bash
# 装 Supabase CLI（macOS）
brew install supabase/tap/supabase

# 装 Deno（写/调 Edge Function 用）
brew install deno

# 登录 Supabase（浏览器授权）
supabase login
```

- 去 https://supabase.com 新建一个 project，记下 **Project Ref**（Settings → General）和 **数据库密码**。

## 1. 初始化仓库结构（A.1）

```bash
cd ding-supabase
supabase init                 # 生成 ./supabase 目录（已含本仓库的 functions/dingtalk-oauth）
git init && git add . && git commit -m "init supabase + dingtalk oauth adapter"
# 在 GitHub 建空仓库后：
git remote add origin git@github.com:<you>/ding-supabase.git
git push -u origin main
```

目标结构：

```text
ding-supabase/
└── supabase/
    ├── migrations/                     # 数据库迁移（连上后自动执行）
    ├── functions/
    │   └── dingtalk-oauth/index.ts     # 钉钉 OAuth 适配层（已给）
    └── config.toml
```

## 2. 建一张表 + 一条 migration（验证 DB 链路）

```bash
supabase migration new init_demo
# 编辑生成的 supabase/migrations/<ts>_init_demo.sql，写：
#   create table public.demo (id bigint generated always as identity primary key, note text, created_at timestamptz default now());
supabase db push                        # 推到远端（或连 GitHub 后由 CI 自动跑）
```

## 3. 连 GitHub（A.2，Dashboard）

1. Dashboard → Project Settings → Integrations → **Authorize GitHub** → 选仓库
2. working directory 填 `.`（supabase/ 在根目录）
3. 打开 **Automatic branching** + **Deploy to production**
4. Enable integration
5. （建议）GitHub 仓库 Settings 开 "Require status checks to pass before merging"

## 4. 部署适配层 Edge Function（A.3）

```bash
supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref <PROJECT_REF>
supabase secrets set DINGTALK_CLIENT_ID=<待大柚给> DINGTALK_CLIENT_SECRET=<待大柚给> --project-ref <PROJECT_REF>

# 冒烟测试（userinfo 路由，401 属正常——说明函数活着、鉴权生效）
curl -i https://<PROJECT_REF>.functions.supabase.co/dingtalk-oauth/userinfo
```

## 5. M0 验收

- [ ] `supabase db push` 成功，Dashboard 能看到 `demo` 表
- [ ] Edge Function 部署成功，curl `/userinfo` 返回 401（结构正确）
- [ ] push 到 GitHub 触发 CI 自动部署（连 GitHub 后）

## 待大柚回的两格（不挡 M0）

1. 用哪个钉钉应用的 `clientId / clientSecret` → 填进第 4 步 secrets
2. 把 Supabase Callback URL 登记进该钉钉应用的 redirect_uri 白名单
   - Callback URL 在 Supabase Dashboard → Authentication → Custom Providers → New Provider 表单里（只读）
