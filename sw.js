// Service worker do DUMTech Master. Faz uma coisa diferente conforme o endereço:
//
// 1) Na máquina (localhost / 127.0.0.1): desliga o worker de OUTRO projeto. No Live Server todos os
//    projetos dividem o mesmo endereço (http://127.0.0.1:5500), e um worker antigo registrado lá
//    (ex.: CMV Pro) seguia respondendo no lugar deste app — "abre outro sistema". O navegador busca
//    /sw.js a cada visita; ao receber este, ele assume, apaga os caches desse endereço, se desregistra
//    e recarrega a aba. Não apaga localStorage nem IndexedDB. O app não registra o worker na máquina.
//
// 2) No site publicado (https): deixa instalar como app no celular e no computador. Não guarda telas
//    nem dados — tudo vem da rede, porque os dados moram no Supabase e precisam estar sempre ao vivo.
//    Sem internet, a abertura mostra offline.html em vez da página de erro do navegador.

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const CACHE = 'dum-offline-v1';
const OFFLINE = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!LOCAL) await (await caches.open(CACHE)).add(new Request(OFFLINE, { cache: 'reload' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => LOCAL || key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!LOCAL) return;
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: 'window' });
      await Promise.all(tabs.map((tab) => tab.navigate(tab.url).catch(() => null)));
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (LOCAL || event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()),
  );
});
