import { applyDeltas } from './crdt.js';

const ignore = () => {};

export class SyncManager {
  constructor() {
    this.lastDeltaId = 0;
    this.state = new Map();
    this.applied = new Set();
    this.queue = [];
    this.root = null;
    this.ready = this.init();
  }

  #saving = Promise.resolve();
  #pending = null;

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
    for (const id of parsed.applied || []) this.applied.add(id);
    const messages = parsed.messages || {};
    for (const id of Object.keys(messages)) this.state.set(id, messages[id]);
  }

  // Saves requested before a write starts share it: write reads latest state
  saveState() {
    if (this.#pending) return this.#pending;
    const pending = this.#saving.then(() => {
      this.#pending = null;
      return this.#write();
    });
    this.#pending = pending;
    this.#saving = pending.then(ignore, ignore);
    return pending;
  }

  async #write() {
    if (!this.root) return;
    const state = {
      lastDeltaId: this.lastDeltaId,
      queue: this.queue,
      applied: Array.from(this.applied),
      messages: this.getMessages(),
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
    return Object.fromEntries(this.state);
  }
}

export const syncManager = new SyncManager();
