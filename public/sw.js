/* global self, caches */
// Public icons only. Bump this version whenever these icon bytes change.
const CACHE_PREFIX = 'volo-static-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const ICONS = new Map([
  ['/pwa/icon-192.png', 'image/png'],
  ['/pwa/icon-512.png', 'image/png'],
  ['/icon.svg', 'image/svg+xml'],
  ['/apple-icon.png', 'image/png'],
]);
let generation = 0;
let mutations = Promise.resolve();
function mutate(task) {
  const result = mutations.then(task);
  mutations = result.catch(() => {});
  return result;
}
async function purge(keepCurrent = false) {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && (!keepCurrent || name !== CACHE_NAME)) await caches.delete(name);
  }
}
async function loadIcon(url) {
  const started = generation;
  const cached = await caches.open(CACHE_NAME).then(cache => cache.match(url.href)).catch(() => undefined);
  if (cached) return cached;
  // Never forward the page's cookies, bearer tokens, query or RSC headers.
  const response = await fetch(new Request(url.href, {credentials: 'omit', cache: 'no-store', redirect: 'error'}));
  const policy = response.headers.get('cache-control') || '';
  const vary = response.headers.get('vary') || '';
  if (response.status !== 200 || response.type !== 'basic' || response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim() !== ICONS.get(url.pathname) ||
      /(?:private|no-store)/i.test(policy) || /(?:cookie|authorization|\*)/i.test(vary)) {
    throw new Error('Icon response is not public cacheable content');
  }
  await mutate(async () => {
    if (started !== generation) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url.href, response.clone());
  }).catch(() => {}); // Storage failure must not break a successful network image.
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil(Promise.all([...ICONS.keys()].map(path => loadIcon(new URL(path, self.location.origin))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(mutate(() => purge(true)).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && !url.search && /^\/auth\/logout\/?$/.test(url.pathname)) {
    generation++;
    // Observe cleanup only: the browser/server still own the entire auth response.
    event.waitUntil(mutate(() => purge()));
    return;
  }
  if (request.method !== 'GET' || url.search || !ICONS.has(url.pathname) || request.mode === 'navigate' ||
      ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'authorization', 'range'].some(header => request.headers.has(header))) return;
  event.respondWith(loadIcon(url));
});
// No sync handler, queued mutations, private fallback, or offline write response.
