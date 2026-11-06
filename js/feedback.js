// 正回饋：震動、提示、彩帶、鼓勵的話

import { reduceMotion } from './charts.js';

export function haptic(p = 12) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* 不支援就算了 */ } }

// ---------- Toast ----------
export function toast(msg, { icon = '✓', action, onAction, duration = 2600 } = {}) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="t-ico">${icon}</span><span class="t-msg"></span>`;
  t.querySelector('.t-msg').textContent = msg;
  let timer;
  const close = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action;
    b.onclick = () => { close(); onAction && onAction(); haptic(8); };
    t.appendChild(b);
    duration = Math.max(duration, 4500);
  }
  while (wrap.children.length > 2) wrap.firstChild.remove();
  wrap.appendChild(t);
  timer = setTimeout(close, duration);
  return close;
}

// ---------- 彩帶 ----------
let raf = null, parts = [];
export function confetti({ count = 90, colors, origin, hearts = false } = {}) {
  if (reduceMotion()) return;
  const cv = document.getElementById('confetti');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const cs = getComputedStyle(document.documentElement);
  colors = colors || ['--accent', '--gold', '--s1', '--s5', '--s3'].map(v => cs.getPropertyValue(v).trim() || '#0a8a65');
  const ox = origin?.x ?? innerWidth / 2, oy = origin?.y ?? innerHeight * 0.75;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const v = 7 + Math.random() * 8;
    parts.push({
      x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, c: colors[i % colors.length], life: 0, round: Math.random() < 0.3,
      heart: hearts, s: 7 + Math.random() * 7,
    });
  }
  if (raf) return;
  // 每一格都對齊目前的視窗：視窗大小或螢幕倍率變了就重設畫布（重設也會清空），再清空整張畫布
  const fit = () => {
    const d = Math.min(2, window.devicePixelRatio || 1), w = Math.round(innerWidth * d), h = Math.round(innerHeight * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  const tick = () => {
    fit();
    parts = parts.filter(p => p.life < 150 && p.y < innerHeight + 30);
    for (const p of parts) {
      p.life++; p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - p.life / 150);
      ctx.fillStyle = p.c;
      if (p.heart) {
        const s = p.s; ctx.rotate(-p.r * 0.85);
        ctx.beginPath(); ctx.moveTo(0, s * 0.35);
        ctx.bezierCurveTo(-s, -s * 0.25, -s * 0.45, -s, 0, -s * 0.45);
        ctx.bezierCurveTo(s * 0.45, -s, s, -s * 0.25, 0, s * 0.35);
        ctx.fill();
      } else if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 2 + 1, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 8)) + 1);
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = null; cv.width = cv.height = 0; }
  };
  raf = requestAnimationFrame(tick);
}

// ---------- 數字跳動 ----------
export function countUp(el, to, fmt, dur = 700) {
  if (!el) return;
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (reduceMotion() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 鼓勵的話 ----------
const pick = a => a[Math.floor(Math.random() * a.length)];
export const PHRASES = {
  generic: ['記好了！', '收到，記下來了！', '完成記帳！', '好的，幫你記好了！', '記帳成功！', '漂亮，又記下一筆！'],
  emoji: ['✨', '👍', '📝', '🎯', '🙌', '😊'],
  income: ['入帳囉！辛苦了 💰', '收入 +1，太棒了 🎉', '錢錢進來了 💰', '有進帳，讚啦 🙌'],
  first: '第一筆記帳完成！好的開始是成功的一半 🎉',
};
export const pickGeneric = (name = '') => (name && Math.random() < 0.35)
  ? pick([`做得好，${name}！`, `${name} 好棒，又記一筆！`, `謝謝 ${name}，記好了！`]) + ' ' + pick(PHRASES.emoji)
  : pick(PHRASES.generic) + ' ' + pick(PHRASES.emoji);
export const pickIncome = () => pick(PHRASES.income);
export const greeting = (name = '') => {
  const h = new Date().getHours();
  const [w, e] = h < 5 ? ['夜深了', '🌙'] : h < 11 ? ['早安', '☀️'] : h < 14 ? ['午安', '🌤️'] : h < 18 ? ['午後好', '☕'] : ['晚安', '🌙'];
  return name ? `${w}，${name} ${e}` : `${w} ${e}`;
};
