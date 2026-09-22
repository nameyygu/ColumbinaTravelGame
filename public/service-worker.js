// 只缓存同源静态发布文件。浏览器本地存档不会经过 fetch，因此绝不在此缓存或上传。
// 每次发布静态资源变更时递增；activate 会清理旧版本缓存。
const CACHE_NAME = 'columbina-travel-static-v9';
const APP_SHELL = ['./', './index.html', './开始游戏.html', './manifest.webmanifest', './src/main.js', './src/legacy-entry.js', './src/pwa/registerServiceWorker.js'];
const STATIC_FILE = /\.(?:html?|js|mjs|css|json|webmanifest|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf)$/i;
function isStaticRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin &&
    (url.pathname === self.location.pathname.replace(/service-worker\.js$/, '') || STATIC_FILE.test(url.pathname));
}
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!isStaticRequest(request)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (!response.ok || response.type !== 'basic') return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    return response;
  })));
});
