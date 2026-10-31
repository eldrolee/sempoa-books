-- Sempoa Books: shop links for marketplace order sync. Tokens are readable only by the Edge Function (service role).
create table if not exists public.marketplace_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('shopee', 'lazada', 'tiktok')),
  shop_id bigint,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  state text,
  back_url text,
  synced_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, platform)
);
alter table public.marketplace_links enable row level security;
-- no policies: browsers cannot read or write this table; only the marketplace Edge Function can.
