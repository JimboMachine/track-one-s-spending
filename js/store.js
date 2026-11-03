// 資料層：先存在瀏覽器（離線也能用），有設定 Supabase 並登入後自動雙向同步

const K = { entries: 'jz_entries', deleted: 'jz_deleted', learned: 'jz_learned', settings: 'jz_settings', cloud: 'jz_supabase' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } };

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
}));

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

let entries = load(K.entries, []);
let deleted = load(K.deleted, []);
const persist = () => { save(K.entries, entries); save(K.deleted, deleted); emit(); scheduleSync(); };

export const getEntries = () => entries;
export const getEntry = id => entries.find(e => e.id === id);

export function addEntries(list, raw) {
  const now = new Date().toISOString();
  const msgId = uuid();
  const added = list.map(p => ({
    id: uuid(), type: p.type, amount: p.amount, category: p.category, date: p.date,
    note: p.note || '', raw: raw || '', msgId, createdAt: now, updatedAt: now, _dirty: true,
  }));
  entries.push(...added);
  persist();
  return added;
}

export function updateEntry(id, patch) {
  const e = getEntry(id); if (!e) return;
  Object.assign(e, patch, { updatedAt: new Date().toISOString(), _dirty: true });
  persist();
}

export function deleteEntries(ids) {
  const set = new Set(ids);
  entries.forEach(e => { if (set.has(e.id) && e._synced) deleted.push(e.id); });
  entries = entries.filter(e => !set.has(e.id));
  persist();
}

export function restoreEntries(list) {
  const ids = new Set(list.map(e => e.id));
  deleted = deleted.filter(id => !ids.has(id));
  entries = entries.filter(e => !ids.has(e.id));
  entries.push(...list.map(e => ({ ...e, _dirty: !e.sample, updatedAt: new Date().toISOString() })));
  persist();
}

// ---------- 範例資料（不會同步到雲端） ----------
export const hasSample = () => entries.some(e => e.sample);
export function addSample(list) {
  const now = Date.now();
  list.forEach((p, i) => {
    const t = p.createdAt || new Date(now - (list.length - i) * 60000).toISOString();
    const id = uuid();
    entries.push({ id, msgId: id, createdAt: t, updatedAt: t, raw: p.raw, type: p.type, amount: p.amount, category: p.category, date: p.date, note: p.note, sample: true, _dirty: false });
  });
  persist();
}
export function clearSample() { entries = entries.filter(e => !e.sample); persist(); }

export function clearAll() {
  entries.forEach(e => { if (e._synced) deleted.push(e.id); });
  entries = [];
  persist();
}

// ---------- 自動學習分類 ----------
export const getLearned = () => load(K.learned, {});
export function learn(note, type, category) {
  const key = (note || '').trim().toLowerCase();
  if (!key || key.length > 20) return;
  const l = getLearned(); l[key] = { type, category }; save(K.learned, l);
}

// ---------- 設定 ----------
export const getSettings = () => ({ budget: 0, ...load(K.settings, {}) });
export const setSettings = patch => { save(K.settings, { ...getSettings(), ...patch }); emit(); };

// ---------- CSV ----------
const CSV_HEAD = ['日期', '類型', '分類', '金額', '備註', '原始訊息', 'id'];
const esc = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCSV() {
  const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map(e => [e.date, e.type === 'income' ? '收入' : '支出', e.category, e.amount, e.note, e.raw, e.id].map(esc).join(','));
  return '﻿' + [CSV_HEAD.join(','), ...rows].join('\r\n');
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
export function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return 0;
  const head = rows[0].map(h => h.trim());
  const col = names => head.findIndex(h => names.includes(h.toLowerCase()) || names.includes(h));
  const ci = {
    date: col(['日期', 'date']), type: col(['類型', 'type']), cat: col(['分類', 'category']),
    amt: col(['金額', 'amount']), note: col(['備註', 'note']), raw: col(['原始訊息', 'raw']), id: col(['id']),
  };
  if (ci.date < 0 || ci.amt < 0) throw new Error('找不到「日期」和「金額」欄位');
  const now = new Date().toISOString();
  let n = 0;
  for (const r of rows.slice(1)) {
    const date = (r[ci.date] || '').trim().replace(/\//g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
    let amount = parseFloat((r[ci.amt] || '').replace(/[,$\s]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(amount)) continue;
    const t = ci.type >= 0 ? (r[ci.type] || '').trim() : '';
    let type = /收入|income/i.test(t) ? 'income' : 'expense';
    if (!t && amount < 0) type = 'expense';
    amount = Math.abs(amount);
    const id = ci.id >= 0 && /^[0-9a-f-]{36}$/i.test((r[ci.id] || '').trim()) ? r[ci.id].trim() : uuid();
    const e = {
      id, type, amount, date,
      category: (ci.cat >= 0 && r[ci.cat]?.trim()) || (type === 'income' ? '其他收入' : '其他'),
      note: ci.note >= 0 ? (r[ci.note] || '').trim() : '', raw: ci.raw >= 0 ? (r[ci.raw] || '') : '',
      msgId: id, createdAt: now, updatedAt: now, _dirty: true,
    };
    const i = entries.findIndex(x => x.id === id);
    if (i >= 0) entries[i] = { ...entries[i], ...e, createdAt: entries[i].createdAt, _synced: entries[i]._synced };
    else entries.push(e);
    n++;
  }
  persist();
  return n;
}

// ---------- 雲端同步（Supabase） ----------
const DEFAULT_CLOUD = (window.JZ_CONFIG && window.JZ_CONFIG.supabaseUrl) ? { url: window.JZ_CONFIG.supabaseUrl, key: window.JZ_CONFIG.supabaseAnonKey } : null;
export const getCloudConfig = () => load(K.cloud, null) || DEFAULT_CLOUD;
export const setCloudConfig = cfg => { if (cfg) save(K.cloud, cfg); else localStorage.removeItem(K.cloud); };

export const cloud = { client: null, user: null, status: 'off', lastSync: null, error: null };
const setStatus = (s, err = null) => { cloud.status = s; cloud.error = err; emit(); };

export async function initCloud() {
  const cfg = getCloudConfig();
  if (!cfg || !cfg.url || !cfg.key) { cloud.client = null; cloud.user = null; setStatus('off'); return; }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm');
    cloud.client = createClient(cfg.url, cfg.key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
    const { data } = await cloud.client.auth.getSession();
    cloud.user = data.session?.user || null;
    cloud.client.auth.onAuthStateChange((_ev, session) => {
      const was = cloud.user?.id; cloud.user = session?.user || null;
      setStatus(cloud.user ? 'idle' : 'signedout');
      if (cloud.user && cloud.user.id !== was) sync();
    });
    setStatus(cloud.user ? 'idle' : 'signedout');
    if (cloud.user) sync();
  } catch (e) {
    console.error(e); setStatus('error', '無法載入雲端模組（可能離線）');
  }
}

export async function signIn() {
  if (!cloud.client) throw new Error('尚未設定 Supabase');
  const redirectTo = location.origin + location.pathname;
  const { error } = await cloud.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}
export async function signInEmail(email) {
  if (!cloud.client) throw new Error('尚未設定 Supabase');
  const { error } = await cloud.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() {
  if (cloud.client) await cloud.client.auth.signOut();
  cloud.user = null;
  // 登出後本機資料標記為未同步，避免下次登入別的帳號時被誤刪
  entries.forEach(e => { e._dirty = true; delete e._synced; }); deleted = [];
  save(K.entries, entries); save(K.deleted, deleted);
  setStatus('signedout');
}

const toRow = e => ({ id: e.id, type: e.type, amount: e.amount, category: e.category, date: e.date, note: e.note, raw: e.raw, msg_id: e.msgId, created_at: e.createdAt, updated_at: e.updatedAt });
const fromRow = r => ({ id: r.id, type: r.type, amount: Number(r.amount), category: r.category, date: r.date, note: r.note || '', raw: r.raw || '', msgId: r.msg_id || r.id, createdAt: r.created_at, updatedAt: r.updated_at, _synced: true });

let syncTimer = null, syncing = false, again = false;
function scheduleSync() { if (cloud.user) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800); } }

export async function sync() {
  if (!cloud.client || !cloud.user) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (syncing) { again = true; return; }
  syncing = true; setStatus('syncing');
  try {
    const db = cloud.client.from('entries');
    const dirty = entries.filter(e => e._dirty && !e.sample);
    if (dirty.length) {
      const { error } = await db.upsert(dirty.map(toRow), { onConflict: 'id' });
      if (error) throw error;
      const ids = new Set(dirty.map(e => e.id));
      entries.forEach(e => { if (ids.has(e.id)) { e._dirty = false; e._synced = true; } });
    }
    if (deleted.length) {
      const { error } = await cloud.client.from('entries').delete().in('id', deleted);
      if (error) throw error;
      deleted = [];
    }
    // 拉回雲端全部資料（分頁）
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await cloud.client.from('entries').select('*').order('created_at').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const stillDirty = entries.filter(e => e._dirty || e.sample); // 同步期間新增的 + 範例
    const dirtyIds = new Set(stillDirty.map(e => e.id));
    entries = [...rows.map(fromRow).filter(e => !dirtyIds.has(e.id)), ...stillDirty];
    save(K.entries, entries); save(K.deleted, deleted);
    cloud.lastSync = new Date();
    setStatus('idle');
  } catch (e) {
    console.error(e);
    const msg = /relation .*entries.* does not exist|Could not find the table/i.test(e.message || '') ? '資料表還沒建立，請先執行 supabase.sql' : (e.message || '同步失敗');
    setStatus('error', msg);
  } finally {
    syncing = false;
    if (again) { again = false; sync(); }
  }
}

window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
