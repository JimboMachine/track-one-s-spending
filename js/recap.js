// 月報／年度回顧：算數字、畫成一張可以存下來分享的圖

export function recapStats(all, from, to, prevFrom, prevTo, catInfo) {
  const list = all.filter(e => e.date >= from && e.date <= to);
  const exp = list.filter(e => e.type === 'expense');
  const inc = list.filter(e => e.type === 'income');
  const sum = l => l.reduce((a, b) => a + b.amount, 0);
  const prevExp = sum(all.filter(e => e.type === 'expense' && e.date >= prevFrom && e.date <= prevTo));
  const byCat = {};
  exp.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, v, icon: catInfo('expense', name).icon }));
  const byNote = {};
  exp.forEach(e => { byNote[e.note] = byNote[e.note] || { n: 0, v: 0, cat: e.category }; byNote[e.note].n++; byNote[e.note].v += e.amount; });
  const fav = Object.entries(byNote).sort((a, b) => b[1].n - a[1].n)[0];
  const biggest = exp.reduce((a, b) => (!a || b.amount > a.amount ? b : a), null);
  // 天數
  // 從開始記帳那天算起，才不會把還沒用 App 的日子算成「沒花錢」
  const firstDay = all.reduce((m, x) => (x.date < m ? x.date : m), to);
  const start = new Date((firstDay > from ? firstDay : from) + 'T00:00'), end = new Date(Math.min(new Date(to + 'T00:00'), new Date(new Date().toDateString())));
  const days = Math.max(1, Math.round((end - start) / 864e5) + 1);
  const spentDays = new Set(exp.map(e => e.date));
  const noSpend = Math.max(0, days - [...spentDays].filter(d => d <= to).length);
  const recDays = new Set(list.map(e => e.createdAt.slice(0, 10))).size;
  const e = sum(exp), i = sum(inc);
  return {
    n: list.length, expense: e, income: i, balance: i - e, savingRate: i > 0 ? (i - e) / i : null,
    prevExp, diff: prevExp > 0 ? (e - prevExp) / prevExp : null, cats, fav: fav ? { note: fav[0], ...fav[1], icon: catInfo('expense', fav[1].cat).icon } : null,
    biggest, days, noSpend, recDays, perDay: e / days,
  };
}

// 每月一句：依數字挑一句鼓勵的話
export function recapHeadline(s) {
  if (s.savingRate != null && s.savingRate >= 0.3) return `存下了收入的 ${Math.round(s.savingRate * 100)}%，超會存！`;
  if (s.diff != null && s.diff <= -0.1) return `比上一期少花 ${Math.round(-s.diff * 100)}%，進步很多！`;
  if (s.noSpend >= 5) return `有 ${s.noSpend} 天完全沒花錢，太自律了`;
  if (s.recDays >= 20) return `記了 ${s.recDays} 天帳，堅持就是力量`;
  return '每一筆都記下來，就是最好的開始';
}

const money = v => '$' + Math.round(v).toLocaleString('zh-TW');

// 畫成 1080×1350 的分享圖
export async function recapImage(s, { title, sub, name, accent = '#0a8a65', dark = false }) {
  try { await document.fonts.load('48px Huninn'); } catch { /* 字型沒載到就用系統字 */ }
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const F = (size, w = 400) => `${w} ${size}px Huninn, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  const bg = dark ? '#0f1714' : '#f3f7f5', card = dark ? '#18221e' : '#ffffff', ink = dark ? '#e7f0eb' : '#13201b', muted = dark ? '#9fb0a8' : '#5d6b65';
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  // 頂部色塊
  const g = x.createLinearGradient(0, 0, W, 520);
  g.addColorStop(0, accent); g.addColorStop(1, shade(accent, -0.25));
  roundRect(x, 40, 40, W - 80, 500, 48); x.fillStyle = g; x.fill();
  x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.arc(W - 120, 120, 220, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff';
  x.font = F(44); x.fillText(title, 100, 140);
  x.font = F(30); x.globalAlpha = 0.85; x.fillText(sub, 100, 192); x.globalAlpha = 1;
  x.font = F(36); x.fillText('總支出', 100, 290);
  x.font = F(120); x.fillText(money(s.expense), 96, 410);
  x.font = F(34); x.globalAlpha = 0.92;
  const line2 = [s.income ? `收入 ${money(s.income)}` : null, s.savingRate != null ? `存下 ${Math.max(0, Math.round(s.savingRate * 100))}%` : null, s.diff != null ? `${s.diff <= 0 ? '比上期少' : '比上期多'} ${Math.abs(Math.round(s.diff * 100))}%` : null].filter(Boolean).join('　·　');
  x.fillText(line2, 100, 480); x.globalAlpha = 1;
  // 一句話
  x.fillStyle = ink; x.font = F(46);
  wrap(x, '「' + recapHeadline(s) + '」', 80, 640, W - 160, 60);
  // 前三分類
  let y = 740;
  roundRect(x, 40, y, W - 80, 330, 36); x.fillStyle = card; x.fill();
  x.fillStyle = muted; x.font = F(30); x.fillText('花最多的地方', 90, y + 64);
  const top = s.cats.slice(0, 3);
  const maxV = top[0] ? top[0].v : 1;
  top.forEach((ct, i) => {
    const yy = y + 120 + (3 - top.length) * 35 + i * 70; // 不滿三項就置中
    x.font = F(40); x.fillStyle = ink; x.fillText(`${ct.icon} ${ct.name}`, 90, yy + 14);
    x.fillStyle = dark ? '#25322d' : '#e6eeea'; roundRect(x, 420, yy - 14, 380, 26, 13); x.fill();
    x.fillStyle = [accent, '#eb6834', '#2a78d6'][i]; roundRect(x, 420, yy - 14, Math.max(26, 380 * ct.v / maxV), 26, 13); x.fill();
    x.fillStyle = ink; x.font = F(36); x.textAlign = 'right'; x.fillText(money(ct.v), W - 90, yy + 12); x.textAlign = 'left';
  });
  if (!top.length) { x.fillStyle = muted; x.font = F(36); x.fillText('這段時間沒有支出 🌱', 90, y + 170); }
  // 小格子
  y = 1100;
  const tiles = [['🌱', `${s.noSpend} 天`, '無支出日'], ['📝', `${s.n} 筆`, '記帳筆數'], s.fav ? [s.fav.icon, s.fav.note.slice(0, 5), `最常買 ${s.fav.n} 次`] : ['📅', money(s.perDay), '平均每天']];
  const tw = (W - 80 - 40) / 3;
  tiles.forEach(([ic, big, lab], i) => {
    const tx = 40 + i * (tw + 20);
    roundRect(x, tx, y, tw, 170, 30); x.fillStyle = card; x.fill();
    x.font = F(40); x.fillStyle = ink; x.fillText(ic, tx + 30, y + 62);
    x.font = F(40); x.fillText(big, tx + 30, y + 118);
    x.font = F(26); x.fillStyle = muted; x.fillText(lab, tx + 30, y + 152);
  });
  x.fillStyle = muted; x.font = F(26);
  x.fillText(`${name ? name + ' · ' : ''}隨手記帳`, 50, H - 34);
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
function wrap(x, text, l, t, maxW, lh) {
  let line = '', y = t;
  for (const ch of [...text]) { if (x.measureText(line + ch).width > maxW) { x.fillText(line, l, y); line = ch; y += lh; } else line += ch; }
  if (line) x.fillText(line, l, y);
}
function shade(hex, k) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}
