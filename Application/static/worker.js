const CACHE = 'v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/pwa.js',
  '/domain.js',
  '/worker.js',
  '/manifest.json',
  '/icon.svg',
  '/favicon.ico',
  '/404.html',
];

class SyncWorker {
  constructor() {
    this.websocket = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectTimer = null;
    this.clientId = '';
    this.lastDeltaId = 0;
    this.state = new Map();
    this.queue = [];
    this.root = null;
    this.init();
  }

  async init() {
    this.root = await navigator.storage.getDirectory();
    await this.loadState();
  }

  delivery(packet) {
    if (this.connected) {
      this.send(packet);
    } else {
      this.queue.push(packet);
      this.saveState();
    }
  }

  send(packet) {
    this.websocket.send(JSON.stringify(packet));
  }

  async loadState() {
    if (!this.root) return;
    const file = await this.root.getFileHandle('state.json', { create: true });
    const reader = await file.getFile();
    const data = await reader.text();
    if (!data) return;
    const parsed = JSON.parse(data);
    this.lastDeltaId = parsed.lastDeltaId || 0;
    this.queue = parsed.queue || [];
    this.clientId = parsed.clientId;
    const messages = parsed.messages || {};
    for (const [id, message] of Object.entries(messages)) {
      this.state.set(id, message);
    }
  }

  async saveState() {
    if (!this.root) return;
    const messages = {};
    for (const [key, value] of this.state.entries()) {
      messages[key] = value;
    }
    const state = {
      clientId: this.clientId,
      lastDeltaId: this.lastDeltaId,
      queue: this.queue,
      messages,
    };
    const file = await this.root.getFileHandle('state.json', { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(state));
    await writable.close();
  }

  applyDelta(records) {
    for (const record of records) {
      this.applyCRDT(record);
    }
    this.saveState();
  }

  applyCRDT(delta) {
    const { strategy, entity, record } = delta;
    if (entity === 'message' && strategy === 'lww') {
      this.state.set(record.id, record);
    } else if (entity === 'reaction' && strategy === 'counter') {
      const { messageId, reaction } = record;
      const message = this.state.get(messageId);
      if (!message) return;
      if (!message.reactions) message.reactions = {};
      const count = message.reactions[reaction] || 0;
      message.reactions[reaction] = count + 1;
    }
  }

  async flushQueue() {
    if (!this.connected) return;
    if (!this.queue.length) return;
    for (const packet of this.queue) {
      this.send(packet);
    }
    this.queue = [];
    await this.saveState();
  }

  async clearDatabase() {
    this.state.clear();
    this.lastDeltaId = 0;
    this.queue = [];
    await this.saveState();
  }
}

const syncWorker = new SyncWorker();

const broadcast = async (packet, exclude) => {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
  });
  for (const client of clients) {
    if (client.id !== exclude) {
      console.log('Broadcasting to:', client.id);
      client.postMessage(packet);
    }
  }
};

const updateCache = async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS);
};

self.addEventListener('install', (event) => {
  const install = async () => {
    await updateCache();
    await self.skipWaiting();
  };
  event.waitUntil(install());
});

const serveFromCache = async (request) => {
  const cache = await caches.open(CACHE);
  const response = await cache.match(request);
  return response;
};

const fetchFromNetwork = async (request) => {
  const response = await fetch(request);
  if (response.status === 200) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

const offlineFallback = async (request) => {
  const cachedResponse = await serveFromCache(request);
  if (cachedResponse) return cachedResponse;
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
      await caches.delete(cacheName);
    });
  await Promise.all(deletePromises);
};

self.addEventListener('fetch', async (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  const respond = async () => {
    try {
      const response = await serveFromCache(request);
      if (response) return response;
      return await fetchFromNetwork(request);
    } catch {
      return await offlineFallback(request);
    }
  };
  event.respondWith(respond());
});

const activate = async () => {
  try {
    await Promise.all([cleanupCache(), self.clients.claim()]);
    console.log('Service Worker: Activated successfully');
  } catch (error) {
    console.error('Service Worker: Activation failed:', error);
  }
};

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    (async () => {
      await activate();
      await syncWorker.loadState();
    })(),
  );
});

const connect = async () => {
  if (syncWorker.connected || syncWorker.connecting) return;
  syncWorker.connecting = true;

  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${self.location.host}`;
  syncWorker.websocket = new WebSocket(url);

  syncWorker.websocket.onopen = () => {
    syncWorker.connected = true;
    syncWorker.connecting = false;
    console.log('Service Worker: websocket connected');
    broadcast({ type: 'status', data: { connected: true } });
    const data = { lastDeltaId: syncWorker.lastDeltaId };
    syncWorker.send({ type: 'sync', data });
    syncWorker.flushQueue();
  };

  syncWorker.websocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Service Worker: websocket message:', message);
    const { type, data } = message;
    if (type === 'delta') {
      syncWorker.lastDeltaId += data.length;
      syncWorker.applyDelta(data);
    }
    broadcast(message);
  };

  syncWorker.websocket.onclose = () => {
    console.log('Service Worker: websocket disconnected');
    if (syncWorker.connected) {
      syncWorker.connected = false;
      broadcast({ type: 'status', data: { connected: false } });
    }
    syncWorker.connecting = false;
    if (syncWorker.reconnectTimer) clearTimeout(syncWorker.reconnectTimer);
    syncWorker.reconnectTimer = setTimeout(connect, 3000);
  };
};

const events = {
  connect: (source, data) => {
    syncWorker.clientId = data.clientId;
    source.postMessage({
      type: 'status',
      data: { connected: syncWorker.connected },
    });
    const messages = {};
    for (const [key, value] of syncWorker.state.entries()) {
      messages[key] = value;
    }
    console.log({ messages });
    source.postMessage({ type: 'state', data: messages });
  },
  online: () => connect(),
  offline: () => {
    if (syncWorker.connected) syncWorker.websocket.close();
  },
  delta: (source, data) => {
    syncWorker.applyDelta(data);
    syncWorker.lastDeltaId += data.length;
    broadcast({ type: 'delta', data }, source.id);
    syncWorker.delivery({ type: 'delta', data });
  },
  username: (source, data) => {
    broadcast({ type: 'username', data }, source.id);
  },
  ping: (source) => {
    source.postMessage({ type: 'pong' });
  },
  updateCache: async (source) => {
    try {
      await updateCache();
      source.postMessage({ type: 'cacheUpdated' });
    } catch (error) {
      const data = { error: error.message };
      source.postMessage({ type: 'cacheUpdateFailed', data });
    }
  },
  clearDatabase: async (source) => {
    try {
      await syncWorker.clearDatabase();
      const messages = {};
      for (const [key, value] of syncWorker.state.entries()) {
        messages[key] = value;
      }
      broadcast({ type: 'state', data: messages });
      source.postMessage({ type: 'databaseCleared' });
    } catch (error) {
      const data = { error: error.message };
      source.postMessage({ type: 'databaseClearFailed', data });
    }
  },
};

self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  const handler = events[type];
  if (handler) handler(event.source, data);
});

connect();
