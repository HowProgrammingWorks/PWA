import { MetacomProxy } from './metacom.js';
import { snapshotDelta } from './crdt.js';
import { syncManager } from './worker.sync.js';
import { cacheManager } from './worker.static.js';

const receive = (deltas) => {
  syncManager.lastDeltaId += deltas.length;
  return syncManager.applyDelta(deltas);
};

const enqueue = async (deltas) => {
  const copies = [];
  for (const delta of deltas) copies.push(snapshotDelta(delta));
  syncManager.queue = syncManager.queue.concat(copies);
  await syncManager.saveState();
};

// Deltas wait in persistent queue while server is unreachable
const deliver = async (server, deltas) => {
  const { chat } = server.api;
  const isReachable = server.active && chat !== undefined;
  if (isReachable) {
    try {
      await chat.delta({ deltas });
      return true;
    } catch (error) {
      console.error('Service Worker: delivery failed:', error);
    }
  }
  await enqueue(deltas);
  return false;
};

const flushQueue = async (server) => {
  const pending = syncManager.queue;
  if (pending.length === 0) return;
  syncManager.queue = [];
  try {
    await server.api.chat.delta({ deltas: pending });
  } catch (error) {
    const arrived = syncManager.queue;
    syncManager.queue = pending.concat(arrived);
    await syncManager.saveState();
    throw error;
  }
  await syncManager.saveState();
};

// Runs after each connect, before calls queued by tabs reach the server
const synchronize = async (server, proxy) => {
  await syncManager.ready;
  await server.load('chat');
  const { chat } = server.api;
  if (chat.listenerCount('delta') === 0) chat.on('delta', receive);
  await chat.subscribe();
  const { lastDeltaId } = syncManager;
  const { deltas } = await chat.sync({ lastDeltaId });
  if (deltas.length > 0) {
    const fresh = receive(deltas);
    if (fresh.length > 0) proxy.broadcast('chat/delta', fresh);
  }
  await flushQueue(server);
};

const proxy = new MetacomProxy({
  restore: (server) => synchronize(server, proxy),
});

// Each failed reconnect attempt is reported here while offline
proxy.on('error', (error) => {
  console.log('Service Worker: metacom error:', error.message);
});

// Methods handled in the worker, other calls are proxied to the server
proxy.register('chat', {
  state: async () => {
    await syncManager.ready;
    return syncManager.getMessages();
  },

  delta: async ({ deltas }, context) => {
    const fresh = receive(deltas);
    if (fresh.length > 0) context.broadcast('chat/delta', fresh);
    const delivered = await deliver(context.server, deltas);
    return { delivered };
  },

  username: async ({ username }, context) => {
    context.broadcast('chat/username', username);
    return true;
  },

  clear: async () => {
    await syncManager.clearDatabase();
    proxy.broadcast('chat/state', syncManager.getMessages());
    return true;
  },
});

proxy.register('cache', {
  update: async () => {
    await cacheManager.update();
    return true;
  },
});

self.addEventListener('install', (e) => cacheManager.handleInstall(e));
self.addEventListener('fetch', (e) => cacheManager.handleFetch(e));

const activate = async () => {
  try {
    await Promise.all([cacheManager.cleanup(), self.clients.claim()]);
    console.log('Service Worker: Activated successfully');
  } catch (error) {
    console.error('Service Worker: Activation failed:', error);
  }
};

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(activate());
});

proxy.open().catch((error) => {
  console.log('Service Worker: server is unreachable:', error.message);
});
