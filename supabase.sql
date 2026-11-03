-- 隨手記帳：Supabase 資料表（v1.1）
-- 用法：Supabase 後台 → SQL Editor → New query → 貼上全部 → Run
-- 可以重複執行：已經建立過的東西不會被清掉，只會補上新的部分。

-- ========== 記帳資料 ==========
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

-- ========== 個人頁面（暱稱、頭像、主題、徽章、存錢目標、預算） ==========
create table if not exists public.profiles (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ========== 每日情話 ==========
create table if not exists public.love_notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  seen_at     timestamptz,                 -- 她第一次看到的時間
  hearts      integer not null default 0,  -- 她回的愛心數
  hearted_at  timestamptz
);

create index if not exists love_notes_user_date_idx on public.love_notes (user_id, date desc, created_at desc);

alter table public.love_notes enable row level security;
drop policy if exists "own notes" on public.love_notes;
create policy "own notes" on public.love_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 內容改過之後，算成她還沒看過新版本
create or replace function public.love_notes_reset_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.seen_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists love_notes_reset_seen on public.love_notes;
create trigger love_notes_reset_seen before update on public.love_notes
  for each row execute function public.love_notes_reset_seen();

-- 她的專屬連結（只存連結代碼和你的暱稱、頭像，不含任何帳務）
create table if not exists public.love_shares (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token       text not null unique check (char_length(token) >= 24),
  name        text not null default '',
  avatar      text not null default '' check (char_length(avatar) <= 200000),
  accent      text not null default 'jade',
  updated_at  timestamptz not null default now()
);

alter table public.love_shares enable row level security;
drop policy if exists "own share" on public.love_shares;
create policy "own share" on public.love_shares for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 登入的人可以操作自己的資料（實際範圍由上面的規則限制）
grant select, insert, update, delete on public.entries, public.profiles, public.love_notes, public.love_shares to authenticated;

-- ========== 她打開連結時用的兩個功能 ==========
-- 她不用登入：憑連結代碼只能讀到情話、你的暱稱和頭像，讀不到其他資料。

-- 讀取情話；p_mark = true 時順便標記成「她看過了」
create or replace function public.love_feed(p_token text, p_mark boolean default true)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.love_shares%rowtype;
begin
  if p_token is null or char_length(p_token) < 24 then
    return null;
  end if;

  select * into s from public.love_shares where token = p_token;
  if not found then
    return null;
  end if;

  if p_mark then
    update public.love_notes set seen_at = now()
     where user_id = s.user_id and seen_at is null;
  end if;

  return json_build_object(
    'name', s.name,
    'avatar', s.avatar,
    'accent', s.accent,
    'notes', coalesce((
      select json_agg(json_build_object(
               'id', n.id, 'date', n.date, 'body', n.body, 'created_at', n.created_at,
               'seen', n.seen_at is not null, 'hearts', n.hearts)
             order by n.date desc, n.created_at desc)
        from (
          select * from public.love_notes
           where user_id = s.user_id
           order by date desc, created_at desc
           limit 365
        ) n
    ), '[]'::json)
  );
end;
$$;

-- 她按愛心（一次最多算 50 顆，每則最多 9999 顆）；回傳這則目前的愛心數
create or replace function public.love_heart(p_token text, p_note uuid, p_n integer default 1)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  total integer;
begin
  if p_token is null or char_length(p_token) < 24 then
    return null;
  end if;

  select user_id into uid from public.love_shares where token = p_token;
  if uid is null then
    return null;
  end if;

  update public.love_notes
     set hearts = least(hearts + greatest(1, least(coalesce(p_n, 1), 50)), 9999),
         hearted_at = now(),
         seen_at = coalesce(seen_at, now())
   where id = p_note and user_id = uid
  returning hearts into total;

  return total;
end;
$$;

revoke all on function public.love_feed(text, boolean) from public;
revoke all on function public.love_heart(text, uuid, integer) from public;
grant execute on function public.love_feed(text, boolean) to anon, authenticated;
grant execute on function public.love_heart(text, uuid, integer) to anon, authenticated;
