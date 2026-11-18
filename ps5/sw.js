const CACHE_NAME = 'lonely-ps5-v4';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './prestige.jpg',
  './src/firmware.js',
  './src/main.js',
  './src/rop.js',
  './src/site.js',
  './src/webkit.js',
  './src/kexp.js',
  './src/relapse_exploit.js',
  './src/utils/mem.js',
  './src/utils/int64.js',
  './src/utils/syscalls.js',
  './src/utils/rop_slave.js',
  // Firmware Offsets
  './offsets/7.00.js',
  './offsets/7.01.js',
  './offsets/7.20.js',
  './offsets/7.40.js',
  './offsets/7.60.js',
  './offsets/7.61.js',
  './offsets/8.00.js',
  './offsets/8.20.js',
  './offsets/8.40.js',
  './offsets/8.60.js',
  './offsets/9.00.js',
  './offsets/9.20.js',
  './offsets/9.40.js',
  './offsets/9.60.js',
  './offsets/10.00.js',
  './offsets/10.01.js',
  './offsets/10.20.js',
  './offsets/10.40.js',
  './offsets/10.60.js',
  './offsets/11.00.js',
  './offsets/11.20.js',
  './offsets/11.60.js',
  './offsets/12.00.js',
  './offsets/12.02.js',
  './offsets/12.20.js',
  './offsets/12.40.js',
  './offsets/12.60.js',
  './offsets/12.70.js',
  './offsets/13.00.js',
  './offsets/13.20.js',
  './offsets/13.40.js',
  './offsets/13.42.js',
  './offsets/13.60.js',
  // Payloads
  './payloads/nexHEN.elf',
  './payloads/zftpd-ps5.elf',
  './payloads/MemDBG-ps5.elf',
  './payloads/klogsrv-ps5.elf',
  './payloads/shsrv-ps5.elf',
  './payloads/websrv-ps5.elf',
  './payloads/gdbsrv-ps5.elf',
  './payloads/elfldr-ps5-1360.elf',
  './payloads/kexp_2026_05_25.bin'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn(`Failed to cache ${url}:`, err))
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Pass through local API calls
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
