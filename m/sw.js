// Service worker do DUM Celular (escopo m/). Não guarda telas nem dados: sem internet, mostra o
// offline.html. Recebe os avisos (Web Push) e, no toque, abre a tela certa do app.
// O cache tem o mesmo nome do sw.js da raiz (que apaga caches de outro nome ao atualizar).

const CACHE = 'dum-offline-v1';
const OFFLINE = new URL('../offline.html', self.registration.scope).href;
const ICON = new URL('../assets/images/icon-192.png', self.registration.scope).href;
const BADGE = new URL('../assets/images/badge-96.png', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await (await caches.open(CACHE)).add(new Request(OFFLINE, { cache: 'reload' }));
      } catch {
        /* sem a página de offline: segue sem ela */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'DUM', body: event.data?.text() ?? '' };
  }
  const title = data.title || 'DUM';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: ICON,
      badge: BADGE,
      lang: 'pt-BR',
      timestamp: Date.now(),
      requireInteraction: data.kind === 'danger',
      data: { link: data.link || '' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '';
  const target = new URL(`./#/ir/${encodeURIComponent(link)}`, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) {
        open.postMessage({ type: 'open', link });
        return open.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
