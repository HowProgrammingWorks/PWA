import { applyDeltas, copyReactions, snapshotDelta } from './crdt.js';

const ignore = () => {};

const messagesFrom = (state) => {
  const messages = {};
  for (const id of state.keys()) messages[id] = state.get(id);
  return messages;
};

export class SyncManager {
  constructor() {
    this.clientId = '';
    this.lastDeltaId = 0;
    this.state = new Map();
    this.applied = new Set();
    this.queue = [];
    this.root = null;
    this.ready = this.init();
  }

  #saving = Promise.resolve();

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
    this.clientId = parsed.clientId || '';
    this.queue = [];
    const storedQueue = parsed.queue || [];
    for (const delta of storedQueue) {
      this.queue.push(snapshotDelta(delta));
    }
    const storedApplied = parsed.applied || [];
    for (const id of storedApplied) this.applied.add(id);
    const messages = parsed.messages || {};
    const ids = Object.keys(messages);
    for (const id of ids) {
      const stored = messages[id];
      const reactions = copyReactions(stored.reactions);
      const message = {
        id: stored.id,
        username: stored.username,
        timestamp: stored.timestamp,
        content: stored.content,
        reactions,
      };
      this.state.set(id, message);
    }
  }

  async saveState() {
    const saving = this.#saving.then(() => this.#write());
    this.#saving = saving.then(ignore, ignore);
    await saving;
  }

  async #write() {
    if (!this.root) return;
    const messages = messagesFrom(this.state);
    const applied = [];
    for (const id of this.applied) applied.push(id);
    const state = {
      clientId: this.clientId,
      lastDeltaId: this.lastDeltaId,
      queue: this.queue,
      applied,
      messages,
    };
    const file = await this.root.getFileHandle('state.json', { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(state));
    await writable.close();
  }

  applyDelta(deltas) {
    const fresh = applyDeltas(this.state, deltas, this.applied);
    this.saveState();
    return fresh;
  }

  async clearDatabase() {
    this.state.clear();
    this.applied.clear();
    this.lastDeltaId = 0;
    this.queue = [];
    await this.saveState();
  }

  getMessages() {
    return messagesFrom(this.state);
  }
}

export const syncManager = new SyncManager();
