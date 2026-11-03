// 純 SVG 圖表：甜甜圈、每日長條、六個月收支（不需任何外部套件，離線也能畫）

const NS = 'http://www.w3.org/2000/svg';
export const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
export const money = n => '$' + nf.format(Math.round(n * 100) / 100);
export const compact = n => n >= 10000 ? (n / 10000).toFixed(n % 10000 ? 1 : 0).replace(/\.0$/, '') + '萬'
  : n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, '') + '千' : String(Math.round(n));

function niceMax(v) {
  if (!(v > 0)) return 100;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

// 上方圓角、底部平的長條
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------- tooltip ----------
let tipEl;
export function tip(html, x, y) {
  tipEl = tipEl || document.getElementById('tip');
  if (!tipEl) return;
  if (html == null) { tipEl.classList.remove('show'); return; }
  tipEl.innerHTML = html;
  tipEl.classList.add('show');
  const r = tipEl.getBoundingClientRect();
  let left = Math.min(Math.max(8, x - r.width / 2), innerWidth - r.width - 8);
  let top = y - r.height - 12;
  if (top < 8) top = y + 16;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.chart, .donut')) tip(null); }, { passive: true });
document.addEventListener('scroll', () => tip(null), { capture: true, passive: true });

function bindHover(el, html, onEnter, onLeave, onClick) {
  const show = e => { const b = el.getBoundingClientRect(); tip(html(), e.clientX || b.left + b.width / 2, b.top); onEnter && onEnter(); };
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(e); });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { tip(null); onLeave && onLeave(); } });
  el.addEventListener('click', e => { show(e); onClick && onClick(); });
}

// ---------- 甜甜圈 ----------
export function donut(host, slices, { centerTop, centerValue, onHover, animate = true } = {}) {
  host.innerHTML = '';
  const total = slices.reduce((s, x) => s + x.value, 0);
  const root = svg('svg', { viewBox: '0 0 200 200', class: 'donut', role: 'img', 'aria-label': centerTop + ' ' + money(total) }, host);
  const R = 78, W = 26, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 2 : 0;
  svg('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': W }, root);
  const g = svg('g', { transform: 'rotate(-90 100 100)' }, root);
  const t1 = svg('text', { x: 100, y: 90, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 13 }, root);
  const t2 = svg('text', { x: 100, y: 118, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 25, 'font-family': 'var(--font-display)' }, root);
  const setCenter = (a, b) => { t1.textContent = a; t2.textContent = b; };
  setCenter(centerTop, centerValue ?? money(total));
  if (!total) return root;
  let acc = 0;
  const arcs = slices.map(s => {
    const len = Math.max(0, s.value / total * C - GAP);
    const off = acc; acc += s.value / total * C;
    const c = svg('circle', {
      class: 'slice', cx: 100, cy: 100, r: R, fill: 'none', stroke: s.color, 'stroke-width': W,
      'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': -off,
    }, g);
    const pct = Math.round(s.value / total * 1000) / 10;
    bindHover(c,
      () => `<b>${s.icon || ''} ${s.label}</b><div class="tr"><span>${money(s.value)}</span><span>${pct}%</span></div>`,
      () => { c.setAttribute('stroke-width', W + 6); setCenter(`${s.icon || ''} ${s.label}`, pct + '%'); onHover && onHover(s.key); },
      () => { c.setAttribute('stroke-width', W); setCenter(centerTop, centerValue ?? money(total)); onHover && onHover(null); },
      () => {
        arcs.forEach(a => a.el.setAttribute('stroke-width', W));
        c.setAttribute('stroke-width', W + 6); setCenter(`${s.icon || ''} ${s.label}`, pct + '%'); onHover && onHover(s.key);
      });
    return { el: c, len, off };
  });
  const dur = reduceMotion() || !animate ? 0 : 750;
  const t0 = performance.now();
  const step = now => {
    const p = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = 1 - Math.pow(1 - p, 3);
    arcs.forEach(a => {
      a.el.setAttribute('stroke-dasharray', `${a.len * e} ${C}`);
      a.el.setAttribute('stroke-dashoffset', -a.off * e);
    });
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  root.resetCenter = () => { arcs.forEach(a => a.el.setAttribute('stroke-width', W)); setCenter(centerTop, centerValue ?? money(total)); };
  return root;
}

// ---------- 每日長條 ----------
export function dailyBars(host, days, { color = 'var(--s2)', todayIndex = -1, avg = 0, label = d => d.label, animate = true } = {}) {
  host.innerHTML = '';
  const W = Math.max(280, Math.round(host.clientWidth || 320)), H = 176;
  const P = { l: 40, r: 8, t: 14, b: 24 };
  const pw = W - P.l - P.r, ph = H - P.t - P.b;
  const max = niceMax(Math.max(...days.map(d => d.value), avg));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' + (animate && !reduceMotion() ? ' animate' : ''), role: 'img', 'aria-label': '每日支出長條圖' }, host);
  const y = v => P.t + ph - v / max * ph;
  [0, max / 2, max].forEach(v => {
    svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: v ? 'gridline' : 'baseline' }, root);
    svg('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = v ? compact(v) : '0';
  });
  const band = pw / days.length;
  const bw = Math.max(3, Math.min(16, band * 0.64));
  const bandsG = svg('g', {}, root);
  const barsG = svg('g', {}, root);
  const labelsG = svg('g', {}, root);
  const n = days.length;
  const shown = new Set([0, n - 1]);
  for (let i = 4; i < n; i += 5) shown.add(i);
  if (todayIndex >= 0) {
    for (const j of [...shown]) if (Math.abs(j - todayIndex) <= 2) shown.delete(j);
    shown.add(todayIndex);
  }
  days.forEach((d, i) => {
    const x = P.l + i * band;
    const hb = svg('rect', { x: x + 1, y: P.t, width: Math.max(1, band - 2), height: ph, rx: 6, class: 'hover-band' }, bandsG);
    if (d.value > 0) {
      const p = svg('path', { d: barPath(x + (band - bw) / 2, y(d.value), bw, P.t + ph - y(d.value)), fill: color, class: 'bar' }, barsG);
      p.style.animationDelay = (i * 14) + 'ms';
    }
    if (shown.has(i)) {
      const t = svg('text', { x: x + band / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick xl' + (i === todayIndex ? ' on' : '') }, labelsG);
      t.textContent = i === todayIndex ? '今天' : String(i + 1);
    }
    const hit = svg('rect', { x, y: P.t, width: band, height: ph + P.b, class: 'hit' }, root);
    bindHover(hit, () => label(d, i), () => hb.classList.add('on'), () => hb.classList.remove('on'), () => {
      bandsG.querySelectorAll('.on').forEach(e => e.classList.remove('on')); hb.classList.add('on');
    });
  });
  if (avg > 0) {
    svg('line', { x1: P.l, x2: W - P.r, y1: y(avg), y2: y(avg), class: 'avg' }, root);
    const lbl = svg('text', { x: W - P.r, y: y(avg) - 6, 'text-anchor': 'end', class: 'avg-label' }, root);
    lbl.textContent = '日均 ' + money(Math.round(avg));
  }
  return root;
}

// ---------- 六個月收支 ----------
export function monthBars(host, months, { selected = -1, onPick, animate = true } = {}) {
  host.innerHTML = '';
  const W = Math.max(280, Math.round(host.clientWidth || 320)), H = 190;
  const P = { l: 40, r: 8, t: 12, b: 26 };
  const pw = W - P.l - P.r, ph = H - P.t - P.b;
  const max = niceMax(Math.max(1, ...months.flatMap(m => [m.income, m.expense])));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' + (animate && !reduceMotion() ? ' animate' : ''), role: 'img', 'aria-label': '近六個月收入與支出' }, host);
  const y = v => P.t + ph - v / max * ph;
  [0, max / 2, max].forEach(v => {
    svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: v ? 'gridline' : 'baseline' }, root);
    svg('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = v ? compact(v) : '0';
  });
  const band = pw / months.length;
  const bw = Math.max(6, Math.min(20, band * 0.3));
  const gap = 2;
  const bandsG = svg('g', {}, root);
  months.forEach((m, i) => {
    const cx = P.l + i * band + band / 2;
    const hb = svg('rect', { x: P.l + i * band + 2, y: P.t, width: band - 4, height: ph, rx: 8, class: 'hover-band' + (i === selected ? ' on' : '') }, bandsG);
    [['income', 'var(--s1)', cx - bw - gap / 2], ['expense', 'var(--s2)', cx + gap / 2]].forEach(([k, col, x], j) => {
      if (m[k] > 0) {
        const p = svg('path', { d: barPath(x, y(m[k]), bw, P.t + ph - y(m[k])), fill: col, class: 'bar' }, root);
        p.style.animationDelay = (i * 60 + j * 30) + 'ms';
      }
    });
    const t = svg('text', { x: cx, y: H - 7, 'text-anchor': 'middle', class: 'tick xl' + (i === selected ? ' on' : '') }, root);
    t.textContent = m.label;
    const hit = svg('rect', { x: P.l + i * band, y: P.t, width: band, height: ph + P.b, class: 'hit' }, root);
    const bal = m.income - m.expense;
    bindHover(hit,
      () => `<b>${m.full}</b><div class="tr"><span><i class="sw" style="background:var(--s1)"></i>收入</span><span>${money(m.income)}</span></div><div class="tr"><span><i class="sw" style="background:var(--s2)"></i>支出</span><span>${money(m.expense)}</span></div><div class="tr"><span>結餘</span><span>${bal >= 0 ? '+' : '−'}${money(Math.abs(bal))}</span></div>`,
      () => hb.classList.add('on'), () => { if (i !== selected) hb.classList.remove('on'); },
      () => { onPick && onPick(i); });
  });
  return root;
}
