-- 最小 demo 表：每个登录用户管理自己的 notes，靠 RLS 做行级隔离
create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- 只能读/写/删自己的数据（auth.uid() 来自登录后的 JWT，即钉钉 unionId 映射的用户）
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);

create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);

create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);
