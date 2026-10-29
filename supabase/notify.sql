-- Sempoa Books — automatic emails and document reminders. Run once in SQL Editor (after schema.sql).
create table if not exists public.notify_log (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event text not null, recipient text not null, sender uuid, at timestamptz not null default now()
);
create index if not exists notify_log_ws_at on public.notify_log(workspace_id, at);
alter table public.notify_log enable row level security;
drop policy if exists nl_owner_read on public.notify_log;
create policy nl_owner_read on public.notify_log for select to authenticated using (public.is_owner(workspace_id));

-- reminder dates only: document type and expiry date, nothing else from the encrypted books
create table if not exists public.reminders (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null check (char_length(label) <= 120),
  due date not null, remind_on date not null,
  recipients text[] not null default '{}' check (array_length(recipients, 1) is null or array_length(recipients, 1) <= 10),
  sent_on date, updated_at timestamptz not null default now()
);
alter table public.reminders enable row level security;
drop policy if exists rm_rw on public.reminders;
create policy rm_rw on public.reminders for all to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- daily 9am (Malaysia) run of the reminder emails
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'sempoa_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'sempoa_cron_secret');
  end if;
end $$;
create or replace function public.cron_secret_ok(s text) returns boolean language sql security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'sempoa_cron_secret' and decrypted_secret = s)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;
select cron.unschedule('sempoa-daily-reminders') where exists (select 1 from cron.job where jobname = 'sempoa-daily-reminders');
select cron.schedule('sempoa-daily-reminders', '0 1 * * *', $cron$
  select net.http_post(
    url := 'https://glnhywrjvoewfvvysecc.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sempoa_cron_secret')),
    body := '{"daily": true}'::jsonb)
$cron$);
