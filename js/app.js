import { parseMessage, extractAmount, CATEGORIES, categoryInfo, toISO, fromISO, extractExtras, setCustomCategories, CURRENCIES, ACCOUNT_WORDS } from './parser.js';
import * as S from './store.js';
import { recognize, receiptToText, toSentence, looksLikeNotice } from './ocr.js';
import { recapStats, recapImage, recapHeadline } from './recap.js';
import { donut, dailyBars, monthBars, money, tip } from './charts.js';
import { haptic, toast, confetti, celebrate, countUp, pickGeneric, pickIncome, PHRASES, greeting } from './feedback.js';

// ---------- 小工具 ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const todayISO = () => toISO(new Date());
const localDay = iso => toISO(new Date(iso));
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const signed = e => (e.type === 'income' ? '+' : '−') + money(e.amount);
const sum = (list, type) => list.reduce((s, e) => s + (e.type === type ? e.amount : 0), 0);

function relDay(iso) {
  const t = fromISO(todayISO()), d = fromISO(iso);
  const diff = Math.round((t - d) / 864e5);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff === -1) return '明天';
  const [y, m, dd] = iso.split('-').map(Number);
  return `${y !== t.getFullYear() ? y + '/' : ''}${m}/${dd}（${WD[d.getDay()]}）`;
}
function dayTitle(iso) {
  const r = relDay(iso);
  const [, m, d] = iso.split('-').map(Number);
  return r.includes('/') ? r : `${r} · ${m}月${d}日 週${WD[fromISO(iso).getDay()]}`;
}

const EXP_SLOTS = CATEGORIES.expense.slice(0, 8).map(c => c.name);
const INC_SLOTS = CATEGORIES.income.map(c => c.name);
const slotOf = (type, name) => (type === 'income' ? INC_SLOTS : EXP_SLOTS).indexOf(name);
const catColor = (type, name) => { const i = slotOf(type, name); return i >= 0 ? `var(--s${i + 1})` : 'var(--s-other)'; };

const state = {
  view: 'chat', month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), catType: 'expense', catFilter: null,
  showCount: 60, ephemeral: [], fresh: null, flash: null, animateStats: true, editing: null,
};
const entries = () => S.getEntries();
const scopeEntries = () => (state.scope === 'book' && S.getBook() ? S.getBookEntries() : entries());
const inMonth = (list, d) => { const k = monthKey(d); return list.filter(e => e.date.startsWith(k)); };

// ---------- 統計輔助 ----------
function streak() {
  const days = new Set(entries().filter(e => !e.sample).map(e => localDay(e.createdAt)));
  const d = new Date();
  if (!days.has(toISO(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(toISO(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const createdToday = () => entries().filter(e => !e.sample && localDay(e.createdAt) === todayISO()).length;
const thisMonth = () => inMonth(entries(), new Date());

function budgetLine(spent, budget) {
  const rem = budget - spent, pct = spent / budget;
  if (pct < 0.5) return `本月預算還剩 ${money(rem)}，穩穩的 💪`;
  if (pct < 0.8) return `本月預算還剩 ${money(rem)}，繼續保持 👍`;
  if (pct < 1) return `預算剩 ${money(rem)}，接下來省一點就好 🙂`;
  return `本月超出預算 ${money(-rem)}，記下來就是掌握的第一步 🌱`;
}

// ---------- 記帳後的鼓勵 ----------
function snapshot() {
  return { count: entries().filter(e => !e.sample).length, today: createdToday(), spent: sum(thisMonth(), 'expense') };
}
function buildCheer(added, before) {
  const total = entries().filter(e => !e.sample).length;
  const today = createdToday();
  const st = streak();
  const firstToday = before.today === 0;
  const budget = S.getSettings().budget;
  let main, sub = null, celebrate = null;
  const ms = [1, 10, 50, 100, 200, 300, 500, 1000, 2000].find(m => before.count < m && total >= m);
  const one = added.length === 1 ? added[0] : null;

  let cheaper = null;
  if (one && one.type === 'expense') {
    const key = one.note.trim().toLowerCase();
    const since = toISO(new Date(Date.now() - 120 * 864e5));
    const hist = entries().filter(e => e.id !== one.id && e.type === 'expense' && e.note.trim().toLowerCase() === key && e.date >= since);
    if (hist.length >= 3) {
      const avg = hist.reduce((s, e) => s + e.amount, 0) / hist.length;
      if (one.amount < avg * 0.9 && avg - one.amount >= 5) cheaper = Math.round(avg - one.amount);
    }
  }

  if (ms === 1) { main = PHRASES.first; celebrate = 'big'; }
  else if (ms) { main = `第 ${ms} 筆紀錄達成！持續記帳的你超棒 🏆`; celebrate = 'big'; }
  else if (firstToday && [3, 7, 14, 21, 30, 50, 100, 180, 365].includes(st)) { main = `連續記帳 ${st} 天 🔥 太厲害了！`; celebrate = 'big'; }
  else if (one && one.type === 'income') { main = pickIncome(); celebrate = 'coins'; }
  else if (added.length > 1) main = `一次記好 ${added.length} 筆，效率滿分 ⚡`;
  else if (firstToday && st >= 2) main = `連續第 ${st} 天記帳 🔥 繼續保持！`;
  else if (cheaper) main = `比平常的「${one.note}」少花 ${money(cheaper)} 👍`;
  else main = pickGeneric(S.getProfile().name);

  const cm = monthKey(new Date());
  const hasExpThisMonth = added.some(e => e.type === 'expense' && e.date.startsWith(cm));
  if (budget > 0 && hasExpThisMonth) {
    const spent = sum(thisMonth(), 'expense');
    if (before.spent < budget * 0.8 && spent >= budget * 0.8 && spent < budget) sub = `已用掉本月預算的 80%，還剩 ${money(budget - spent)} 🙂`;
    else sub = budgetLine(spent, budget);
  } else if (one && one.type === 'income') {
    sub = `本月收入累計 ${money(sum(thisMonth(), 'income'))}`;
  } else sub = `今天已記 ${today} 筆`;
  const cbn = one ? catBudgetNote(one) : null;
  if (cbn) sub = cbn;
  if (one && one.fx) sub = `${fxLabel(one.fx)} ≈ ${money(one.amount)}（匯率 ${one.fx.rate}）`;
  if (added.some(e => e.bookId)) sub = `👫 記到共同帳本「${esc(S.getBook()?.name || '')}」`;
  return { main, sub, celebrate, streakUp: firstToday && st >= 1 };
}

// ---------- 解析：付款方式、標籤、外幣、旅行模式、共同帳本 ----------
const SHARED_TAGS = ['一起', '共同', '我們'];
function activeTrip() {
  const t = S.getSettings().trip;
  return t && t.active ? t : null;
}
function fxRate(cur) {
  const t = activeTrip(); const r = S.getSettings().fxRates || {};
  if (t && t.currency === cur && t.rate > 0) return t.rate;
  return r[cur] > 0 ? r[cur] : null;
}
// 一句話 → 幾筆紀錄（已經套好付款方式、標籤、匯率、共同帳本）
function parseSmart(text) {
  const st = S.getSettings();
  const ex = extractExtras(text, { accounts: st.accounts || [] });
  const list = parseMessage(ex.text, { learned: S.getLearned() });
  if (!list.length) return { list, ex };
  const trip = activeTrip();
  let tags = [...ex.tags];
  let shared = state.sharedMode && !!S.getBook();
  if (tags.some(t => SHARED_TAGS.includes(t)) && S.getBook()) { shared = true; tags = tags.filter(t => !SHARED_TAGS.includes(t)); }
  if (trip && trip.tag && !tags.includes(trip.tag)) tags.push(trip.tag);
  let cur = ex.currency === 'TWD' ? null : ex.currency;
  if (!ex.currency && trip && trip.currency && trip.currency !== 'TWD' && trip.localDefault !== false) cur = trip.currency;
  const rate = cur ? fxRate(cur) : null;
  const book = shared ? S.getBook() : null;
  const me = book ? book.members.find(m => m.me) : null;
  for (const e of list) {
    if (ex.account || st.defaultAccount) e.account = ex.account || st.defaultAccount;
    if (tags.length) e.tags = tags;
    if (cur && rate) { e.fx = { cur, amount: e.amount, rate }; e.amount = Math.round(e.amount * rate); }
    if (book) { e.bookId = book.id; e.paidBy = me ? me.name : ''; }
  }
  return { list, ex, cur, rate, missingRate: !!cur && !rate, book };
}
const fxLabel = fx => `${(CURRENCIES[fx.cur] || {}).sym || fx.cur}${Number(fx.amount).toLocaleString('zh-TW')}`;

// ---------- 固定收支／訂閱 ----------
// 同一筆固定收支在同一天只會有一筆：用「項目 id + 日期」算出固定的紀錄 id，兩台裝置同時補記也不會重複
function stableId(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, out = '';
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < str.length; i++) { h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619); h2 = Math.imul(h2 + str.charCodeAt(i), 2246822507) ^ (h1 >>> 13); }
    out += ((h1 ^ h2 ^ r) >>> 0).toString(16).padStart(8, '0');
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20, 32)}`;
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : stableId(String(Math.random()) + Date.now()));
const recurList = () => S.getSettings().recurring || [];
const setRecur = list => S.setSettings({ recurring: list });
const dueDateIn = (item, y, m) => `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(item.day, daysIn(y, m))).padStart(2, '0')}`;
function recurringCmd(t) {
  const m = t.match(/^每(?:個)?月\s*(\d{1,2})?\s*(?:號|日)?\s*(.+)$/);
  if (!m) return null;
  const day = m[1] ? Math.min(31, Math.max(1, Number(m[1]))) : new Date().getDate();
  const r = parseSmart(m[2]).list;
  if (r.length !== 1) return null;
  return { recurring: true, day, item: r[0] };
}
function addRecurringFromChat(rc, text) {
  const it = rc.item;
  const item = { id: newId(), note: it.note, amount: it.amount, type: it.type, category: it.category, account: it.account || null, day: rc.day, active: true, since: todayISO() };
  setRecur([...recurList(), item]);
  haptic(12);
  const now = new Date();
  const due = dueDateIn(item, now.getFullYear(), now.getMonth());
  botSay(`<p>🔁 好，之後<b>每月 ${item.day} 號</b>自動記「${esc(item.note)}」<b>${signed(item)}</b></p>
    <p class="hint">${due >= todayISO() ? `這個月${relDay(due)}會記第一筆。` : '這個月的日子已經過了，下個月開始。'}扣款前一天會提醒你。</p>
    <p class="hint" style="margin-top:8px"><button class="linkish" type="button" data-act="recur-manage">管理固定收支 →</button></p>`, text);
  runRecurring();
}
// 補記到今天為止該記的固定收支
function runRecurring() {
  const list = recurList(); if (!list.length) return [];
  const today = todayISO(), now = new Date();
  const have = new Set(S.getAllEntries().map(e => e.id));
  const added = [];
  let changed = false;
  const next = list.map(it => {
    if (!it.active) return it;
    const from = it.lastRun || it.since || today;
    let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1;
    const stopY = now.getFullYear(), stopM = now.getMonth();
    let last = it.lastRun || null, guard = 0;
    while ((y < stopY || (y === stopY && m <= stopM)) && guard++ < 13) { // 最多往回補 12 個月
      const due = dueDateIn(it, y, m);
      if (due <= today && due >= (it.since || '0000') && (!it.lastRun || due > it.lastRun)) {
        const id = stableId(`${it.id}|${due}`);
        if (!have.has(id)) { added.push({ id, type: it.type, amount: it.amount, category: it.category, date: due, note: it.note, account: it.account || undefined, recurringId: it.id }); have.add(id); }
        last = due;
      }
      m++; if (m > 11) { m = 0; y++; }
    }
    if (last !== it.lastRun) { changed = true; return { ...it, lastRun: last }; }
    return it;
  });
  if (changed) setRecur(next);
  if (added.length) {
    const byDate = {};
    for (const a of added) (byDate[a.date] = byDate[a.date] || []).push(a);
    for (const d of Object.keys(byDate).sort()) S.addEntries(byDate[d], '🔁 固定收支');
    toast(`已自動記好 ${added.length} 筆固定收支`, { icon: '🔁' });
  }
  return added;
}
// 明天要扣款的固定收支：一天提醒一次
function recurringHeadsUp() {
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const t = toISO(tm);
  const st = S.getSettings();
  if (st.recurNotified === todayISO()) return;
  const due = recurList().filter(it => it.active && dueDateIn(it, tm.getFullYear(), tm.getMonth()) === t && (!it.lastRun || it.lastRun < t));
  if (!due.length) return;
  S.setSettings({ recurNotified: todayISO() });
  const total = due.filter(x => x.type === 'expense').reduce((a, b) => a + b.amount, 0);
  state.ephemeral.push({ at: new Date().toISOString(), html: `<p>⏰ <b>明天</b>會自動記：</p><p>${due.map(it => `${categoryInfo(it.type, it.category).icon} ${esc(it.note)} <b>${signed(it)}</b>`).join('<br>')}</p>${total ? `<p class="hint">記得帳戶留 ${money(total)} 喔</p>` : ''}` });
}
const monthlyFixed = type => recurList().filter(it => it.active && it.type === type).reduce((a, b) => a + b.amount, 0);

function renderRecurCard() {
  const card = $('#recur-card'); if (!card) return;
  const list = recurList();
  const exp = monthlyFixed('expense'), inc = monthlyFixed('income');
  card.innerHTML = `<div class="card-head"><h2>固定收支</h2>${list.length ? `<span class="card-sub">每月固定支出 ${money(exp)}${inc ? ` · 收入 ${money(inc)}` : ''}</span>` : ''}</div>
    ${list.length ? `<div class="recur-list">${[...list].sort((a, b) => a.day - b.day).map(it => `<button class="recur-row${it.active ? '' : ' off'}" type="button" data-recur="${it.id}">
      <span class="rr-day">${it.day}<small>號</small></span><span class="rc-ico" aria-hidden="true">${categoryInfo(it.type, it.category).icon}</span>
      <span class="rc-txt"><span class="rc-note">${esc(it.note)}</span><span class="rc-meta">${esc(it.category)}${it.account ? ` · ${esc(it.account)}` : ''}${it.active ? '' : ' · 已暫停'}</span></span>
      <span class="amt${it.type === 'income' ? ' inc' : ''}">${signed(it)}</span></button>`).join('')}</div>` : '<p class="note" style="margin:0 0 10px">房租、訂閱、薪水設一次，每月自動記好，前一天還會提醒你。也可以直接在聊天打「每月 10 號 Netflix 390」。</p>'}
    <button class="btn ghost block" type="button" data-act="recur-add">＋ 新增固定收支</button>`;
}
async function editRecurring(id) {
  const it = id ? recurList().find(x => x.id === id) : null;
  let removed = false;
  const ok = await dialog({
    title: it ? '編輯固定收支' : '新增固定收支', ok: '儲存', cancel: '取消',
    extra: `<div class="field"><label for="rc-text">項目和金額</label><input class="input" id="rc-text" placeholder="例如：Netflix 390、薪水 +45000" value="${it ? esc(`${it.note} ${it.type === 'income' ? '+' : ''}${it.amount}${it.account ? ' ' + it.account : ''}`) : ''}"></div>
      <div class="field"><label for="rc-day">每月幾號</label><select class="input" id="rc-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${(it ? it.day : new Date().getDate()) === i + 1 ? ' selected' : ''}>${i + 1} 號${i + 1 >= 29 ? '（月份沒有這天就記在月底）' : ''}</option>`).join('')}</select></div>
      ${it ? `<div class="row"><button class="btn ghost sm grow" type="button" data-rc="toggle">${it.active ? '⏸ 暫停' : '▶️ 恢復'}</button><button class="btn danger sm grow" type="button" data-rc="del">刪除</button></div>` : ''}`,
    onOpen: (w, done) => {
      $$('[data-rc]', w).forEach(b => b.addEventListener('click', () => {
        removed = true;
        if (b.dataset.rc === 'del') { setRecur(recurList().filter(x => x.id !== id)); toast(`已刪除「${it.note}」，之前記好的不會動`, { icon: '🗑️' }); }
        else { setRecur(recurList().map(x => (x.id === id ? { ...x, active: !x.active } : x))); toast(it.active ? '已暫停，不會再自動記' : '已恢復', { icon: it.active ? '⏸' : '▶️' }); }
        done(false);
      }));
      setTimeout(() => $('#rc-text', w).focus(), 50);
    },
    onOk: w => {
      const r = parseSmart($('#rc-text', w).value.trim()).list;
      if (r.length !== 1) { toast('請寫成「項目 金額」，例如 Netflix 390', { icon: '✏️' }); return false; }
      const e = r[0], day = Number($('#rc-day', w).value);
      const base = { note: e.note, amount: e.amount, type: e.type, category: e.category, account: e.account || null, day };
      if (it) setRecur(recurList().map(x => (x.id === id ? { ...x, ...base, ...(day !== x.day ? { lastRun: null, since: todayISO() } : {}) } : x)));
      else setRecur([...recurList(), { id: newId(), ...base, active: true, since: todayISO() }]);
    },
  });
  if (ok && !removed) { haptic(12); toast(it ? '已更新固定收支' : '設定好了，之後每月自動記 🔁', { icon: '🔁' }); runRecurring(); }
}

// ---------- 匯率 ----------
async function askRate(cur) {
  const c = CURRENCIES[cur] || { sym: cur };
  const ok = await dialog({
    title: `設定 ${cur} 匯率`, ok: '儲存並記帳', cancel: '取消',
    body: `1 ${c.sym} 等於多少台幣？之後都會自動換算。`,
    extra: `<div class="money-input" style="padding:0 14px"><span style="font-size:18px">NT$</span><input id="fx-in" inputmode="decimal" placeholder="${cur === 'JPY' ? '0.21' : cur === 'USD' ? '32' : ''}" style="height:48px;font-size:24px" aria-label="匯率"></div>`,
    onOpen: w => setTimeout(() => $('#fx-in', w).focus(), 50),
    onOk: w => { const v = parseFloat($('#fx-in', w).value); if (!(v > 0)) return false; S.setSettings({ fxRates: { ...(S.getSettings().fxRates || {}), [cur]: v } }); },
  });
  if (ok) submit();
}

// ---------- 聊天畫面 ----------
function groups() {
  const map = new Map();
  for (const e of [...entries()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = e.msgId || e.id;
    if (!map.has(k)) map.set(k, { id: k, at: e.createdAt, raw: e.raw, items: [], sample: !!e.sample });
    map.get(k).items.push(e);
  }
  return [...map.values()];
}

function metaTags(e) {
  let h = '';
  if (e.bookId) h += `<span class="tag shared">👫 ${esc(e.mine === false ? (e.paidBy || '對方') : '我付')}</span>`;
  if (e.fx) h += `<span class="tag fx">${esc(fxLabel(e.fx))}</span>`;
  if (e.account) h += `<span class="tag acc">${accIcon(e.account)} ${esc(e.account)}</span>`;
  if (e.recurringId) h += '<span class="tag acc">🔁 固定</span>';
  for (const g of e.tags || []) h += `<span class="tag hash">#${esc(g)}</span>`;
  return h;
}
function rowHTML(e, showDateTag = true, createdDay = null) {
  const c = categoryInfo(e.type, e.category);
  const tag = showDateTag && e.date !== createdDay ? `<span class="tag">${relDay(e.date)}</span>` : '';
  return `<button class="rc-row${state.flash === e.id ? ' pop' : ''}" type="button" data-edit="${e.id}"><span class="rc-in">
    <span class="rc-ico" aria-hidden="true">${c.icon}</span>
    <span class="rc-txt"><span class="rc-note">${esc(e.note)}</span><span class="rc-meta">${e.note === e.category ? (e.type === 'income' ? '收入' : '支出') : esc(e.category)}${tag}${metaTags(e)}</span></span>
    <span class="amt${e.type === 'income' ? ' inc' : ''}">${signed(e)}</span></span></button>`;
}

function groupHTML(g, isLast) {
  const isFresh = state.fresh && state.fresh.msgId === g.id;
  const fresh = isFresh && !state.fresh.shown;
  const time = hhmm(g.at);
  const day = localDay(g.at);
  const net = g.items.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
  let h = '';
  if (g.raw) h += `<div class="msg-user${fresh ? ' enter' : ''}"><div class="bubble">${esc(g.raw)}</div><div class="msg-time">${time}</div></div>`;
  h += `<div class="msg-bot${fresh ? ' enter-late' : ''}"><div class="bot-ava" aria-hidden="true">記</div><div class="bot-col">
    <div class="receipt${fresh ? ' new' : ''}${g.sample ? ' sample' : ''}">
      <div class="rc-head"><span>收據 · ${time}</span></div>
      ${g.items.map(e => rowHTML(e, true, day)).join('')}
      ${g.items.length > 1 ? `<div class="rc-total"><span>合計 ${g.items.length} 筆</span><span class="amt">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</span></div>` : ''}
      ${isFresh ? '<span class="stamp" aria-hidden="true">已記帳</span>' : ''}
    </div>`;
  if (isFresh && state.fresh.cheer) {
    const c = state.fresh.cheer;
    h += `<div class="cheer${fresh ? ' enter-late' : ''}"><strong>${esc(c.main)}</strong>${isLast ? '<button class="undo" type="button" data-act="undo">撤銷</button>' : ''}${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}${c.badges ? `<span class="sub">🏅 解鎖徽章：${esc(c.badges.join('、'))} <button class="linkish" type="button" data-go="settings">去看看</button></span>` : ''}</div>`;
  }
  return h + '</div></div>';
}

function welcomeHTML() {
  return `<div class="msg-bot enter"><div class="bot-ava" aria-hidden="true">記</div><div class="bot-col"><div class="bot-text">
    <p><b>${greeting(S.getProfile().name)}</b> 我是你的記帳小幫手。</p>
    <p>直接打一句話就記好了，金額、日期、分類都交給我。點一個例子試試看：</p>
    <div class="ex">
      <button class="chip" type="button" data-try="午餐 120">🍜 午餐 120</button>
      <button class="chip" type="button" data-try="昨天 計程車 250">🚕 昨天 計程車 250</button>
      <button class="chip" type="button" data-try="薪水 +45000">💰 薪水 +45000</button>
      <button class="chip" type="button" data-try="早餐 60、咖啡 85">☕ 早餐 60、咖啡 85</button>
    </div>
    <p class="hint" style="margin-top:12px">想先看看圖表長怎樣？<button class="linkish" type="button" data-act="sample">載入範例資料</button></p>
  </div></div></div>`;
}

function botHTML(m) {
  const an = m.shown ? '' : ' enter';
  if (m.user) return `<div class="msg-user${an}"><div class="bubble">${esc(m.user)}</div><div class="msg-time">${hhmm(m.at)}</div></div>`;
  return `<div class="msg-bot${m.shown ? '' : ' enter-late'}"><div class="bot-ava" aria-hidden="true">記</div><div class="bot-col"><div class="bot-text">${m.html}</div></div></div>`;
}

function renderChat(forceBottom = false, smooth = false) {
  const view = $('#view-chat'), chat = $('#chat');
  const near = view.scrollHeight - view.scrollTop - view.clientHeight < 160;
  const gs = groups();
  const items = [...gs.map(g => ({ at: g.at, g })), ...state.ephemeral.map(m => ({ at: m.at, m }))].sort((a, b) => a.at.localeCompare(b.at));
  const visible = items.slice(-state.showCount);
  const lastG = [...visible].reverse().find(it => it.g);
  let h = '';
  if (items.length > visible.length) h += '<button class="load-more" type="button" data-act="more">顯示更早的紀錄</button>';
  if (!gs.length) h += welcomeHTML();
  let lastDay = null;
  for (const it of visible) {
    const day = localDay(it.at);
    if (day !== lastDay) { h += `<div class="day-sep">${dayTitle(day)}</div>`; lastDay = day; }
    h += it.g ? groupHTML(it.g, it === lastG) : botHTML(it.m);
  }
  if (S.hasSample()) h += '<div class="sample-banner"><span>📊 目前顯示的是範例資料</span><button type="button" data-act="clear-sample">清除範例</button></div>';
  chat.innerHTML = h;
  if (state.fresh) state.fresh.shown = true;
  state.ephemeral.forEach(m => { m.shown = true; });
  if (forceBottom || near) requestAnimationFrame(() => view.scrollTo({ top: view.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' }));
}

function botSay(html, userText) {
  const at = new Date();
  if (userText) state.ephemeral.push({ at: at.toISOString(), user: userText });
  state.ephemeral.push({ at: new Date(at.getTime() + 1).toISOString(), html });
  renderChat(true, true);
}

// ---------- 月份摘要列 ----------
function renderStrip() {
  const strip = $('#month-strip');
  const now = new Date();
  const list = thisMonth();
  const spent = sum(list, 'expense');
  const budget = S.getSettings().budget;
  const st = streak();
  let right = '', bar = '';
  if (budget > 0) {
    const pct = spent / budget;
    right = pct >= 1 ? `超出 ${money(spent - budget)}` : `預算剩 ${money(budget - spent)}`;
    bar = `<div class="minibar${pct >= 1 ? ' over' : pct >= 0.8 ? ' warn' : ''}"><i style="width:${Math.min(100, pct * 100)}%"></i></div>`;
  } else {
    const today = list.filter(e => e.date === todayISO());
    right = `今天 ${money(sum(today, 'expense'))}`;
  }
  const prevStreak = Number(strip.dataset.streak || 0);
  const from = stripPrev ?? spent;
  strip.innerHTML = `<div class="ms-main"><div class="ms-row"><span class="left">${now.getMonth() + 1}月支出 <b class="num" id="ms-spent" data-v="${from}">${money(from)}</b></span><span>${right}</span></div>${bar}</div>
    ${activeTrip() ? `<span class="trip-badge" title="旅行模式">✈️ ${esc(activeTrip().name)}</span>` : ''}${st > 0 ? `<span class="streak${st > prevStreak && prevStreak > 0 ? ' pop' : ''}" title="連續記帳天數">🔥 ${st} 天</span>` : ''}`;
  strip.dataset.streak = st;
  countUp($('#ms-spent'), spent, money, 600);
  stripPrev = spent;
}
let stripPrev = null;

// ---------- 同步狀態 ----------
const ICON = {
  device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z"/><path d="m9.5 13 2 2 3.5-3.5"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 2.2-.9M13 6.2a6 6 0 0 1 4.9 4.4A3.8 3.8 0 0 1 19.7 17"/><path d="m3 3 18 18"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};
function renderPill() {
  const p = $('#sync-pill');
  const c = S.cloud, st = c.status;
  // 分級：只有真的需要你處理（登入過期、資料表沒建）才用紅色；網路問題是灰色，會自己重試
  let cls = '', ic = ICON.device, txt = '本機';
  if (st === 'signedout') [ic, txt] = [ICON.user, '未登入'];
  else if (st === 'idle') [cls, ic, txt] = ['ok', ICON.cloud, '已同步'];
  else if (st === 'syncing') [cls, ic, txt] = ['spin', ICON.sync, '同步中'];
  else if (st === 'offline') [cls, ic, txt] = ['muted', ICON.offline, '離線'];
  else if (st === 'error') {
    if (c.errorKind === 'network') [cls, ic, txt] = ['muted', ICON.offline, c.user ? '稍後同步' : '離線'];
    else if (c.errorKind === 'auth') [cls, ic, txt] = ['err', ICON.user, '請重新登入'];
    else if (c.errorKind === 'setup') [cls, ic, txt] = ['err', ICON.warn, '需要設定'];
    else [cls, ic, txt] = ['warn', ICON.warn, '同步暫停'];
  }
  p.className = 'sync-pill ' + cls;
  p.innerHTML = ic + `<span>${txt}</span>`;
}

async function syncSheet() {
  const c = S.cloud, st = c.status, cfg = S.getCloudConfig();
  const pending = entries().filter(e => e._dirty && !e.sample).length;
  const last = c.lastSync ? `上次同步：${relDay(toISO(c.lastSync))} ${hhmm(c.lastSync.toISOString())}` : '';
  let title, body, ok = '好', act = null;
  if (!cfg) { title = '資料存在這台裝置'; body = '目前沒有開啟雲端同步。開啟後換手機、用電腦都看得到同一份帳。'; ok = '去開啟'; act = 'cloud'; }
  else if (!c.user && st !== 'error') { title = '還沒登入'; body = '登入一次，之後每筆都會自動同步到雲端。'; ok = '去登入'; act = 'cloud'; }
  else if (st === 'idle') { title = '都同步好了 ☁️'; body = `${last || '每次記帳都會自動同步'}`; ok = '立即同步'; act = 'sync'; }
  else if (st === 'syncing') { title = '同步中…'; body = '馬上就好。'; }
  else if (st === 'offline' || c.errorKind === 'network') {
    title = '目前離線'; body = `${pending ? `有 ${pending} 筆還沒上傳，` : ''}資料都安全存在這台裝置，連上網路後會自動同步。${last ? `<br><small>${last}</small>` : ''}`; ok = '再試一次'; act = 'retry';
  } else if (c.errorKind === 'auth') { title = '登入過期了'; body = '重新登入一次就好，這段時間記的帳都還在。'; ok = '重新登入'; act = 'signin'; }
  else { title = c.errorKind === 'setup' ? '雲端還差一步' : '同步暫停'; body = `${esc(c.error || '同步時發生問題')}${pending ? `<br>有 ${pending} 筆還沒上傳，資料都還在這台裝置。` : ''}`; ok = '再試一次'; act = 'retry'; }
  const go = await dialog({ title, body, ok, cancel: act ? '關閉' : '', extra: act && act !== 'cloud' ? '<p style="margin:-4px 0 12px"><button class="linkish" type="button" data-go-cloud>查看雲端設定</button></p>' : '',
    onOpen: (w, done) => { const l = $('[data-go-cloud]', w); if (l) l.addEventListener('click', () => { done(false); setView('settings'); setTimeout(() => $('#cloud-card').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }); } });
  if (!go || !act) return;
  if (act === 'cloud') { setView('settings'); setTimeout(() => { const card = $('#cloud-card'); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); const d = $('details', card); if (d && !cfg) d.open = true; }, 80); }
  else if (act === 'signin') { try { await S.signIn(); } catch (err) { toast('登入失敗：' + (err.message || err), { icon: '⚠️', duration: 5000 }); } }
  else { if (!S.cloud.client) await S.initCloud(); else await S.sync(); if (S.cloud.status === 'idle') { haptic(12); toast('同步完成 ☁️'); } else toast('還是連不上，等等會自動再試', { icon: '🕒' }); }
}

// ---------- 輸入列 ----------
const input = $('#msg'), sendBtn = $('#send'), preview = $('#preview');
const COMMANDS = [
  [/^(幫助|說明|help|\?|？|怎麼用|教學|指令)$/i, () => helpReply()],
  [/^(復原|撤銷|收回|undo)/i, () => undoLast(true)],
  [/^(嗨|哈囉|hi|hello|hey|你好|安安)/i, () => helpReply(true)],
  [/(這週|本週|這禮拜|這星期)/, () => summary('week')],
  [/(上個月|上月)/, () => summary('lastmonth')],
  [/(本月|這個月|這月)/, () => summary('month')],
  [/(今天|今日)/, () => summary('day')],
  [/(花多少|花了多少|總共|統計)/, () => summary('month')],
];
const matchCommand = t => COMMANDS.find(([re]) => re.test(t));

function updatePreview() {
  const t = input.value.trim();
  sendBtn.disabled = !t;
  preview.className = 'preview';
  // 沒在打字：顯示快捷鍵；打字中：快捷鍵收起來，換成即時預覽（輸入區永遠只有兩列）
  $('#composer').classList.toggle('typing', !!t);
  if (!t) { preview.innerHTML = ''; return; }
  const q = askQuery(t) || recurringCmd(t);
  const sm = q ? { list: [] } : parseSmart(t);
  const r = sm.list;
  if (sm.missingRate) { preview.className = 'preview ok'; preview.innerHTML = `<span>💱 送出後設定 ${esc(sm.cur)} 匯率</span>`; return; }
  if (r.length === 1) {
    const e = r[0], c = categoryInfo(e.type, e.category);
    preview.className = 'preview ok';
    const extra = [e.fx ? fxLabel(e.fx) : '', e.account || '', ...(e.tags || []).map(g => '#' + g), e.bookId ? '👫 共同' : ''].filter(Boolean).map(x => `<span class="pv-x">${esc(x)}</span>`).join('');
    preview.innerHTML = `<span class="pv-chip${e.type === 'income' ? ' inc' : ''}">${c.icon} ${esc(e.category)} · ${esc(e.note)} · ${relDay(e.date)} <b>${signed(e)}</b></span>${extra}`;
  } else if (r.length > 1) {
    const net = r.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
    preview.className = 'preview ok';
    preview.innerHTML = `<span class="pv-chip">${r.map(e => categoryInfo(e.type, e.category).icon).join('')} ${r.length} 筆 · 合計 <b>${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</b></span>`;
  } else if (q && q.recurring) {
    preview.className = 'preview ok';
    preview.innerHTML = `<span class="pv-chip">🔁 每月 ${q.day} 號 · ${esc(q.item.note)} <b>${signed(q.item)}</b></span>`;
  } else if (q) {
    preview.innerHTML = `<span>🔎 按送出，幫你查「${esc(q.kw)}」</span>`;
  } else if (matchCommand(t)) {
    preview.innerHTML = '<span>💬 按送出，我來幫你查</span>';
  } else {
    preview.innerHTML = '<span>還差金額喔，例如「午餐 120」</span>';
  }
}

// 快捷鍵：記住每個項目上次的金額，點一下直接記；並依現在的時段排序
const SLOT_DEFAULTS = {
  morning: [['🍳', '早餐'], ['☕', '咖啡'], ['🚇', '捷運']],
  noon: [['🍱', '午餐'], ['🧋', '飲料'], ['☕', '咖啡']],
  afternoon: [['🧋', '飲料'], ['🍰', '點心'], ['🛒', '全聯']],
  evening: [['🍲', '晚餐'], ['🛒', '全聯'], ['🚕', '計程車']],
  night: [['🍜', '宵夜'], ['🛍️', '蝦皮'], ['🚕', '計程車']],
};
const NOTE_ICON = { 早餐: '🍳', 早午餐: '🥞', 午餐: '🍱', 晚餐: '🍲', 宵夜: '🍜', 飲料: '🧋', 咖啡: '☕', 點心: '🍰', 捷運: '🚇', 公車: '🚌', 計程車: '🚕', 加油: '⛽', 全聯: '🛒', 蝦皮: '🛍️', 聚餐: '🍻' };
const slotOfHour = h => (h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 14 ? 'noon' : h >= 14 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night');
function quickChips() {
  const since = toISO(new Date(Date.now() - 60 * 864e5));
  const nowH = new Date().getHours();
  const near = h => Math.min(Math.abs(h - nowH), 24 - Math.abs(h - nowH)) <= 2;
  const cnt = new Map();
  const list = entries().filter(e => e.date >= since && !e.sample && e.note.length <= 8).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of list) {
    const k = e.type + '|' + e.note;
    const v = cnt.get(k) || { n: 0, score: 0, e };
    v.n++; v.score += 1 + (near(new Date(e.createdAt).getHours()) ? 3 : 0); v.e = e; // 留最新一筆，金額才會是「上次」的
    cnt.set(k, v);
  }
  const top = [...cnt.values()].filter(v => v.n >= 2 || near(new Date(v.e.createdAt).getHours()))
    .sort((a, b) => b.score - a.score).slice(0, 7)
    .map(v => ({ icon: NOTE_ICON[v.e.note] || categoryInfo(v.e.type, v.e.category).icon, note: v.e.note, amount: v.e.amount, income: v.e.type === 'income' }));
  const defs = [...SLOT_DEFAULTS[slotOfHour(nowH)], ['🍱', '午餐'], ['🍲', '晚餐'], ['🍳', '早餐'], ['🧋', '飲料'], ['🚇', '捷運'], ['🛒', '全聯'], ['🚕', '計程車']];
  for (const [icon, note] of defs) if (top.length < 7 && !top.some(t => t.note === note)) top.push({ icon, note });
  const shared = S.getBook() ? `<button class="chip shared-chip${state.sharedMode ? ' on' : ''}" type="button" data-act="shared-toggle" aria-pressed="${state.sharedMode ? 'true' : 'false'}">👫 ${state.sharedMode ? '記到共同' : '共同'}</button>` : '';
  $('#quick-chips').innerHTML = shared + top.map(t => {
    const text = t.amount ? `${t.note} ${t.income ? '+' : ''}${t.amount}` : t.note;
    return `<button class="chip${t.amount ? ' quick' : ''}" type="button" data-chip="${esc(t.note)}"${t.amount ? ` data-quick="${esc(text)}" aria-label="直接記 ${esc(text)}，長按可修改"` : ''}>${t.icon} ${esc(t.note)}${t.amount ? ` <span class="c-amt">${money(t.amount)}</span>` : ''}</button>`;
  }).join('');
}

function insertChip(word) {
  const v = input.value.trim();
  input.value = !v ? word + ' ' : `${word} ${v}`;
  input.focus();
  const L = input.value.length; input.setSelectionRange(L, L);
  haptic(6); updatePreview();
}
// 點一下：用上次金額直接記；長按：只帶文字讓你改金額
let chipPress = null;
$('#quick-chips').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-quick]'); if (!b) return;
  clearTimeout(chipPress?.t);
  chipPress = { b, long: false, t: setTimeout(() => { chipPress.long = true; haptic(14); input.value = b.dataset.quick; input.focus(); const L = input.value.length; input.setSelectionRange(L, L); updatePreview(); }, 480) };
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#quick-chips').addEventListener(ev, () => { if (chipPress) clearTimeout(chipPress.t); }));
$('#quick-chips').addEventListener('contextmenu', e => { if (e.target.closest('[data-quick]')) e.preventDefault(); });
$('#quick-chips').addEventListener('click', e => {
  const b = e.target.closest('[data-chip]'); if (!b) return;
  if (b.dataset.quick) {
    if (chipPress && chipPress.b === b && chipPress.long) { chipPress = null; return; }
    if (input.value.trim()) { insertChip(b.dataset.chip); return; } // 已經在打字就只補上名稱
    // 防誤觸：同一顆 1.5 秒內只算一次；記好後收據下方就有「撤銷」
    if (state.lastChip && state.lastChip.text === b.dataset.quick && Date.now() - state.lastChip.t < 1500) return;
    state.lastChip = { text: b.dataset.quick, t: Date.now() };
    input.value = b.dataset.quick; input.dataset.last = b.dataset.quick; state.viaChip = true; submit(); return;
  }
  insertChip(b.dataset.chip);
});

function submit() {
  const text = input.value.trim();
  if (!text) return;
  const q = askQuery(text);
  if (q) { input.value = ''; updatePreview(); haptic(8); answerQuery(q); return; }
  const rc = recurringCmd(text);
  if (rc) { input.value = ''; updatePreview(); addRecurringFromChat(rc, text); return; }
  const smart = parseSmart(text);
  const parsed = smart.list;
  if (smart.missingRate) { askRate(smart.cur); return; }
  if (parsed.length) {
    const before = snapshot();
    const added = S.addEntries(parsed, text);
    const cheer = buildCheer(added, before);
    if (state.viaChip && !cheer.celebrate && added.length === 1) cheer.main = `用上次的金額記好「${added[0].note}」${money(added[0].amount)}，不對就按撤銷`;
    state.viaChip = false;
    // 第二筆起（第一筆留給慶祝），示範一次滑動手勢
    const realCount = entries().filter(e => !e.sample).length;
    const showSwipeHint = !cheer.celebrate && realCount >= 2 && !S.getSettings().swipeHint && 'ontouchstart' in window;
    if (showSwipeHint) { cheer.sub = '💡 小技巧：收據往左滑刪除、往右滑編輯'; S.setSettings({ swipeHint: true }); }
    const freshBadges = checkBadges();
    if (freshBadges.length) { cheer.badges = freshBadges.map(b => `${b.icon} ${b.name}`); cheer.celebrate = 'big'; }
    state.fresh = { msgId: added[0].msgId, cheer };
    input.value = '';
    updatePreview();
    sendBtn.classList.remove('fly'); void sendBtn.offsetWidth; sendBtn.classList.add('fly');
    renderChat(true, true);
    if (showSwipeHint) setTimeout(() => { const r = $(`#chat .rc-row[data-edit="${added[added.length - 1].id}"]`); if (r) { r.classList.add('hint-swipe'); setTimeout(() => r.classList.remove('hint-swipe'), 1900); } }, 1100);
    if (cheer.celebrate === 'big') { haptic([18, 50, 18]); setTimeout(() => celebrate({ count: 130 }), 350); }
    else if (cheer.celebrate === 'coins') {
      haptic([12, 40, 12]);
      const cs = getComputedStyle(document.documentElement);
      setTimeout(() => celebrate({ count: 70, colors: [cs.getPropertyValue('--gold').trim(), '#ffd84d', cs.getPropertyValue('--accent').trim()] }), 350);
    } else haptic(15);
    quickChips();
    return;
  }
  const cmd = matchCommand(text);
  if (cmd) { input.value = ''; updatePreview(); haptic(8); cmd[1](text); return; }
  // 沒有金額
  haptic([10, 40, 10]);
  const row = $('.inputrow');
  row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
  preview.className = 'preview ok';
  const word = text.replace(/\s+/g, ' ').slice(0, 10);
  preview.innerHTML = `<span>「${esc(word)}」花了多少呢？在後面補上金額就好 🙂</span>`;
  if (!input.value.endsWith(' ')) input.value += ' ';
  input.focus();
}

function helpReply(hello = false) {
  const userText = input.dataset.last || null;
  botSay(`${hello ? `<p><b>${greeting(S.getProfile().name)}</b> 有什麼要記的嗎？</p>` : ''}
    <p>這些寫法我都看得懂：</p>
    <div class="ex">
      <button class="chip" type="button" data-try="午餐 120">午餐 120</button>
      <button class="chip" type="button" data-try="昨天 計程車 250">昨天 計程車 250</button>
      <button class="chip" type="button" data-try="週五 聚餐 800">週五 聚餐 800</button>
      <button class="chip" type="button" data-try="薪水 +45000">薪水 +45000</button>
      <button class="chip" type="button" data-try="早餐 60、咖啡 85">早餐 60、咖啡 85</button>
    </div>
    <p class="hint" style="margin-top:10px">也可以問我「今天花多少」「本月」，或說「復原」收回上一筆。</p>`, userText);
}

function summary(kind) {
  const userText = input.dataset.last;
  const now = new Date();
  let from, to, label;
  const t = todayISO();
  if (kind === 'day') { from = to = t; label = '今天'; }
  else if (kind === 'week') {
    const m = new Date(now); m.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    from = toISO(m); to = t; label = '這週';
  } else if (kind === 'lastmonth') {
    const a = new Date(now.getFullYear(), now.getMonth() - 1, 1), b = new Date(now.getFullYear(), now.getMonth(), 0);
    from = toISO(a); to = toISO(b); label = `${a.getMonth() + 1}月`;
  } else { from = toISO(new Date(now.getFullYear(), now.getMonth(), 1)); to = t; label = '本月'; }
  const list = entries().filter(e => e.date >= from && e.date <= to);
  const exp = sum(list, 'expense'), inc = sum(list, 'income');
  const byCat = {};
  list.filter(e => e.type === 'expense').forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  let h = `<p><b>${label}</b>支出 <b>${money(exp)}</b>（${list.filter(e => e.type === 'expense').length} 筆）${inc ? `，收入 <b>${money(inc)}</b>` : ''}</p>`;
  if (!exp && kind === 'day') h += '<p>今天還沒有花錢，無支出日 🌱 很讚！</p>';
  else if (top) h += `<p>花最多的是 ${categoryInfo('expense', top[0]).icon} ${esc(top[0])} ${money(top[1])}</p>`;
  const budget = S.getSettings().budget;
  if (budget > 0 && (kind === 'month' || kind === 'day' || kind === 'week')) h += `<p class="hint">${budgetLine(sum(thisMonth(), 'expense'), budget)}</p>`;
  h += `<p class="hint" style="margin-top:8px"><button class="linkish" type="button" data-go="stats">看圖表 →</button></p>`;
  botSay(h, userText);
}

// ---------- 搜尋 ----------
const PERIOD_WORDS = [['今天', 'day'], ['今日', 'day'], ['這週', 'week'], ['本週', 'week'], ['這禮拜', 'week'], ['這星期', 'week'],
  ['上個月', 'lastmonth'], ['上月', 'lastmonth'], ['這個月', 'month'], ['本月', 'month'], ['這月', 'month'], ['今年', 'year'], ['全部', 'all'], ['總共', 'all']];
function periodRange(kind) {
  const now = new Date(), t = todayISO();
  if (kind === 'day') return [t, t, '今天'];
  if (kind === 'week') { const m = new Date(now); m.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return [toISO(m), t, '這週']; }
  if (kind === 'lastmonth') { const a = new Date(now.getFullYear(), now.getMonth() - 1, 1), b = new Date(now.getFullYear(), now.getMonth(), 0); return [toISO(a), toISO(b), `${a.getMonth() + 1}月`]; }
  if (kind === 'year') return [`${now.getFullYear()}-01-01`, t, '今年'];
  if (kind === 'all') return ['0000-00-00', '9999-99-99', '全部'];
  return [toISO(new Date(now.getFullYear(), now.getMonth(), 1)), t, '本月'];
}
// 「這個月咖啡花多少」「上次修車多少」→ { kw, period, last }
function askQuery(t) {
  if (!/(花了?多少|多少錢|花費|多少$|幾筆|幾次)/.test(t)) return null;
  let rest = t, period = null;
  const last = /上次|上一次|最近一次/.test(rest);
  rest = rest.replace(/上一次|最近一次|上次/g, ' ');
  for (const [w, k] of PERIOD_WORDS) if (rest.includes(w)) { period = period || k; rest = rest.split(w).join(' '); }
  const kw = rest.replace(/(我|總共|一共|共|在|的|了|花了?多少錢?|多少錢|花費|多少|幾筆|幾次|呢|啊|嗎|[?？!！,，。\s])/g, ' ').trim().split(/\s+/).filter(Boolean).join(' ');
  if (!kw) return null;
  return { kw, period, last };
}
// 口語說法對應到分類或常見項目：「吃飯」找得到午餐、晚餐，「搭車」找得到捷運、計程車
const SYNONYMS = {
  吃飯: ['餐飲'], 吃: ['餐飲'], 吃的: ['餐飲'], 伙食: ['餐飲'], 餐費: ['餐飲'], 外食: ['餐飲'],
  喝: ['飲料', '咖啡', '手搖', '奶茶', '珍奶', '茶'], 喝的: ['飲料', '咖啡', '手搖', '奶茶', '珍奶', '茶'], 手搖: ['飲料', '奶茶', '珍奶', '手搖'],
  搭車: ['交通'], 坐車: ['交通'], 車錢: ['交通'], 車費: ['交通'], 通勤: ['交通', '捷運', '公車'],
  買東西: ['購物'], 網購: ['蝦皮', 'momo', '網購', '淘寶', 'pchome'], 衣服: ['衣服', '褲', '裙', '外套', 'uniqlo'],
  玩: ['娛樂'], 看病: ['醫療'], 生病: ['醫療'], 繳費: ['帳單'], 帳單: ['帳單'], 房子: ['居家', '房租'],
  約會: ['#約會'], 禮物: ['社交', '禮物'], 寵物: ['寵物'], 上課: ['教育'], 學習: ['教育'],
};
const termHit = (e, t) => e.note.toLowerCase().includes(t) || e.category.toLowerCase().includes(t) || (e.raw || '').toLowerCase().includes(t)
  || (e.account || '').toLowerCase().includes(t) || (e.tags || []).some(g => ('#' + g).toLowerCase().includes(t));
function matchEntries(q, list = entries()) {
  const raw = q.trim().toLowerCase();
  if (!raw) return [];
  const terms = raw.split(/\s+/);
  return list.filter(e => terms.every(term => {
    const cmp = term.match(/^([<>]=?)(\d+(?:\.\d+)?)$/);
    if (cmp) { const v = Number(cmp[2]); return cmp[1] === '>' ? e.amount > v : cmp[1] === '>=' ? e.amount >= v : cmp[1] === '<' ? e.amount < v : e.amount <= v; }
    if (/^\d+(?:\.\d+)?$/.test(term)) return e.amount === Number(term) || e.note.toLowerCase().includes(term);
    if (term === '收入') return e.type === 'income';
    if (term === '支出') return e.type === 'expense';
    return termHit(e, term) || (SYNONYMS[term] || []).some(x => termHit(e, x.toLowerCase()));
  }));
}
function answerQuery(q) {
  const userText = input.dataset.last;
  const all = matchEntries(q.kw).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const more = `<p class="hint" style="margin-top:8px"><button class="linkish" type="button" data-search="${esc(q.kw)}">看全部「${esc(q.kw)}」明細 →</button></p>`;
  if (!all.length) { botSay(`<p>找不到「${esc(q.kw)}」的紀錄耶 🤔</p><p class="hint">試試其他關鍵字，或用分類名稱，例如「餐飲」「交通」。</p>`, userText); return; }
  if (q.last) {
    // 「上次」指的是之前那一次：剛剛（10 分鐘內）才記的不算
    const recent = Date.now() - 10 * 60e3;
    const prev = all.filter(x => Date.parse(x.createdAt) < recent);
    const e = prev[0] || all[0];
    botSay(`<p>上次「${esc(e.note)}」是 <b>${relDay(e.date)}</b>，${e.type === 'income' ? '收入' : '花了'} <b>${money(e.amount)}</b></p>${all.length > 1 ? `<p class="hint">總共記過 ${all.length} 次，平均 ${money(Math.round(all.reduce((s, x) => s + x.amount, 0) / all.length))}</p>` : ''}${more}`, userText);
    return;
  }
  let [from, to, label] = periodRange(q.period || 'month');
  let list = all.filter(e => e.date >= from && e.date <= to);
  let fallback = '';
  if (!list.length && !q.period) { [from, to, label] = periodRange('all'); list = all; fallback = '本月還沒有，'; }
  if (!list.length) { botSay(`<p>${label}沒有「${esc(q.kw)}」的紀錄 🌱</p>${more}`, userText); return; }
  const exp = sum(list, 'expense'), inc = sum(list, 'income');
  const n = list.length;
  const avg = Math.round((exp || inc) / n);
  botSay(`<p>${fallback}${label}「${esc(q.kw)}」${exp ? `花了 <b>${money(exp)}</b>` : ''}${exp && inc ? '，' : ''}${inc ? `收入 <b>${money(inc)}</b>` : ''}（${n} 筆）</p>
    ${n > 1 ? `<p class="hint">平均每筆 ${money(avg)} · 最近一次 ${relDay(list[0].date)} ${money(list[0].amount)}</p>` : ''}${more}`, userText);
}

function undoLast(fromChat = false) {
  const gs = groups().filter(g => !g.sample);
  const g = gs[gs.length - 1];
  const userText = fromChat ? input.dataset.last : null;
  if (!g) { if (fromChat) botSay('<p>目前沒有可以收回的紀錄喔。</p>', userText); return; }
  const copy = g.items.map(e => ({ ...e }));
  S.deleteEntries(g.items.map(e => e.id));
  if (state.fresh?.msgId === g.id) state.fresh = null;
  haptic(10);
  if (fromChat) botSay(`<p>已收回「${esc(g.raw || g.items[0].note)}」✓</p>`, userText);
  else renderChat();
  toast(`已收回 ${g.items.length} 筆`, { icon: '↩️', action: '還原', onAction: () => { S.restoreEntries(copy); toast('已還原 ✓'); } });
  quickChips();
}

// ---------- 編輯 ----------
const sheet = $('#sheet'), backdrop = $('#sheet-backdrop'), form = $('#edit-form');
function renderCats(type, selected) {
  $('#e-cats').innerHTML = CATEGORIES[type].map(c => `<button type="button" class="cat${c.name === selected ? ' on' : ''}" data-cat="${c.name}"><span>${c.icon}</span>${c.name}</button>`).join('');
}
function openEdit(id) {
  const e = S.getEntry(id); if (!e) return;
  state.editing = { id, type: e.type, category: e.category, orig: { ...e } };
  $$('#e-type button').forEach(b => b.classList.toggle('on', b.dataset.t === e.type));
  $('#e-amount').value = e.amount; $('#e-calc').textContent = ''; showKeypad(false);
  renderCats(e.type, e.category);
  $('#e-date').value = e.date;
  $('#e-note').value = e.note;
  $('#e-raw').textContent = (e.raw ? `原始訊息：「${e.raw}」 · ` : '') + `記於 ${localDay(e.createdAt).replace(/-/g, '/')} ${hhmm(e.createdAt)}` + (e.fx ? ` · 原幣 ${fxLabel(e.fx)}` : '') + (e.mine === false ? ` · ${e.paidBy || '對方'}記的` : '');
  state.editing.account = e.account || null;
  state.editing.bookId = e.bookId || null;
  renderEditExtras(e);
  sheet.style.transform = '';
  sheet.classList.add('show'); backdrop.classList.add('show'); document.documentElement.classList.add('sheet-open');
  sheet.scrollTop = 0;
  haptic(6);
}
function renderEditExtras(e) {
  const ed = state.editing;
  const accs = [...new Set([...accountList(), ...(e.account ? [e.account] : [])])];
  const book = S.getBook();
  $('#e-extra').innerHTML = `<span class="lbl">付款方式</span><div class="acc-chips" id="e-accs">${accs.map(a => `<button type="button" class="chip${ed.account === a ? ' on' : ''}" data-eacc="${esc(a)}">${accIcon(a)} ${esc(a)}</button>`).join('')}</div>
    <label for="e-tags" class="lbl" style="margin-top:6px">標籤</label><input class="input" id="e-tags" placeholder="例如：約會 日本（空格分開）" value="${esc((e.tags || []).join(' '))}">
    ${book && e.mine !== false ? `<label class="switch-row"><span>👫 記在共同帳本「${esc(book.name)}」</span><input type="checkbox" id="e-shared"${ed.bookId ? ' checked' : ''}></label>` : ''}`;
  $('#e-accs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-eacc]'); if (!b) return;
    ed.account = ed.account === b.dataset.eacc ? null : b.dataset.eacc;
    $$('#e-accs .chip').forEach(x => x.classList.toggle('on', x.dataset.eacc === ed.account)); haptic(5);
  });
  const sh = $('#e-shared');
  if (sh) sh.addEventListener('change', () => { ed.bookId = sh.checked ? book.id : null; haptic(6); });
}
function closeEdit() { showKeypad(false); document.documentElement.classList.remove('sheet-open'); sheet.classList.remove('show'); backdrop.classList.remove('show'); state.editing = null; sheet.style.transform = ''; }

$('#e-type').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b || !state.editing) return;
  const t = b.dataset.t; if (t === state.editing.type) return;
  state.editing.type = t;
  $$('#e-type button').forEach(x => x.classList.toggle('on', x === b));
  if (!CATEGORIES[t].some(c => c.name === state.editing.category)) state.editing.category = t === 'income' ? '其他收入' : '其他';
  renderCats(t, state.editing.category); haptic(6);
});
$('#e-cats').addEventListener('click', ev => {
  const b = ev.target.closest('.cat'); if (!b || !state.editing) return;
  state.editing.category = b.dataset.cat;
  $$('#e-cats .cat').forEach(x => x.classList.toggle('on', x === b)); haptic(6);
});
$$('[data-d]', form).forEach(b => b.addEventListener('click', () => {
  const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.d)); $('#e-date').value = toISO(d); haptic(6);
}));
form.addEventListener('submit', ev => {
  ev.preventDefault();
  const ed = state.editing; if (!ed) return;
  const raw = $('#e-amount').value.trim();
  const amount = evalAmount(raw);
  if (!(amount > 0)) {
    const m = $('.money-input', form); m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake');
    haptic([10, 40, 10]); $('#e-amount').focus(); return;
  }
  const date = $('#e-date').value || ed.orig.date;
  const note = $('#e-note').value.trim() || ed.category;
  const tags = ($('#e-tags').value || '').split(/[\s,，、#＃]+/).map(x => x.trim()).filter(Boolean);
  const patch = { type: ed.type, category: ed.category, amount, date, note, account: ed.account || null, tags: tags.length ? tags : null };
  if (ed.orig.mine !== false) { patch.bookId = ed.bookId || null; if (ed.bookId && !ed.orig.bookId) { const me = (S.getBook()?.members || []).find(m => m.me); patch.paidBy = me ? me.name : ''; } }
  if (ed.orig.fx && amount !== ed.orig.amount) patch.fx = null; // 改了台幣金額，原幣就不準了
  S.updateEntry(ed.id, patch);
  let msg = '已更新 ✓';
  if (ed.category !== ed.orig.category || ed.type !== ed.orig.type) {
    S.learn(note, ed.type, ed.category);
    msg = `已更新！下次「${note}」會自動分到 ${categoryInfo(ed.type, ed.category).icon} ${ed.category}`;
  }
  state.flash = ed.id;
  closeEdit();
  haptic(12);
  toast(msg, { icon: '✨' });
  celebrateBadges(checkBadges(), 1500);
  setTimeout(() => { state.flash = null; }, 800);
});
$('#e-del').addEventListener('click', () => {
  const ed = state.editing; if (!ed) return;
  closeEdit(); deleteWithUndo(ed.id);
});
$('#sheet-close').addEventListener('click', closeEdit);
backdrop.addEventListener('click', () => { if (state.editing) closeEdit(); closeProfile(false); });
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (state.editing) closeEdit(); closeProfile(false); });
// 下滑關閉
function enableSwipe(sh, onClose) {
  let y0 = null, dy = 0;
  const start = e => { if (sh.scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; };
  const move = e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translate(-50%, ${dy}px)`; };
  const end = () => { if (y0 == null) return; sh.style.transition = ''; y0 = null; if (dy > 90) onClose(); else sh.style.transform = ''; };
  [$('.grab', sh), $('.sheet-head', sh)].forEach(el => {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
  });
}
enableSwipe(sheet, closeEdit);

// ---------- 金額鍵盤：大按鍵、可以直接算 120+85 ----------
function evalAmount(str) {
  const t = String(str).replace(/[,\s$]/g, '').replace(/[−–]/g, '-').replace(/[x×*]/g, '*');
  if (!t) return NaN;
  if (!/^[\d.+\-*]+$/.test(t)) { const a = extractAmount(str); return a ? a.amount : NaN; }
  const parts = t.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== t) return NaN;
  let total = 0;
  for (const p of parts) {
    const sign = p[0] === '-' ? -1 : 1;
    const f = p.replace(/^[+-]/, '').split('*').map(Number);
    if (f.some(n => !isFinite(n))) return NaN;
    total += sign * f.reduce((a, b) => a * b, 1);
  }
  return Math.round(total * 100) / 100;
}
const amt = $('#e-amount'), keypad = $('#keypad');
const coarse = matchMedia('(pointer: coarse)').matches;
if (!coarse) amt.setAttribute('inputmode', 'decimal'); // 桌機用實體鍵盤打，不用自訂鍵盤
function updateCalc() {
  const v = amt.value, r = evalAmount(v);
  $('#e-calc').textContent = /[+\-−×*]/.test(v.replace(/^[−-]/, '')) && isFinite(r) ? `= ${money(r)}` : '';
}
function showKeypad(on) { if (!coarse) return; keypad.hidden = !on; $('#e-money').classList.toggle('active', on); }
amt.addEventListener('focus', () => showKeypad(true));
amt.addEventListener('input', updateCalc);
keypad.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); }); // 保持焦點在金額
keypad.addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const k = b.dataset.k; let v = amt.value;
  haptic(5);
  if (k === 'done') { const r = evalAmount(v); if (isFinite(r) && r > 0) amt.value = String(r); updateCalc(); showKeypad(false); amt.blur(); return; }
  if (k === 'back') v = v.slice(0, -1);
  else if (k === '+' || k === '−') { if (!v) return; v = /[+−-]$/.test(v) ? v.slice(0, -1) + k : v + k; }
  else if (k === '.') { const seg = v.split(/[+−-]/).pop(); if (seg.includes('.')) return; v += seg ? '.' : '0.'; }
  else { const seg = v.split(/[+−-]/).pop(); if (seg === '0') v = v.slice(0, -1); if (seg.replace('.', '').length >= 9) return; v += k; }
  amt.value = v; updateCalc();
});
document.addEventListener('pointerdown', e => { if (!keypad.hidden && !e.target.closest('#keypad, #e-money')) showKeypad(false); });

// ---------- 左滑刪除、右滑編輯（收據與明細的每一列） ----------
function deleteWithUndo(id) {
  const copy = { ...S.getEntry(id) };
  if (!copy.id) return;
  S.deleteEntries([id]);
  if (state.fresh && !groups().some(g => g.id === state.fresh.msgId)) state.fresh = null;
  haptic([10, 30, 10]);
  toast(`已刪除「${copy.note}」`, { icon: '🗑️', action: '復原', onAction: () => { S.restoreEntries([copy]); toast('已復原 ✓'); } });
  quickChips();
}
(() => {
  let sw = null, suppressClick = false;
  const TH = 84;
  const reset = row => { row.classList.remove('swiping', 'arm-del', 'arm-edit', 'to-left', 'to-right'); row.style.removeProperty('--dx'); row.style.removeProperty('--p'); };
  document.addEventListener('touchstart', e => {
    const row = e.target.closest('.rc-row[data-edit]');
    if (!row || e.touches.length > 1) { sw = null; return; }
    sw = { row, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, dir: null };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x0, dy = t.clientY - sw.y0;
    if (!sw.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
      if (sw.dir === 'h') { sw.row.classList.add('swiping'); sw.row.style.transition = 'none'; }
    }
    if (sw.dir !== 'h') return;
    e.preventDefault();
    const lim = sw.row.offsetWidth * 0.6;
    sw.dx = Math.max(-lim, Math.min(lim, dx));
    const p = Math.min(1, Math.abs(sw.dx) / TH);
    sw.row.style.setProperty('--dx', sw.dx + 'px');
    sw.row.style.setProperty('--p', p);
    const armDel = sw.dx <= -TH, armEdit = sw.dx >= TH;
    if (armDel !== sw.row.classList.contains('arm-del') || armEdit !== sw.row.classList.contains('arm-edit')) { if (armDel || armEdit) haptic(8); }
    sw.row.classList.toggle('arm-del', armDel); sw.row.classList.toggle('arm-edit', armEdit);
    sw.row.classList.toggle('to-left', sw.dx < 0); sw.row.classList.toggle('to-right', sw.dx > 0);
  }, { passive: false });
  const end = () => {
    if (!sw) return;
    const { row, dx, dir } = sw; sw = null;
    if (dir !== 'h') return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 350);
    row.style.transition = '';
    const id = row.dataset.edit;
    if (dx <= -TH) { row.classList.add('gone'); row.style.setProperty('--dx', '-110%'); setTimeout(() => deleteWithUndo(id), 180); return; }
    reset(row);
    if (dx >= TH) setTimeout(() => openEdit(id), 60);
  };
  document.addEventListener('touchend', end);
  // 被系統打斷（來電、捲動接手）就當作沒滑過，不刪也不開
  document.addEventListener('touchcancel', () => { if (!sw) return; const { row } = sw; sw = null; row.style.transition = ''; reset(row); });
  document.addEventListener('click', e => { if (suppressClick && e.target.closest('.rc-row')) { e.stopPropagation(); e.preventDefault(); } }, true);
})();

// ---------- 圖表頁 ----------
function renderStats(animate = state.animateStats) {
  state.animateStats = false;
  const m = state.month, y = m.getFullYear(), mo = m.getMonth();
  const now = new Date();
  const isCur = y === now.getFullYear() && mo === now.getMonth();
  $('#m-title').textContent = `${y}年${mo + 1}月`;
  $('#m-next').disabled = isCur || m > now;
  const book = S.getBook();
  if (!book) state.scope = 'me';
  $('#scope-seg').hidden = !book;
  $$('#scope-seg button').forEach(b => b.classList.toggle('on', b.dataset.scope === state.scope));
  const inBook = state.scope === 'book';
  $('#view-stats').classList.toggle('book-scope', inBook);
  const list = inMonth(scopeEntries(), m);
  const inc = sum(list, 'income'), exp = sum(list, 'expense'), bal = inc - exp;
  renderBookHero(list, isCur, mo);

  // 結餘
  const fmtBal = v => (v >= 0 ? '+' : '−') + money(Math.abs(v));
  countUp($('#h-balance'), bal, fmtBal);
  countUp($('#h-income'), inc, money);
  countUp($('#h-expense'), exp, money);
  $('.h-label', $('#hero')).textContent = isCur ? '本月結餘' : `${mo + 1}月結餘`;
  let note;
  if (!list.length) note = isCur ? '這個月還沒有紀錄，從記一筆開始吧 ✏️' : '這個月沒有紀錄';
  else if (inc > 0 && bal >= 0) note = `存下了收入的 ${Math.round(bal / inc * 100)}%，很棒 👏`;
  else if (inc > 0) note = `支出比收入多 ${money(-bal)}，下個月一起調整 💪`;
  else note = `已記錄 ${list.length} 筆，掌握每一筆就是進步 ✨`;
  $('#h-note').innerHTML = `${esc(note)}${list.length >= 3 && !inBook ? ` <button class="hero-link" type="button" data-act="recap" data-month="${monthKey(m)}">🎁 ${isCur ? '目前為止的' : ''}${mo + 1} 月回顧</button>` : ''}`;

  if (inBook) { $('#budget-card').hidden = true; } else renderBudget(list, isCur, y, mo, animate);
  renderInsights(list, isCur, y, mo);
  renderDonut(list, animate);
  renderAccountsInStats(list);
  renderTagsInStats(list);
  renderDaily(list, isCur, y, mo, animate);
  renderMonths(m, animate);
  renderDetail(list);
}

function renderBudget(list, isCur, y, mo, animate) {
  const card = $('#budget-card');
  const budget = S.getSettings().budget;
  card.classList.toggle('slim', !(budget > 0));
  if (!(budget > 0)) {
    if (S.getSettings().budgetHintOff) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = `<span class="slim-ico" aria-hidden="true">🎯</span><span class="slim-txt"><b>設個每月預算？</b><small>記帳時就知道這個月還能花多少</small></span>
      <button class="btn primary sm" type="button" data-act="budget-edit">設定</button><button class="icon-btn sm" type="button" data-act="budget-hint-off" aria-label="不用了"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`;
    return;
  }
  card.hidden = false;
  const spent = sum(list, 'expense');
  const pct = spent / budget;
  const cls = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : '';
  const status = pct >= 1 ? ['var(--critical)', '已超出預算'] : pct >= 0.8 ? ['var(--warning)', '接近上限'] : ['var(--good)', '進度良好'];
  let lines;
  if (isCur) {
    const left = daysIn(y, mo) - new Date().getDate() + 1;
    const rem = budget - spent;
    lines = rem >= 0
      ? `<span>還可以花 <b>${money(rem)}</b></span><span>剩 ${left} 天 · 每天約 <b>${money(Math.floor(rem / left))}</b></span>`
      : `<span>超出 <b>${money(-rem)}</b></span><span>剩 ${left} 天，慢慢調整就好 🌱</span>`;
  } else {
    lines = spent <= budget ? `<span>守住預算，省下 <b>${money(budget - spent)}</b> 🎉</span>` : `<span>超出 <b>${money(spent - budget)}</b></span>`;
  }
  card.innerHTML = `<div class="card-head"><h2>預算 <button class="linkish sm" type="button" data-act="budget-edit">修改</button></h2><span class="status"><span class="dot" style="background:${status[0]}"></span>${status[1]}</span></div>
    <div class="budget-lines"><span>已花 <b>${money(spent)}</b> / ${money(budget)}</span><span>${Math.round(pct * 100)}%</span></div>
    <div class="budget-track ${cls}"><i></i></div>
    <div class="budget-lines">${lines}</div>`;
  const bar = $('.budget-track i', card);
  const w = Math.min(100, pct * 100) + '%';
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = w; }));
  else { bar.style.transition = 'none'; bar.style.width = w; }
}

function renderInsights(list, isCur, y, mo) {
  const box = $('#insights');
  const tiles = [];
  const expList = list.filter(e => e.type === 'expense');
  if (!list.length) { box.innerHTML = ''; return; }
  // 跟上個月同期比
  const upto = isCur ? new Date().getDate() : daysIn(y, mo);
  const prev = new Date(y, mo - 1, 1);
  const prevList = inMonth(scopeEntries(), prev).filter(e => e.type === 'expense' && Number(e.date.slice(8)) <= upto);
  const prevExp = prevList.reduce((s, e) => s + e.amount, 0);
  const curExp = expList.filter(e => Number(e.date.slice(8)) <= upto).reduce((s, e) => s + e.amount, 0);
  if (prevExp > 0) {
    const d = (curExp - prevExp) / prevExp;
    if (d <= -0.02) tiles.push(['👏', `少花 ${Math.round(-d * 100)}%`, `比${prev.getMonth() + 1}月同期省 ${money(prevExp - curExp)}`]);
    else if (d >= 0.02) tiles.push(['🧭', `多花 ${Math.round(d * 100)}%`, `比${prev.getMonth() + 1}月同期多 ${money(curExp - prevExp)}`]);
    else tiles.push(['⚖️', '跟上月差不多', `${prev.getMonth() + 1}月同期 ${money(prevExp)}`]);
  }
  // 無支出日
  const spentDays = new Set(expList.map(e => e.date));
  const free = Array.from({ length: upto }, (_, i) => i + 1).filter(d => !spentDays.has(`${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)).length;
  if (free > 0) tiles.push(['🌱', `${free} 天`, '無支出日，給自己拍拍手']);
  // 最常記
  const cnt = {};
  expList.forEach(e => { cnt[e.note] = cnt[e.note] || { n: 0, e }; cnt[e.note].n++; });
  const fav = Object.values(cnt).sort((a, b) => b.n - a.n)[0];
  if (fav && fav.n >= 2) tiles.push([categoryInfo('expense', fav.e.category).icon, esc(fav.e.note), `最常記的項目，${fav.n} 次`]);
  if (tiles.length < 3 && expList.length) {
    const big = expList.reduce((a, b) => (b.amount > a.amount ? b : a));
    tiles.push(['🔎', money(big.amount), `最大一筆：${esc(big.note)}`]);
  }
  box.className = 'insights n' + Math.min(3, tiles.length);
  box.innerHTML = tiles.slice(0, 3).map(([i, b, t]) => `<div class="insight"><span class="i-ico" aria-hidden="true">${i}</span><span class="i-big">${b}</span><span class="i-txt">${t}</span></div>`).join('');
}

function renderDonut(list, animate = true) {
  const type = state.catType;
  $$('#cat-seg button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
  const wrap = $('#donut-wrap');
  const items = list.filter(e => e.type === type);
  if (!items.length) {
    wrap.innerHTML = `<div class="empty"><div class="big">🍃</div>這個月還沒有${type === 'income' ? '收入' : '支出'}紀錄<button class="btn primary sm" type="button" data-go="chat">去記一筆</button></div>`;
    return;
  }
  const by = {};
  items.forEach(e => { by[e.category] = by[e.category] || { v: 0, n: 0 }; by[e.category].v += e.amount; by[e.category].n++; });
  const rows = Object.entries(by).sort((a, b) => b[1].v - a[1].v);
  const total = rows.reduce((s, r) => s + r[1].v, 0);
  const slices = [];
  let other = 0;
  rows.forEach(([name, o]) => {
    if (slotOf(type, name) >= 0) slices.push({ key: name, label: name, icon: categoryInfo(type, name).icon, value: o.v, color: catColor(type, name) });
    else other += o.v;
  });
  if (other) slices.push({ key: '__other', label: '其他', icon: '📦', value: other, color: 'var(--s-other)' });
  wrap.innerHTML = '<div id="donut-host"></div><div class="legend" id="legend"></div>';
  const legend = $('#legend');
  legend.innerHTML = rows.map(([name, o]) => {
    const pct = o.v / total * 100;
    const key = slotOf(type, name) >= 0 ? name : '__other';
    const cb = type === 'expense' && state.scope !== 'book' ? catBudgets()[name] : 0;
    const bp = cb > 0 ? o.v / cb : 0;
    const bcls = cb > 0 ? (bp >= 1 ? ' over' : bp >= 0.8 ? ' warn' : ' ok') : '';
    return `<button class="lg-row${bcls ? ' has-budget' + bcls : ''}" type="button" data-cat="${esc(name)}" data-key="${esc(key)}">
      <span class="lg-sw" style="background:${catColor(type, name)}"></span>
      <span class="lg-ico" aria-hidden="true">${categoryInfo(type, name).icon}</span>
      <span class="lg-mid"><span class="lg-name">${esc(name)} <small>${o.n} 筆</small>${cb > 0 ? `<small class="lg-budget">${bp >= 1 ? `超出 ${money(o.v - cb)}` : `剩 ${money(cb - o.v)}`}</small>` : ''}</span><span class="lg-bar"><i data-w="${cb > 0 ? Math.min(100, bp * 100) : pct}" style="background:${cb > 0 ? (bp >= 1 ? 'var(--critical)' : bp >= 0.8 ? 'var(--warning)' : catColor(type, name)) : catColor(type, name)}"></i></span></span>
      <span class="lg-val"><b>${money(o.v)}</b><small>${cb > 0 ? `/ ${money(cb)}` : `${pct.toFixed(pct < 10 ? 1 : 0)}%`}</small></span></button>`;
  }).join('');
  donut($('#donut-host'), slices, {
    animate,
    centerTop: type === 'income' ? '收入合計' : '支出合計',
    onHover: key => $$('.lg-row', legend).forEach(r => r.classList.toggle('hl', key != null && r.dataset.key === key)),
  });
  const bars = $$('.lg-bar i', legend);
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(i => { i.style.width = i.dataset.w + '%'; })));
  else bars.forEach(i => { i.style.transition = 'none'; i.style.width = i.dataset.w + '%'; });
}

function renderDaily(list, isCur, y, mo, animate) {
  const n = daysIn(y, mo);
  const days = Array.from({ length: n }, (_, i) => {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    const items = list.filter(e => e.date === iso && e.type === 'expense');
    return { iso, value: items.reduce((s, e) => s + e.amount, 0), items };
  });
  const elapsed = isCur ? new Date().getDate() : n;
  const exp = days.slice(0, elapsed).reduce((s, d) => s + d.value, 0);
  const avg = elapsed ? exp / elapsed : 0;
  $('#daily-sub').textContent = exp ? `日均 ${money(Math.round(avg))}` : '';
  dailyBars($('#daily-chart'), days, {
    todayIndex: isCur ? new Date().getDate() - 1 : -1, avg: exp ? avg : 0, animate,
    label: d => {
      const top = [...d.items].sort((a, b) => b.amount - a.amount).slice(0, 3);
      return `<b>${relDay(d.iso)}</b><div class="tr"><span>支出</span><span>${money(d.value)}</span></div>` +
        (top.length ? top.map(e => `<div class="tr"><span>${categoryInfo(e.type, e.category).icon} ${esc(e.note)}</span><span>${money(e.amount)}</span></div>`).join('') + (d.items.length > 3 ? `<div>…共 ${d.items.length} 筆</div>` : '') : '<div>無支出 🌱</div>');
    },
  });
}

function renderMonths(m, animate) {
  const now = new Date();
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const diff = (curStart.getFullYear() - m.getFullYear()) * 12 + curStart.getMonth() - m.getMonth();
  const end = diff >= 0 && diff < 6 ? curStart : m;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth() - 5 + i, 1);
    const l = inMonth(scopeEntries(), d);
    return { d, label: `${d.getMonth() + 1}月`, full: `${d.getFullYear()}年${d.getMonth() + 1}月`, income: sum(l, 'income'), expense: sum(l, 'expense') };
  });
  const sel = months.findIndex(x => monthKey(x.d) === monthKey(m));
  monthBars($('#month-chart'), months, {
    selected: sel, animate,
    onPick: i => { if (i === sel) return; state.month = months[i].d; state.catFilter = null; haptic(6); tip(null); renderStats(true); },
  });
}

function renderDetail(list) {
  const f = state.catFilter;
  const items = (f ? list.filter(e => e.category === f) : list).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  $('#detail-filter').innerHTML = f ? `<span class="filter-chip">${categoryInfo(state.catType, f).icon} ${esc(f)}<button type="button" data-act="clear-filter" aria-label="清除篩選">✕</button></span>` : `<span class="card-sub">${list.length} 筆</span>`;
  if (!items.length) { $('#detail-list').innerHTML = '<div class="empty"><div class="big">📭</div>沒有紀錄</div>'; return; }
  let h = '', day = null;
  const dayTotal = {};
  items.forEach(e => { dayTotal[e.date] = (dayTotal[e.date] || 0) + (e.type === 'income' ? e.amount : -e.amount); });
  for (const e of items) {
    if (e.date !== day) { day = e.date; const t = dayTotal[day]; h += `<div class="list-day"><span>${dayTitle(day)}</span><span class="num">${t >= 0 ? '+' : '−'}${money(Math.abs(t))}</span></div>`; }
    h += rowHTML(e, false);
  }
  $('#detail-list').innerHTML = h;
}

// ---------- 搜尋結果 ----------
const SEARCH_SUGGEST = ['咖啡', '餐飲', '交通', '>1000', '收入'];
function renderSearch() {
  const q = ($('#q').value || '').trim();
  const on = !!q;
  $('#view-stats').classList.toggle('searching', on);
  $('#q-clear').hidden = !on;
  $('#search-card').hidden = !on;
  if (!on) return;
  const items = matchEntries(q).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!items.length) {
    $('#search-sum').innerHTML = '';
    $('#search-list').innerHTML = `<div class="empty"><div class="big">🔎</div>找不到「${esc(q)}」<div class="ex" style="justify-content:center;margin-top:10px">${SEARCH_SUGGEST.filter(w => w !== q).map(w => `<button class="chip" type="button" data-search="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>`;
    return;
  }
  const exp = sum(items, 'expense'), inc = sum(items, 'income');
  const span = items.length > 1 ? `${relDay(items[items.length - 1].date)} ～ ${relDay(items[0].date)}` : relDay(items[0].date);
  $('#search-sum').innerHTML = `<div><b>${items.length}</b> 筆${exp ? ` · 支出 <b>${money(exp)}</b>` : ''}${inc ? ` · 收入 <b>${money(inc)}</b>` : ''}</div><small>${span}</small>`;
  let h = '', mk = null;
  for (const e of items.slice(0, 300)) {
    const k = e.date.slice(0, 7);
    if (k !== mk) {
      mk = k;
      const ms = items.filter(x => x.date.startsWith(k));
      const net = ms.reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
      h += `<div class="list-day"><span>${Number(k.slice(0, 4))}年${Number(k.slice(5))}月 · ${ms.length} 筆</span><span class="num">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</span></div>`;
    }
    h += rowHTML(e, false).replace('<span class="rc-meta">', `<span class="rc-meta"><span>${relDay(e.date)}</span>`);
  }
  if (items.length > 300) h += `<p class="note" style="text-align:center">只顯示最近 300 筆，再多打幾個字縮小範圍</p>`;
  $('#search-list').innerHTML = h;
}
function openSearch(q) {
  setView('stats');
  $('#q').value = q; renderSearch();
  $('#view-stats').scrollTop = 0;
}
$('#q').addEventListener('input', renderSearch);
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = ''; renderSearch(); } });
$('#q-clear').addEventListener('click', () => { $('#q').value = ''; renderSearch(); $('#q').focus(); haptic(5); });

// ---------- 設定頁 ----------
let cloudKey = '';
function renderSettings(force = false) {
  const st = S.getSettings();
  $('#budget-row-val').textContent = st.budget > 0 ? `${money(st.budget)} / 月` : '還沒設定';
  $('#budget-row-btn').textContent = st.budget > 0 ? '修改' : '設定';
  const cbs = Object.entries(st.catBudgets || {});
  $('#catbudget-row-val').textContent = cbs.length ? cbs.slice(0, 3).map(([k, v]) => `${k} ${money(v)}`).join('、') + (cbs.length > 3 ? ` 等 ${cbs.length} 個` : '') : '還沒設定';
  renderRecurCard(); renderAccountCard(); renderCatCard(); renderTripCard(); renderBookCard(); renderRemindCard();
  const last = st.lastExport;
  $('#backup-sub').textContent = last ? `上次備份：${relDay(toISO(new Date(last)))}` : '還沒備份過';
  $('#sample-btn').textContent = S.hasSample() ? '清除範例' : '載入範例';
  renderInstall();
  const cfg = S.getCloudConfig();
  const key = [S.cloud.status, S.cloud.errorKind, S.cloud.user?.id, !!cfg, S.cloud.error, S.cloud.lastSync && hhmm(S.cloud.lastSync.toISOString()), inFrame].join('|');
  if (key !== cloudKey || force) { cloudKey = key; renderCloud(cfg); }
}

function cfgForm(cfg, open) {
  return `<details class="adv"${open ? ' open' : ''}><summary>${cfg ? '變更 Supabase 設定' : '設定 Supabase'}</summary>
    <div class="sheet-body" style="gap:10px">
      <div class="field"><label for="sb-url">Project URL</label><input class="input" id="sb-url" placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url || '')}" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="sb-key">anon key（或 Publishable key）</label><input class="input" id="sb-key" placeholder="eyJhbGciOi…" value="${esc(cfg?.key || '')}" autocapitalize="off" spellcheck="false"></div>
      <div class="row"><button class="btn primary grow" type="button" data-act="cloud-save">儲存並連線</button>${cfg ? '<button class="btn ghost" type="button" data-act="cloud-remove">中斷連線</button>' : ''}</div>
      <p class="note" style="margin:0">這兩個值在 Supabase 後台 Project Settings → API。完整步驟見說明文件。</p>
    </div></details>`;
}
function renderCloud(cfg) {
  const card = $('#cloud-card');
  const c = S.cloud;
  let h = '<div class="card-head"><h2>雲端同步</h2>';
  if (inFrame) {
    card.innerHTML = h + '<span class="card-sub">預覽模式</span></div><p class="note" style="margin:0">預覽版的資料只存在這個瀏覽器。放上你自己的網址後，就能用 Google 登入，手機和電腦看到同一份帳。</p>';
    return;
  }
  if (!cfg) {
    h += '<span class="card-sub">未開啟</span></div><p class="note" style="margin:0 0 6px">目前資料只存在這台裝置。開啟同步後，換手機或用電腦都看得到同一份帳，也不怕資料不見。</p>' + cfgForm(null, false);
  } else if (!c.user) {
    h += `<span class="card-sub">${c.status === 'error' ? (c.errorKind === 'network' ? '離線中' : '連線失敗') : '尚未登入'}</span></div>`;
    if (c.error) h += `<p class="note" style="color:${c.errorKind === 'network' ? 'var(--ink-2)' : 'var(--danger)'};margin:0 0 8px">${c.errorKind === 'network' ? '🕒' : '⚠️'} ${esc(c.error)}</p>`;
    h += `<p class="note" style="margin:0 0 10px">登入一次，之後就會自動同步。這台裝置上的紀錄也會一起上傳。</p>
      <button class="btn primary block" type="button" data-act="signin"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>用 Google 登入</button>
      <div class="row" style="margin-top:10px"><input class="input grow" id="sb-email" type="email" inputmode="email" placeholder="或輸入 Email 收登入連結" autocapitalize="off" aria-label="Email"><button class="btn ghost" type="button" data-act="signin-email">寄送</button></div>` + cfgForm(cfg, false);
  } else {
    const label = c.status === 'error' ? ({ network: '離線中，會自動重試', auth: '登入過期', setup: '需要設定' }[c.errorKind] || '同步暫停') : ({ idle: '已同步', syncing: '同步中…', offline: '離線中，連上網路後自動同步' }[c.status] || '');
    h += `<span class="status"><span class="dot" style="background:${c.status === 'error' && c.errorKind !== 'network' ? 'var(--critical)' : c.status === 'idle' ? 'var(--good)' : c.status === 'offline' || c.errorKind === 'network' ? 'var(--muted)' : 'var(--warning)'}"></span>${label}</span></div>
      <div class="set-row" style="border:0;padding-top:0"><div class="t"><b>${esc(c.user.email || '已登入')}</b><small>${c.lastSync ? '上次同步 ' + hhmm(c.lastSync.toISOString()) : '每次記帳都會自動同步'}</small></div></div>
      ${c.error ? `<p class="note" style="color:${c.errorKind === 'network' ? 'var(--ink-2)' : 'var(--danger)'};margin:0 0 8px">${c.errorKind === 'network' ? '🕒' : '⚠️'} ${esc(c.error)}</p>` : ''}
      ${c.errorKind === 'auth' ? '<button class="btn primary block" type="button" data-act="signin" style="margin-bottom:8px">重新登入</button>' : ''}
      <div class="row"><button class="btn ghost grow" type="button" data-act="sync-now">立即同步</button><button class="btn ghost" type="button" data-act="signout">登出</button></div>`;
  }
  card.innerHTML = h;
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; renderInstall(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('安裝完成！之後從主畫面打開就好 🎉', { icon: '📲' }); setTimeout(() => celebrate({ count: 100 }), 1000); renderInstall(); });
function renderInstall() {
  const card = $('#install-card');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || inFrame) { card.hidden = true; return; }
  card.hidden = false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#install-btn').hidden = !deferredInstall;
  $('#install-text').textContent = deferredInstall ? '裝到主畫面後，點一下就能記帳，用起來就像一般 App。'
    : ios ? '在 Safari 點下方的「分享」按鈕，再選「加入主畫面」，就能像 App 一樣使用。'
      : '在瀏覽器選單選「加到主畫面」或「安裝應用程式」，就能像 App 一樣使用。';
}

// ---------- 對話框 ----------
function dialog({ title, body, ok = '確定', cancel = '取消', danger = false, extra = '', onOk, onOpen }) {
  return new Promise(res => {
    const w = document.createElement('div');
    w.className = 'dialog-wrap';
    w.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h3>${title}</h3>${body ? `<p>${body}</p>` : ''}${extra}
      <div class="row">${cancel ? `<button class="btn ghost" type="button" data-r="0">${cancel}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-r="1">${ok}</button></div></div>`;
    let closed = false;
    const done = v => { if (closed) return; closed = true; w.remove(); res(v); };
    w.addEventListener('click', e => {
      if (closed) return;
      const b = e.target.closest('[data-r]');
      if (b) { if (b.dataset.r === '1' && onOk && onOk(w, () => done(true)) === false) return; done(b.dataset.r === '1'); }
      else if (e.target === w) done(false);
    });
    // 鍵盤上的「完成／前往」直接確定，Esc 取消
    w.addEventListener('keydown', e => {
      if (closed || e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); if (cancel) done(false); }
      else if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]):not([type=radio])')) { e.preventDefault(); $('[data-r="1"]', w).click(); }
    });
    document.body.appendChild(w);
    if (onOpen) onOpen(w, done);
    $('[data-r="1"]', w).focus();
  });
}

// ---------- 每月預算（圖表頁和我的頁共用同一個設定視窗） ----------
async function editBudget() {
  const cur = S.getSettings().budget || 0;
  let val = cur;
  const ok = await dialog({
    title: cur ? '修改每月預算' : '設定每月預算', ok: '儲存', cancel: '取消',
    body: '每次記帳都會告訴你這個月還能花多少。',
    extra: `<div class="money-input" style="padding:0 14px"><span style="font-size:20px">$</span><input id="budget-dlg" inputmode="numeric" placeholder="例如 15000" value="${cur || ''}" style="height:48px;font-size:24px" aria-label="每月預算"></div>${cur ? '<button class="linkish" type="button" data-budget-clear style="align-self:flex-start">取消預算</button>' : ''}`,
    onOpen: (w, done) => {
      const i = $('#budget-dlg', w); setTimeout(() => { i.focus(); i.select(); }, 50);
      i.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-r="1"]', w).click(); });
      const c = $('[data-budget-clear]', w); if (c) c.addEventListener('click', () => { val = 0; done(true); });
    },
    onOk: w => {
      const raw = ($('#budget-dlg', w).value || '').replace(/[,$\s]/g, '');
      const v = raw ? evalAmount(raw) : 0;
      if (raw && !(v > 0)) { const m = $('.money-input', w); m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); haptic([10, 40, 10]); return false; }
      val = v || 0;
    },
  });
  if (!ok) return;
  S.setSettings({ budget: val });
  state.animateStats = true;
  haptic(12);
  toast(val ? `每月預算 ${money(val)} 設定好了` : '已取消每月預算', { icon: val ? '🎯' : '✓' });
}

// ---------- 分類預算 ----------
const catBudgets = () => S.getSettings().catBudgets || {};
function catBudgetNote(e) {
  // 記一筆支出後：這個分類用到 80%、100% 時提醒一次
  const b = catBudgets()[e.category];
  if (!(b > 0) || e.type !== 'expense' || !e.date.startsWith(monthKey(new Date()))) return null;
  const spent = sum(thisMonth().filter(x => x.category === e.category), 'expense');
  const before = spent - e.amount;
  const ic = categoryInfo('expense', e.category).icon;
  if (before < b && spent >= b) return `${ic} ${e.category}超過本月預算 ${money(spent - b)}，接下來緩一緩 🌱`;
  if (before < b * 0.8 && spent >= b * 0.8) return `${ic} ${e.category}已用掉預算的 ${Math.round(spent / b * 100)}%，還剩 ${money(b - spent)}`;
  return null;
}
async function editCatBudgets() {
  const cur = catBudgets();
  const cats = CATEGORIES.expense.filter(c => c.name !== '其他');
  const avg = {};
  // 參考：近 3 個月平均
  const since = toISO(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1));
  const until = toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 0));
  entries().filter(e => e.type === 'expense' && e.date >= since && e.date <= until).forEach(e => { avg[e.category] = (avg[e.category] || 0) + e.amount / 3; });
  const ok = await dialog({
    title: '分類預算', ok: '儲存', cancel: '取消',
    body: '只填想控制的分類就好，用到 80% 會提醒你。',
    extra: `<div class="cb-list">${cats.map(c => `<label class="cb-row"><span class="cb-name">${c.icon} ${esc(c.name)}${avg[c.name] ? `<small>近 3 個月平均 ${money(Math.round(avg[c.name]))}</small>` : ''}</span><span class="money-input small"><span>$</span><input inputmode="numeric" data-cb="${esc(c.name)}" value="${cur[c.name] || ''}" placeholder="不限" aria-label="${esc(c.name)}預算"></span></label>`).join('')}</div>`,
    onOk: w => {
      const next = {};
      $$('[data-cb]', w).forEach(i => { const v = evalAmount(i.value); if (v > 0) next[i.dataset.cb] = v; });
      S.setSettings({ catBudgets: next });
    },
  });
  if (ok) { haptic(12); toast('分類預算設定好了 🎯', { icon: '🎯' }); state.animateStats = true; }
}

// ---------- 付款方式 ----------
const DEFAULT_ACCOUNTS = ['現金', '信用卡', 'LINE Pay', '悠遊卡'];
const accountList = () => S.getSettings().accounts || DEFAULT_ACCOUNTS;
const ACCOUNT_ICON = { 現金: '💵', 信用卡: '💳', 'LINE Pay': '🟩', 悠遊卡: '🎫', 街口: '🟥', 'Apple Pay': '📱', 轉帳: '🏦' };
const accIcon = a => ACCOUNT_ICON[a] || '👛';
function renderAccountCard() {
  const card = $('#account-card'); if (!card) return;
  const st = S.getSettings();
  const list = accountList();
  card.innerHTML = `<div class="card-head"><h2>付款方式</h2><span class="card-sub">預設：${st.defaultAccount ? esc(st.defaultAccount) : '不指定'}</span></div>
    <div class="acc-chips">${list.map(a => `<button class="chip${st.defaultAccount === a ? ' on' : ''}" type="button" data-acc="${esc(a)}">${accIcon(a)} ${esc(a)}</button>`).join('')}<button class="chip" type="button" data-act="acc-add">＋ 新增</button></div>
    <p class="note" style="margin:10px 0 0">點一下設成預設、再點一次取消，長按刪除。記帳時說「刷卡」「LINE Pay」「現金」會自動帶入。</p>`;
}
function accountStats(list) {
  const exp = list.filter(e => e.type === 'expense');
  const by = {};
  exp.forEach(e => { const k = e.account || '未指定'; by[k] = (by[k] || 0) + e.amount; });
  return Object.entries(by).sort((a, b) => (a[0] === '未指定') - (b[0] === '未指定') || b[1] - a[1]); // 未指定放最後
}
function renderAccountsInStats(list) {
  const card = $('#acc-stats'); if (!card) return;
  const rows = accountStats(list);
  if (!rows.length || (rows.length === 1 && rows[0][0] === '未指定')) { card.hidden = true; return; }
  card.hidden = false;
  const total = rows.reduce((a, b) => a + b[1], 0);
  const credit = rows.find(r => r[0] === '信用卡');
  card.innerHTML = `<div class="card-head"><h2>付款方式</h2>${credit ? `<span class="card-sub">💳 信用卡本月累積 <b>${money(credit[1])}</b></span>` : ''}</div>
    <div class="acc-rows">${rows.map(([k, v]) => `<button class="acc-row" type="button" data-search="${esc(k === '未指定' ? '' : k)}"${k === '未指定' ? ' disabled' : ''}><span>${k === '未指定' ? '➖' : accIcon(k)} ${esc(k)}</span><span class="acc-bar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></span><b>${money(v)}</b></button>`).join('')}</div>`;
}

// ---------- 標籤 ----------
function renderTagsInStats(list) {
  const card = $('#tag-stats'); if (!card) return;
  const by = {};
  list.filter(e => e.type === 'expense').forEach(e => (e.tags || []).forEach(t => { by[t] = by[t] || { v: 0, n: 0 }; by[t].v += e.amount; by[t].n++; }));
  const rows = Object.entries(by).sort((a, b) => b[1].v - a[1].v).slice(0, 8);
  if (!rows.length) { card.hidden = true; return; }
  card.hidden = false;
  card.innerHTML = `<div class="card-head"><h2>標籤</h2><span class="card-sub">點一下看明細</span></div>
    <div class="tag-chips">${rows.map(([t, o]) => `<button class="tag-chip" type="button" data-search="#${esc(t)}">#${esc(t)} <b>${money(o.v)}</b><small>${o.n} 筆</small></button>`).join('')}</div>`;
}

// ---------- 自訂分類 ----------
const customCats = () => S.getSettings().customCats || [];
function applyCustomCats() { setCustomCategories(customCats()); }
function renderCatCard() {
  const card = $('#cat-card'); if (!card) return;
  const list = customCats();
  card.innerHTML = `<div class="card-head"><h2>自訂分類</h2><span class="card-sub">${list.length ? `${list.length} 個` : ''}</span></div>
    ${list.length ? `<div class="acc-chips">${list.map((c, i) => `<button class="chip" type="button" data-ccat="${i}">${esc(c.icon || '🏷️')} ${esc(c.name)}<small style="color:var(--muted)">${c.type === 'income' ? '收入' : ''}</small></button>`).join('')}</div>` : '<p class="note" style="margin:0 0 10px">內建分類不夠用？加一個自己的，例如「🐱 貓咪」「💄 美妝」，再設定關鍵字就會自動分類。</p>'}
    <div class="row" style="margin-top:10px"><button class="btn ghost grow" type="button" data-act="ccat-add">＋ 新增分類</button></div>
    <p class="note" style="margin:10px 0 0">標籤：記帳時加上 <code>#約會</code>、<code>#日本</code>，圖表頁會幫你分開統計。</p>`;
}
async function editCustomCat(idx) {
  const list = customCats();
  const c = idx != null ? list[idx] : null;
  let removed = false;
  const ok = await dialog({
    title: c ? '編輯分類' : '新增分類', ok: '儲存', cancel: '取消',
    extra: `<div class="seg" id="cc-type"><button type="button" data-t="expense" class="${!c || c.type !== 'income' ? 'on' : ''}">支出</button><button type="button" data-t="income" class="${c && c.type === 'income' ? 'on' : ''}">收入</button></div>
      <div class="row"><input class="input" id="cc-icon" maxlength="4" value="${esc(c ? c.icon : '🏷️')}" style="width:64px;text-align:center;font-size:22px" aria-label="圖示"><input class="input grow" id="cc-name" maxlength="8" placeholder="分類名稱，例如：貓咪" value="${esc(c ? c.name : '')}"></div>
      <div class="field"><label for="cc-kw">關鍵字（用逗號分開）</label><input class="input" id="cc-kw" placeholder="例如：貓砂, 罐罐, 逗貓棒" value="${esc(c ? (c.kw || []).join(', ') : '')}"></div>
      ${c ? '<button class="linkish" type="button" data-cc-del style="align-self:flex-start;color:var(--danger)">刪除這個分類</button>' : ''}`,
    onOpen: (w, done) => {
      $('#cc-type', w).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#cc-type button', w).forEach(x => x.classList.toggle('on', x === b)); });
      const d = $('[data-cc-del]', w);
      if (d) d.addEventListener('click', () => { removed = true; S.setSettings({ customCats: list.filter((_, i) => i !== idx) }); applyCustomCats(); toast(`已刪除「${c.name}」，記過的紀錄保留原分類名稱`, { icon: '🗑️' }); done(false); });
      setTimeout(() => $('#cc-name', w).focus(), 50);
    },
    onOk: w => {
      const name = $('#cc-name', w).value.trim();
      const type = $('#cc-type .on', w)?.dataset.t || 'expense';
      if (!name) { $('#cc-name', w).focus(); return false; }
      if (CATEGORIES[type].some(x => x.name === name && !x.custom) || list.some((x, i) => x.name === name && i !== idx)) { toast('已經有這個分類了', { icon: '✋' }); return false; }
      const item = { type, name, icon: $('#cc-icon', w).value.trim() || '🏷️', kw: $('#cc-kw', w).value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean) };
      const next = [...list]; if (c) next[idx] = item; else next.push(item);
      S.setSettings({ customCats: next });
      applyCustomCats();
    },
  });
  if (ok && !removed) { haptic(12); toast('分類存好了，下次記帳會自動分進去 ✨', { icon: '🏷️' }); }
}

// ---------- 旅行模式 ----------
function tripSpent(t) {
  return entries().filter(e => e.type === 'expense' && (e.tags || []).includes(t.tag));
}
function renderTripCard() {
  const card = $('#trip-card'); if (!card) return;
  const t = S.getSettings().trip;
  if (t && t.active) {
    const list = tripSpent(t);
    const days = Math.max(1, Math.round((fromISO(todayISO()) - fromISO(t.start)) / 864e5) + 1);
    const total = list.reduce((a, b) => a + b.amount, 0);
    const c = CURRENCIES[t.currency];
    card.innerHTML = `<div class="card-head"><h2>✈️ ${esc(t.name)}</h2><span class="status"><span class="dot" style="background:var(--good)"></span>進行中 · 第 ${days} 天</span></div>
      <div class="trip-sum"><div><small>旅行總花費</small><b>${money(total)}</b></div><div><small>平均每天</small><b>${money(Math.round(total / days))}</b></div><div><small>${list.length} 筆</small><b>#${esc(t.tag)}</b></div></div>
      ${c ? `<p class="note" style="margin:8px 0">直接打當地金額就好（例如「拉麵 1200」），會用 1 ${c.sym} = NT$${t.rate} 換算。要記台幣就加「台幣」。</p>` : ''}
      <div class="row"><button class="btn ghost grow" type="button" data-search="#${esc(t.tag)}">看明細</button><button class="btn ghost grow" type="button" data-act="trip-edit">修改</button><button class="btn primary grow" type="button" data-act="trip-end">結束旅行</button></div>`;
  } else {
    const past = (S.getSettings().trips || []).slice(-3).reverse();
    card.innerHTML = `<div class="card-head"><h2>旅行模式</h2></div>
      <p class="note" style="margin:0 0 10px">出國或出遊時打開：每筆都自動加上旅行標籤，外幣自動換算台幣，回來一眼看出這趟花了多少。</p>
      <button class="btn ghost block" type="button" data-act="trip-start">✈️ 開始一趟旅行</button>
      ${past.length ? `<div class="tag-chips" style="margin-top:10px">${past.map(p => `<button class="tag-chip" type="button" data-search="#${esc(p.tag)}">✈️ ${esc(p.name)} <b>${money(p.total || 0)}</b></button>`).join('')}</div>` : ''}`;
  }
}
async function editTrip(existing) {
  const t = existing ? S.getSettings().trip : null;
  const curOpts = Object.keys(CURRENCIES);
  const names = { TWD: '台幣（國內）', JPY: '日圓', USD: '美金', KRW: '韓元', EUR: '歐元', THB: '泰銖', HKD: '港幣', CNY: '人民幣' };
  const rates = S.getSettings().fxRates || {};
  const ok = await dialog({
    title: t ? '修改旅行' : '開始旅行', ok: t ? '儲存' : '出發 ✈️', cancel: '取消',
    extra: `<div class="field"><label for="tr-name">旅行名稱</label><input class="input" id="tr-name" maxlength="12" placeholder="例如：日本旅行" value="${esc(t ? t.name : '')}"></div>
      <div class="field"><label for="tr-cur">當地貨幣</label><select class="input" id="tr-cur">${curOpts.map(c => `<option value="${c}"${(t ? t.currency : 'JPY') === c ? ' selected' : ''}>${names[c]}${c !== 'TWD' ? ` ${c}` : ''}</option>`).join('')}</select></div>
      <div class="field" id="tr-rate-f"><label for="tr-rate">匯率：1 單位當地貨幣 = 幾元台幣</label><input class="input" id="tr-rate" inputmode="decimal" value="${t ? t.rate || '' : rates.JPY || ''}" placeholder="例如日圓 0.21"></div>`,
    onOpen: w => {
      const sync = () => { const c = $('#tr-cur', w).value; $('#tr-rate-f', w).hidden = c === 'TWD'; if (!t && rates[c]) $('#tr-rate', w).value = rates[c]; };
      $('#tr-cur', w).addEventListener('change', sync); sync();
      setTimeout(() => $('#tr-name', w).focus(), 50);
    },
    onOk: w => {
      const name = $('#tr-name', w).value.trim() || '旅行';
      const currency = $('#tr-cur', w).value;
      const rate = parseFloat($('#tr-rate', w).value);
      if (currency !== 'TWD' && !(rate > 0)) { $('#tr-rate', w).focus(); toast('填一下匯率，才能幫你換算台幣', { icon: '💱' }); return false; }
      const tag = name.replace(/\s+/g, '');
      S.setSettings({ trip: { ...(t || {}), active: true, name, tag, currency, rate: currency === 'TWD' ? null : rate, start: t ? t.start : todayISO() }, fxRates: currency === 'TWD' ? rates : { ...rates, [currency]: rate } });
    },
  });
  if (ok) { haptic([12, 40, 12]); toast(t ? '旅行設定更新了' : `${S.getSettings().trip.name}，出發！之後每筆都會標上 #${S.getSettings().trip.tag}`, { icon: '✈️', duration: 4000 }); if (!t) celebrate({ count: 70 }); }
}
async function endTrip() {
  const t = S.getSettings().trip; if (!t) return;
  const list = tripSpent(t);
  const total = list.reduce((a, b) => a + b.amount, 0);
  const days = Math.max(1, Math.round((fromISO(todayISO()) - fromISO(t.start)) / 864e5) + 1);
  const ok = await dialog({ title: `結束「${t.name}」？`, body: `這趟 ${days} 天，總共花了 ${money(total)}（${list.length} 筆）。之後記帳就不會再自動加標籤。`, ok: '結束旅行' });
  if (!ok) return;
  S.setSettings({ trip: null, trips: [...(S.getSettings().trips || []), { name: t.name, tag: t.tag, start: t.start, end: todayISO(), total }] });
  haptic([12, 40, 12]); celebrate({ count: 90 });
  toast(`歡迎回家！「${t.name}」總共 ${money(total)} 🏠`, { icon: '🧳', duration: 4500 });
}

// ---------- 付款方式：長按刪除 ----------
let accPress = null;
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-acc]'); if (!b) return;
  clearTimeout(accPress?.t);
  accPress = { long: false, t: setTimeout(async () => {
    accPress.long = true; haptic(14);
    const a = b.dataset.acc;
    if (await dialog({ title: `刪除「${a}」？`, body: '已經記過的紀錄會保留這個付款方式。', ok: '刪除', danger: true })) {
      const st = S.getSettings();
      S.setSettings({ accounts: accountList().filter(x => x !== a), defaultAccount: st.defaultAccount === a ? null : st.defaultAccount });
    }
  }, 520) };
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => { if (accPress) clearTimeout(accPress.t); }, true));

// ---------- 共同帳本 ----------
function bookSettle(list, book) {
  // 每個人付了多少，平分後誰該補誰
  const exp = list.filter(e => e.type === 'expense');
  const paid = Object.fromEntries(book.members.map(m => [m.id, 0]));
  const meId = S.myId();
  for (const e of exp) {
    const who = e.mine === false ? e.userId : meId;
    paid[who] = (paid[who] || 0) + e.amount;
  }
  const total = exp.reduce((a, b) => a + b.amount, 0);
  const n = Math.max(1, book.members.length);
  const share = total / n;
  const me = book.members.find(m => m.me) || { id: meId, name: '我' };
  const others = book.members.filter(m => !m.me);
  const myDiff = (paid[me.id] || 0) - share; // 正數：別人要給我
  return { total, paid, share, me, others, myDiff };
}
function renderBookHero(list, isCur, mo) {
  const hero = $('#book-hero');
  const book = S.getBook();
  if (!book || state.scope !== 'book') { hero.hidden = true; return; }
  hero.hidden = false;
  const s = bookSettle(list, book);
  const nameOf = id => (book.members.find(m => m.id === id) || {}).name || '對方';
  const other = s.others[0];
  let line;
  if (!s.total) line = '這個月還沒有共同支出';
  else if (Math.abs(s.myDiff) < 1) line = '剛好打平，誰都不用補 🤝';
  else if (s.myDiff > 0) line = `${other ? esc(other.name) : '對方'}要給你 <b>${money(Math.round(s.myDiff))}</b>`;
  else line = `你要給${other ? esc(other.name) : '對方'} <b>${money(Math.round(-s.myDiff))}</b>`;
  hero.innerHTML = `<div class="bh-top"><span>👫 ${esc(book.name)} · ${isCur ? '本月' : `${mo + 1}月`}共同支出</span><b class="bh-total">${money(s.total)}</b></div>
    <div class="bh-people">${book.members.map(m => `<div class="bh-p"><span class="avatar sm">${esc(m.avatar || [...(m.name || '?')][0])}</span><span>${esc(m.me ? '我' : m.name)}付了</span><b>${money(s.paid[m.id] || 0)}</b></div>`).join('')}</div>
    <div class="bh-settle">${line}${book.members.length > 1 && s.total ? `<small>（每人 ${money(Math.round(s.share))}）</small>` : ''}</div>`;
  void nameOf;
}
function renderBookCard() {
  const card = $('#book-card'); if (!card) return;
  const book = S.getBook();
  const signed = !!S.cloud.user;
  if (book) {
    const alone = book.members.length < 2;
    card.innerHTML = `<div class="card-head"><h2>👫 ${esc(book.name)}</h2><span class="card-sub">${book.members.length} 人</span></div>
      <div class="bh-people" style="margin-bottom:10px">${book.members.map(m => `<div class="bh-p"><span class="avatar sm">${esc(m.avatar || [...(m.name || '?')][0])}</span><span>${esc(m.me ? `${m.name}（我）` : m.name)}</span></div>`).join('')}</div>
      ${alone ? `<p class="note" style="margin:0 0 8px">把邀請碼傳給她，她登入後在這裡輸入就能加入：</p>` : ''}
      <div class="invite"><span>邀請碼</span><b>${esc(book.code)}</b><button class="btn ghost sm" type="button" data-act="book-copy">複製</button>${navigator.share ? '<button class="btn ghost sm" type="button" data-act="book-share">傳給她</button>' : ''}</div>
      <p class="note" style="margin:10px 0">記帳時加上「#一起」，或點輸入框上方的「👫 共同」，就會記進共同帳本。圖表頁可以切換看共同支出和誰該補多少。</p>
      <button class="btn ghost block" type="button" data-act="book-leave">離開共同帳本</button>`;
  } else if (!signed) {
    card.innerHTML = `<div class="card-head"><h2>👫 共同帳本</h2></div><p class="note" style="margin:0 0 10px">約會、房租、旅行這種一起花的錢，兩個人都能記、都看得到，月底自動算誰該補多少。各自的私帳照樣分開。</p><button class="btn ghost block" type="button" data-act="goto-cloud">先開啟雲端同步並登入</button>`;
  } else {
    card.innerHTML = `<div class="card-head"><h2>👫 共同帳本</h2></div><p class="note" style="margin:0 0 10px">約會、房租、旅行這種一起花的錢，兩個人都能記、都看得到，月底自動算誰該補多少。各自的私帳照樣分開，她看不到你的私帳。</p>
      <div class="row"><button class="btn primary grow" type="button" data-act="book-create">建立共同帳本</button><button class="btn ghost grow" type="button" data-act="book-join">輸入邀請碼</button></div>`;
  }
}
async function bookAction(act) {
  try {
    if (act === 'book-create') {
      let name = '我們的帳本';
      const ok = await dialog({ title: '建立共同帳本', ok: '建立', extra: '<input class="input" id="bk-name" maxlength="20" value="我們的帳本" aria-label="帳本名稱">', onOpen: w => setTimeout(() => $('#bk-name', w).select(), 50), onOk: w => { name = $('#bk-name', w).value.trim() || name; } });
      if (!ok) return;
      await S.createBook(name);
      haptic([12, 40, 12]); celebrate({ count: 80 });
      toast(`「${name}」建好了，把邀請碼傳給她吧 💌`, { icon: '👫', duration: 4500 });
    } else if (act === 'book-join') {
      let code = '';
      const ok = await dialog({ title: '加入共同帳本', body: '輸入對方給你的 6 碼邀請碼。', ok: '加入', extra: '<input class="input" id="bk-code" maxlength="6" autocapitalize="characters" placeholder="例如 A1B2C3" style="font-size:22px;letter-spacing:.2em;text-align:center;text-transform:uppercase">', onOpen: w => setTimeout(() => $('#bk-code', w).focus(), 50), onOk: w => { code = $('#bk-code', w).value.trim(); if (code.length < 6) return false; } });
      if (!ok) return;
      const b = await S.joinBook(code);
      haptic([12, 40, 12]); celebrate({ count: 80 });
      toast(`加入「${b.name}」了 👫`, { icon: '🎉' });
    } else if (act === 'book-copy') {
      copyText(S.getBook().code, '邀請碼複製好了');
    } else if (act === 'book-share') {
      const b = S.getBook();
      try { await navigator.share({ title: '一起記帳', text: `一起用「隨手記帳」記共同支出吧！打開 App →「我的」→ 共同帳本 → 輸入邀請碼：${b.code}`, url: location.origin + location.pathname }); } catch { /* 取消 */ }
    } else if (act === 'book-leave') {
      if (!(await dialog({ title: '離開共同帳本？', body: '你記在共同帳本的紀錄會變回你自己的帳；對方記的會從這台裝置移除。之後可以用邀請碼再加入。', ok: '離開', danger: true }))) return;
      await S.leaveBook(); state.scope = 'me'; state.sharedMode = false;
      toast('已離開共同帳本', { icon: '👋' });
    }
  } catch (err) { toast(err.message || String(err), { icon: '⚠️', duration: 5000 }); }
}

// ---------- 輸入列：共同、語音、拍照 ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function renderComposerExtras() {
  if (!S.getBook()) state.sharedMode = false;
  $('#composer').classList.toggle('can-mic', !!SpeechRec);
  quickChips();
}
let rec = null;
function startVoice() {
  if (!SpeechRec) { toast('這個瀏覽器不支援語音輸入', { icon: '🎙️' }); return; }
  if (rec) { rec.stop(); return; }
  rec = new SpeechRec();
  rec.lang = 'zh-TW'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  const btn = $('#mic-btn');
  const base = input.value.trim();
  let finalText = '';
  btn.classList.add('listening'); haptic(10);
  preview.className = 'preview ok'; $('#composer').classList.add('typing');
  preview.innerHTML = '<span>🎙️ 請說，例如「晚餐一百二」…</span>';
  rec.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    input.value = [base, finalText + interim].filter(Boolean).join(' ').replace(/[。！？]$/, '');
    updatePreview();
  };
  rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('需要麥克風權限才能語音記帳', { icon: '🎙️' }); else if (ev.error === 'no-speech') toast('沒聽到聲音，再試一次', { icon: '🎙️' }); };
  rec.onend = () => {
    btn.classList.remove('listening'); rec = null;
    const t = input.value.trim();
    updatePreview();
    // 聽得懂又有金額就直接記（下面一樣有「撤銷」）
    if (t && finalText && parseSmart(t).list.length) { input.dataset.last = t; submit(); }
    else if (t) input.focus();
  };
  try { rec.start(); } catch { btn.classList.remove('listening'); rec = null; }
}

// ---------- 情話：排日期、紀念日 ----------
async function pickLoveDate() {
  const t = todayISO();
  const max = new Date(); max.setDate(max.getDate() + 60);
  let v = state.loveDate && state.loveDate > t ? state.loveDate : t;
  const ok = await dialog({
    title: '哪天送給她？', ok: '好', cancel: '取消',
    body: '選未來的日子，到那天她打開連結才看得到，忙的時候也不會斷。',
    extra: `<div class="row"><button class="btn ghost sm" type="button" data-ld="0">今天</button><button class="btn ghost sm" type="button" data-ld="1">明天</button><button class="btn ghost sm" type="button" data-ld="7">一週後</button></div><input class="input" type="date" id="ld-date" min="${t}" max="${toISO(max)}" value="${v}">`,
    onOpen: w => $$('[data-ld]', w).forEach(b => b.addEventListener('click', () => { const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.ld)); $('#ld-date', w).value = toISO(d); })),
    onOk: w => { v = $('#ld-date', w).value || t; },
  });
  if (!ok) return;
  state.loveDate = v > t ? v : null;
  haptic(6); renderLove();
}
function annivInfo() {
  const a = S.getSettings().anniv;
  if (!a || !a.date) return null;
  const start = fromISO(a.date), today = fromISO(todayISO());
  const days = Math.round((today - start) / 864e5) + 1;
  // 下一個週年
  let next = new Date(today.getFullYear(), start.getMonth(), start.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, start.getMonth(), start.getDate());
  const toNext = Math.round((next - today) / 864e5);
  const years = next.getFullYear() - start.getFullYear();
  // 下一個整百天
  const nextHundred = Math.ceil((days + 1) / 100) * 100;
  return { ...a, days, toNext, years, nextHundred, toHundred: nextHundred - days };
}
function renderAnniv() {
  const box = $('#love-anniv'); if (!box) return;
  const a = annivInfo();
  if (!a) { box.innerHTML = '<button class="linkish" type="button" data-act="anniv-edit">💞 設定你們的紀念日，倒數給她看</button>'; return; }
  const soon = a.toNext === 0 ? `今天是 ${a.years} 週年 🎉` : a.toHundred < a.toNext ? `再 ${a.toHundred} 天就第 ${a.nextHundred} 天` : `距離 ${a.years} 週年還有 ${a.toNext} 天`;
  box.innerHTML = `<button class="anniv-pill" type="button" data-act="anniv-edit"><span>💞 ${esc(a.label || '在一起')}第 <b>${a.days}</b> 天</span><small>${soon}</small></button>`;
}
async function editAnniv() {
  const a = S.getSettings().anniv || {};
  let removed = false;
  const ok = await dialog({
    title: '紀念日', ok: '儲存', cancel: '取消', body: '她打開專屬連結時也會看到倒數。',
    extra: `<input class="input" id="an-label" maxlength="10" placeholder="例如：在一起、結婚" value="${esc(a.label || '在一起')}"><input class="input" type="date" id="an-date" max="${todayISO()}" value="${a.date || ''}">${a.date ? '<button class="linkish" type="button" data-an-del style="align-self:flex-start;color:var(--danger)">移除紀念日</button>' : ''}`,
    onOpen: (w, done) => { const d = $('[data-an-del]', w); if (d) d.addEventListener('click', () => { removed = true; S.setSettings({ anniv: null }); done(false); }); },
    onOk: w => { const d = $('#an-date', w).value; if (!d) { $('#an-date', w).focus(); return false; } S.setSettings({ anniv: { date: d, label: $('#an-label', w).value.trim() || '在一起' } }); },
  });
  if (ok && !removed) { haptic([12, 40, 12]); heartBurst(null); toast(`${annivInfo().label}第 ${annivInfo().days} 天 💞`, { icon: '💞' }); }
}

// ---------- 拍收據／截圖記帳 ----------
async function handleReceipt(file) {
  if (!file) return;
  setView('chat');
  preview.className = 'preview ok'; $('#composer').classList.add('typing');
  const show = (p, msg) => { preview.innerHTML = `<span class="ocr-prog"><i style="width:${Math.round(p * 100)}%"></i></span><span>📷 ${esc(msg)}</span>`; };
  show(0.02, '讀取圖片…');
  try {
    const text = await recognize(file, show);
    const r = receiptToText(text);
    const sentence = toSentence(r);
    if (!sentence) { toast('看不出金額，換一張清楚一點的，或直接打字記', { icon: '🧐', duration: 4000 }); updatePreview(); return; }
    input.value = sentence; updatePreview(); input.focus();
    const L = input.value.length; input.setSelectionRange(L, L);
    haptic([10, 30, 10]);
    toast('辨識好了，確認一下再按送出', { icon: '📷' });
  } catch (err) {
    toast(err.message || '辨識失敗', { icon: '⚠️', duration: 4500 }); updatePreview();
  }
}
$('#ocr-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleReceipt(f); });
// 貼上銀行／支付通知：自動整理成「店家 金額」
input.addEventListener('paste', e => {
  const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (!looksLikeNotice(t)) return;
  const sentence = toSentence(receiptToText(t));
  if (!sentence) return;
  e.preventDefault();
  input.value = sentence; updatePreview();
  toast('幫你把通知整理成一句了，確認後送出', { icon: '✂️' });
});
// Android 從其他 App 分享圖片或文字進來
async function handleShareTarget() {
  const u = new URL(location.href);
  if (u.searchParams.has('text') || u.searchParams.has('title')) {
    const t = [u.searchParams.get('title'), u.searchParams.get('text')].filter(Boolean).join(' ');
    history.replaceState(null, '', location.pathname);
    const sentence = looksLikeNotice(t) ? toSentence(receiptToText(t)) : null;
    setView('chat'); input.value = sentence || t; updatePreview(); input.focus();
    return;
  }
  if (u.searchParams.has('shared') && 'caches' in window) {
    history.replaceState(null, '', location.pathname);
    try {
      const c = await caches.open('jz-share');
      const res = await c.match('shared-image');
      if (res) { const blob = await res.blob(); await c.delete('shared-image'); handleReceipt(new File([blob], 'shared', { type: blob.type })); }
    } catch (err) { console.warn(err); }
  }
}

// ---------- 月報與年度回顧 ----------
function recapRange(key, year = false) {
  if (year) { const y = Number(key); return { from: `${y}-01-01`, to: `${y}-12-31`, pf: `${y - 1}-01-01`, pt: `${y - 1}-12-31`, title: `${y} 年度回顧`, sub: '這一年的你' }; }
  const [y, m] = key.split('-').map(Number);
  const last = daysIn(y, m - 1);
  const p = new Date(y, m - 2, 1);
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}`, pf: `${monthKey(p)}-01`, pt: `${monthKey(p)}-${String(daysIn(p.getFullYear(), p.getMonth())).padStart(2, '0')}`, title: `${m} 月回顧`, sub: `${y} 年 ${m} 月` };
}
async function openRecap(key, year = false) {
  key = key || (year ? String(new Date().getFullYear()) : monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)));
  const r = recapRange(key, year);
  const real = entries().filter(e => !e.sample);
  const s = recapStats(real.length ? real : entries(), r.from, r.to, r.pf, r.pt, categoryInfo);
  if (!s.n) { toast(`${r.sub}沒有紀錄可以回顧`, { icon: '📭' }); return; }
  if (!year) S.setSettings({ recapSeen: key });
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a8a65';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  const blob = await recapImage(s, { title: r.title, sub: r.sub, name: S.getProfile().name, accent, dark });
  const url = URL.createObjectURL(blob);
  const file = new File([blob], `${r.title}.png`, { type: 'image/png' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  haptic([12, 40, 12]); celebrate({ count: 90 });
  await dialog({
    title: `🎁 ${r.title}`, ok: canShare ? '分享' : '存成圖片', cancel: '關閉',
    extra: `<img class="recap-img" src="${url}" alt="${esc(r.title)}：總支出 ${money(s.expense)}">
      <p class="note" style="margin:0">${esc(recapHeadline(s))}${s.biggest ? ` · 最大一筆「${esc(s.biggest.note)}」${money(s.biggest.amount)}` : ''}</p>`,
    onOk: async (w, close) => {
      if (canShare) { try { await navigator.share({ files: [file], title: r.title }); } catch { /* 取消 */ } }
      else { const a = document.createElement('a'); a.href = url; a.download = `${r.title}.png`; document.body.appendChild(a); a.click(); a.remove(); toast('圖片存好了', { icon: '🖼️' }); }
      close();
      return false;
    },
  });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// 每月第一次打開：上個月有紀錄就送上回顧；一月時多一個年度回顧
function recapPrompt() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = monthKey(prev);
  const st = S.getSettings();
  if (st.recapSeen === key || st.recapPrompted === key) return;
  const n = entries().filter(e => !e.sample && e.date.startsWith(key)).length;
  if (n < 5) return;
  S.setSettings({ recapPrompted: key });
  const yearBtn = now.getMonth() === 0 ? `<button class="btn ghost sm" type="button" data-act="recap-year" data-year="${prev.getFullYear()}">${prev.getFullYear()} 年度回顧</button>` : '';
  state.ephemeral.push({ at: new Date().toISOString(), html: `<p>🎁 <b>${prev.getMonth() + 1} 月回顧</b>做好了！看看上個月的你花在哪、省了多少。</p><div class="row" style="margin-top:8px"><button class="btn primary sm" type="button" data-act="recap" data-month="${key}">打開看看</button>${yearBtn}</div>` });
}

// ---------- 每日記帳提醒（推播） ----------
const VAPID = window.JZ_CONFIG && window.JZ_CONFIG.vapidPublicKey;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); }
function renderRemindCard() {
  const card = $('#remind-card'); if (!card) return;
  const r = S.getSettings().remind || {};
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let body;
  if (!pushSupported() || (ios && !isStandalone())) body = `<p class="note" style="margin:0">${ios ? 'iPhone 要先把 App「加入主畫面」，從主畫面打開後才能開啟提醒。' : '這個瀏覽器不支援推播提醒。'}</p>`;
  else if (!S.cloud.user) body = '<p class="note" style="margin:0 0 10px">提醒是從雲端送出的，要先開啟雲端同步並登入。</p><button class="btn ghost block" type="button" data-act="goto-cloud">前往雲端同步設定</button>';
  else if (!VAPID) body = '<p class="note" style="margin:0">推播還差一步伺服器設定（見說明文件「每日提醒」），設定好就能開啟。</p>';
  else if (r.on) body = `<div class="set-row" style="border:0;padding:0"><div class="t"><b>每天 ${esc(r.time || '21:00')} 提醒</b><small>那天還沒記帳才會通知，一天最多一次</small></div><div class="row"><button class="btn ghost sm" type="button" data-act="remind-time">改時間</button><button class="btn ghost sm" type="button" data-act="remind-off">關閉</button></div></div>`;
  else body = '<p class="note" style="margin:0 0 10px">晚上還沒記帳時提醒你一次，記過了就不吵你。</p><button class="btn primary block" type="button" data-act="remind-on">🔔 開啟每日提醒</button>';
  card.innerHTML = `<div class="card-head"><h2>每日記帳提醒</h2></div>${body}`;
}
async function remindAction(act) {
  try {
    if (act === 'remind-off') {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await S.removePush(sub.endpoint); await sub.unsubscribe(); }
      S.setSettings({ remind: { ...(S.getSettings().remind || {}), on: false } });
      toast('已關閉提醒', { icon: '🔕' }); return;
    }
    let time = (S.getSettings().remind || {}).time || '21:00';
    if (act === 'remind-time' || act === 'remind-on') {
      const ok = await dialog({ title: '幾點提醒你？', ok: act === 'remind-on' ? '開啟' : '儲存', extra: `<input class="input" type="time" id="rm-time" value="${time}" step="900">`, onOk: w => { time = $('#rm-time', w).value || '21:00'; } });
      if (!ok) return;
    }
    if (act === 'remind-on') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('要允許通知才能提醒你喔', { icon: '🔔' }); return; }
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) });
    await S.savePush(sub.toJSON(), time, Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei');
    S.setSettings({ remind: { on: true, time } });
    haptic(12); toast(`好，每天 ${time} 還沒記帳就提醒你 🔔`, { icon: '🔔' });
  } catch (err) { toast(err.message || String(err), { icon: '⚠️', duration: 5000 }); }
}

// ---------- 範例資料 ----------
function makeSample() {
  const out = [];
  const now = new Date();
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) / 5) * 5;
  const add = (d, note, amount, type = 'expense', hour = 12) => {
    const p = parseMessage(`${note} ${amount}`)[0];
    const iso = toISO(d);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(Math.random() * 59));
    if (at > now) return; // 今天還沒到的時間就不產生
    out.push({ raw: `${note} ${type === 'income' ? '+' : ''}${amount}`, type, amount, category: p ? (type === 'income' ? (p.type === 'income' ? p.category : '其他收入') : p.category) : '其他', date: iso, note, createdAt: at.toISOString() });
  };
  for (let back = 5; back >= 0; back--) {
    const y = now.getFullYear(), mo = now.getMonth() - back;
    const n = daysIn(new Date(y, mo, 1).getFullYear(), new Date(y, mo, 1).getMonth());
    for (let day = 1; day <= n; day++) {
      const d = new Date(y, mo, day);
      if (d > now) break;
      const wd = d.getDay();
      if (day === 1) add(d, '房租', 12000, 'expense', 9);
      if (day === 5) add(d, '薪水', 45000, 'income', 10);
      if (day === 10) add(d, 'Netflix', 390, 'expense', 20);
      if (day === 15) add(d, '電話費', 599, 'expense', 19);
      if (day === 20 && (mo % 2 === 0)) add(d, '電費', rnd(600, 1400), 'expense', 19);
      if ([8, 18, 28].includes(day)) add(d, '加油', rnd(900, 1300), 'expense', 18);
      if (back === 2 && day === 12) add(d, '股利', 3200, 'income', 9);
      if (Math.random() < 0.7) add(d, '早餐', rnd(45, 90), 'expense', 8);
      if (Math.random() < 0.85) add(d, wd % 6 === 0 ? '早午餐' : '午餐', rnd(95, 180), 'expense', 12);
      if (Math.random() < 0.45) add(d, '飲料', rnd(45, 75), 'expense', 15);
      if (wd > 0 && wd < 6 && Math.random() < 0.7) add(d, '捷運', rnd(20, 45), 'expense', 9);
      if (wd === 6 && Math.random() < 0.6) add(d, '聚餐', rnd(400, 900), 'expense', 19);
      else if (Math.random() < 0.75) add(d, '晚餐', rnd(100, 260), 'expense', 19);
      if (Math.random() < 0.12) add(d, '蝦皮', rnd(200, 1500), 'expense', 22);
      if (Math.random() < 0.1) add(d, '全聯', rnd(300, 900), 'expense', 20);
      if (Math.random() < 0.06) add(d, '電影', 330, 'expense', 21);
      if (Math.random() < 0.08) add(d, '計程車', rnd(150, 350), 'expense', 23);
      if (Math.random() < 0.04) add(d, '看醫生', 150, 'expense', 10);
      if (Math.random() < 0.05) add(d, '書', rnd(250, 480), 'expense', 16);
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function toggleSample() {
  if (S.hasSample()) { S.clearSample(); toast('範例資料已清除，開始記你自己的帳吧 ✏️'); return; }
  S.addSample(makeSample());
  state.animateStats = true;
  toast('已載入範例資料', { icon: '📊', action: '看圖表', onAction: () => setView('stats') });
}

// ---------- 匯出匯入 ----------
async function doExport() {
  const csv = S.toCSV();
  const n = entries().length;
  if (!n) { toast('還沒有紀錄可以匯出', { icon: '📭' }); return; }
  if (inFrame) {
    const ok = await dialog({
      title: '匯出 CSV', body: '預覽模式不能直接下載，複製下面的內容貼到記事本存成 .csv 就可以。', ok: '複製',
      extra: `<textarea readonly id="csv-text" aria-label="CSV 內容">${esc(csv.replace(/^﻿/, ''))}</textarea>`,
      onOk: (w, close) => {
        const ta = $('#csv-text', w);
        const manual = () => { ta.focus(); ta.select(); toast('請長按文字，選「全選」再複製', { icon: '✋', duration: 4000 }); };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(close, manual);
          else manual();
        } catch { manual(); }
        return false;
      },
    });
    if (!ok) return;
  } else {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `記帳備份-${todayISO().replace(/-/g, '')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  S.setSettings({ lastExport: Date.now() });
  haptic(12);
  toast(`已匯出 ${n} 筆紀錄，資料安全 +1`, { icon: '📁' });
}

// ---------- 我的：個人頁 ----------
const ACCENTS = [
  { id: 'jade', name: '翡翠', c: '#0a8a65' }, { id: 'ocean', name: '海洋', c: '#1f6fd1' }, { id: 'sakura', name: '櫻花', c: '#c93d72' },
  { id: 'sunset', name: '夕陽', c: '#bf550b' }, { id: 'lavender', name: '薰衣草', c: '#6a4fd0' }, { id: 'ink', name: '墨黑', c: '#2b3038' },
];
const COVERS = [{ id: 'aurora', name: '極光' }, { id: 'ledger', name: '帳本' }, { id: 'dots', name: '圓點' }, { id: 'stripes', name: '斜紋' }, { id: 'plain', name: '純色' }];
const AVATAR_EMOJI = ['🐻', '🐱', '🐶', '🐰', '🦊', '🐼', '🐨', '🐯', '🐸', '🐧', '🦄', '🐳', '🌻', '🍀', '⭐', '😎'];
const PERSON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const isPhoto = v => typeof v === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

function avatarHTML(p, fallback = 'icon') {
  const a = p.avatar;
  if (a && a.kind === 'photo' && isPhoto(a.value)) return `<img src="${a.value}" alt="">`;
  if (a && a.kind === 'emoji' && a.value) return esc(a.value);
  if (p.name) return esc([...p.name.trim()][0] || '🙂');
  return fallback === 'icon' ? PERSON_SVG : '🙂';
}

let themeOwned = false, lastTheme = '';
function applyTheme(p = S.getProfile()) {
  const key = `${p.accent}|${p.mode}`;
  if (key === lastTheme) return;
  lastTheme = key;
  const root = document.documentElement;
  if (p.accent && p.accent !== 'jade') root.dataset.accent = p.accent; else delete root.dataset.accent;
  if (p.mode === 'light' || p.mode === 'dark') { root.dataset.theme = p.mode; themeOwned = true; }
  else if (themeOwned) { delete root.dataset.theme; themeOwned = false; }
  requestAnimationFrame(() => {
    const c = getComputedStyle(document.body).getPropertyValue('--surface').trim();
    if (c) $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', c));
  });
}

function longestRun(sortedDays) {
  let best = 0, run = 0, prev = null;
  for (const d of sortedDays) {
    run = prev && Math.round((fromISO(d) - fromISO(prev)) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return best;
}
function runUntilToday(daySet) {
  const d = new Date();
  if (!daySet.has(toISO(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (daySet.has(toISO(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function goalProgress() {
  const g = S.getProfile().goal;
  if (!g || !(g.amount > 0)) return null;
  const net = entries().filter(e => !e.sample && e.date >= (g.start || '0000-00-00'))
    .reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
  const saved = Math.max(0, (g.base || 0) + net);
  return { ...g, saved, pct: Math.min(100, Math.floor(saved / g.amount * 100)), left: Math.max(0, g.amount - saved) };
}

function personalStats() {
  const list = entries().filter(e => !e.sample);
  const days = [...new Set(list.map(e => localDay(e.createdAt)))].sort();
  const first = days[0] || null;
  let noSpend = 0;
  if (first) {
    const spentDays = new Set(list.filter(e => e.type === 'expense').map(e => e.date));
    const d = fromISO(first), end = fromISO(todayISO());
    while (d < end) { if (!spentDays.has(toISO(d))) noSpend++; d.setDate(d.getDate() + 1); }
  }
  const months = {};
  list.forEach(e => {
    const m = months[e.date.slice(0, 7)] = months[e.date.slice(0, 7)] || { inc: 0, exp: 0, n: 0 };
    m[e.type === 'income' ? 'inc' : 'exp'] += e.amount; m.n++;
  });
  const cur = monthKey(new Date());
  const budget = S.getSettings().budget;
  const p = S.getProfile();
  const g = goalProgress();
  return {
    total: list.length, days: days.length, longest: longestRun(days), first, noSpend,
    budgetSet: budget > 0,
    budgetKept: budget > 0 && Object.entries(months).some(([k, m]) => k < cur && m.n >= 10 && m.exp <= budget),
    saver: Object.values(months).some(m => m.inc > 0 && m.n >= 5 && (m.inc - m.exp) / m.inc >= 0.2),
    taught: Object.keys(S.getLearned()).length,
    goalSet: !!g, goalPct: g ? g.pct : 0, goalDone: !!g && g.pct >= 100,
    profileDone: !!(p.name && p.avatar),
    loveLongest: longestRun([...new Set(S.getLove().map(n => n.date))].sort()),
  };
}

const BADGES = [
  { id: 'profile', icon: '✨', name: '有型有款', desc: '設定暱稱和頭像', ok: s => s.profileDone, prog: () => '去布置' },
  { id: 'first', icon: '🌱', name: '第一步', desc: '記下第一筆帳', ok: s => s.total >= 1, prog: () => '0/1' },
  { id: 'streak3', icon: '🔥', name: '連續 3 天', desc: '連續 3 天都有記帳', ok: s => s.longest >= 3, prog: s => `${s.longest}/3` },
  { id: 'streak7', icon: '⚡', name: '一週不間斷', desc: '連續 7 天都有記帳', ok: s => s.longest >= 7, prog: s => `${s.longest}/7` },
  { id: 'streak30', icon: '🏅', name: '30 天達人', desc: '連續 30 天都有記帳', ok: s => s.longest >= 30, prog: s => `${s.longest}/30` },
  { id: 'count100', icon: '📒', name: '百筆紀錄', desc: '累積 100 筆紀錄', ok: s => s.total >= 100, prog: s => `${s.total}/100` },
  { id: 'nospend', icon: '🍃', name: '無支出日', desc: '累積 5 天完全沒花錢', ok: s => s.noSpend >= 5, prog: s => `${s.noSpend}/5` },
  { id: 'budget', icon: '🎯', name: '守住預算', desc: '有一整個月花費都在預算內', ok: s => s.budgetKept, prog: s => (s.budgetSet ? '月底結算' : '先設預算') },
  { id: 'saver', icon: '💰', name: '存錢高手', desc: '某個月存下收入的兩成以上', ok: s => s.saver, prog: () => '加油' },
  { id: 'teacher', icon: '🧠', name: '調教小幫手', desc: '幫小幫手改正 3 次分類', ok: s => s.taught >= 3, prog: s => `${s.taught}/3` },
  { id: 'goal', icon: '🚀', name: '夢想達成', desc: '完成一個存錢目標', ok: s => s.goalDone, prog: s => (s.goalSet ? `${s.goalPct}%` : '先設目標') },
  { id: 'love7', icon: '💞', name: '情話一週', desc: '連續 7 天寫情話給她', ok: s => s.loveLongest >= 7, prog: s => `${s.loveLongest}/7` },
];

function checkBadges() {
  const st = S.getSettings();
  const have = new Set(st.badges || []);
  const s = personalStats();
  const fresh = BADGES.filter(b => !have.has(b.id) && b.ok(s));
  if (fresh.length) {
    const at = new Date().toISOString();
    S.setSettings({
      badges: [...have, ...fresh.map(b => b.id)],
      badgeAt: { ...(st.badgeAt || {}), ...Object.fromEntries(fresh.map(b => [b.id, at])) },
      badgeNew: [...new Set([...(st.badgeNew || []), ...fresh.map(b => b.id)])],
    });
  }
  return fresh;
}
function celebrateBadges(list, delay = 0) {
  if (!list.length) return;
  setTimeout(() => {
    const b = list[0];
    toast(`解鎖徽章「${b.name}」${list.length > 1 ? `等 ${list.length} 個` : ''}`, { icon: b.icon, action: '去看看', onAction: () => setView('settings'), duration: 5000 });
    celebrate({ count: 120 }); haptic([18, 50, 18]);
  }, delay);
}

function renderTabAva() {
  $('#tab-ava').innerHTML = avatarHTML(S.getProfile(), 'icon');
  $('#tab-dot').hidden = !(S.getSettings().badgeNew || []).length;
}

function renderMe(animate = false) {
  const p = S.getProfile();
  const s = personalStats();
  const dayN = s.first ? Math.round((fromISO(todayISO()) - fromISO(s.first)) / 864e5) + 1 : 0;
  $('#profile-card').innerHTML = `<div class="cover" data-cover="${esc(p.cover)}"><button class="cover-edit" type="button" data-act="edit-profile">✏️ 布置</button></div>
    <div class="p-body">
      <button class="p-ava-btn" type="button" data-act="edit-profile" aria-label="換頭像"><span class="avatar lg">${avatarHTML(p, 'smile')}</span><span class="cam" aria-hidden="true">📷</span></button>
      <button type="button" class="p-name${p.name ? '' : ' p-empty'}" data-act="edit-profile">${p.name ? esc(p.name) : '幫自己取個暱稱吧'}</button>
      <button type="button" class="p-bio${p.bio ? '' : ' p-empty'}" data-act="edit-profile">${p.bio ? esc(p.bio) : '寫一句給自己的話 ✨'}</button>
      <div class="p-meta">${s.first ? `<span>記帳第 ${dayN} 天</span><span>${s.first.replace(/-/g, '/')} 開始</span>` : '<span>今天開始記帳吧 ✏️</span>'}</div>
    </div>`;
  const have = new Set(S.getSettings().badges || []);
  $('#me-stats').innerHTML = [[s.days, '記帳天數'], [s.total, '總筆數'], [s.longest, '最長連續'], [`${have.size}/${BADGES.length}`, '徽章']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  renderGoal(animate);
  renderBadges(s, have);
  renderLove();
}

function renderGoal(animate) {
  const card = $('#goal-card');
  const g = goalProgress();
  if (!g) {
    card.innerHTML = `<div class="card-head"><h2>🎯 存錢目標</h2></div>
      <p class="note" style="margin:0 0 10px">定一個目標，例如「日本旅行 $60,000」，每記一筆都看得到離夢想多近。</p>
      <button class="btn primary block" type="button" data-act="edit-goal">設定目標</button>`;
    return;
  }
  const msg = g.pct >= 100 ? '目標達成！你做到了 🏆' : g.pct >= 75 ? '快到了，再加把勁 🔥' : g.pct >= 50 ? '過半了，太厲害了 🎉'
    : g.pct >= 25 ? '穩穩前進中 💪' : g.saved > 0 ? '起步了，每一筆都算數 🌱' : '從今天開始，收入減支出都會算進來 🌱';
  card.innerHTML = `<div class="card-head"><h2>🎯 ${esc(g.name || '存錢目標')}</h2><button class="btn ghost sm" type="button" data-act="edit-goal">編輯</button></div>
    <div class="goal-nums"><span>已存 <b>${money(g.saved)}</b></span><span>目標 ${money(g.amount)} · ${g.pct}%</span></div>
    <div class="goal-track" role="progressbar" aria-label="存錢目標進度" aria-valuenow="${g.pct}" aria-valuemin="0" aria-valuemax="100"><i></i></div>
    <p class="goal-msg">${msg}${g.left > 0 ? ` 還差 ${money(g.left)}` : ''}</p>`;
  const bar = $('.goal-track i', card);
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = g.pct + '%'; }));
  else { bar.style.transition = 'none'; bar.style.width = g.pct + '%'; }
}

function renderBadges(s, have) {
  const fresh = new Set(S.getSettings().badgeNew || []);
  $('#badge-card').innerHTML = `<div class="card-head"><h2>成就徽章</h2><span class="card-sub">${have.size} / ${BADGES.length}</span></div>
    <div class="badges">${BADGES.map(b => {
      const on = have.has(b.id);
      return `<button class="badge ${on ? 'on' : 'off'}${on && fresh.has(b.id) ? ' new' : ''}" type="button" data-badge="${b.id}"><span class="b-ico" aria-hidden="true">${b.icon}</span><span class="b-name">${b.name}</span>${on ? '' : `<span class="b-prog">${b.prog(s)}</span>`}</button>`;
    }).join('')}</div>`;
}

// ---------- 每日情話 ----------
const loveStreak = () => runUntilToday(new Set(S.getLove().map(n => n.date)));
let loveBuilt = false;
function buildLoveCard() {
  $('#love-card').innerHTML = `<div class="love-head"><h2>💌 每日情話</h2><span class="love-streak" id="love-streak" hidden></span></div>
    <div id="love-today"></div>
    <textarea class="love-input" id="love-input" maxlength="500" placeholder="今天想對她說什麼？" aria-label="寫給她的話"></textarea>
    <div class="love-actions"><span class="love-count" id="love-count">0 / 500</span><button class="btn ghost sm" type="button" id="love-when" aria-label="選擇哪天送出">📅 今天</button><button class="btn love" type="button" id="love-send" disabled>送給她 💌</button></div>
    <div class="love-anniv" id="love-anniv"></div>
    <div class="love-share" id="love-share"></div>
    <div class="love-list" id="love-list"></div>`;
  const ta = $('#love-input');
  ta.value = state.loveDraft || '';
  ta.addEventListener('input', () => {
    state.loveDraft = ta.value;
    $('#love-count').textContent = `${ta.value.length} / 500`;
    $('#love-send').disabled = !ta.value.trim();
  });
  $('#love-send').addEventListener('click', sendLove);
  $('#love-when').addEventListener('click', pickLoveDate);
  loveBuilt = true;
}

function renderLove() {
  if (!loveBuilt) buildLoveCard();
  const notes = [...S.getLove()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const t = todayISO();
  const today = notes.filter(n => n.date === t);
  const past = notes.filter(n => n.date < t);
  const future = notes.filter(n => n.date > t).sort((a, b) => a.date.localeCompare(b.date));
  const st = loveStreak();
  const sEl = $('#love-streak');
  sEl.hidden = st < 1;
  sEl.textContent = `💗 連續 ${st} 天`;
  const shareOn = !!S.getShare();
  const statusOf = n => (n.seenAt ? '<span class="li-seen">她看過了 ✓</span>' : (shareOn && n._synced ? '<span>還沒看</span>' : ''))
    + (n.hearts ? `<span class="li-seen">❤️ ×${n.hearts}</span>` : '');
  const replyOf = n => (n.reply ? `<span class="li-reply">💬 她回：${esc(n.reply)}</span>` : '');
  $('#love-today').innerHTML = today.map(n => `<button class="love-today" type="button" data-love="${n.id}">
      <span class="lt-label">今天寫給她的 <span class="li-status">${statusOf(n)}</span></span><span class="lt-body">${esc(n.body)}</span>${replyOf(n)}</button>`).join('')
    + (future.length ? `<div class="love-list-title">排好的 · ${future.length} 則（到那天她才看得到）</div>` + future.map(n => `<button class="love-item future" type="button" data-love="${n.id}"><span class="li-top"><span>📅 ${dayTitle(n.date)}</span></span><span class="li-body">${esc(n.body)}</span></button>`).join('') : '');
  const wd = state.loveDate && state.loveDate > t ? state.loveDate : null;
  $('#love-when').textContent = wd ? `📅 ${relDay(wd)}` : '📅 今天';
  $('#love-when').classList.toggle('on', !!wd);
  $('#love-send').textContent = wd ? '排好送出 📅' : '送給她 💌';
  renderAnniv();
  const ta = $('#love-input');
  ta.placeholder = today.length ? '想再多說一句也可以 💗' : '今天想對她說什麼？';
  $('#love-count').textContent = `${ta.value.length} / 500`;
  $('#love-send').disabled = !ta.value.trim();
  renderLoveShare();
  const shown = state.loveShowAll ? past : past.slice(0, 5);
  $('#love-list').innerHTML = past.length ? `<div class="love-list-title">寫過的話 · ${past.length} 則</div>`
    + shown.map(n => `<button class="love-item" type="button" data-love="${n.id}"><span class="li-top"><span>${dayTitle(n.date)}</span><span class="li-status">${statusOf(n)}</span></span><span class="li-body">${esc(n.body)}</span>${replyOf(n)}</button>`).join('')
    + (past.length > shown.length ? `<button class="load-more" type="button" data-act="love-all">看全部 ${past.length} 則</button>` : '') : '';
}

function renderLoveShare() {
  const box = $('#love-share');
  const c = S.cloud, share = S.getShare();
  if (inFrame) {
    box.innerHTML = '<p class="note">預覽版不能分享。放上你的網址並開啟雲端同步後，就能產生她的專屬連結。</p>';
    return;
  }
  if (!c.user) {
    box.innerHTML = `<p class="note">想讓她在自己的手機看到，先開啟下面的「雲端同步」並登入，就能產生一個只給她的專屬連結。</p>
      <button class="btn ghost block" type="button" data-act="goto-cloud">前往雲端同步設定</button>`;
    return;
  }
  const err = c.extraError ? `<p class="note" style="color:var(--danger)">⚠️ ${esc(c.extraError)}</p>` : '';
  if (!share) {
    box.innerHTML = err + `<p class="note">產生專屬連結傳給她，她不用下載也不用登入，打開就看得到你寫的話。她看不到你的帳。</p>
      <button class="btn love block" type="button" data-act="love-share-on">💗 產生她的專屬連結</button>`;
    return;
  }
  const link = S.shareLink(share.token);
  box.innerHTML = err + `<div class="love-link"><span>${esc(link)}</span><button class="btn ghost sm" type="button" data-act="love-copy">複製</button></div>
    <div class="row"><button class="btn love" type="button" data-act="love-send-link">傳給她</button><a class="btn ghost" href="https://line.me/R/share?text=${encodeURIComponent('給你的每日情話 💌\n' + link)}" target="_blank" rel="noopener">用 LINE 傳</a></div>
    <div class="love-more"><button type="button" data-act="love-preview">預覽她看到的</button><button type="button" data-act="love-reset">換新連結</button><button type="button" data-act="love-share-off">停止分享</button></div>`;
}

function heartBurst(el) {
  const cs = getComputedStyle(document.documentElement);
  const r = el ? el.getBoundingClientRect() : null;
  confetti({ count: 45, hearts: true, colors: [cs.getPropertyValue('--love').trim() || '#c93d72', '#ff8fb6', '#ffc2d6'], origin: r ? { x: r.left + r.width / 2, y: r.top } : undefined });
}

function sendLove() {
  const ta = $('#love-input');
  const body = ta.value.trim();
  if (!body) return;
  const before = loveStreak();
  const when = state.loveDate && state.loveDate > todayISO() ? state.loveDate : todayISO();
  S.addLove(body, when);
  ta.value = ''; state.loveDraft = '';
  if (when !== todayISO()) { state.loveDate = null; haptic([12, 40, 12]); heartBurst($('#love-send')); toast(`排好了，${relDay(when)}她就會看到 📅`, { icon: '💗' }); return; }
  const st = loveStreak();
  haptic([12, 40, 12]);
  heartBurst($('#love-send'));
  let msg;
  if ([3, 7, 14, 30, 100, 365].includes(st) && st > before) msg = `連續 ${st} 天寫情話，好浪漫 💞`;
  else if (S.cloud.user && S.getShare()) msg = '送出了 💌 她打開連結就看得到';
  else if (S.cloud.user) msg = '寫好了 💌 產生專屬連結就能傳給她';
  else msg = '寫好了 💌 開啟雲端同步後，她就能用連結看到';
  toast(msg, { icon: '💗' });
  celebrateBadges(checkBadges(), 1200);
}

async function editLove(id) {
  const n = S.getLove().find(x => x.id === id);
  if (!n) return;
  let removed = false, newBody = null;
  const seen = (n.seenAt ? `<p class="note" style="margin:0">她在 ${relDay(localDay(n.seenAt))} ${hhmm(n.seenAt)} 看過了${n.hearts ? `，還回了你 ❤️×${n.hearts}` : ''} 💗</p>` : '')
    + (n.reply ? `<p class="note li-reply" style="margin:0">💬 她回：${esc(n.reply)}</p>` : '')
    + (n.date > todayISO() ? `<p class="note" style="margin:0">📅 ${dayTitle(n.date)}她才看得到</p>` : '');
  const ok = await dialog({
    title: `${dayTitle(n.date)}的情話`, ok: '儲存',
    extra: `<textarea class="love-input" id="love-edit" maxlength="500" aria-label="情話內容">${esc(n.body)}</textarea>${seen}<button type="button" class="linkish danger" id="love-del">刪除這則</button>`,
    onOpen: (w, done) => { $('#love-del', w).addEventListener('click', () => { removed = true; done(false); }); },
    onOk: w => { const v = $('#love-edit', w).value.trim(); if (!v) { $('#love-edit', w).focus(); return false; } newBody = v; },
  });
  if (removed) {
    const copy = S.deleteLove(id);
    haptic([10, 30, 10]);
    toast('已刪除這則情話', { icon: '🗑️', action: '復原', onAction: () => { S.restoreLove(copy); toast('已復原 💗'); } });
  } else if (ok && newBody && newBody !== n.body) {
    S.updateLove(id, newBody);
    haptic(12); toast('改好了 💗');
  }
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg, { icon: '📋' }); haptic(10); }
  catch { await dialog({ title: '複製連結', body: '長按下面的連結，選「全選」再複製。', ok: '好', cancel: '', extra: `<textarea readonly class="love-input" style="min-height:90px;font-size:13px">${esc(text)}</textarea>` }); }
}

// ---------- 布置個人頁（底部表單） ----------
const psheet = $('#psheet'), pform = $('#pform');
let pdraft = null;
function openProfile(focus) {
  if (state.editing) closeEdit();
  pdraft = JSON.parse(JSON.stringify(S.getProfile()));
  $('#p-name').value = pdraft.name || '';
  $('#p-bio').value = pdraft.bio || '';
  const g = pdraft.goal || {};
  $('#p-goal-name').value = g.name || '';
  $('#p-goal-amt').value = g.amount || '';
  $('#p-goal-base').value = g.base || '';
  renderPSheet();
  psheet.style.transform = '';
  psheet.classList.add('show'); backdrop.classList.add('show'); document.documentElement.classList.add('sheet-open');
  psheet.scrollTop = 0;
  haptic(6);
  if (focus === 'goal') setTimeout(() => { $('#p-goal-name').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('#p-goal-name').focus({ preventScroll: true }); }, 380);
}
function renderPSheet() {
  const p = pdraft;
  $('#p-ava-preview').innerHTML = avatarHTML({ ...p, name: $('#p-name').value.trim() }, 'smile');
  $('#p-photo-clear').hidden = !(p.avatar && p.avatar.kind === 'photo');
  const cur = p.avatar && p.avatar.kind === 'emoji' ? p.avatar.value : null;
  $('#p-emojis').innerHTML = AVATAR_EMOJI.map(e => `<button type="button" class="emo${e === cur ? ' on' : ''}" data-emo="${e}" role="radio" aria-checked="${e === cur}" aria-label="頭像 ${e}">${e}</button>`).join('');
  $('#p-accents').innerHTML = ACCENTS.map(a => `<button type="button" class="sw-btn${a.id === p.accent ? ' on' : ''}" data-accent="${a.id}" role="radio" aria-checked="${a.id === p.accent}"><span class="sw-dot" style="background:${a.c}">${a.id === p.accent ? '✓' : ''}</span>${a.name}</button>`).join('');
  $$('#p-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === (p.mode || 'system')));
  $('#p-covers').innerHTML = COVERS.map(c => `<button type="button" class="cv-btn${c.id === p.cover ? ' on' : ''}" data-cover="${c.id}" role="radio" aria-checked="${c.id === p.cover}"><span class="cover" data-cover="${c.id}"></span>${c.name}</button>`).join('');
}
function closeProfile(saved = false) {
  if (!state.editing) document.documentElement.classList.remove('sheet-open');
  if (!psheet.classList.contains('show')) return;
  psheet.classList.remove('show'); backdrop.classList.remove('show'); psheet.style.transform = '';
  if (!saved) { lastTheme = ''; applyTheme(S.getProfile()); }
  pdraft = null;
}
function readPhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 512×512 在高解析螢幕上也清楚；她的頁面頭像欄位上限 200000 字，所以畫質會自動往下調到放得進去
      const size = 512, c = document.createElement('canvas');
      c.width = c.height = size;
      const m = Math.min(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.9, out = c.toDataURL('image/jpeg', q);
      while (out.length > 190000 && q > 0.5) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      res(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('讀不到這張圖片，換一張試試')); };
    img.src = url;
  });
}
psheet.addEventListener('click', e => {
  if (!pdraft) return;
  const emo = e.target.closest('[data-emo]'), acc = e.target.closest('.sw-btn'), cov = e.target.closest('.cv-btn'), mode = e.target.closest('#p-mode button');
  if (emo) pdraft.avatar = { kind: 'emoji', value: emo.dataset.emo };
  else if (acc) { pdraft.accent = acc.dataset.accent; applyTheme(pdraft); }
  else if (cov) pdraft.cover = cov.dataset.cover;
  else if (mode) { pdraft.mode = mode.dataset.m; applyTheme(pdraft); }
  else return;
  haptic(6); renderPSheet();
});
$('#p-name').addEventListener('input', () => { if (pdraft) $('#p-ava-preview').innerHTML = avatarHTML({ ...pdraft, name: $('#p-name').value.trim() }, 'smile'); });
$('#p-photo-btn').addEventListener('click', () => $('#p-photo').click());
$('#p-photo').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !pdraft) return;
  try { pdraft.avatar = { kind: 'photo', value: await readPhoto(f) }; renderPSheet(); haptic(10); }
  catch (err) { toast(err.message, { icon: '⚠️' }); }
});
$('#p-photo-clear').addEventListener('click', () => { if (pdraft) { pdraft.avatar = { kind: 'emoji', value: '🐻' }; renderPSheet(); } });
$('#psheet-close').addEventListener('click', () => closeProfile(false));
pform.addEventListener('submit', ev => {
  ev.preventDefault();
  if (!pdraft) return;
  const was = S.getProfile();
  pdraft.name = $('#p-name').value.trim().slice(0, 20);
  pdraft.bio = $('#p-bio').value.trim().slice(0, 40);
  const num = id => parseFloat(($(id).value || '').replace(/[,$\s]/g, ''));
  const amt = num('#p-goal-amt'), base = num('#p-goal-base') || 0;
  const gname = $('#p-goal-name').value.trim().slice(0, 16);
  if (amt > 0) pdraft.goal = { name: gname || '存錢目標', amount: amt, base: Math.max(0, base), start: was.goal?.start || todayISO() };
  else if (gname) {
    const m = $('#p-goal-amt').closest('.money-input');
    m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake');
    $('#p-goal-amt').focus(); haptic([10, 40, 10]); toast('目標金額要填喔', { icon: '🎯' });
    return;
  } else pdraft.goal = null;
  const name = pdraft.name;
  S.setProfile(pdraft);
  closeProfile(true);
  haptic(12);
  toast(!was.name && name ? `很高興認識你，${name}！👋` : '個人頁面更新好了 ✨', { icon: '🎨' });
  celebrate({ count: 60 });
  celebrateBadges(checkBadges(), 1300);
});

enableSwipe(psheet, () => closeProfile(false));

// ---------- 畫面切換 ----------
const VIEWS = ['chat', 'stats', 'settings'];
const TITLES = { chat: '隨手記帳', stats: '圖表', settings: '我的' };
function setView(v) {
  if (!VIEWS.includes(v)) v = 'chat';
  const changed = v !== state.view;
  state.view = v;
  tip(null);
  VIEWS.forEach(x => $('#view-' + x).classList.toggle('active', x === v));
  $$('.tab').forEach(t => { const on = t.dataset.view === v; t.classList.toggle('active', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  $('#tab-ind').style.transform = `translateX(${VIEWS.indexOf(v) * 100}%)`;
  $('#composer').hidden = v !== 'chat';
  $('#month-strip').hidden = v !== 'chat';
  $('#view-title').textContent = TITLES[v];
  if (v === 'stats') { if (changed) state.animateStats = true; renderStats(); $('#view-stats').scrollTop = changed ? 0 : $('#view-stats').scrollTop; }
  if (v === 'settings') {
    renderSettings(true); renderMe(changed);
    if (changed) $('#view-settings').scrollTop = 0;
    if ((S.getSettings().badgeNew || []).length) setTimeout(() => S.setSettings({ badgeNew: [] }), 2600);
  }
  if (v === 'chat') renderChat(true);
  if (changed) haptic(5);
  requestAnimationFrame(setDock);
}

let renderQueued = false, bookKey = S.getBook()?.id || '';
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!pdraft) applyTheme(S.getProfile()); // 布置中的主題預覽不要被蓋掉
    applyCustomCats();
    if (bookKey !== (S.getBook()?.id || '')) { bookKey = S.getBook()?.id || ''; renderComposerExtras(); }
    renderTabAva();
    renderPill(); renderStrip(); updatePreview();
    if (state.view === 'chat') renderChat();
    if (state.view === 'stats') { renderStats(false); renderSearch(); }
    if (state.view === 'settings') { renderSettings(); renderMe(false); }
  });
}

// ---------- 事件 ----------
$('#composer').addEventListener('submit', e => { e.preventDefault(); input.dataset.last = input.value.trim(); submit(); });
input.addEventListener('input', updatePreview);
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
$('#month-strip').addEventListener('click', () => { state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); setView('stats'); });
$('#sync-pill').addEventListener('click', () => { haptic(5); syncSheet(); });
$('#m-prev').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); state.catFilter = null; haptic(5); renderStats(true); });
$('#m-next').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); state.catFilter = null; haptic(5); renderStats(true); });
$('#cat-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.t === state.catType) return; state.catType = b.dataset.t; state.catFilter = null; haptic(5); renderDonut(inMonth(scopeEntries(), state.month)); renderDetail(inMonth(scopeEntries(), state.month)); });

// 統一處理各種 data-* 按鈕
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-edit],[data-try],[data-act],[data-go],[data-badge],[data-love],[data-search],[data-recur],[data-acc],[data-ccat],[data-scope],.lg-row');
  if (!t || t.closest('.dialog-wrap')) return;
  if (t.dataset.badge) {
    const b = BADGES.find(x => x.id === t.dataset.badge);
    const at = (S.getSettings().badgeAt || {})[b.id];
    if ((S.getSettings().badges || []).includes(b.id)) toast(`${b.name}：${b.desc}${at ? `（${relDay(localDay(at))}解鎖）` : ''}`, { icon: b.icon });
    else toast(`還沒解鎖「${b.name}」：${b.desc}`, { icon: '🔒' });
    haptic(6); return;
  }
  if (t.dataset.search) { openSearch(t.dataset.search); haptic(6); return; }
  if (t.dataset.recur) { editRecurring(t.dataset.recur); return; }
  if (t.dataset.ccat != null) { editCustomCat(Number(t.dataset.ccat)); return; }
  if (t.dataset.scope) { if (state.scope !== t.dataset.scope) { state.scope = t.dataset.scope; state.catFilter = null; haptic(6); renderStats(true); } return; }
  if (t.dataset.acc) {
    if (accPress && accPress.long) { accPress = null; return; }
    const cur = S.getSettings().defaultAccount;
    S.setSettings({ defaultAccount: cur === t.dataset.acc ? null : t.dataset.acc }); haptic(6);
    toast(cur === t.dataset.acc ? '已取消預設付款方式' : `之後沒說的話，都記成「${t.dataset.acc}」`, { icon: accIcon(t.dataset.acc) });
    return;
  }
  if (t.dataset.love) { editLove(t.dataset.love); return; }
  if (t.dataset.edit) { openEdit(t.dataset.edit); return; }
  if (t.dataset.try) { if (state.view !== 'chat') setView('chat'); input.value = t.dataset.try; updatePreview(); input.focus(); haptic(6); return; }
  if (t.dataset.go) { setView(t.dataset.go); return; }
  if (t.classList.contains('lg-row')) {
    state.catFilter = state.catFilter === t.dataset.cat ? null : t.dataset.cat;
    haptic(5);
    renderDetail(inMonth(scopeEntries(), state.month));
    if (state.catFilter) $('#detail-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const act = t.dataset.act;
  if (act === 'cat-budget') { editCatBudgets(); return; }
  if (act === 'anniv-edit') { editAnniv(); return; }
  if (act === 'recur-add') { editRecurring(null); return; }
  if (act === 'recur-manage') { setView('settings'); setTimeout(() => $('#recur-card').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); return; }
  if (act === 'ccat-add') { editCustomCat(null); return; }
  if (act === 'trip-start') { editTrip(false); return; }
  if (act === 'trip-edit') { editTrip(true); return; }
  if (act === 'trip-end') { endTrip(); return; }
  if (act === 'acc-add') {
    const ok = await dialog({ title: '新增付款方式', ok: '新增', extra: '<input class="input" id="acc-name" maxlength="12" placeholder="例如：國泰卡、全支付">', onOpen: w => setTimeout(() => $('#acc-name', w).focus(), 50), onOk: w => { const v = $('#acc-name', w).value.trim(); if (!v) return false; if (!accountList().includes(v)) S.setSettings({ accounts: [...accountList(), v] }); } });
    if (ok) { haptic(10); toast('新增好了，記帳時打這個名字就會帶入', { icon: '👛' }); }
    return;
  }
  if (act && act.startsWith('book-')) { bookAction(act, t); return; }
  if (act && act.startsWith('remind-')) { remindAction(act, t); return; }
  if (act === 'shared-toggle') { state.sharedMode = !state.sharedMode; haptic(8); renderComposerExtras(); updatePreview(); toast(state.sharedMode ? '接下來記的會放進共同帳本 👫' : '回到記我自己的帳', { icon: state.sharedMode ? '👫' : '🙋' }); return; }
  if (act === 'mic') { startVoice(); return; }
  if (act === 'cam') { $('#ocr-file').click(); return; }
  if (act === 'recap') { openRecap(t.dataset.month); return; }
  if (act === 'recap-year') { openRecap(t.dataset.year, true); return; }
  if (act === 'more') { state.showCount += 60; renderChat(); }
  else if (act === 'edit-profile') openProfile();
  else if (act === 'edit-goal') openProfile('goal');
  else if (act === 'love-all') { state.loveShowAll = true; renderLove(); }
  else if (act === 'goto-cloud') { const c = $('#cloud-card'); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); const d = $('details', c); if (d) d.open = true; }
  else if (act === 'love-share-on' || act === 'love-reset') {
    if (act === 'love-reset' && !(await dialog({ title: '換一個新連結？', body: '舊的連結會馬上失效，記得把新連結傳給她。', ok: '換新連結' }))) return;
    try {
      await S.enableShare(act === 'love-reset');
      haptic([12, 40, 12]); heartBurst(t);
      toast(act === 'love-reset' ? '新連結做好了，舊的已經失效' : '專屬連結做好了，傳給她吧 💌', { icon: '💗' });
    } catch (err) { toast(err.message || String(err), { icon: '⚠️', duration: 5000 }); }
  } else if (act === 'love-share-off') {
    if (!(await dialog({ title: '停止分享？', body: '她的連結會失效，你寫的話會保留在這裡。之後可以再產生新連結。', ok: '停止分享', danger: true }))) return;
    try { await S.disableShare(); toast('已停止分享'); } catch (err) { toast(err.message || String(err), { icon: '⚠️' }); }
  } else if (act === 'love-copy') {
    const sh = S.getShare(); if (sh) copyText(S.shareLink(sh.token), '連結複製好了，貼給她吧 💌');
  } else if (act === 'love-send-link') {
    const sh = S.getShare(); if (!sh) return;
    const link = S.shareLink(sh.token);
    if (navigator.share) { try { await navigator.share({ title: '給你的話', text: '給你的每日情話 💌', url: link }); haptic(10); } catch { /* 取消分享 */ } }
    else copyText(link, '連結複製好了，貼給她吧 💌');
  } else if (act === 'love-preview') {
    const sh = S.getShare(); if (sh) window.open(S.shareLink(sh.token), '_blank', 'noopener');
  }
  else if (act === 'undo') undoLast(false);
  else if (act === 'sample' || act === 'clear-sample') toggleSample();
  else if (act === 'clear-filter') { state.catFilter = null; renderDetail(inMonth(scopeEntries(), state.month)); }
  else if (act === 'budget-edit') editBudget();
  else if (act === 'budget-hint-off') { S.setSettings({ budgetHintOff: true }); haptic(5); toast('好，之後想設定可以到「我的」', { icon: '👌', action: '現在設定', onAction: editBudget }); 
  } else if (act === 'cloud-save') {
    const url = $('#sb-url').value.trim().replace(/\/+$/, ''), key = $('#sb-key').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('請貼上正確的 Project URL 和 anon key', { icon: '⚠️' }); return; }
    S.setCloudConfig({ url, key });
    toast('連線中…', { icon: '☁️', duration: 1200 });
    await S.initCloud();
    renderSettings(true);
    if (S.cloud.client) toast('已連上 Supabase！接著用 Google 登入', { icon: '☁️' });
  } else if (act === 'cloud-remove') {
    if (!(await dialog({ title: '中斷雲端連線？', body: '這台裝置的紀錄會保留，只是不再同步。', ok: '中斷連線', danger: true }))) return;
    await S.signOut().catch(() => {}); S.setCloudConfig(null); await S.initCloud(); renderSettings(true); toast('已中斷連線');
  } else if (act === 'signin') {
    try { await S.signIn(); } catch (err) { toast('登入失敗：' + (err.message || err), { icon: '⚠️', duration: 5000 }); }
  } else if (act === 'signin-email') {
    const em = ($('#sb-email').value || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { $('#sb-email').focus(); haptic([10, 40, 10]); toast('請輸入正確的 Email', { icon: '⚠️' }); return; }
    try { await S.signInEmail(em); haptic(12); toast('登入連結已寄出，到信箱點一下就完成 📬', { duration: 6000 }); }
    catch (err) { toast('寄送失敗：' + (err.message || err), { icon: '⚠️', duration: 5000 }); }
  } else if (act === 'signout') {
    if (!(await dialog({ title: '要登出嗎？', body: '這台裝置上的紀錄會保留，下次登入會再同步。', ok: '登出' }))) return;
    await S.signOut(); toast('已登出', { icon: '👋' });
  } else if (act === 'sync-now') {
    await S.sync();
    if (S.cloud.status === 'idle') { haptic(12); toast('同步完成，資料都在雲端了 ☁️'); }
  }
});

$('#budget-row-btn').addEventListener('click', editBudget);
$('#export-btn').addEventListener('click', doExport);
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const n = S.importCSV(await f.text());
    haptic(12);
    toast(n ? `匯入 ${n} 筆紀錄 ✓` : '檔案裡沒有找到紀錄', { icon: n ? '📥' : '🤔' });
    if (n) { celebrate({ count: 60 }); celebrateBadges(checkBadges(), 1200); }
  } catch (err) { toast('匯入失敗：' + err.message, { icon: '⚠️', duration: 5000 }); }
});
$('#sample-btn').addEventListener('click', toggleSample);
$('#clear-btn').addEventListener('click', async () => {
  if (!entries().length) { toast('目前沒有紀錄', { icon: '📭' }); return; }
  const ok = await dialog({ title: '清除所有紀錄？', body: `共 ${entries().length} 筆，清除後無法復原。${S.cloud.user ? '雲端上的資料也會一起刪除。' : ''}建議先匯出備份。`, ok: '全部清除', danger: true });
  if (!ok) return;
  S.clearAll(); state.ephemeral = []; state.fresh = null;
  toast('已清除所有紀錄', { icon: '🧹' });
});
$('#install-btn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null; renderInstall();
});

// 手機鍵盤打開時：讓畫面貼齊可視區、隱藏下方選單
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onVV = () => {
    const open = vv.height < window.innerHeight - 120 && document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    document.documentElement.classList.toggle('kb-open', !!open);
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    if (open) { window.scrollTo(0, 0); if (state.view === 'chat') { const v = $('#view-chat'); v.scrollTop = v.scrollHeight; } }
  };
  vv.addEventListener('resize', onVV);
  input.addEventListener('blur', () => setTimeout(onVV, 50));
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (state.view === 'stats') renderStats(false); }, 200); });

// 雲端狀態變化的提示
let prevStatus = S.cloud.status, firstSyncToast = false;
S.onChange(() => {
  const st = S.cloud.status;
  if (st !== prevStatus) {
    if (st === 'idle' && prevStatus === 'syncing' && !firstSyncToast) { firstSyncToast = true; toast('雲端同步完成，資料已安全備份 ☁️'); }
    prevStatus = st;
  }
  if (S.loveNews.hearts || S.loveNews.seen || S.loveNews.replies) {
    const h = S.loveNews.hearts, rp = S.loveNews.replies;
    S.loveNews.hearts = 0; S.loveNews.seen = 0; S.loveNews.replies = 0;
    setTimeout(() => {
      toast(rp ? `她回了你一句話 💬` : h ? `她回了你 ${h} 顆心 ❤️` : '她看過你寫的話了 💗', { icon: '💌', action: '看看', onAction: () => setView('settings'), duration: 6000 });
      heartBurst(null); haptic([12, 40, 12]);
    }, 300);
  }
  scheduleRender();
});
setInterval(() => { if (state.view === 'settings' && document.visibilityState === 'visible' && S.cloud.user) S.sync(); }, 45000);

// ---------- Service worker ----------
if ('serviceWorker' in navigator && !inFrame && /^https?:/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('有新版本囉', { icon: '🆕', action: '更新', duration: 10000, onAction: () => w.postMessage('skipWaiting') });
          }
        });
      });
    }).catch(err => console.warn('SW', err));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  });
}

// toast 出現在輸入區／下方選單上面
const setDock = () => {
  const r = $('#app').getBoundingClientRect();
  const tops = [$('#composer'), $('.tabbar')].filter(el => !el.hidden && el.offsetParent).map(el => el.getBoundingClientRect().top);
  const top = tops.length ? Math.min(...tops) : r.bottom;
  document.documentElement.style.setProperty('--dock', Math.max(0, window.innerHeight - top) + 'px');
};
if (window.ResizeObserver) { const ro = new ResizeObserver(setDock); ro.observe($('#composer')); ro.observe($('.tabbar')); }
window.addEventListener('resize', setDock);

// ---------- 開始 ----------
applyTheme(S.getProfile());
applyCustomCats();
runRecurring();
recurringHeadsUp();
recapPrompt();
renderComposerExtras();
checkBadges();
renderTabAva(); renderPill(); renderStrip(); quickChips(); updatePreview();
setView(location.hash === '#charts' ? 'stats' : 'chat');
S.initCloud();
handleShareTarget();
// 隔天打開（或從背景回來）時補記固定收支、提醒
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { applyCustomCats(); runRecurring(); recurringHeadsUp(); recapPrompt(); scheduleRender(); } });
