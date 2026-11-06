// 每日記帳提醒：每 15 分鐘被排程呼叫一次。
// 到了使用者設定的時間、而且那天還沒記帳，就送一則推播（一天最多一次）。
//
// 需要的密鑰（supabase secrets set …）：
//   VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT（例如 mailto:you@example.com）
//   CRON_SECRET（自己隨便設一串，排程呼叫時帶在 Authorization 標頭）
// SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供。

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

// 某個時區「現在」的日期和時間
function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}
// 那個時區今天 00:00 是 UTC 的幾點
function dayStartUtc(date: string, tz: string) {
  const guess = new Date(`${date}T00:00:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime()));
}

const MESSAGES = [
  '今天記帳了嗎？花 5 秒記一下，連續紀錄不要斷 🔥',
  '睡前記一下今天的花費吧 ✏️',
  '今天有花錢嗎？打一句「晚餐 150」就好 🙂',
  '記帳小幫手在等你～今天的帳記了嗎？📒',
];

Deno.serve(async req => {
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return new Response('forbidden', { status: 403 });
  const { data: subs, error } = await db.from('push_subs').select('*');
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0, skipped = 0, removed = 0;
  for (const s of subs ?? []) {
    const now = localNow(s.tz || 'Asia/Taipei');
    const at = String(s.remind_at).slice(0, 5);
    if (now.time < at || s.last_sent === now.date) { skipped++; continue; }
    // 今天記過帳就不吵
    const { count } = await db.from('entries').select('id', { count: 'exact', head: true })
      .eq('user_id', s.user_id).gte('created_at', dayStartUtc(now.date, s.tz || 'Asia/Taipei').toISOString());
    if ((count ?? 0) > 0) { await db.from('push_subs').update({ last_sent: now.date }).eq('endpoint', s.endpoint); skipped++; continue; }
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: '隨手記帳', body: MESSAGES[Math.floor(Math.random() * MESSAGES.length)], url: './' }));
      await db.from('push_subs').update({ last_sent: now.date }).eq('endpoint', s.endpoint);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await db.from('push_subs').delete().eq('endpoint', s.endpoint); removed++; }
      else console.error('push failed', code, e);
    }
  }
  return Response.json({ sent, skipped, removed });
});
