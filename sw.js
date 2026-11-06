// 離線快取：App 本體先用快取（秒開），背景再更新；字型與雲端模組也會存起來
const VERSION = 'v1.4.0';
const APP_CACHE = 'jz-app-' + VERSION;
const RUNTIME = 'jz-runtime';
const SHELL = [
  './', 'index.html', 'love.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/parser.js', 'js/store.js', 'js/charts.js', 'js/feedback.js', 'js/ocr.js', 'js/recap.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/love-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('jz-app-') && k !== APP_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  // Android：從相簿或其他 App「分享」圖片到記帳 → 先存起來，打開 App 後辨識
  if (req.method === 'POST' && new URL(req.url).searchParams.has('share-target')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('image');
        const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join(' ');
        if (file && file.size) {
          const c = await caches.open('jz-share');
          await c.put('shared-image', new Response(file, { headers: { 'content-type': file.type || 'image/png' } }));
          return Response.redirect('./?shared=1', 303);
        }
        return Response.redirect('./?text=' + encodeURIComponent(text), 303);
      } catch { return Response.redirect('./', 303); }
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase API 不快取
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  // 字型、Supabase 模組：快取優先
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // 開啟頁面：先拿最新的，離線時用快取（主頁和她的頁面分開存）
  if (req.mode === 'navigate') {
    const page = /\/love\.html$/.test(url.pathname) ? 'love.html' : 'index.html';
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(page, copy)); }
      return res;
    }).catch(async () => (await caches.match(page)) || (await caches.match('./'))));
    return;
  }

  // 其他檔案：快取優先，背景更新
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

// ---------- 每日記帳提醒 ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '今天記帳了嗎？', {
    body: d.body || '花 5 秒記一下今天的花費，連續紀錄不要斷 🔥',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-remind', renotify: false,
    data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hit = all.find(c => c.url.startsWith(self.registration.scope));
    if (hit) { await hit.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
