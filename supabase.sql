-- Run this once in Supabase > SQL Editor
create table if not exists history (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table history enable row level security;
-- each user can only see and change their own rows
create policy "own rows" on history for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
