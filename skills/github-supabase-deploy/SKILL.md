---
name: github-supabase-deploy
description: 用 gh (GitHub CLI) + supabase (Supabase CLI) 把"本地代码 → GitHub → Supabase 自动部署"这条链路全自动搭起来。覆盖：建 Supabase 项目、link、db push、部署 Edge Functions、配 secrets、抓 anon key、建 GitHub 仓库 + 配 CI 密钥 + 开 Actions 自动部署。当需要为一个新应用从零搭建 Supabase 后端 + GitHub CI/CD、或排查 supabase/gh 命令报错时使用。这是应用"后半段"业务层（数据库+后端+前端+部署）的基建脚手架，不负责钉钉身份/OIDC 前半段链路。
version: 0.1.0
metadata:
  author: 胡奕舟
  category: infra
  related_skills: []
  handoff_to: 勤泽（开放平台 skill 侧）
---

# GitHub CLI + Supabase CLI 部署 Skill

把一个应用的"后半段"（数据库 + 后端业务逻辑 + 前端 + 自动部署）从零搭起来，
全程只用两个 CLI：`gh`（GitHub）+ `supabase`（Supabase）。除钉钉开发者后台（无开放 API）外，**全链路可脚本化**。

目标链路：

```
本地代码  ──git push──►  GitHub  ──Actions(CI/CD)──►  Supabase
                                                       ├─ Postgres（migrations 自动跑）
                                                       ├─ Edge Functions（后端业务逻辑）
                                                       └─ Auth（Custom OAuth Provider）
GitHub Pages ◄──同一次 push── web/ 静态前端
```

## 🤖 Agent 执行入口（无脑照做，按顺序）

> 给 agent：这是固定四段流程，不用读完整篇文档也能闭环。第 1、2 步备好后，第 3 步一条命令搞定全自动部署。

```
① 拉模板（务必在 ~/ 下，不要在 /tmp，否则函数部署会被 Docker 挂载坑卡死）
   git clone https://github.com/PeterGuy326/dingtalk-supabase.git ~/my-app
   cd ~/my-app

② 收齐 3 个入参（向用户索取，缺一不可）→ export 到环境变量
   export SUPABASE_ACCESS_TOKEN=sbp_xxx     # https://supabase.com/dashboard/account/tokens
   export DINGTALK_CLIENT_ID=dingxxx        # 钉钉应用 AppKey（不接钉钉身份可传占位）
   export DINGTALK_CLIENT_SECRET=xxx        # 钉钉应用 AppSecret
   # 另需已登录：supabase login、gh auth login

③ 一键全自动（建 Supabase 项目→建表→部署函数→配密钥→建 GitHub 仓库→开 CI）
   ./auto-provision.sh <app-name>
   # 跑完会打印三件交接物：Supabase 回调地址 / 函数地址 / 前端公网地址

④ 停 — 钉钉开发者后台 4 步无开放 API，agent 必须停下来交人工：
   建应用拿 AppKey/Secret · 配回调白名单 · 开 Contact.User.Read 并发版 · 建 Custom Provider
   （把第 ③ 步打印的「回调地址/函数地址」交给前半段/勤泽侧去填）
```

判断标准：第 ③ 步脚本退出码为 0 且打印出三件交接物 = 后半段闭环完成。剩下只欠钉钉人工 4 步。

## 适用边界

- **负责**：Supabase 项目生命周期、DB migration、Edge Functions 部署、GitHub 仓库与 CI/CD、前端 Pages 托管。
- **不负责（前半段，勤泽/玉澜侧）**：钉钉应用建号、OIDC/OAuth 身份链路、API 权限审批、redirect_uri 白名单登记。本 skill 假设"前面已经通了"，只把后端基建脚手架交付到位。

## 工具权限

| 工具 | 用途 | 约束 |
|------|------|------|
| `supabase` CLI | 项目 link / db push / functions deploy / secrets | 需先 `supabase login` |
| `gh` CLI | 建仓库 / 配 Actions secrets / 查当前用户 | 需先 `gh auth login` |
| Supabase Management API (`api.supabase.com/v1`) | 建项目、抓 anon key、配 Auth（CLI 不支持建项目） | 需 `SUPABASE_ACCESS_TOKEN`(sbp_…) |
| `curl` / `python3` / `openssl` | 调 API、解析 JSON、生成密码 | — |

## 前置（一次性）

```bash
# macOS 装两个 CLI
brew install supabase/tap/supabase gh
brew install deno            # 写/调 Edge Function 用

# 登录（都走浏览器授权）
supabase login              # 或 export SUPABASE_ACCESS_TOKEN=sbp_xxx
gh auth login               # 选 GitHub.com → HTTPS/SSH → 浏览器授权
```

拿到两把令牌：
- **Supabase Personal Access Token**：`https://supabase.com/dashboard/account/tokens` → `sbp_…`
- **GitHub**：`gh auth login` 后自动持有；CI 里用不到，CI 只需 Supabase 两把密钥。

## ⚠️ 三个已踩过的坑（先看这里，能省一小时）

1. **macOS Docker /tmp 挂载坑**：`supabase functions deploy` 用 Docker 打包，`/tmp`、`/private/tmp` 默认不被 Docker Desktop 挂载，会报 `entrypoint path does not exist / error running container`。**必须在 `~/` 下的目录跑**，不要在 `/tmp` 下。
2. **建项目不能用 CLI**：`supabase` CLI 没有"创建项目"命令，必须走 Management API（`POST /v1/projects`）。建完等 `status == ACTIVE_HEALTHY` 再 link，否则 link 失败。
3. **db push / link 要带密码**：非交互环境下 `supabase link` / `db push` 要显式 `--password "$DB_PASS"`，否则会卡在交互式输入。

## 标准操作流程（SOP）

### A. 一条命令全自动（推荐）

仓库根目录的 `auto-provision.sh` 已把下面 8 步串好，直接：

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxx
export DINGTALK_CLIENT_ID=dingxxx      # 若不接钉钉身份可传占位
export DINGTALK_CLIENT_SECRET=xxx
./auto-provision.sh my-app-name        # 必须在 ~/ 下的路径执行
```

它做的事 = 下面 B 的全部。

### B. 手动分步（排查时逐步跑）

```bash
API="https://api.supabase.com/v1"
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")

# 1) 取组织 id
ORG=$(curl -s "${AUTH[@]}" "$API/organizations" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

# 2) 生成 DB 密码 + 建项目（API，非控制台）
DB_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
REF=$(curl -s -X POST "${AUTH[@]}" "$API/projects" \
  -d "{\"organization_id\":\"$ORG\",\"name\":\"my-app\",\"region\":\"ap-southeast-1\",\"db_pass\":\"$DB_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 3) 等 ACTIVE_HEALTHY（最多约 5 分钟）
for i in $(seq 1 30); do
  st=$(curl -s "${AUTH[@]}" "$API/projects/$REF" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
  [ "$st" = "ACTIVE_HEALTHY" ] && break || sleep 10
done

# 4) link + 建表 + 部署函数（CLI）
supabase link --project-ref "$REF" --password "$DB_PASS"
supabase db push --password "$DB_PASS"
supabase functions deploy <your-func> --project-ref "$REF"   # 适配层加 --no-verify-jwt

# 5) 配密钥（业务用到的环境变量）
supabase secrets set KEY1=v1 KEY2=v2 --project-ref "$REF"

# 6) 抓 anon key（前端要用）
ANON=$(curl -s "${AUTH[@]}" "$API/projects/$REF/api-keys?reveal=true" \
  | python3 -c "import sys,json;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")

# 7) 建 GitHub 仓库 + push + 配 CI 密钥
git add -A && git commit -m "provision" || true
gh repo create my-app --public --source=. --remote=origin --push
gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN"
gh secret set SUPABASE_DB_PASSWORD --body "$DB_PASS"
# 之后每次 push main → Actions 自动部署
```

## CI/CD（GitHub Actions）

仓库 `.github/workflows/` 放两条腿，push main 即触发：

- `deploy.yml`：`supabase/setup-cli@v1` → `link` → `db push` → `functions deploy`。
  需在 GitHub 仓库 Settings → Secrets 配 **`SUPABASE_ACCESS_TOKEN`** + **`SUPABASE_DB_PASSWORD`**（上面第 7 步已自动配）。
  注意把 workflow 里的 `env: PROJECT_REF` 改成你的 ref。
- `pages.yml`：把 `web/` 静态前端发布到 GitHub Pages，拿到公网地址 `https://<user>.github.io/<repo>`。
  需在仓库 Settings → Pages 把 Source 设为 "GitHub Actions"。

两条 workflow 模板见本仓库 `.github/workflows/`，可直接拷贝改 ref。

## 验收清单

- [ ] `curl .../projects/$REF` 返回 `ACTIVE_HEALTHY`
- [ ] `supabase db push` 后 Dashboard 能看到目标表
- [ ] `supabase functions deploy` 成功；`curl https://$REF.functions.supabase.co/<func>` 有响应（鉴权函数返回 401 属正常，说明函数活着）
- [ ] `gh repo view` 能看到仓库；Actions 页有一次绿色 run
- [ ] push 一次空提交 → Actions 自动重新部署

## 交接给前半段（勤泽/玉澜）的接口

本 skill 跑完后，把这几个值交给身份链路侧即可对接钉钉 OIDC：

| 产出 | 值 | 给谁 |
|------|----|----|
| Supabase 回调地址 | `https://$REF.supabase.co/auth/v1/callback` | 登记进钉钉应用 redirect_uri 白名单 |
| 函数地址（适配层 Token/UserInfo URL） | `https://$REF.functions.supabase.co/<adapter>/{token,userinfo}` | 填进 Supabase Custom OAuth Provider |
| 前端公网地址 | `https://<user>.github.io/<repo>` | site_url / 回跳白名单 |

> 钉钉侧 4 步（建应用拿 AppKey/Secret、配回调、开 Contact.User.Read 权限并发版、建 Custom Provider）**无开放 API，必须人工**，由前半段同学完成。
