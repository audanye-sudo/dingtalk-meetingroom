#!/usr/bin/env bash
# 一键部署：建表 + 部署两个函数 + 配钉钉密钥
# 用法：SUPABASE_ACCESS_TOKEN=sbp_xxx ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# 读本地机密（.gitignore 已忽略）
set -a; source .env.local; set +a
REF="${SUPABASE_PROJECT_REF:?缺 SUPABASE_PROJECT_REF}"

: "${SUPABASE_ACCESS_TOKEN:?请先 export SUPABASE_ACCESS_TOKEN=sbp_xxx}"

echo "▶ 1/5 关联项目 $REF"
supabase link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD"

echo "▶ 2/5 建表（db push）"
supabase db push

echo "▶ 3/5 部署 dingtalk-oauth（身份适配层）"
supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref "$REF"

echo "▶ 4/5 部署 notes-api（业务接口）"
supabase functions deploy notes-api --project-ref "$REF"

echo "▶ 5/5 配置钉钉应用密钥"
supabase secrets set \
  DINGTALK_CLIENT_ID="$DINGTALK_CLIENT_ID" \
  DINGTALK_CLIENT_SECRET="$DINGTALK_CLIENT_SECRET" \
  --project-ref "$REF"

echo "✅ 全部完成。函数地址："
echo "   https://$REF.functions.supabase.co/dingtalk-oauth/token"
echo "   https://$REF.functions.supabase.co/dingtalk-oauth/userinfo"
