// supabase/functions/dingtalk-oauth/index.ts
// ──────────────────────────────────────────────────────────────────────────
// 钉钉 OAuth2.0 → 标准 OAuth2 适配层（Supabase Edge Function / Deno）
//
// 为什么需要它：钉钉 OAuth2.0 不是标准实现（见方案文档附录 B）：
//   · token 端点要 JSON body，返回字段是 accessToken / expireIn
//   · userinfo 用自定义 header x-acs-dingtalk-access-token（非 Authorization: Bearer）
// 所以 Supabase 的 Custom OAuth2 Provider 不能直连钉钉，这层把它包成标准 OAuth2。
//
// Supabase Custom OAuth2 Provider 三个 URL 这样填：
//   Authorization URL: https://login.dingtalk.com/oauth2/auth      （直接指钉钉，无需适配）
//   Token URL:         https://<project-ref>.functions.supabase.co/dingtalk-oauth/token
//   User Info URL:     https://<project-ref>.functions.supabase.co/dingtalk-oauth/userinfo
//
// 部署：
//   supabase functions deploy dingtalk-oauth --no-verify-jwt
//   supabase secrets set DINGTALK_CLIENT_ID=xxx DINGTALK_CLIENT_SECRET=xxx
// ──────────────────────────────────────────────────────────────────────────

const DING_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken";
const DING_USERINFO_URL = "https://api.dingtalk.com/v1.0/contact/users/me";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/dingtalk-oauth/, "");
  try {
    if (path === "/token") return await handleToken(req);
    if (path === "/userinfo") return await handleUserinfo(req);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error", message: String(e) }, 500);
  }
});

// 标准 OAuth2 token 请求(form-encoded) → 钉钉 JSON → 标准 token 响应
async function handleToken(req: Request): Promise<Response> {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  if (!code) {
    return json({ error: "invalid_request", error_description: "missing code" }, 400);
  }
  const resp = await fetch(DING_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: Deno.env.get("DINGTALK_CLIENT_ID"),
      clientSecret: Deno.env.get("DINGTALK_CLIENT_SECRET"),
      code,
      grantType: "authorization_code",
    }),
  });
  const d = await resp.json();
  if (!resp.ok || !d.accessToken) {
    return json({ error: "invalid_grant", error_description: JSON.stringify(d) }, 400);
  }
  return json({
    access_token: d.accessToken,
    token_type: "bearer",
    expires_in: d.expireIn ?? 7200,
    refresh_token: d.refreshToken,
  });
}

// 标准 Bearer → 钉钉自定义 header → 标准 OIDC claims（sub 用稳定的 unionId）
async function handleUserinfo(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "invalid_token" }, 401);

  const resp = await fetch(DING_USERINFO_URL, {
    headers: { "x-acs-dingtalk-access-token": token },
  });
  const u = await resp.json();
  console.log("[userinfo] dingtalk status=" + resp.status + " body=" + JSON.stringify(u));
  if (!resp.ok || !u.unionId) {
    return json({ error: "server_error", error_description: JSON.stringify(u) }, 400);
  }
  return json({
    sub: u.unionId,        // 稳定唯一标识，做用户主键
    name: u.nick,
    picture: u.avatarUrl,
    email: u.email,        // 钉钉可能不返回，取决于用户资料 + 应用权限
    phone_number: u.mobile,
    openid: u.openId,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
