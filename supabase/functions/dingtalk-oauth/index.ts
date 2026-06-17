// supabase/functions/dingtalk-oauth/index.ts
// ──────────────────────────────────────────────────────────────────────────
// 钉钉「扫码登录应用」(移动接入应用-登录) → 标准 OAuth2 适配层
//   面向【任意钉钉用户 / 跨组织】登录，不受 900104 跨组织限制、无需 Contact.User.Read。
//
// 与旧版（企业内部自建应用 oauth2/userAccessToken）不同：
//   · 授权走 oapi.dingtalk.com/connect/qrconnect（scope=snsapi_login）
//   · 换用户信息走 sns/getuserinfo_bycode（HMAC-SHA256 签名），一步拿 unionId
//
// Supabase Custom OAuth2 Provider（Manual）三个 URL：
//   Authorization URL: https://<ref>.functions.supabase.co/dingtalk-oauth/authorize
//   Token URL:         https://<ref>.functions.supabase.co/dingtalk-oauth/token
//   User Info URL:     https://<ref>.functions.supabase.co/dingtalk-oauth/userinfo
//
// 部署：supabase functions deploy dingtalk-oauth --no-verify-jwt --project-ref <ref>
// 机密：DINGTALK_CLIENT_ID = 扫码登录应用 appId；DINGTALK_CLIENT_SECRET = appSecret
// ──────────────────────────────────────────────────────────────────────────

const DING_AUTHORIZE = "https://oapi.dingtalk.com/connect/qrconnect";
const DING_USERINFO_BYCODE = "https://oapi.dingtalk.com/sns/getuserinfo_bycode";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/dingtalk-oauth/, "");
  try {
    if (path === "/authorize") return handleAuthorize(url);
    if (path === "/token") return await handleToken(req);
    if (path === "/userinfo") return handleUserinfo(req);
    if (path === "/version") return json({ version: "qrlogin-1", flow: "snsapi_login" });
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error", message: String(e) }, 500);
  }
});

// Supabase 标准授权请求 → 转成钉钉扫码登录 qrconnect（client_id→appid, scope→snsapi_login）
function handleAuthorize(url: URL): Response {
  const clientId = url.searchParams.get("client_id") ?? Deno.env.get("DINGTALK_CLIENT_ID") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const target = `${DING_AUTHORIZE}?appid=${encodeURIComponent(clientId)}`
    + `&response_type=code&scope=snsapi_login`
    + `&state=${encodeURIComponent(state)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return new Response(null, { status: 302, headers: { Location: target, ...CORS } });
}

// 标准 token 请求 → 钉钉 getuserinfo_bycode（一步拿到 unionId）→ 把用户信息打包进 access_token
async function handleToken(req: Request): Promise<Response> {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  if (!code) return json({ error: "invalid_request", error_description: "missing code" }, 400);

  const appId = Deno.env.get("DINGTALK_CLIENT_ID")!;
  const appSecret = Deno.env.get("DINGTALK_CLIENT_SECRET")!;
  const ts = Date.now().toString();
  const sig = await signHmac(ts, appSecret);
  const api = `${DING_USERINFO_BYCODE}?accessKey=${encodeURIComponent(appId)}&timestamp=${ts}&signature=${sig}`;

  const resp = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmp_auth_code: code }),
  });
  const d = await resp.json();
  console.log("[token] getuserinfo_bycode status=" + resp.status + " body=" + JSON.stringify(d));
  const u = d.user_info;
  if (!u || !u.unionid) {
    return json({ error: "invalid_grant", error_description: JSON.stringify(d) }, 400);
  }
  // 把 {unionid, openid, nick} 打包进 token（UTF-8 安全 base64），userinfo 端再解出来
  const packed = b64encode(JSON.stringify({ unionid: u.unionid, openid: u.openid, nick: u.nick }));
  return json({ access_token: packed, token_type: "bearer", expires_in: 7200 });
}

// 标准 Bearer（内含打包的用户信息）→ 解出标准 claims（sub=unionId）
function handleUserinfo(req: Request): Response {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "invalid_token" }, 401);
  let u: { unionid: string; openid?: string; nick?: string };
  try { u = JSON.parse(b64decode(token)); } catch { return json({ error: "invalid_token" }, 401); }
  if (!u.unionid) return json({ error: "invalid_token" }, 401);
  return json({ sub: u.unionid, name: u.nick, openid: u.openid });
}

// HMAC-SHA256(timestamp, appSecret) → base64 → urlencode
async function signHmac(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return encodeURIComponent(b64);
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
