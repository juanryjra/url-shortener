create extension if not exists pgcrypto;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  token text not null unique,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  url text not null,
  created_at timestamptz not null default now()
);

alter table public.invites enable row level security;
alter table public.links enable row level security;

drop policy if exists "Users can read their claimed invite" on public.invites;
create policy "Users can read their claimed invite"
on public.invites for select
to authenticated
using (claimed_by = auth.uid());

drop policy if exists "Users can read own links" on public.links;
create policy "Users can read own links"
on public.links for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own links" on public.links;
create policy "Users can insert own links"
on public.links for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can delete own links" on public.links;
create policy "Users can delete own links"
on public.links for delete
to authenticated
using (user_id = auth.uid());

create index if not exists links_user_id_created_at_idx
on public.links (user_id, created_at desc);

create index if not exists invites_claimed_by_idx
on public.invites (claimed_by);
