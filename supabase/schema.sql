-- Sempoa Books — Supabase schema. Run once in Supabase → SQL Editor → New query → Run.
-- The server only ever stores the encrypted envelope; it cannot read any business data.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email)),
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.vaults (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  envelope jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.vaults enable row level security;

-- helpers: the caller's confirmed email from the JWT
create or replace function public.jwt_email() returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
create or replace function public.is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.workspace_id = ws and (m.user_id = auth.uid() or m.email = public.jwt_email()))
$$;
create or replace function public.is_owner(ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.workspace_id = ws and m.role = 'owner' and (m.user_id = auth.uid() or m.email = public.jwt_email()))
$$;

-- row level security: members see their own workspaces; only owners manage members
drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select to authenticated using (public.is_member(id));
drop policy if exists mb_select on public.members;
create policy mb_select on public.members for select to authenticated using (public.is_member(workspace_id));
drop policy if exists mb_owner_ins on public.members;
create policy mb_owner_ins on public.members for insert to authenticated with check (public.is_owner(workspace_id) and role = 'member');
drop policy if exists mb_owner_del on public.members;
create policy mb_owner_del on public.members for delete to authenticated using (public.is_owner(workspace_id) and role = 'member');
drop policy if exists vt_select on public.vaults;
create policy vt_select on public.vaults for select to authenticated using (public.is_member(workspace_id));
-- no direct insert/update on vaults or workspaces: only through the functions below

-- create a workspace with its first encrypted envelope; the caller becomes owner
create or replace function public.create_workspace(p_name text, p_envelope jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; em text := public.jwt_email();
begin
  if auth.uid() is null or em = '' then raise exception 'not signed in'; end if;
  if (select count(*) from workspaces where created_by = auth.uid()) >= 20 then raise exception 'too many workspaces'; end if;
  insert into workspaces(name, created_by) values (p_name, auth.uid()) returning id into ws;
  insert into members(workspace_id, email, user_id, role) values (ws, em, auth.uid(), 'owner');
  insert into vaults(workspace_id, envelope) values (ws, p_envelope);
  return ws;
end $$;

-- save with optimistic locking: fails if someone else saved first
create or replace function public.save_vault(p_ws uuid, p_envelope jsonb, p_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.is_member(p_ws) then raise exception 'not a member'; end if;
  if pg_column_size(p_envelope) > 20000000 then raise exception 'too large'; end if;
  update vaults set envelope = p_envelope, version = version + 1, updated_at = now(), updated_by = auth.uid()
    where workspace_id = p_ws and version = p_version returning version into v;
  if v is null then raise exception 'conflict'; end if;
  return v;
end $$;

-- the caller's workspaces; also links pending invitations to this account
create or replace function public.my_workspaces() returns table(id uuid, name text, role text, version bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  update members set user_id = auth.uid() where email = public.jwt_email() and user_id is null and public.jwt_email() <> '';
  return query select w.id, w.name, m.role, v.version, v.updated_at from members m join workspaces w on w.id = m.workspace_id join vaults v on v.workspace_id = w.id
    where m.user_id = auth.uid() order by w.created_at;
end $$;

revoke all on function public.create_workspace(text, jsonb) from public, anon;
revoke all on function public.save_vault(uuid, jsonb, bigint) from public, anon;
revoke all on function public.my_workspaces() from public, anon;
grant execute on function public.create_workspace(text, jsonb) to authenticated;
grant execute on function public.save_vault(uuid, jsonb, bigint) to authenticated;
grant execute on function public.my_workspaces() to authenticated;
