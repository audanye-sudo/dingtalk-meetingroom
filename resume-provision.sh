#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/bin:$PATH"
set -a; . "$HOME/.config/dingtalk-meetingroom.env"; set +a
REF=$(grep '^PROVISION_REF=' "$HOME/.config/dingtalk-meetingroom.env" | tail -1 | cut -d= -f2)
DB_PASS=$(grep '^PROVISION_DB_PASS=' "$HOME/.config/dingtalk-meetingroom.env" | tail -1 | cut -d= -f2)
API="https://api.supabase.com/v1"
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")
APP_NAME=dingtalk-meetingroom
echo "REF=$REF"

echo "▶ 部署 dingtalk-oauth"
supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref "$REF"
echo "▶ 部署 rooms-api"
supabase functions deploy rooms-api --project-ref "$REF"

echo "▶ 配钉钉 secrets"
supabase secrets set DINGTALK_CLIENT_ID="$DINGTALK_CLIENT_ID" DINGTALK_CLIENT_SECRET="$DINGTALK_CLIENT_SECRET" --project-ref "$REF"

echo "▶ 抓 anon key 填前端"
ANON=$(curl -s "${AUTH[@]}" "$API/projects/$REF/api-keys?reveal=true" | python3 -c "import sys,json;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
python3 - "$REF" "$ANON" <<'PY'
import sys,re
ref,anon=sys.argv[1],sys.argv[2]
s=open("web/index.html").read()
s=re.sub(r'const SUPABASE_URL = "[^"]*"', f'const SUPABASE_URL = "https://{ref}.supabase.co"', s)
s=re.sub(r'const SUPABASE_ANON_KEY = "[^"]*"', f'const SUPABASE_ANON_KEY = "{anon}"', s)
open("web/index.html","w").write(s)
print("  web/index.html patched")
PY

echo "▶ 配登录回跳白名单"
PAGES_URL="https://$(gh api user -q .login 2>/dev/null | tr 'A-Z' 'a-z').github.io/$APP_NAME"
curl -s -X PATCH "${AUTH[@]}" "$API/projects/$REF/config/auth" \
  -d "{\"site_url\":\"$PAGES_URL\",\"uri_allow_list\":\"http://localhost:8080/**,$PAGES_URL/**\"}" >/dev/null
echo "  site_url=$PAGES_URL"

echo "▶ 建 GitHub 仓库 + push + CI 密钥"
git add -A && git commit -q -m "meeting room app: schema+rooms-api+oauth adapter+frontend" || true
gh repo create "$APP_NAME" --public --source=. --remote=origin --push 2>/dev/null || git push -u origin main
gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN"
gh secret set SUPABASE_DB_PASSWORD --body "$DB_PASS"

echo ""
echo "================ 续跑完成 ================"
echo "  Supabase 项目 : $REF"
echo "  函数地址      : https://$REF.functions.supabase.co/{dingtalk-oauth,rooms-api}"
echo "  回调地址      : https://$REF.supabase.co/auth/v1/callback"
echo "  前端公网地址  : $PAGES_URL/"
