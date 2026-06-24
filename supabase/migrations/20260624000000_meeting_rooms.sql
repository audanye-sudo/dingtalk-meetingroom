-- 会议室申请：两张表 + RLS + 10 间种子（A~J），按整天预定
-- 登录用户 auth.uid() 来自钉钉 unionId 映射的 Supabase 用户

-- 会议室
create table if not exists public.meeting_rooms (
  id         bigint generated always as identity primary key,
  code       text not null unique,          -- 编号 A/B/.../J
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.meeting_rooms enable row level security;

-- 所有登录用户可看会议室列表
create policy "rooms_select_all" on public.meeting_rooms
  for select to authenticated using (true);

-- 预订记录（按整天：room_id + booking_date 唯一 → 一间一天只能被订一次）
create table if not exists public.bookings (
  id           bigint generated always as identity primary key,
  room_id      bigint not null references public.meeting_rooms (id) on delete cascade,
  booking_date date   not null,
  user_id      uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  user_name    text,                         -- 预订人姓名快照（钉钉昵称）
  created_at   timestamptz not null default now(),
  unique (room_id, booking_date)
);

alter table public.bookings enable row level security;

-- 所有登录用户可读全部预订（这样人人能看到"预订人"）
create policy "bookings_select_all" on public.bookings
  for select to authenticated using (true);

-- 只能挂在自己名下新增
create policy "bookings_insert_own" on public.bookings
  for insert to authenticated with check (auth.uid() = user_id);

-- 只能取消自己的预订
create policy "bookings_delete_own" on public.bookings
  for delete to authenticated using (auth.uid() = user_id);

-- 种子：10 间会议室 A~J
insert into public.meeting_rooms (code, name) values
  ('A', '会议室 A'), ('B', '会议室 B'), ('C', '会议室 C'), ('D', '会议室 D'), ('E', '会议室 E'),
  ('F', '会议室 F'), ('G', '会议室 G'), ('H', '会议室 H'), ('I', '会议室 I'), ('J', '会议室 J')
on conflict (code) do nothing;
