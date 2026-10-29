// Sempoa Books — automatic email notifications.
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor → name "notify" → paste this file.
// Then turn OFF "Enforce JWT verification" for this function (it checks the signed-in user itself).
// Secrets (Edge Functions → Secrets): BREVO_API_KEY (or RESEND_API_KEY), MAIL_FROM, MAIL_FROM_NAME, APP_URL.
// The server never sees the books: emails carry only a document number and the company name.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const APP_URL = Deno.env.get('APP_URL') || 'https://eldrolee.github.io/sempoa-books/';
const FROM = Deno.env.get('MAIL_FROM') || '';
const FROM_NAME = Deno.env.get('MAIL_FROM_NAME') || 'Sempoa Books';
const DAILY_LIMIT = 200;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clip = (s: unknown, n: number) => String(s ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, n);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type T = { subject: string; en: string; ms: string; zh: string; cta: string };
const TEMPLATES: Record<string, (v: Record<string, string>) => T> = {
  claim_submitted: v => ({ subject: `Claim ${v.ref} needs your approval`, en: `${v.actor} submitted claim ${v.ref}${v.note ? ` (${v.note})` : ''} for your approval.`, ms: `${v.actor} menghantar tuntutan ${v.ref} untuk kelulusan anda.`, zh: `${v.actor} 提交了报销 ${v.ref}，等待您审批。`, cta: 'Review the claim' }),
  claim_rejected: v => ({ subject: `Claim ${v.ref} was rejected`, en: `Your claim ${v.ref} was rejected by ${v.actor}${v.note ? `: ${v.note}` : '.'} You can edit and resubmit it.`, ms: `Tuntutan ${v.ref} anda ditolak oleh ${v.actor}. Anda boleh membetulkan dan menghantarnya semula.`, zh: `您的报销 ${v.ref} 被 ${v.actor} 驳回，可以修改后重新提交。`, cta: 'Edit and resubmit' }),
  claim_approved: v => ({ subject: `Claim ${v.ref} approved`, en: `Your claim ${v.ref} was approved by ${v.actor} and will be paid with your next salary.`, ms: `Tuntutan ${v.ref} anda telah diluluskan dan akan dibayar bersama gaji seterusnya.`, zh: `您的报销 ${v.ref} 已获批准，将随下次薪资发放。`, cta: 'View the claim' }),
  payroll_ready: v => ({ subject: `Payroll for ${v.ref} is ready to release`, en: `${v.actor} processed payroll for ${v.ref}. It is waiting for you to release payment.`, ms: `${v.actor} telah memproses gaji ${v.ref}. Ia menunggu anda melepaskan bayaran.`, zh: `${v.actor} 已处理 ${v.ref} 的薪资，等待您批准发薪。`, cta: 'Release payment' }),
  payslip_ready: v => ({ subject: `Your payslip for ${v.ref} is ready`, en: `Your payslip for ${v.ref} is ready. Open My pay and unlock it with your PIN.`, ms: `Slip gaji anda untuk ${v.ref} sudah sedia. Buka Gaji saya dan buka dengan PIN anda.`, zh: `您 ${v.ref} 的工资单已发布，请在「我的薪资」用 PIN 查看。`, cta: 'Open My pay' }),
  doc_expiring: v => ({ subject: `${v.ref} expires on ${v.note}`, en: `${v.ref} expires on ${v.note}. Renew it and upload the new copy in Company documents.`, ms: `${v.ref} akan tamat pada ${v.note}. Perbaharui dan muat naik salinan baharu.`, zh: `${v.ref} 将于 ${v.note} 到期，请续期并上传新副本。`, cta: 'Open company documents' }),
  test: v => ({ subject: 'Sempoa Books email test', en: `Automatic emails are working for ${v.company}.`, ms: `E-mel automatik berfungsi untuk ${v.company}.`, zh: `${v.company} 的自动电邮已启用。`, cta: 'Open Sempoa Books' })
};

async function send(to: string, t: T, company: string) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#161b33"><p style="font-size:13px;color:#646b85">${esc(company)}</p><h2 style="font-size:18px">${esc(t.subject)}</h2><p>${esc(t.en)}</p><p style="color:#646b85">${esc(t.ms)}<br>${esc(t.zh)}</p><p><a href="${APP_URL}" style="display:inline-block;background:#1e2a5a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(t.cta)}</a></p><p style="font-size:11px;color:#9097b3">Sent by Sempoa Books for ${esc(company)}. You receive this because you are a member of these books.</p></div>`;
  const text = `${t.en}\n\n${t.ms}\n${t.zh}\n\n${APP_URL}`;
  const brevo = Deno.env.get('BREVO_API_KEY'); const resend = Deno.env.get('RESEND_API_KEY');
  let r: Response;
  if (brevo) r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': brevo, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: FROM_NAME, email: FROM }, to: [{ email: to }], subject: t.subject, htmlContent: html, textContent: text }) });
  else if (resend) r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `${FROM_NAME} <${FROM}>`, to: [to], subject: t.subject, html, text }) });
  else throw new Error('No email provider key set (BREVO_API_KEY or RESEND_API_KEY)');
  if (!r.ok) throw new Error(`Email provider error ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function memberEmails(ws: string) { const { data } = await admin.from('members').select('email').eq('workspace_id', ws); return new Set((data || []).map((m: { email: string }) => m.email.toLowerCase())); }
async function sentToday(ws: string) { const since = new Date(Date.now() - 86400000).toISOString(); const { count } = await admin.from('notify_log').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('at', since); return count || 0; }

async function runDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: due } = await admin.from('reminders').select('*').lte('remind_on', today);
  let sent = 0;
  for (const r of due || []) {
    const dueDate = r.due as string; if (dueDate < new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)) continue;
    if (r.sent_on && (Date.parse(today) - Date.parse(r.sent_on)) / 86400000 < 7) continue;
    const { data: w } = await admin.from('workspaces').select('name').eq('id', r.workspace_id).single();
    const ok = await memberEmails(r.workspace_id);
    const to = (r.recipients || []).map((e: string) => e.toLowerCase()).filter((e: string) => ok.has(e));
    for (const e of to) { try { await send(e, TEMPLATES.doc_expiring({ ref: clip(r.label, 120), note: dueDate, actor: '', company: w?.name || '' }), w?.name || ''); sent++; await admin.from('notify_log').insert({ workspace_id: r.workspace_id, event: 'doc_expiring', recipient: e }); } catch (_) { /* try the next one */ } }
    await admin.from('reminders').update({ sent_on: today }).eq('id', r.id);
  }
  return { ok: true, sent };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const cron = req.headers.get('x-cron-secret');
    if (cron) { const { data } = await admin.rpc('cron_secret_ok', { s: cron }); if (!data) return json({ error: 'forbidden' }, 403); return json(await runDaily()); }
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token); const user = u?.user;
    if (!user || !user.email) return json({ error: 'Sign in first' }, 401);
    const b = await req.json();
    const ws = clip(b.ws, 64); const event = clip(b.event, 40); const tpl = TEMPLATES[event];
    if (!ws || !tpl) return json({ error: 'Unknown event' }, 400);
    const me = user.email.toLowerCase(); const ok = await memberEmails(ws);
    if (!ok.has(me)) return json({ error: 'Not a member of these books' }, 403);
    if (await sentToday(ws) >= DAILY_LIMIT) return json({ error: 'Daily email limit reached' }, 429);
    const want: string[] = Array.isArray(b.to) ? b.to.slice(0, 10).map((e: unknown) => clip(e, 254).toLowerCase()) : [];
    const to = event === 'test' ? [me] : [...new Set(want)].filter(e => ok.has(e) && e !== me);
    if (!to.length) return json({ ok: true, sent: 0, skipped: want.length });
    const { data: w } = await admin.from('workspaces').select('name').eq('id', ws).single();
    const v = { ref: clip(b.ref, 60), note: clip(b.note, 160), actor: clip(b.actor, 80) || me, company: w?.name || '' };
    let sent = 0; const errors: string[] = [];
    for (const e of to) { try { await send(e, tpl(v), v.company); sent++; await admin.from('notify_log').insert({ workspace_id: ws, event, recipient: e, sender: user.id }); } catch (x) { errors.push(String((x as Error).message)); } }
    return json({ ok: errors.length === 0, sent, errors });
  } catch (x) { return json({ error: String((x as Error).message || x) }, 500); }
});
