// supabase/functions/auth-login/index.ts
// 零手动登录：前端走钉钉 OAuth 拿 code → 本函数换 unionId/nick → service_role 签发 Supabase 会话
//   POST { code } → { token_hash, name }
//   前端拿 token_hash 后调 supabase.auth.verifyOtp({type:"magiclink", token_hash}) 即获登录态。
// 不依赖 Supabase 控制台 Custom OAuth Provider。
//
// 部署：supabase functions deploy auth-login --no-verify-jwt --project-ref <ref>
// 机密：DINGTALK_CLIENT_ID/SECRET（已配）；SUPABASE_URL/SERVICE_ROLE_KEY 由平台自动注入。

import { createClient } from "jsr:@supabase/supabase-js@2";

const DING_USER_TOKEN = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken";
const DING_USERINFO = "https://api.dingtalk.com/v1.0/contact/users/me";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { code } = await req.json().catch(() => ({}));
  if (!code) return json({ error: "missing code" }, 400);

  const clientId = Deno.env.get("DINGTALK_CLIENT_ID")!;
  const clientSecret = Deno.env.get("DINGTALK_CLIENT_SECRET")!;

  // 1) code → userAccessToken
  const tokResp = await fetch(DING_USER_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, code, grantType: "authorization_code" }),
  });
  const tok = await tokResp.json();
  if (!tok.accessToken) return json({ error: "ding_token_failed", detail: tok }, 400);

  // 2) userAccessToken → 个人信息
  const meResp = await fetch(DING_USERINFO, {
    headers: { "x-acs-dingtalk-access-token": tok.accessToken },
  });
  const me = await meResp.json();
  if (!me?.unionId) return json({ error: "ding_userinfo_failed", detail: me }, 400);

  const unionId: string = me.unionId;
  const nick: string = me.nick ?? "钉钉用户";
  const email: string = me.email || `${unionId.toLowerCase()}@dingtalk.user`;

  // 3) service_role：确保用户存在，再签发 magiclink 会话
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: nick, sub: unionId, provider: "dingtalk" },
  });
  // 已存在则忽略（其余错误才报）
  if (createErr && !/already|registered|exists/i.test(createErr.message)) {
    return json({ error: "create_user_failed", detail: createErr.message }, 400);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return json({ error: "generate_link_failed", detail: linkErr?.message }, 400);
  }

  return json({ token_hash: link.properties.hashed_token, name: nick });
});
