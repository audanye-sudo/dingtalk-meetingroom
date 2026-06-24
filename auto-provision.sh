#!/usr/bin/env bash
# ============================================================================
# auto-provision.sh — 一条命令打通「Supabase + GitHub」全自动链路
#   建 Supabase 项目 → 建表 → 部署函数 → 配密钥 → 抓 anon key 填前端
#   → 建 GitHub 仓库 → push → 开 CI 自动部署
#
# 这是预研第十三节结论的可复用工具：除钉钉开发者后台（无 API）外，全部自动化。
#
# 依赖：supabase CLI、gh CLI（已登录）、curl、python3、openssl
# 用法：
#   export SUPABASE_ACCESS_TOKEN=sbp_xxx          # Supabase 个人访问令牌
#   export DINGTALK_CLIENT_ID=dingxxx             # 钉钉应用 AppKey（需先手动建应用）
#   export DINGTALK_CLIENT_SECRET=xxx
#   ./auto-provision.sh my-app-name
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# macOS 坑：supabase functions deploy 用 Docker 打包，/tmp、/private/tmp 默认不被 Docker Desktop 挂载，
# 会报 "entrypoint path does not exist / error running container"。务必在 Docker 可见路径（如 ~/ 下）运行。
case "$(pwd)" in
  /tmp/*|/private/tmp/*) echo "⚠️ 当前在 /tmp 下，Docker 可能挂载不到导致部署函数失败，请挪到 ~/ 下再跑"; exit 1;;
esac

APP_NAME="${1:-dingtalk-app}"
REGION="${SUPABASE_REGION:-ap-southeast-1}"
: "${SUPABASE_ACCESS_TOKEN:?需要 export SUPABASE_ACCESS_TOKEN=sbp_xxx}"
: "${DINGTALK_CLIENT_ID:?需要 export DINGTALK_CLIENT_ID（钉钉 AppKey）}"
: "${DINGTALK_CLIENT_SECRET:?需要 export DINGTALK_CLIENT_SECRET（钉钉 AppSecret）}"
API="https://api.supabase.com/v1"
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")

echo "▶ 1/8 获取组织 id"
ORG=$(curl -s "${AUTH[@]}" "$API/organizations" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
echo "   org=$ORG"

echo "▶ 2/8 生成数据库密码 + 创建 Supabase 项目（API，非控制台）"
DB_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
REF=$(curl -s -X POST "${AUTH[@]}" "$API/projects" \
  -d "{\"organization_id\":\"$ORG\",\"name\":\"$APP_NAME\",\"region\":\"$REGION\",\"db_pass\":\"$DB_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "   project ref=$REF  region=$REGION"
# 保险：把 ref + DB 密码落盘到仓库外，万一后续步骤失败可续跑、不再产生孤儿项目
{ echo "PROVISION_REF=$REF"; echo "PROVISION_DB_PASS=$DB_PASS"; } >> "$HOME/.config/dingtalk-meetingroom.env"

echo "▶ 3/8 等项目 ACTIVE_HEALTHY"
for i in $(seq 1 30); do
  st=$(curl -s "${AUTH[@]}" "$API/projects/$REF" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
  [ "$st" = "ACTIVE_HEALTHY" ] && { echo "   healthy"; break; } || { echo "   ...$st"; sleep 10; }
done

echo "▶ 4/8 link + 建表 + 部署两个函数（CLI）"
supabase link --project-ref "$REF" --password "$DB_PASS"
supabase db push --password "$DB_PASS"
supabase functions deploy auth-login --no-verify-jwt --project-ref "$REF"
supabase functions deploy rooms-api --project-ref "$REF"

echo "▶ 5/8 配钉钉密钥（secrets）"
supabase secrets set DINGTALK_CLIENT_ID="$DINGTALK_CLIENT_ID" DINGTALK_CLIENT_SECRET="$DINGTALK_CLIENT_SECRET" --project-ref "$REF"

echo "▶ 6/8 抓 anon key 填前端 + 配登录回跳白名单（API）"
ANON=$(curl -s "${AUTH[@]}" "$API/projects/$REF/api-keys?reveal=true" | python3 -c "import sys,json;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
python3 - "$REF" "$ANON" <<'PY'
import sys
ref,anon=sys.argv[1],sys.argv[2]
s=open("web/index.html").read()
import re
s=re.sub(r'const SUPABASE_URL = "[^"]*"', f'const SUPABASE_URL = "https://{ref}.supabase.co"', s)
s=re.sub(r'const SUPABASE_ANON_KEY = "[^"]*"', f'const SUPABASE_ANON_KEY = "{anon}"', s)
open("web/index.html","w").write(s)
PY
PAGES_URL="https://$(gh api user -q .login 2>/dev/null | tr 'A-Z' 'a-z').github.io/$APP_NAME"
curl -s -X PATCH "${AUTH[@]}" "$API/projects/$REF/config/auth" \
  -d "{\"site_url\":\"$PAGES_URL\",\"uri_allow_list\":\"http://localhost:8080/**,$PAGES_URL/**\"}" >/dev/null
echo "   anon key 已填，回跳白名单已配"

echo "▶ 7/8 建 GitHub 仓库 + push + 配 CI 密钥"
git add -A && git commit -q -m "provision $APP_NAME" || true
gh repo create "$APP_NAME" --public --source=. --remote=origin --push 2>/dev/null || git push -u origin main
gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN"
gh secret set SUPABASE_DB_PASSWORD --body "$DB_PASS"

echo "▶ 8/8 完成。GitHub Actions 会在每次 push 时自动部署。"
echo ""
echo "================ 自动化完成（Supabase + GitHub 全程无人工）================"
echo "  Supabase 项目: $REF"
echo "  前端公网地址 : $PAGES_URL/（Pages workflow 部署后生效）"
echo "  函数地址     : https://$REF.functions.supabase.co/dingtalk-oauth/{token,userinfo}"
echo ""
echo "⚠️ 钉钉侧仍需手动（钉钉开发者后台无开放 API，无法脚本化）："
echo "  1. open-dev.dingtalk.com 建企业内部应用，拿 AppKey/AppSecret（填到本脚本的环境变量）"
echo "  2. Custom Provider 回调：把 https://$REF.supabase.co/auth/v1/callback 填进钉钉「接入登录→回调域名」"
echo "  3. 权限管理开通 Contact.User.Read 并发布版本"
echo "  4. Supabase 控制台建 Custom OAuth2 Provider（或用 config/auth custom_oauth API）"
