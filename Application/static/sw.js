const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/application.js',
  '/database.js',
  '/manifest.json',
  '/icon.svg',
];

const handleApiRequest = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      return response;
    }
  } catch (error) {
    console.log('Network failed, trying cache:', error);
  }
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  return new Response(
    JSON.stringify({ error: 'Offline - No cached data available' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    },
  );
};

const storeOfflineAction = async (message) => {
  if (!message || !message.id) {
    console.error('Invalid message data:', message);
    return;
  }
  const cache = await caches.open(DYNAMIC_CACHE);
  const response = new Response(JSON.stringify(message), {
    headers: { 'Content-Type': 'application/json' },
  });
  await cache.put(`/offline-actions/${message.id}`, response);
};

const getOfflineActions = async () => {
  const cache = await caches.open(DYNAMIC_CACHE);
  const keys = await cache.keys();
  const actionKeys = keys.filter((key) =>
    key.url.includes('/offline-actions/'),
  );

  const actions = [];
  for (const key of actionKeys) {
    const response = await cache.match(key);
    const action = await response.json();
    actions.push(action);
  }

  return actions;
};

const removeOfflineAction = async (id) => {
  const cache = await caches.open(DYNAMIC_CACHE);
  await cache.delete(`/offline-actions/${id}`);
};

const processOfflineAction = async (data) => {
  if (data.type === 'message') {
    console.log('Offline message stored:', data);
  } else {
    console.log('Unknown action type:', data.type);
  }
};

const doBackgroundSync = async () => {
  try {
    const offlineActions = await getOfflineActions();
    for (const action of offlineActions) {
      try {
        await processOfflineAction(action);
        await removeOfflineAction(action.id);
      } catch (error) {
        console.error('Failed to process offline action:', error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
};

const installServiceWorker = async () => {
  try {
    const cache = await caches.open(STATIC_CACHE);
    console.log('Service Worker: Caching static assets');
    await cache.addAll(STATIC_ASSETS);
    console.log('Service Worker: Static assets cached');
    return self.skipWaiting();
  } catch (error) {
    console.error('Service Worker: Cache installation failed:', error);
  }
};

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(installServiceWorker());
});

const activateServiceWorker = async () => {
  console.log('Service Worker: Activating...');
  const cacheKeys = await caches.keys();
  const ops = cacheKeys.map((key) => {
    if (key !== STATIC_CACHE && key !== DYNAMIC_CACHE) {
      console.log('Service Worker: Deleting old cache:', key);
      return caches.delete(key);
    }
    return null;
  });
  await Promise.all(ops);
  console.log('Service Worker: Activated');
  return self.clients.claim();
};

self.addEventListener('activate', (event) => {
  event.waitUntil(activateServiceWorker());
});

const handleFetch = async (request) => {
  const response = await caches.match(request);
  if (response) return response;
  
  const fetchRequest = request.clone();
  try {
    const fetchResponse = await fetch(fetchRequest);
    if (
      !fetchResponse ||
      fetchResponse.status !== 200 ||
      fetchResponse.type !== 'basic'
    ) {
      return fetchResponse;
    }
    
    const responseToCache = fetchResponse.clone();
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, responseToCache);
    return fetchResponse;
  } catch (error) {
    if (request.destination === 'document') {
      return caches.match('/404.html');
    }
    return null;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  event.respondWith(handleFetch(request));
});

self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered:', event.tag);
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

self.addEventListener('push', (event) => {
  console.log('Service Worker: Push received');
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      { action: 'explore', title: 'View', icon: '/icon.svg' },
      { action: 'close', title: 'Close', icon: '/icon.svg' },
    ],
  };
  event.waitUntil(self.registration.showNotification('PWA Example', options));
});

self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked');
  event.notification.close();
  if (event.action === 'explore') {
    event.waitUntil(self.clients.openWindow('/'));
  }
});

self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'STORE_OFFLINE_ACTION') {
    event.waitUntil(storeOfflineAction(event.data));
  }
});
