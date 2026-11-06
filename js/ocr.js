// 收據、截圖、銀行通知 → 一句「店家 金額」：拍照辨識用 Tesseract.js（第一次用才下載）

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TESS; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('辨識模組載入失敗')));
      s.onerror = () => { loading = null; rej(new Error('辨識模組載入失敗，請確認網路')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// 縮小到長邊 1600px、轉灰階，辨識比較快也比較準
async function prepImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.25)';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

export async function recognize(file, onProgress = () => {}) {
  const T = await loadTesseract();
  onProgress(0.05, '準備中…');
  const canvas = await prepImage(file);
  const worker = await T.createWorker(['chi_tra', 'eng'], 1, {
    logger: m => {
      if (m.status === 'recognizing text') onProgress(0.4 + m.progress * 0.6, '辨識中…');
      else if (/loading|initializ/.test(m.status)) onProgress(0.05 + (m.progress || 0) * 0.35, '下載辨識資料（只有第一次）…');
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally { worker.terminate(); }
}

const AMOUNT_KEY = /(合\s*計|總\s*計|總\s*額|總\s*金\s*額|金\s*額|實\s*付|應\s*付|付\s*款|消\s*費|小\s*計|現\s*金|信\s*用\s*卡|NT\$|TWD|NTD|\$)/i;
const SKIP_NAME = /(發票|電子|收據|統一編號|統編|序號|機號|地址|電話|TEL|日期|時間|NO\.?|隨機碼|總計|合計|金額|謝謝|歡迎|會員)/i;

// 從辨識出的文字（或貼上的通知）找出店家、金額、日期
export function receiptToText(raw) {
  const text = String(raw || '').replace(/[｜|]/g, ' ').replace(/[，]/g, ',');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const nums = [];
  lines.forEach((line, i) => {
    // 先拿掉日期、時間、發票號碼，免得被當成金額
    const l = line.replace(/\d{3,4}[/.-]\d{1,2}[/.-]\d{1,2}/g, ' ').replace(/(?<!\d)\d{1,2}[/月]\d{1,2}日?(?!\d)/g, ' ')
      .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ').replace(/[A-Z]{2}-?\d{8}/g, ' ').replace(/(隨機碼|序號|機號|統[一]?編[號]?|賣方|買方)\s*[:：]?\s*\d+/g, ' ');
    const re = /(?:NT\$|\$|＄)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?!\d)/g;
    let m;
    while ((m = re.exec(l))) {
      const v = Number(m[1].replace(/,/g, ''));
      if (!(v > 0) || v > 2000000 || m[1].replace(/,/g, '').length >= 8) continue; // 電話、編號
      const before = l.slice(Math.max(0, m.index - 8), m.index);
      nums.push({ v, key: AMOUNT_KEY.test(before) || /\$/.test(m[0]), total: /(合\s*計|總\s*計|總\s*額|實\s*付|應\s*付|消\s*費|付款金額|交易金額)\s*[:：]?\s*(NT\$|\$)?\s*$/.test(before + (m[0].match(/^(?:NT\$|\$|＄)?\s*/) || [''])[0]) || /(合\s*計|總\s*計|實\s*付|應\s*付)/.test(before), i });
    }
  });
  const pick = (nums.filter(n => n.total).sort((a, b) => b.v - a.v)[0])
    || (nums.filter(n => n.key).sort((a, b) => b.v - a.v)[0])
    || (nums.sort((a, b) => b.v - a.v)[0]);
  // 店家：通知裡的「商店：xxx」「於 xxx 消費」，否則取第一行有中文名稱的
  let name = (text.match(/(?:商店|商家|特店|店家|消費地點|商戶)\s*[:：]?\s*([^\s,，。]{2,16})/) || [])[1]
    || (text.match(/[於在]\s*([^\s,，。\d]{2,16})\s*(?:消費|刷卡|交易)/) || [])[1];
  if (!name) {
    const l = lines.find(x => /[一-鿿]{2,}/.test(x) && !SKIP_NAME.test(x) && !/\d{3,}/.test(x));
    if (l) name = (l.match(/[一-鿿A-Za-z0-9&'·\s]{2,16}/) || [l])[0].trim();
  }
  // 日期
  let date = null;
  const dm = text.match(/(\d{4}|\d{3})[/.-](\d{1,2})[/.-](\d{1,2})/) || text.match(/(?<!\d)(\d{1,2})[/月](\d{1,2})日?(?!\d)/);
  if (dm) {
    if (dm.length === 4) { let y = Number(dm[1]); if (y < 1911) y += 1911; date = { y, m: Number(dm[2]), d: Number(dm[3]) }; }
    else date = { y: new Date().getFullYear(), m: Number(dm[1]), d: Number(dm[2]) };
    if (!(date.m >= 1 && date.m <= 12 && date.d >= 1 && date.d <= 31)) date = null;
  }
  const account = /信用卡|刷卡|VISA|MASTER|JCB/i.test(text) ? '信用卡' : /line\s*pay/i.test(text) ? 'LINE Pay' : /悠遊/.test(text) ? '悠遊卡' : /街口/.test(text) ? '街口' : null;
  return { amount: pick ? pick.v : null, name: name ? name.replace(/\s+/g, ' ').slice(0, 16) : null, date, account };
}

// 組成可以直接送出的一句話
export function toSentence(r) {
  if (!r.amount) return null;
  const today = new Date();
  const dateStr = r.date && !(r.date.m === today.getMonth() + 1 && r.date.d === today.getDate()) ? `${r.date.m}/${r.date.d} ` : '';
  return `${dateStr}${r.name || '消費'} ${r.amount}${r.account ? ' ' + (r.account === '信用卡' ? '刷卡' : r.account) : ''}`;
}

// 貼上的是銀行／支付通知嗎？
export const looksLikeNotice = t => t.length > 24 && /(消費|交易|扣款|付款|刷卡|支付)/.test(t) && /\d/.test(t);
