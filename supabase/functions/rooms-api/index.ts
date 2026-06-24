// supabase/functions/rooms-api/index.ts
// 会议室业务 Edge Function：登录态 + 列表/详情/预定/取消（按整天）
//   GET  ?action=list&date=YYYY-MM-DD     → 10 间房 + 当天预订状态
//   GET  ?action=detail&room_id=&date=    → 房间详情 + 当天预订人/时间
//   POST {action:"book", room_id, date}   → 预定（撞唯一约束 → 409）
//   POST {action:"cancel", booking_id}    → 取消（RLS 限本人）
// 关键：把前端 Authorization(JWT) 透传给 supabase-js，RLS 自动鉴权。
//
// 部署：supabase functions deploy rooms-api --project-ref <REF>

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  const myName = user.user_metadata?.name ?? "钉钉用户";

  const url = new URL(req.url);

  // ---- 写操作 ----
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "book") {
      const roomId = body.room_id;
      const date = body.date || today();
      if (!roomId) return json({ error: "missing room_id" }, 400);
      const { data, error } = await supabase
        .from("bookings")
        .insert({ room_id: roomId, booking_date: date, user_name: myName })
        .select()
        .single();
      if (error) {
        // 23505 = 唯一约束冲突（当天该会议室已被预订）
        if ((error as { code?: string }).code === "23505") {
          return json({ error: "该会议室当天已被预订", code: "ALREADY_BOOKED" }, 409);
        }
        return json({ error: error.message }, 400);
      }
      return json({ booked: data });
    }

    if (action === "cancel") {
      const bookingId = body.booking_id;
      if (!bookingId) return json({ error: "missing booking_id" }, 400);
      // RLS 保证只能删自己的；用 select 回读判断是否真的删了
      const { data, error } = await supabase
        .from("bookings")
        .delete()
        .eq("id", bookingId)
        .select();
      if (error) return json({ error: error.message }, 400);
      if (!data || data.length === 0) {
        return json({ error: "无权取消或预订不存在", code: "NOT_ALLOWED" }, 403);
      }
      return json({ cancelled: data[0] });
    }

    return json({ error: "unknown action" }, 400);
  }

  // ---- 读操作 ----
  const action = url.searchParams.get("action") ?? "list";
  const date = url.searchParams.get("date") || today();

  if (action === "detail") {
    const roomId = url.searchParams.get("room_id");
    if (!roomId) return json({ error: "missing room_id" }, 400);
    const { data: room, error: rErr } = await supabase
      .from("meeting_rooms").select("*").eq("id", roomId).single();
    if (rErr) return json({ error: rErr.message }, 400);
    const { data: bk } = await supabase
      .from("bookings").select("*").eq("room_id", roomId).eq("booking_date", date).maybeSingle();
    return json({
      date,
      room,
      booking: bk
        ? { id: bk.id, booked_by: bk.user_name, booked_at: bk.created_at, is_mine: bk.user_id === user.id }
        : null,
    });
  }

  // action = list：10 间房 + 当天预订状态
  const { data: rooms, error: roomsErr } = await supabase
    .from("meeting_rooms").select("*").order("code");
  if (roomsErr) return json({ error: roomsErr.message }, 400);

  const { data: bookings, error: bkErr } = await supabase
    .from("bookings").select("*").eq("booking_date", date);
  if (bkErr) return json({ error: bkErr.message }, 400);

  const byRoom = new Map<number, typeof bookings[number]>();
  for (const b of bookings ?? []) byRoom.set(b.room_id, b);

  const list = (rooms ?? []).map((r) => {
    const b = byRoom.get(r.id);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      booked: !!b,
      booking_id: b?.id ?? null,
      booked_by: b?.user_name ?? null,
      booked_at: b?.created_at ?? null,
      is_mine: b ? b.user_id === user.id : false,
    };
  });

  return json({
    date,
    user: { id: user.id, name: myName },
    rooms: list,
  });
});
