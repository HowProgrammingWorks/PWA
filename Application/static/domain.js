import { Application } from './pwa.js';

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

class Example extends Application {
  getElements() {
    this.installBtn = document.getElementById('install-btn');
    this.updateCacheBtn = document.getElementById('update-cache-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.sendBtn = document.getElementById('send-btn');
    this.messageInput = document.getElementById('message-input');
    this.connectionStatus = document.getElementById('connection-status');
    this.installStatus = document.getElementById('install-status');
    this.notification = document.getElementById('notification');
  }

  setupEvents() {
    this.installBtn.onclick = () => this.install();
    this.updateCacheBtn.onclick = () => this.updateCache();
    this.clearBtn.onclick = () => this.logger.clear();
    this.sendBtn.onclick = () => this.sendMessage();
    this.messageInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.sendMessage();
    });
    this.on('network', () => this.updateInterface());
    this.on('install', () => this.showInstallButton(true));
    this.on('installed', () => this.showInstallButton(false));
  }

  updateInterface() {
    this.sendBtn.disabled = !this.connected;
    const online = this.online ? 'online' : 'offline';
    const connected = this.connected ? 'connected' : 'disconnected';
    const status = `${online} / ${connected}`;
    this.connectionStatus.textContent = status.toUpperCase();
    this.connectionStatus.className = `status-indicator ${connected}`;
  }

  async sendMessage() {
    const content = this.messageInput.value.trim();
    if (!content) {
      this.showNotification('Please enter a message', 'warning');
      return;
    }
    this.messageInput.value = '';
    this.post({ type: 'message', data: { content } });
    this.logger.log('Sent message:', content);
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
}

const logger = new Logger('output');
const app = new Example({ logger });

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

app.on('error', (data) => {
  app.logger.log('Service worker error:', data.error);
  app.showNotification('Service worker error', 'error');
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

export { Example, app };
