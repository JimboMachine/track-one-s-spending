// 離線快取：App 本體先用快取（秒開），背景再更新；字型與雲端模組也會存起來
const VERSION = 'v1.0.0';
const APP_CACHE = 'jz-app-' + VERSION;
const RUNTIME = 'jz-runtime';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/parser.js', 'js/store.js', 'js/charts.js', 'js/feedback.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
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

  // 開啟頁面：離線時用快取的 index.html
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      caches.open(APP_CACHE).then(c => c.put('index.html', res.clone()));
      return res;
    }).catch(async () => (await caches.match('index.html')) || (await caches.match('./'))));
    return;
  }

  // 其他檔案：快取優先，背景更新
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) caches.open(APP_CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
