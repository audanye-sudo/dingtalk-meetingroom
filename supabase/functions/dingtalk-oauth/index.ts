// supabase/functions/dingtalk-oauth/index.ts
// ──────────────────────────────────────────────────────────────────────────
// 钉钉「企业内部应用」新版统一 OAuth2 → 标准 OAuth2/OIDC 适配层
//   单应用即可当身份源：用同一个企业内部应用（如 OpenCode助手）的 appKey/secret。
//
//   · 授权走 login.dingtalk.com/oauth2/auth（scope=openid，钉钉客户端内通常静默授权）
//   · 换 token 走 api.dingtalk.com/v1.0/oauth2/userAccessToken
//   · 取用户信息走 api.dingtalk.com/v1.0/contact/users/me（拿 unionId / nick）
//
// Supabase Custom OAuth2 Provider（custom:dingtalk）三个 URL：
//   Authorization URL: https://<ref>.functions.supabase.co/dingtalk-oauth/authorize
//   Token URL:         https://<ref>.functions.supabase.co/dingtalk-oauth/token
//   User Info URL:     https://<ref>.functions.supabase.co/dingtalk-oauth/userinfo
//
// 部署：supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref <ref>
// 机密：DINGTALK_CLIENT_ID = 企业内部应用 appKey；DINGTALK_CLIENT_SECRET = appSecret
// 钉钉侧需开「个人信息读权限」并发版，且把 Supabase 回调域名登记进登录回调白名单。
// ──────────────────────────────────────────────────────────────────────────

const DING_AUTHORIZE = "https://login.dingtalk.com/oauth2/auth";
const DING_USER_TOKEN = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken";
const DING_USERINFO = "https://api.dingtalk.com/v1.0/contact/users/me";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/dingtalk-oauth/, "");
  try {
    if (path === "/authorize") return handleAuthorize(url);
    if (path === "/token") return await handleToken(req);
    if (path === "/userinfo") return await handleUserinfo(req);
    if (path === "/.well-known/openid-configuration") return json(discovery(url));
    if (path === "/jwks") return json({ keys: [] });
    if (path === "/version") return json({ version: "internal-oauth2-1", flow: "oauth2_openid" });
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error", message: String(e) }, 500);
  }
});

// Supabase 标准授权请求 → 钉钉新版统一 OAuth2 授权页
function handleAuthorize(url: URL): Response {
  const clientId = url.searchParams.get("client_id") ?? Deno.env.get("DINGTALK_CLIENT_ID") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const target = `${DING_AUTHORIZE}?client_id=${encodeURIComponent(clientId)}`
    + `&response_type=code&scope=openid&prompt=consent`
    + `&state=${encodeURIComponent(state)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return new Response(null, { status: 302, headers: { Location: target, ...CORS } });
}

// 标准 token 请求 → userAccessToken → contact/users/me → 把用户信息打包进 access_token
async function handleToken(req: Request): Promise<Response> {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  if (!code) return json({ error: "invalid_request", error_description: "missing code" }, 400);

  const clientId = Deno.env.get("DINGTALK_CLIENT_ID")!;
  const clientSecret = Deno.env.get("DINGTALK_CLIENT_SECRET")!;

  // 1) code → userAccessToken
  const tokResp = await fetch(DING_USER_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, code, grantType: "authorization_code" }),
  });
  const tok = await tokResp.json();
  console.log("[token] userAccessToken status=" + tokResp.status + " body=" + JSON.stringify(tok));
  const accessToken = tok.accessToken;
  if (!accessToken) {
    return json({ error: "invalid_grant", error_description: JSON.stringify(tok) }, 400);
  }

  // 2) userAccessToken → 个人信息（unionId / nick）
  const meResp = await fetch(DING_USERINFO, {
    headers: { "x-acs-dingtalk-access-token": accessToken },
  });
  const me = await meResp.json();
  console.log("[token] users/me status=" + meResp.status + " body=" + JSON.stringify(me));
  if (!me || !me.unionId) {
    return json({ error: "invalid_grant", error_description: JSON.stringify(me) }, 400);
  }

  // 把 {unionid, openid, nick, email} 打包进 token（UTF-8 安全 base64），userinfo 端再解出来
  const packed = b64encode(JSON.stringify({
    unionid: me.unionId,
    openid: me.openId,
    nick: me.nick,
    email: me.email,
  }));
  return json({ access_token: packed, token_type: "bearer", expires_in: 7200 });
}

// 标准 Bearer（内含打包的用户信息）→ 解出标准 claims（sub=unionId）
async function handleUserinfo(req: Request): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "invalid_token" }, 401);
  let u: { unionid: string; openid?: string; nick?: string; email?: string };
  try { u = JSON.parse(b64decode(token)); } catch { return json({ error: "invalid_token" }, 401); }
  if (!u.unionid) return json({ error: "invalid_token" }, 401);
  // 钉钉不一定返回 email，但 Supabase 默认要求 email；用 unionId 合成稳定唯一邮箱兜底。
  return json({
    sub: u.unionid,
    name: u.nick,
    openid: u.openid,
    email: u.email || `${u.unionid.toLowerCase()}@dingtalk.user`,
    email_verified: true,
  });
}

// OIDC discovery：Supabase 保存时会拉 {issuer}/.well-known/openid-configuration。
// BASE 按当前请求 origin 动态推导，避免写死项目 ref。
function discovery(url: URL) {
  const BASE = `${url.origin}/dingtalk-oauth`;
  return {
    issuer: BASE,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    userinfo_endpoint: `${BASE}/userinfo`,
    jwks_uri: `${BASE}/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    scopes_supported: ["openid"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

// UTF-8 安全 base64（昵称可能含中文）
function b64encode(s: string): string { return btoa(unescape(encodeURIComponent(s))); }
function b64decode(s: string): string { return decodeURIComponent(escape(atob(s))); }

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });
}
