// 把「午餐 120」、「昨天 計程車 250」、「薪水 +45000」這類句子解析成記帳資料

export const CATEGORIES = {
  expense: [
    { name: '餐飲', icon: '🍜', kw: ['早午餐', '早餐', '午餐', '晚餐', '宵夜', '消夜', '便當', '外送', 'foodpanda', 'ubereats', '聚餐', '咖啡', '星巴克', '路易莎', '飲料', '手搖', '珍奶', '奶茶', '紅茶', '綠茶', '果汁', '麥當勞', '肯德基', '摩斯', '漢堡', '披薩', '火鍋', '燒肉', '壽司', '拉麵', '牛肉麵', '小吃', '點心', '甜點', '蛋糕', '麵包', '水果', '零食', '啤酒', '餐', '飯', '麵', '吃'] },
    { name: '交通', icon: '🚌', kw: ['計程車', '小黃', 'uber', '捷運', '公車', '客運', '高鐵', '台鐵', '火車', '加油', '油錢', '停車', '機票', 'etc', '過路費', 'youbike', 'ubike', '悠遊卡', '一卡通', '機車', '汽車', '保養', '車資', '車票', '船票'] },
    { name: '購物', icon: '🛍️', kw: ['衣服', '褲子', '裙子', '外套', '鞋', '包包', '購物', '網購', '蝦皮', 'momo', '淘寶', 'pchome', 'amazon', '手機殼', '耳機', '電腦', '3c', '化妝品', '保養品', '日用品', '衛生紙', '洗髮', '全聯', '家樂福', '好市多', 'costco', '超市', '大創', '無印', 'uniqlo', '屈臣氏', '康是美'] },
    { name: '娛樂', icon: '🎮', kw: ['電影', '遊戲', 'steam', 'switch', 'ps5', 'ktv', '唱歌', '演唱會', '展覽', '旅遊', '旅行', '住宿', '飯店', '民宿', '門票', 'netflix', 'spotify', 'disney', 'youtube', '訂閱', '健身', '運動', '游泳', '球'] },
    { name: '居家', icon: '🏠', kw: ['房租', '租金', '房貸', '管理費', '家具', '家電', '修理', '維修', '清潔', '洗衣', '裝潢'] },
    { name: '帳單', icon: '🧾', kw: ['電費', '水費', '瓦斯', '網路費', '網路', '電話費', '手機費', '月租', '保險', '保費', '稅', '信用卡', '卡費', '繳費', '第四台', '學貸'] },
    { name: '醫療', icon: '💊', kw: ['看醫生', '掛號', '醫院', '診所', '藥局', '藥', '牙醫', '健檢', '眼科', '復健', '口罩'] },
    { name: '社交', icon: '🎁', kw: ['紅包', '禮物', '禮金', '請客', '送禮', '捐款', '喜酒', '奠儀', '慶生'] },
    { name: '教育', icon: '📚', kw: ['課程', '補習', '學費', '文具', '講座', '考試', '報名費', '書'] },
    { name: '寵物', icon: '🐶', kw: ['飼料', '貓砂', '罐頭', '寵物', '獸醫', '貓', '狗'] },
    { name: '其他', icon: '📦', kw: [] },
  ],
  income: [
    { name: '薪水', icon: '💰', kw: ['薪水', '薪資', '工資', '月薪', '加班費', '發薪'] },
    { name: '獎金', icon: '🎉', kw: ['獎金', '年終', '分紅', '中獎', '發票', '三節'] },
    { name: '投資', icon: '📈', kw: ['股息', '股利', '利息', '投資', '股票', '基金', '收租', '配息'] },
    { name: '其他收入', icon: '💵', kw: ['收入', '退款', '退費', '兼職', '外快', '零用錢', '收紅包', '回饋', '賣'] },
  ],
};

export function categoryInfo(type, name) {
  const list = CATEGORIES[type] || CATEGORIES.expense;
  return list.find(c => c.name === name) || { name, icon: type === 'income' ? '💵' : '📦' };
}

// ---------- 日期工具 ----------
const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ---------- 中文數字 ----------
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };
export function cnToNumber(s) {
  if (!s) return NaN;
  let total = 0, section = 0, num = 0, lastUnit = 1;
  for (const ch of s) {
    if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; }
    else if (ch in CN_UNIT) {
      const u = CN_UNIT[ch];
      section += (num || (u === 10 && section === 0 ? 1 : 0)) * u;
      num = 0; lastUnit = u;
    } else if (ch === '萬') {
      total += (section + num) * 10000; section = 0; num = 0; lastUnit = 10000;
    } else return NaN;
  }
  // 「一百二」= 120、「三千五」= 3500
  if (num && lastUnit >= 100 && s.length >= 3 && !/[零〇]/.test(s.slice(-2, -1))) num *= lastUnit / 10;
  return total + section + num;
}

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

// 從文字中找出日期，回傳 { date, text(移除日期後) }
export function extractDate(text, today = new Date()) {
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let m;
  const rules = [
    [/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日號]?/, m => new Date(+m[1], +m[2] - 1, +m[3])],
    [/(?<![\d.])(\d{1,2})\s*[/月]\s*(\d{1,2})\s*[日號]?(?![\d.])/, m => {
      const mo = +m[1], d = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      let dt = new Date(today.getFullYear(), mo - 1, d);
      if (dt - today > 31 * 864e5) dt = new Date(today.getFullYear() - 1, mo - 1, d); // 太遙遠的未來 → 去年
      return dt;
    }],
    [/大前天/, () => addDays(today, -3)],
    [/前天/, () => addDays(today, -2)],
    [/昨天|昨日|昨晚|昨早/, () => addDays(today, -1)],
    [/今天|今日|今晚|今早/, () => today],
    [/明天/, () => addDays(today, 1)],
    [/(\d+|[一二兩三四五六七八九十]+)\s*天前/, m => addDays(today, -(isNaN(+m[1]) ? cnToNumber(m[1]) : +m[1]))],
    [/(上上|上個|上|這個|這|本|下個|下)?\s*(?:週|周|星期|禮拜)([一二三四五六日天])/, m => {
      const target = WEEKDAY[m[2]];
      const dow = today.getDay();
      const mondayOffset = (dow + 6) % 7; // 本週一距今天數
      let d = addDays(today, -mondayOffset + ((target + 6) % 7));
      const p = m[1] || '';
      if (p.startsWith('上上')) d = addDays(d, -14);
      else if (p.startsWith('上')) d = addDays(d, -7);
      else if (p.startsWith('下')) d = addDays(d, 7);
      else if (!p && d > today) d = addDays(d, -7); // 沒說「這週」又在未來 → 指上一個
      return d;
    }],
    [/(?<![\d/月.])(\d{1,2})\s*號/, m => {
      const d = +m[1]; if (d < 1 || d > 31) return null;
      let dt = new Date(today.getFullYear(), today.getMonth(), d);
      if (dt > today) dt = new Date(today.getFullYear(), today.getMonth() - 1, d);
      return dt;
    }],
  ];
  for (const [re, fn] of rules) {
    if ((m = text.match(re))) {
      const d = fn(m);
      if (d && !isNaN(d)) return { date: toISO(d), text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)) };
    }
  }
  return { date: null, text };
}

// 從文字中找出金額
export function extractAmount(text) {
  const candidates = [];
  const re = /(?:(?<![0-9A-Za-z])([+＋\-－]))?\s*(?:NT\$|\$|＄)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(萬|千|k|K)?\s*(元|塊錢|塊|圓|nt|NT)?/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    m[1] = m[1] || '';
    let v = parseFloat(m[2].replace(/,/g, ''));
    if (m[3] === '萬') v *= 10000; else if (m[3]) v *= 1000;
    candidates.push({ v, sign: m[1], strong: !!(m[4] || m[3] || m[1] || /\$/.test(m[0])), index: m.index, len: m[0].length });
  }
  const cre = /([+＋\-－]?)([零〇一二兩三四五六七八九十百千萬]+)\s*(元|塊錢|塊)/g;
  while ((m = cre.exec(text))) {
    const v = cnToNumber(m[2]);
    if (!isNaN(v) && v > 0) candidates.push({ v, sign: m[1], strong: true, index: m.index, len: m[0].length });
  }
  if (!candidates.length) return null;
  // 優先：有「元/塊/$/+/-」的 → 否則取最後一個數字（例如「7-11 咖啡 65」取 65）
  const strong = candidates.filter(c => c.strong);
  const pick = (strong.length ? strong : candidates).sort((a, b) => b.index - a.index)[0];
  return {
    amount: Math.round(pick.v * 100) / 100,
    sign: pick.sign.replace('＋', '+').replace('－', '-'),
    text: text.slice(0, pick.index) + ' ' + text.slice(pick.index + pick.len),
  };
}

function findCategory(type, note, learned) {
  const key = note.trim().toLowerCase();
  if (learned && learned[key] && learned[key].type === type) return learned[key].category;
  // 學習過的關鍵字也試試看部分比對
  if (learned) {
    for (const [k, v] of Object.entries(learned)) if (k.length >= 2 && key.includes(k) && v.type === type) return v.category;
  }
  const all = [];
  // 自訂分類的關鍵字優先（一樣長時排前面）
  for (const c of [...CATEGORIES[type].filter(x => x.custom), ...CATEGORIES[type].filter(x => !x.custom)]) for (const k of c.kw) all.push([k, c.name]);
  all.sort((a, b) => b[0].length - a[0].length);
  for (const [k, name] of all) if (key.includes(k)) return name;
  return null;
}

function detectIncome(text) {
  for (const c of CATEGORIES.income) for (const k of c.kw) if (text.toLowerCase().includes(k)) return true;
  return /^(收到|收|領|入帳)/.test(text.trim());
}

// 解析一段（一筆）
export function parseOne(text, { today = new Date(), defaultDate = null, learned = null } = {}) {
  const original = text.trim();
  if (!original) return null;
  const d = extractDate(original, today);
  const a = extractAmount(d.text);
  if (!a || !(a.amount > 0)) return { error: 'no-amount', date: d.date };
  let note = a.text.replace(/[,，。.!！~～:：]/g, ' ').replace(/\s+/g, ' ').trim();
  let type;
  if (a.sign === '+') type = 'income';
  else if (a.sign === '-') type = 'expense';
  else type = detectIncome(note) ? 'income' : 'expense';
  let category = findCategory(type, note, learned);
  if (!category) {
    // 說了收入但沒對到收入分類，也許其實是支出關鍵字
    if (type === 'income' && !a.sign && !/^(收到|收|領|入帳)/.test(note)) {
      const alt = findCategory('expense', note, learned);
      if (alt) { type = 'expense'; category = alt; }
    }
  }
  if (!category) category = type === 'income' ? '其他收入' : '其他';
  note = note.replace(/^(收到|入帳)\s*/, '').trim();
  if (!note) note = category;
  return { type, amount: a.amount, category, date: d.date || defaultDate || toISO(today), note, dateExplicit: !!d.date };
}

// 解析整則訊息，可能有多筆：「昨天 午餐 120、飲料 50」
export function parseMessage(text, opts = {}) {
  const parts = text.split(/\n|；|;|、|，|,(?!\d{3})/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const results = [];
    let ctxDate = null;
    let ok = true;
    for (const p of parts) {
      const r = parseOne(p, { ...opts, defaultDate: ctxDate });
      if (!r || r.error) {
        // 某段只有日期（例如「昨天，午餐 120」）就當作後面的日期
        if (r && r.error && r.date) { ctxDate = r.date; continue; }
        ok = false; break;
      }
      if (r.dateExplicit) ctxDate = r.date;
      results.push(r);
    }
    if (ok && results.length) return results;
  }
  const r = parseOne(text, opts);
  return r && !r.error ? [r] : [];
}

// ---------- 自訂分類 ----------
// 自訂分類插在「其他／其他收入」前面；關鍵字一樣會自動判斷
export function setCustomCategories(list = []) {
  for (const type of ['expense', 'income']) {
    const arr = CATEGORIES[type].filter(c => !c.custom);
    const fallback = arr.pop(); // 其他 / 其他收入
    const add = list.filter(c => c.type === type && c.name && !arr.some(x => x.name === c.name))
      .map(c => ({ name: c.name, icon: c.icon || '🏷️', kw: (c.kw || []).map(k => String(k).toLowerCase()).filter(Boolean), color: c.color, custom: true }));
    CATEGORIES[type].splice(0, CATEGORIES[type].length, ...arr, ...add, fallback);
  }
}

// ---------- 付款方式、標籤、外幣 ----------
export const ACCOUNT_WORDS = [
  ['信用卡', ['刷卡', '信用卡', '刷信用卡', '卡刷']], ['現金', ['現金', '付現']], ['LINE Pay', ['line pay', 'linepay']],
  ['悠遊卡', ['悠遊卡', '悠遊付', '嗶卡']], ['街口', ['街口']], ['Apple Pay', ['apple pay', 'applepay']], ['轉帳', ['轉帳', '匯款']],
];
export const CURRENCIES = {
  TWD: { sym: 'NT$', words: ['新台幣', '台幣', 'twd'] },
  JPY: { sym: '¥', words: ['日圓', '日元', '日幣', '円', 'jpy', 'yen', '¥', '￥'] },
  USD: { sym: 'US$', words: ['美金', '美元', 'usd', 'us$'] },
  KRW: { sym: '₩', words: ['韓元', '韓幣', 'krw', '₩'] },
  EUR: { sym: '€', words: ['歐元', 'eur', '€'] },
  THB: { sym: '฿', words: ['泰銖', 'thb', '฿'] },
  HKD: { sym: 'HK$', words: ['港幣', '港元', 'hkd', 'hk$'] },
  CNY: { sym: 'CN¥', words: ['人民幣', 'rmb', 'cny'] },
};
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function extractExtras(text, { accounts = [] } = {}) {
  let t = ' ' + text + ' ';
  const tags = [];
  t = t.replace(/[#＃]([^\s#＃,，、;；]+)/g, (_, g) => { if (!tags.includes(g)) tags.push(g); return ' '; });
  let account = null;
  const words = [...accounts.filter(a => !ACCOUNT_WORDS.some(([n]) => n === a)).map(a => [a, [a.toLowerCase()]]), ...ACCOUNT_WORDS]
    .flatMap(([name, ws]) => ws.map(w => [name, w])).sort((a, b) => b[1].length - a[1].length);
  for (const [name, w] of words) {
    const re = new RegExp(`(^|[\\s，,、用])${escRe(w)}(?=$|[\\s，,、付])`, 'i');
    if (re.test(t)) { account = name; t = t.replace(re, '$1 ').replace(/\s用\s/g, ' '); break; }
  }
  let currency = null;
  for (const [code, c] of Object.entries(CURRENCIES)) {
    const re = new RegExp(c.words.map(escRe).join('|'), 'i');
    if (re.test(t)) { currency = code; t = t.replace(new RegExp(c.words.map(escRe).join('|'), 'gi'), ' '); break; }
  }
  return { text: t.replace(/\s+/g, ' ').trim(), tags, account, currency };
}
