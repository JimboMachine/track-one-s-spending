-- 隨手記帳：Supabase 資料表
-- 用法：Supabase 後台 → SQL Editor → New query → 貼上全部 → Run

create table if not exists public.entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),
  amount      numeric(14, 2) not null check (amount >= 0),
  category    text not null,
  date        date not null,
  note        text not null default '',
  raw         text not null default '',
  msg_id      uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- 只有自己看得到、改得到自己的資料
alter table public.entries enable row level security;

drop policy if exists "own rows select" on public.entries;
drop policy if exists "own rows insert" on public.entries;
drop policy if exists "own rows update" on public.entries;
drop policy if exists "own rows delete" on public.entries;

create policy "own rows select" on public.entries for select using (auth.uid() = user_id);
create policy "own rows insert" on public.entries for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows delete" on public.entries for delete using (auth.uid() = user_id);
