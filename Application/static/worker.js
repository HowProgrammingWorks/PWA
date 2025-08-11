const CACHE = 'v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/application.js',
  '/worker.js',
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

const install = async () => {
  console.log('Service Worker: Installing...');
  try {
    await updateCache();
    console.log('Service Worker: All assets cached successfully');
    await self.skipWaiting();
  } catch (error) {
    console.error('Service Worker: Failed to cache assets:', error);
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(install());
});

const serveFromCache = async (request) => {
  const cache = await caches.open(CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    console.log('Service Worker: Serving from cache:', request.url);
    return cachedResponse;
  }
  return null;
};

const fetchFromNetwork = async (request) => {
  console.log('Service Worker: Fetching from network:', request.url);
  const networkResponse = await fetch(request);
  if (networkResponse.status === 200) {
    console.log('Service Worker: Caching response:', request.url);
    const cache = await caches.open(CACHE);
    await cache.put(request, networkResponse.clone());
  }
  return networkResponse;
};

const offlineFallback = async (request) => {
  console.log('Service Worker: Network failed, checking cache:', request.url);
  const cachedResponse = await serveFromCache(request);
  if (cachedResponse) {
    console.log('Service Worker: Serving from cache (offline):', request.url);
    return cachedResponse;
  }
  console.log('Service Worker: No cache available for:', request.url);
  if (request.mode === 'navigate') {
    const cache = await caches.open(CACHE);
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
};

const cleanupCache = async () => {
  const cacheNames = await caches.keys();
  const deletePromises = cacheNames
    .filter((cacheName) => cacheName !== CACHE)
    .map(async (cacheName) => {
      console.log('Service Worker: Deleting old cache:', cacheName);
      await caches.delete(cacheName);
    });
  await Promise.all(deletePromises);
};

const updateCacheHandler = async (event) => {
  console.log('Service Worker: Manual cache update requested');
  try {
    await updateCache();
    event.source.postMessage({ type: 'cacheUpdated' });
  } catch (error) {
    event.source.postMessage({
      type: 'cacheUpdateFailed',
      error: error.message,
    });
  }
};

self.addEventListener('fetch', async (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  const respond = async () => {
    try {
      const cachedResponse = await serveFromCache(request);
      if (cachedResponse) return cachedResponse;
      return await fetchFromNetwork(request);
    } catch {
      return await offlineFallback(request);
    }
  };
  event.respondWith(respond());
});

const activate = async () => {
  console.log('Service Worker: Activating...');
  try {
    await Promise.all([
      cleanupCache(),
      self.clients.claim(),
    ]);
    console.log('Service Worker: Activated successfully');
  } catch (error) {
    console.error('Service Worker: Activation failed:', error);
  }
};

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(activate());
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

const messageHandlers = {
  online: () => connect(),
  offline: () => {
    if (connected) websocket.close();
  },
  message: (event) => {
    const packet = { type: 'message', content: event.data.content };
    send(packet);
    broadcast(packet, event.source);
  },
  ping: (event) => {
    console.log({ event });
    event.source.postMessage({ type: 'pong' });
  },
  updateCache: updateCacheHandler,
};

self.addEventListener('message', (event) => {
  console.log('Service Worker: received', event.data);
  const { type } = event.data;
  const handler = messageHandlers[type];
  if (handler) handler(event);
});

self.addEventListener('beforeunload', (event) => {
  console.log('Service Worker: beforeunload', event);
});

connect();
