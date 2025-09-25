import { Application, generateId } from './pwa.js';

class Logger {
  #output;

  constructor(outputId) {
    this.#output = document.getElementById(outputId);
  }

  log(...args) {
    const lines = args.map(Logger.#serialize);
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${lines.join(' ')}\n`;
    this.#output.textContent += logEntry;
    this.#output.scrollTop = this.#output.scrollHeight;
  }

  clear() {
    this.#output.textContent = '';
  }

  static #serialize(x) {
    return typeof x === 'object' ? JSON.stringify(x, null, 2) : x;
  }
}

const REACTIONS = { like: 0, dislike: 0, love: 0, smile: 0, poo: 0 };

class ChatApplication extends Application {
  constructor(config = {}) {
    super(config);
    this.username = '';
    this.syncTimeout = null;
    this.config = config;
  }

  getElements() {
    this.installBtn = document.getElementById('install-btn');
    this.updateCacheBtn = document.getElementById('update-cache-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.clearMessagesBtn = document.getElementById('clear-messages-btn');
    this.sendBtn = document.getElementById('send-btn');
    this.messageInput = document.getElementById('message-input');
    this.usernameInput = document.getElementById('username-input');
    this.connectionStatus = document.getElementById('connection-status');
    this.installStatus = document.getElementById('install-status');
    this.notification = document.getElementById('notification');
    this.chatMessages = document.getElementById('chat-messages');
    this.messageTemplate = document.getElementById('chat-message-template');
    this.reactionTemplate = document.getElementById('reaction-button-template');
  }

  setupEvents() {
    this.installBtn.onclick = () => this.install();
    this.updateCacheBtn.onclick = () => this.updateCache();
    this.clearBtn.onclick = () => this.logger.clear();
    this.clearMessagesBtn.onclick = () => this.clearDatabase();
    this.sendBtn.onclick = () => this.sendMessage();
    this.messageInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.sendMessage();
    });
    this.usernameInput.addEventListener('blur', () => this.syncUsername());
    this.usernameInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.syncUsername();
    });

    this.on('network', () => this.updateInterface());
    this.on('install', () => this.showInstallButton(true));
    this.on('installed', () => this.showInstallButton(false));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.syncUsername();
    });
    window.addEventListener('beforeunload', () => this.syncUsername());
    window.addEventListener('blur', () => this.syncUsername());
  }

  updateInterface() {
    const online = this.online ? 'online' : 'offline';
    const connected = this.connected ? 'connected' : 'disconnected';
    const status = `${online} / ${connected}`;
    this.connectionStatus.textContent = status.toUpperCase();
    this.connectionStatus.className = `status-indicator ${connected}`;
  }

  syncUsername() {
    const username = this.usernameInput.value.trim();
    if (!username || username === this.username) return;
    this.username = username;
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      this.post({ type: 'username', data: this.username });
      this.logger.log('Username auto-synced:', this.username);
    }, this.config.syncTimeout);
  }

  async sendMessage() {
    const content = this.messageInput.value.trim();
    this.messageInput.value = '';
    if (!content) {
      this.showNotification('Please enter a message', 'warning');
      return;
    }
    this.syncUsername();
    if (!this.username) {
      this.showNotification('Please enter a username', 'warning');
      return;
    }
    const delta = this.addMessage(content);
    this.post({ type: 'delta', data: [delta] });
    if (this.connected) {
      this.logger.log('Sent message:', content);
      this.showNotification('Message sent!', 'success');
    } else {
      this.logger.log('Message queued (offline):', content);
      this.showNotification('Message queued - will send when online', 'info');
    }
    this.renderChatMessages();
  }

  renderChatMessages() {
    this.chatMessages.innerHTML = '';
    const items = Array.from(this.state.values());
    items.sort((a, b) => b.timestamp - a.timestamp);
    for (const message of items) {
      const el = this.createMessageElement(message);
      this.addReactionHandlers(el);
      this.chatMessages.appendChild(el);
    }
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  createMessageElement(message) {
    const el = this.messageTemplate.content.cloneNode(true);
    const div = el.querySelector('.chat-message');
    div.querySelector('.username').textContent = message.username;
    const timestamp = new Date(message.timestamp).toLocaleString();
    div.querySelector('.timestamp').textContent = timestamp;
    div.querySelector('.content').textContent = message.content;
    const reactions = div.querySelector('.reactions');
    this.addReactionButtons(reactions, message);
    return div;
  }

  addReactionButtons(container, message) {
    const reactions = [
      { type: 'like', emoji: '👍' },
      { type: 'dislike', emoji: '👎' },
      { type: 'love', emoji: '❤️' },
      { type: 'smile', emoji: '😊' },
      { type: 'poo', emoji: '💩' },
    ];
    for (const { type, emoji } of reactions) {
      const el = this.reactionTemplate.content.cloneNode(true);
      const button = el.querySelector('.reaction-btn');
      button.dataset.messageId = message.id;
      button.dataset.reaction = type;
      button.querySelector('.emoji').textContent = emoji;
      const count = message.reactions?.[type] || 0;
      button.querySelector('.count').textContent = count;
      container.appendChild(button);
    }
  }

  addReactionHandlers(el) {
    const reactionBtns = el.querySelectorAll('.reaction-btn');
    for (const btn of reactionBtns) {
      const { messageId, reaction } = btn.dataset;
      btn.addEventListener('click', () => {
        const record = { messageId, reaction };
        const delta = { strategy: 'counter', entity: 'reaction', record };
        const message = this.state.get(messageId);
        if (message) {
          if (!message.reactions) message.reactions = {};
          const count = message.reactions[reaction] || 0;
          message.reactions[reaction] = count + 1;
          this.renderChatMessages();
        }
        this.post({ type: 'delta', data: [delta] });
        this.logger.log('Added reaction:', reaction, 'to message:', messageId);
      });
    }
  }

  updateCache() {
    this.logger.log('Requesting cache update...');
    this.updateCacheBtn.disabled = true;
    this.updateCacheBtn.textContent = 'Updating...';
    this.showNotification('Cache update requested', 'info');
    this.post({ type: 'updateCache' });
  }

  showInstallButton(visible = true) {
    if (visible) {
      this.installBtn.classList.remove('hidden');
      this.installStatus.classList.remove('hidden');
    } else {
      this.showNotification('App installed successfully!', 'success');
      this.installBtn.classList.add('hidden');
      this.installStatus.classList.add('hidden');
    }
  }

  showNotification(message, type = 'info') {
    if (!this.notification) return;
    this.notification.textContent = message;
    this.notification.className = `notification ${type}`;
    this.notification.classList.remove('hidden');
    setTimeout(() => {
      this.notification.classList.add('hidden');
    }, this.config.notificationTimeout);
  }

  clearDatabase() {
    this.logger.log('Requesting database clear...');
    this.clearMessagesBtn.disabled = true;
    this.clearMessagesBtn.textContent = 'Clearing...';
    this.showNotification('Database clear requested', 'info');
    this.post({ type: 'clearDatabase' });
  }

  addMessage(content) {
    const id = generateId();
    const username = this.username;
    const timestamp = Date.now();
    const reactions = { ...REACTIONS };
    const message = { id, username, timestamp, content, reactions };
    this.state.set(id, message);
    return { strategy: 'lww', entity: 'message', record: message };
  }
}

const logger = new Logger('output');
const app = new ChatApplication({ logger, syncTimeout: 2000 });

app.on('message', (data) => {
  app.showNotification(`Message: ${data.content}`, 'info');
  app.logger.log('Message:', data.content);
});

app.on('status', (data) => {
  if (data.connected) {
    app.logger.log('Websocket connected');
    app.showNotification('Websocket connected', 'success');
  } else {
    app.logger.log('Websocket disconnected');
    app.showNotification('Websocket disconnected', 'warning');
  }
  app.updateInterface();
});

app.on('state', (state) => {
  app.state.clear();
  for (const [key, value] of Object.entries(state)) {
    app.state.set(key, value);
  }
  app.renderChatMessages();
  app.logger.log('State updated from worker');
});

app.on('username', (data) => {
  app.username = data;
  app.usernameInput.value = data;
  app.logger.log('Username updated from other tab:', data);
  app.showNotification('Username updated from other tab: ' + data);
});

app.on('cacheUpdated', () => {
  app.logger.log('Cache updated successfully');
  app.showNotification('Cache updated successfully!', 'success');
  app.updateCacheBtn.disabled = false;
  app.updateCacheBtn.textContent = 'Update Cache';
});

app.on('cacheUpdateFailed', (data) => {
  app.logger.log('Cache update failed:', data.error);
  app.showNotification('Cache update failed', 'error');
  app.updateCacheBtn.disabled = false;
  app.updateCacheBtn.textContent = 'Update Cache';
});

app.on('databaseCleared', () => {
  app.state.clear();
  app.renderChatMessages();
  app.logger.log('Database cleared successfully');
  app.showNotification('Database cleared successfully!', 'success');
  app.clearMessagesBtn.disabled = false;
  app.clearMessagesBtn.textContent = 'Clear Database';
});

app.on('delta', (data) => {
  for (const delta of data) {
    const { strategy, entity, record } = delta;
    if (entity === 'message' && strategy === 'lww') {
      app.state.set(record.id, record);
      app.logger.log('Message updated from CRDT:', record.id);
    } else if (entity === 'reaction' && strategy === 'counter') {
      const { messageId, reaction } = record;
      const message = app.state.get(messageId);
      if (!message) continue;
      if (!message.reactions) message.reactions = {};
      const count = message.reactions[reaction] || 0;
      message.reactions[reaction] = count + 1;
      app.logger.log(`Reaction from CRDT: ${reaction} for: ${messageId}`);
    }
  }
  app.renderChatMessages();
});

export { ChatApplication, app };
