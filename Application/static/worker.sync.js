import { mergeDelta } from './crdt.js';

const ignore = () => {};

export class SyncManager {
  constructor() {
    // Position in the server log: entries up to it are applied here
    this.lastDeltaId = 0;
    this.state = new Map();
    // Own deltas applied here before the server log returns them
    this.pending = new Set();
    // Own deltas the server has not accepted yet
    this.queue = [];
    this.root = null;
    this.ready = this.init();
  }

  #saving = Promise.resolve();
  #scheduled = null;

  async init() {
    this.root = await navigator.storage.getDirectory();
    await this.loadState();
  }

  async loadState() {
    const file = await this.root.getFileHandle('state.json', { create: true });
    const reader = await file.getFile();
    const data = await reader.text();
    if (!data) return;
    const parsed = JSON.parse(data);
    this.lastDeltaId = parsed.lastDeltaId || 0;
    this.queue = parsed.queue || [];
    for (const id of parsed.pending || []) this.pending.add(id);
    const messages = parsed.messages || {};
    for (const id of Object.keys(messages)) this.state.set(id, messages[id]);
  }

  // Saves requested before a write starts share it: write reads latest state
  saveState() {
    if (this.#scheduled) return this.#scheduled;
    const scheduled = this.#saving.then(() => {
      this.#scheduled = null;
      return this.#write();
    });
    this.#scheduled = scheduled;
    this.#saving = scheduled.then(ignore, ignore);
    return scheduled;
  }

  async #write() {
    if (!this.root) return;
    const state = {
      lastDeltaId: this.lastDeltaId,
      queue: this.queue,
      pending: Array.from(this.pending),
      messages: this.getMessages(),
    };
    const file = await this.root.getFileHandle('state.json', { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(state));
    await writable.close();
  }

  // Own deltas from tabs: applied now, sent to the server through the queue
  commit(deltas) {
    const fresh = [];
    for (const delta of deltas) {
      if (!mergeDelta(this.state, delta)) continue;
      this.pending.add(delta.id);
      this.queue.push(delta);
      fresh.push(delta);
    }
    if (fresh.length > 0) this.saveState();
    return fresh;
  }

  // Server log entries ending at lastDeltaId, null if entries before are missed
  append(deltas, lastDeltaId) {
    const start = lastDeltaId - deltas.length;
    if (start > this.lastDeltaId) return null;
    const entries = deltas.slice(this.lastDeltaId - start);
    const fresh = [];
    for (const delta of entries) {
      if (this.pending.delete(delta.id)) continue;
      if (mergeDelta(this.state, delta)) fresh.push(delta);
    }
    if (lastDeltaId > this.lastDeltaId) this.lastDeltaId = lastDeltaId;
    if (entries.length > 0) this.saveState();
    return fresh;
  }

  async clearDatabase() {
    this.state.clear();
    this.pending.clear();
    this.lastDeltaId = 0;
    this.queue = [];
    await this.saveState();
  }

  getMessages() {
    return Object.fromEntries(this.state);
  }
}

export const syncManager = new SyncManager();
