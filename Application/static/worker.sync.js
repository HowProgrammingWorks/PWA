export class SyncManager {
  constructor() {
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

  async clearDatabase() {
    this.state.clear();
    this.lastDeltaId = 0;
    this.queue = [];
    await this.saveState();
  }

  getMessages() {
    const messages = {};
    for (const [key, value] of this.state.entries()) {
      messages[key] = value;
    }
    return messages;
  }
}

export const syncManager = new SyncManager();
