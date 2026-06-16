// supabase/functions/notes-api/index.ts
// 最小业务 Edge Function：演示"登录态 + 业务逻辑 + 读写自己的数据"
//   GET  /notes-api  → 返回当前登录用户的 notes（含计数）
//   POST /notes-api  → body {content} 新增一条 note
// 关键：把前端传来的 Authorization(JWT) 透传给 supabase-js，RLS 自动只放行本人数据。
//
// 部署：supabase functions deploy notes-api --project-ref <PROJECT_REF>
// （SUPABASE_URL / SUPABASE_ANON_KEY 由 Supabase 平台自动注入，无需手动配）

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "not logged in" }, 401);

  if (req.method === "POST") {
    const { content } = await req.json().catch(() => ({}));
    if (!content) return json({ error: "missing content" }, 400);
    const { data, error } = await supabase
      .from("notes").insert({ content }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ created: data });
  }

  // GET：业务逻辑示例——返回本人 notes + 计数
  const { data, error } = await supabase
    .from("notes").select("*").order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 400);
  return json({
    user: { id: user.id, sub: user.user_metadata?.sub ?? user.id, name: user.user_metadata?.name },
    count: data.length,
    notes: data,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
