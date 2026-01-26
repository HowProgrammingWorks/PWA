import { syncManager } from './worker.sync.js';
import { connectionManager, ConnectionManager } from './worker.connection.js';
import { cacheManager } from './worker.static.js';

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
  event.waitUntil(
    (async () => {
      await activate();
      await syncManager.loadState();
    })(),
  );
});

const events = {
  connect: (source, data) => {
    syncManager.clientId = data.clientId;
    source.postMessage({
      type: 'status',
      data: { connected: connectionManager.connected },
    });
    const messages = syncManager.getMessages();
    console.log({ messages });
    source.postMessage({ type: 'state', data: messages });
  },
  online: () => connectionManager.connect(),
  offline: () => connectionManager.disconnect(),
  delta: (source, data) => {
    syncManager.applyDelta(data);
    syncManager.lastDeltaId += data.length;
    ConnectionManager.broadcast({ type: 'delta', data }, source.id);
    connectionManager.delivery({ type: 'delta', data });
  },
  username: (source, data) => {
    ConnectionManager.broadcast({ type: 'username', data }, source.id);
  },
  ping: (source) => {
    source.postMessage({ type: 'pong' });
  },
  updateCache: async (source) => {
    try {
      await cacheManager.update();
      source.postMessage({ type: 'cacheUpdated' });
    } catch (error) {
      const data = { error: error.message };
      source.postMessage({ type: 'cacheUpdateFailed', data });
    }
  },
  clearDatabase: async (source) => {
    try {
      await syncManager.clearDatabase();
      const messages = syncManager.getMessages();
      ConnectionManager.broadcast({ type: 'state', data: messages });
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

connectionManager.connect();
