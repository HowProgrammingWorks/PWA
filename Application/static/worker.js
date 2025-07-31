const CACHE = 'v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/application.js',
  '/worker.js',
  '/database.js',
  '/manifest.json',
  '/icon.svg',
  '/favicon.ico',
  '/404.html',
];

let websocket = null;
let connected = false;
let connecting = false;
let reconnectTimer = null;

const send = (packet) => {
  if (!connected) return false;
  websocket.send(JSON.stringify(packet));
  return true;
};

const broadcast = async (packet, exclude = null) => {
  console.log('BROADCAST');
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  console.log('Broadcasting to clients:', clients.length, packet);
  for (const client of clients) {
    if (client !== exclude) {
      console.log('Sending to client:', client.id);
      client.postMessage(packet);
    }
  }
};

const updateCache = async () => {
  const cache = await caches.open(CACHE);
  console.log('Service Worker: Updating cache...');
  for (const asset of ASSETS) {
    try {
      await cache.add(asset);
      console.log('Service Worker: Cached:', asset);
    } catch (error) {
      console.error('Service Worker: Failed to cache:', asset, error);
    }
  }
};

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    updateCache()
      .then(() => {
        console.log('Service Worker: All assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache assets:', error);
      }),
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName === CACHE) return;
            console.log('Service Worker: Deleting old cache:', cacheName);
            caches.delete(cacheName);
          }),
        ),
      ),
      self.clients.claim(),
    ]).then(() => {
      console.log('Service Worker: Activated successfully');
    }),
  );
});

self.addEventListener('fetch', async (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache:', request.url);
          return cachedResponse;
        }
        console.log('Service Worker: Fetching from network:', request.url);
        const networkResponse = await fetch(request);
        if (networkResponse.status === 200) {
          console.log('Service Worker: Caching response:', request.url);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        console.log('Service Worker: Network failed, checking:', request.url);
        const cache = await caches.open(CACHE);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache:', request.url);
          return cachedResponse;
        }
        console.log('Service Worker: No cache available for:', request.url);
        if (request.mode === 'navigate') {
          const fallbackResponse = await cache.match('/index.html');
          if (fallbackResponse) {
            return fallbackResponse;
          }
        }
        return new Response('Offline - Content not available', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});

const connect = async () => {
  if (connected || connecting) return;
  connecting = true;

  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${self.location.host}`;
  websocket = new WebSocket(url);

  websocket.onopen = () => {
    connected = true;
    connecting = false;
    console.log('Service Worker: websocket connected');
    broadcast({ type: 'status', connected: true });
  };

  websocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Service Worker: websocket message:', message);
    broadcast(message);
  };

  websocket.onclose = () => {
    connected = false;
    console.log('Service Worker: websocket disconnected');
    broadcast({ type: 'status', connected: false });
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  websocket.onerror = (error) => {
    console.error('Service Worker: websocket error', error);
    broadcast({ type: 'error', error: error.message });
  };
};

self.addEventListener('message', (event) => {
  console.log('Service Worker: received', event.data);
  const { type, content } = event.data;
  if (type === 'online') return void connect();
  if (type === 'offline') {
    if (connected) websocket.close();
  }
  if (type === 'message') {
    const packet = { type: 'message', content };
    send(packet);
    broadcast(packet, event.source);
  }
  if (type === 'ping') {
    console.log({ event });
    event.source.postMessage({ type: 'pong' });
  }
  if (type === 'updateCache') {
    console.log('Service Worker: Manual cache update requested');
    updateCache()
      .then(() => {
        event.source.postMessage({ type: 'cacheUpdated' });
      })
      .catch((error) => {
        event.source.postMessage({
          type: 'cacheUpdateFailed',
          error: error.message,
        });
      });
  }
});

connect();

self.addEventListener('beforeunload', (event) => {
  console.log('Service Worker: beforeunload', event);
});
