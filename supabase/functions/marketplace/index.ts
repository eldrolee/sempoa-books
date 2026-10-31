// Sempoa Books — Shopee Open Platform (API v2) order sync.
// Deploy: Supabase → Edge Functions → new function "marketplace" → paste this file → turn OFF "Enforce JWT verification" (it checks the user itself).
// Secrets: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY (from open.shopee.com after Shopee approves your app), optional SHOPEE_HOST (default live host),
//          FUNCTION_URL = https://<project>.supabase.co/functions/v1/marketplace (Shopee sends the shop back here after authorisation).
// Run marketplace.sql once first. Partner keys and shop tokens stay on the server; the app only receives order lines (order no, date, SKU, name, qty, status).
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PID = Number(Deno.env.get('SHOPEE_PARTNER_ID') || 0); const PKEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const HOST = Deno.env.get('SHOPEE_HOST') || 'https://partner.shopeemobile.com'; const SELF = Deno.env.get('FUNCTION_URL') || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);

async function hmac(msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(PKEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* Shopee v2 signature: partner_id + path + timestamp (+ access_token + shop_id for shop calls) */
async function signed(path: string, q: Record<string, string | number> = {}, shop?: { token: string; shopId: number }) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await hmac(`${PID}${path}${ts}${shop ? shop.token + shop.shopId : ''}`);
  const p = new URLSearchParams({ partner_id: String(PID), timestamp: String(ts), sign, ...(shop ? { access_token: shop.token, shop_id: String(shop.shopId) } : {}) });
  Object.entries(q).forEach(([k, v]) => p.set(k, String(v)));
  return `${HOST}${path}?${p}`;
}
async function shopeeJson(r: Response) { const j = await r.json(); if (j.error) throw new Error(`Shopee: ${j.error} ${j.message || ''}`.trim()); return j; }
async function tokenFor(ws: string) {
  const { data: l } = await admin.from('marketplace_links').select('*').eq('workspace_id', ws).eq('platform', 'shopee').maybeSingle();
  if (!l) throw new Error('Shopee is not connected for these books');
  if (new Date(l.expires_at).getTime() > Date.now() + 120000) return { token: l.access_token as string, shopId: Number(l.shop_id) };
  const path = '/api/v2/auth/access_token/get';
  const j = await shopeeJson(await fetch(await signed(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: l.refresh_token, partner_id: PID, shop_id: Number(l.shop_id) }) }));
  await admin.from('marketplace_links').update({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: new Date(Date.now() + j.expire_in * 1000).toISOString() }).eq('id', l.id);
  return { token: j.access_token as string, shopId: Number(l.shop_id) };
}
async function orders(ws: string, days: number) {
  const shop = await tokenFor(ws); const to = Math.floor(Date.now() / 1000); const from = to - Math.min(15, Math.max(1, days)) * 86400; /* Shopee allows at most 15 days per call */
  const sns: string[] = []; let cursor = '';
  for (let page = 0; page < 20; page++) {
    const j = await shopeeJson(await fetch(await signed('/api/v2/order/get_order_list', { time_range_field: 'create_time', time_from: from, time_to: to, page_size: 100, cursor, response_optional_fields: 'order_status' }, shop)));
    (j.response?.order_list || []).forEach((o: { order_sn: string }) => sns.push(o.order_sn));
    if (!j.response?.more) break; cursor = j.response.next_cursor;
  }
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < sns.length; i += 50) {
    const j = await shopeeJson(await fetch(await signed('/api/v2/order/get_order_detail', { order_sn_list: sns.slice(i, i + 50).join(','), response_optional_fields: 'item_list,order_status,create_time' }, shop)));
    for (const o of j.response?.order_list || []) for (const it of o.item_list || []) rows.push({ order: o.order_sn, date: new Date(o.create_time * 1000).toISOString().slice(0, 10), sku: it.model_sku || it.item_sku || '', name: it.item_name, qty: it.model_quantity_purchased, status: o.order_status });
  }
  await admin.from('marketplace_links').update({ synced_at: new Date().toISOString() }).eq('workspace_id', ws).eq('platform', 'shopee');
  return rows;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.get('code')) { /* Shopee redirects the shop owner here after they authorise */
      const ws = clip(url.searchParams.get('ws'), 64); const state = clip(url.searchParams.get('st'), 80); const shopId = Number(url.searchParams.get('shop_id'));
      const { data: pend } = await admin.from('marketplace_links').select('id, back_url').eq('workspace_id', ws).eq('platform', 'shopee').eq('state', state).maybeSingle();
      if (!pend || !shopId) return new Response('This link has expired. Start again from Sempoa Books.', { status: 400 });
      const path = '/api/v2/auth/token/get';
      const j = await shopeeJson(await fetch(await signed(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: url.searchParams.get('code'), shop_id: shopId, partner_id: PID }) }));
      await admin.from('marketplace_links').update({ shop_id: shopId, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: new Date(Date.now() + j.expire_in * 1000).toISOString(), state: null }).eq('id', pend.id);
      return new Response(null, { status: 302, headers: { Location: pend.back_url || 'https://eldrolee.github.io/sempoa-books/' } });
    }
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!PID || !PKEY) return json({ error: 'Shopee partner keys are not set on the server yet (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY)' }, 503);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token); const user = u?.user; if (!user?.email) return json({ error: 'Sign in first' }, 401);
    const b = await req.json(); const ws = clip(b.ws, 64);
    const { data: m } = await admin.from('members').select('email').eq('workspace_id', ws).eq('email', user.email.toLowerCase()).maybeSingle();
    if (!m) return json({ error: 'Not a member of these books' }, 403);
    if (b.action === 'status') { const { data: l } = await admin.from('marketplace_links').select('shop_id, synced_at, access_token').eq('workspace_id', ws).eq('platform', 'shopee').maybeSingle(); return json({ connected: !!(l && l.access_token), shopId: l?.shop_id, syncedAt: l?.synced_at }); }
    if (b.action === 'auth_url') {
      if (!SELF) return json({ error: 'FUNCTION_URL secret is not set' }, 503);
      const st = crypto.randomUUID(); const back = clip(b.back, 300);
      await admin.from('marketplace_links').upsert({ workspace_id: ws, platform: 'shopee', state: st, back_url: back, created_by: user.id }, { onConflict: 'workspace_id,platform' });
      const path = '/api/v2/shop/auth_partner';
      return json({ url: await signed(path, { redirect: `${SELF}?ws=${encodeURIComponent(ws)}&st=${st}` }) });
    }
    if (b.action === 'orders') return json({ rows: await orders(ws, Number(b.days) || 7) });
    return json({ error: 'Unknown action' }, 400);
  } catch (x) { return json({ error: String((x as Error).message || x) }, 500); }
});
