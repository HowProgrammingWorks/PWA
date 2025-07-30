const CACHE = 'v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/application.js',
  '/database.js',
  '/manifest.json',
  '/icon.svg',
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

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', async ({ request }) => {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status < 400) cache.put(request, response.clone());
  return response;
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
});

connect();

self.addEventListener('beforeunload', (event) => {
  console.log('Service Worker: beforeunload', event);
});
