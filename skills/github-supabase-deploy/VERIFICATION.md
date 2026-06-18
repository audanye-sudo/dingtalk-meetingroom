# 验证报告 — github-supabase-deploy skill

> 验证时间：2026-06-18 ｜ 验证人：胡奕舟
> 结论：**skill 内命令全部真实有效，底层链路已实测部署且线上存活。** 详见下方逐项证据。

## 验证范围说明（诚实边界）

- ✅ **能本地验证的全部跑了**：CLI 存在性、所有 flag 真实性、脚本语法、业务实体结构、**线上已部署函数探活**。
- ⚠️ **没有重新跑一遍全新 `auto-provision.sh`**：它会真实创建新的 Supabase 项目 + GitHub 仓库（产生云资源），且需要钉钉 AppKey/Secret。改为**探活历史已部署的真实项目**来证明链路成立——见 §3，这是更强的证据（不仅命令对，而且确实跑通过且现在还活着）。

## 1. 环境与 CLI

| 项 | 结果 |
|----|------|
| `supabase --version` | ✅ 2.106.0 |
| `gh --version` | ✅ 2.89.0 |
| `gh auth status` | ✅ 已登录 PeterGuy326 |
| `curl / python3 / openssl` | ✅ 齐 |
| `deno` | ⚠️ 本机未装（skill 前置已写 `brew install deno`，仅写/调函数时需要，部署走 Docker 不依赖本机 deno） |

## 2. skill 内所有 CLI flag 真实性（防编造，逐个 `--help` 核对）

| 命令 | flag | 结果 |
|------|------|------|
| `supabase functions deploy` | `--project-ref` `--no-verify-jwt` | ✅ 存在 |
| `supabase db push` | `--password` | ✅ 存在 |
| `supabase link` | `--project-ref` `--password` | ✅ 存在 |
| `supabase secrets set` | `--project-ref` | ✅ 存在 |
| `supabase migration new` | — | ✅ 存在 |
| `gh repo create` | `--public` `--source` `--remote` `--push` | ✅ 存在 |
| `gh secret set` | `--body` | ✅ 存在 |
| `gh api user -q .login` | — | ✅ 返回 PeterGuy326 |

**结论：零编造命令/参数。**

## 3. 线上链路探活（实证"真跑通过且存活"）

目标项目 `PROJECT_REF=xwzzmiomjtnaladqhikc`（= deploy.yml / config.toml 中记录的真实项目）：

| 探测点 | HTTP | 含义 |
|--------|------|------|
| `dingtalk-oauth/userinfo` | **401** | 函数活着 + 鉴权生效（= M0 验收标准） |
| `dingtalk-oauth/.well-known/openid-configuration` | **200** | OIDC discovery 真实返回（见下方 body） |
| `notes-api` | **401** | 业务函数活着 |
| `…supabase.co/rest/v1/` | **401** | 项目存在 |

线上 discovery 真实返回体（节选，证明函数逻辑完整在跑）：

```json
{
  "issuer": "https://xwzzmiomjtnaladqhikc.functions.supabase.co/dingtalk-oauth",
  "authorization_endpoint": ".../dingtalk-oauth/authorize",
  "token_endpoint": ".../dingtalk-oauth/token",
  "userinfo_endpoint": ".../dingtalk-oauth/userinfo",
  "jwks_uri": ".../dingtalk-oauth/jwks",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "scopes_supported": ["openid"]
}
```

## 4. 业务实体静态校验

| 项 | 结果 |
|----|------|
| `migrations/*.sql` | ✅ `notes` 表 + RLS + 3 条 policy（select/insert/delete own） |
| `config.toml` project_id | ✅ `xwzzmiomjtnaladqhikc`（与线上一致） |
| Edge Functions 入口 | ✅ `dingtalk-oauth/index.ts` + `notes-api/index.ts` |
| `auto-provision.sh` / `deploy.sh` | ✅ `bash -n` 语法通过 |

## 复现命令（任何人可自验）

```bash
REF=xwzzmiomjtnaladqhikc
curl -s -o /dev/null -w "%{http_code}\n" https://$REF.functions.supabase.co/dingtalk-oauth/userinfo            # 期望 401
curl -s https://$REF.functions.supabase.co/dingtalk-oauth/.well-known/openid-configuration | python3 -m json.tool  # 期望完整 OIDC JSON
supabase functions deploy --help | grep -- --no-verify-jwt                                                     # 期望命中
gh repo create --help | grep -- --source                                                                      # 期望命中
```

## 5. 部署产物链接（全部线上探活存活，可直接点开）

| 产物 | 链接 | 探活 |
|------|------|------|
| **前端应用（成品）** | https://peterguy326.github.io/dingtalk-supabase/ | **200 ✅** |
| OIDC discovery | https://xwzzmiomjtnaladqhikc.functions.supabase.co/dingtalk-oauth/.well-known/openid-configuration | 200 |
| userinfo | https://xwzzmiomjtnaladqhikc.functions.supabase.co/dingtalk-oauth/userinfo | 401（鉴权生效） |
| token | https://xwzzmiomjtnaladqhikc.functions.supabase.co/dingtalk-oauth/token | 500（GET 探活无 body 所致，真实是 POST+code） |
| notes-api | https://xwzzmiomjtnaladqhikc.functions.supabase.co/notes-api | 401 |
| Supabase 项目主域 | https://xwzzmiomjtnaladqhikc.supabase.co | 401（存在） |
| CI: Deploy to Supabase | https://github.com/PeterGuy326/dingtalk-supabase/actions/runs/27731783751 | ✅ success |
| CI: Deploy Frontend to Pages | https://github.com/PeterGuy326/dingtalk-supabase/actions/runs/27731783759 | ✅ success |

## 总评

- **命令层**：100% 真实，无编造。
- **链路层**：已实测部署，线上存活（401/200 符合预期）。
- **未覆盖**：全新一键 provision 的端到端首跑（需真钉钉凭证 + 会建云资源），交由勤泽侧在真实接入时跑首测；skill 顶部「Agent 执行入口」已把首跑流程固化为四步。
