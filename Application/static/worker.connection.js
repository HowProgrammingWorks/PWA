import { syncManager } from './worker.sync.js';

export class ConnectionManager {
  constructor() {
    this.websocket = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectTimer = null;
  }

  static async broadcast(packet, exclude) {
    const clients = await self.clients.matchAll({
      includeUncontrolled: true,
    });
    for (const client of clients) {
      if (client.id !== exclude) {
        console.log('Broadcasting to:', client.id);
        client.postMessage(packet);
      }
    }
  }

  send(packet) {
    this.websocket.send(JSON.stringify(packet));
  }

  delivery(packet) {
    if (this.connected) {
      this.send(packet);
    } else {
      syncManager.queue.push(packet);
      syncManager.saveState();
    }
  }

  async connect() {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${self.location.host}`;
    this.websocket = new WebSocket(url);

    this.websocket.onopen = () => {
      this.connected = true;
      this.connecting = false;
      console.log('Service Worker: websocket connected');
      const message = { type: 'status', data: { connected: true } };
      ConnectionManager.broadcast(message);
      const data = { lastDeltaId: syncManager.lastDeltaId };
      this.send({ type: 'sync', data });
      this.flushQueue();
    };

    this.websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Service Worker: websocket message:', message);
      const { type, data } = message;
      if (type === 'delta') {
        syncManager.lastDeltaId += data.length;
        syncManager.applyDelta(data);
      }
      ConnectionManager.broadcast(message);
    };

    this.websocket.onclose = () => {
      console.log('Service Worker: websocket disconnected');
      if (this.connected) {
        this.connected = false;
        const message = { type: 'status', data: { connected: false } };
        ConnectionManager.broadcast(message);
      }
      this.connecting = false;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  async flushQueue() {
    if (!this.connected) return;
    if (!syncManager.queue.length) return;
    for (const packet of syncManager.queue) {
      this.send(packet);
    }
    syncManager.queue = [];
    await syncManager.saveState();
  }

  disconnect() {
    if (this.connected) this.websocket.close();
  }
}

export const connectionManager = new ConnectionManager();
