// PWA 能力的安全占位：file:// 下不注册，浏览器不支持时静默跳过。
//
// 调试开关（调素材 / 微调坐标时用）：
//   带 ?nosw=1 打开一次 -> 注销已注册的 SW、清掉它的缓存，并把开关记进 localStorage；
//   之后**不用再带参数**（PWA 图标直接进也生效），改完刷新就能看到最新文件。
//   带 ?nosw=0 打开一次 -> 关掉开关，恢复正常的 PWA 离线缓存。
// 为什么需要它：SW 是 cache-first，源码文件进过缓存就一直返回旧版；
// 靠递增 CACHE_NAME 能让改动生效，但会把所有图片重新下载一遍（手机上很费流量）。
const NOSW_KEY = 'columbina-travel/nosw';

function noswEnabled() {
  let q = null;
  try { q = new URLSearchParams(window.location.search).get('nosw'); } catch (e) { q = null; }
  try {
    if (q === '1') { window.localStorage.setItem(NOSW_KEY, '1'); return true; }
    if (q === '0') { window.localStorage.removeItem(NOSW_KEY); return false; }
    return window.localStorage.getItem(NOSW_KEY) === '1';
  } catch (e) {
    return q === '1';
  }
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (noswEnabled()) {
    navigator.serviceWorker.getRegistrations()
      .then(function (rs) { rs.forEach(function (r) { r.unregister(); }); })
      .catch(function () {});
    if (window.caches && window.caches.keys) {
      window.caches.keys()
        .then(function (ks) { ks.forEach(function (k) { window.caches.delete(k); }); })
        .catch(function () {});
    }
    return;
  }
  // Vite 开发服务器不注册，避免缓存干扰热更新；生产构建在 localhost/HTTPS 下注册。
  if (import.meta.env?.DEV) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  }, { once: true });
}
