import { MetacomProxy } from './metacom.js';
import { syncManager } from './worker.sync.js';
import { cacheManager } from './worker.static.js';

const proxy = new MetacomProxy();
const { server } = proxy;

const report = (error) => {
  console.log('Service Worker:', error.message);
};

// Server log is applied one batch at a time, in log order
let applying = Promise.resolve();
const serialize = (task) => {
  const result = applying.then(task);
  applying = result.catch(report);
  return result;
};

const broadcast = (deltas) => {
  if (deltas.length > 0) proxy.broadcast('chat/delta', deltas);
};

const pull = async () => {
  const { lastDeltaId } = syncManager;
  const reply = await server.api.chat.sync({ lastDeltaId });
  // Server log is shorter than the cursor after server data was reset
  syncManager.lastDeltaId = Math.min(lastDeltaId, reply.lastDeltaId);
  broadcast(syncManager.append(reply.deltas, reply.lastDeltaId) ?? []);
};

// Event that does not continue the local log means entries were missed
const receive = async ({ deltas, lastDeltaId }) => {
  const fresh = syncManager.append(deltas, lastDeltaId);
  if (fresh) broadcast(fresh);
  else await pull();
};

const onLog = (entries) => serialize(() => receive(entries));

// Own deltas leave the persistent queue in order once the server accepts them
const flushQueue = async () => {
  while (syncManager.queue.length > 0) {
    if (!server.active || !server.api.chat) return false;
    const deltas = syncManager.queue.slice();
    await server.api.chat.delta({ deltas });
    const sent = new Set(deltas);
    syncManager.queue = syncManager.queue.filter((delta) => !sent.has(delta));
    await syncManager.saveState();
  }
  return true;
};

let flushing = null;
const deliver = () => {
  if (!flushing) {
    flushing = flushQueue().finally(() => {
      flushing = null;
    });
  }
  return flushing;
};

// Runs after each connect without holding calls that tabs queued meanwhile
const synchronize = async () => {
  await syncManager.ready;
  await server.load('chat');
  const { chat } = server.api;
  if (!chat.listeners('log').includes(onLog)) chat.on('log', onLog);
  await chat.subscribe();
  await serialize(pull);
  await deliver();
};

server.on('open', () => {
  synchronize().catch(report);
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

  // Sender tab renders its delta from the broadcast like every other tab
  delta: async ({ deltas }) => {
    await syncManager.ready;
    broadcast(syncManager.commit(deltas));
    const delivered = await deliver().catch((error) => {
      report(error);
      return false;
    });
    return { delivered };
  },

  username: async ({ username }, context) => {
    context.broadcast('chat/username', username);
    return true;
  },

  clear: () =>
    serialize(async () => {
      await syncManager.ready;
      await syncManager.clearDatabase();
      proxy.broadcast('chat/state', syncManager.getMessages());
      return true;
    }),
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
