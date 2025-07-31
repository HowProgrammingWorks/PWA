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

const generateId = () => Math.random().toString(36).substr(2, 9);

class Application {
  constructor(worker) {
    this.logger = new Logger('output');
    this.prompt = null;
    this.online = navigator.onLine;
    this.worker = worker;
    this.init();
  }

  init() {
    this.worker.postMessage({ type: 'connect' });
    this.getElements();
    this.setupEventListeners();
    this.setupNetworkStatus();
    this.setupInstallPrompt();
    this.updateUI();
    setTimeout(() => {
      this.requestNotificationPermission();
    }, 2000);
    this.clientId = localStorage.getItem('clientId');
    if (!this.clientId) {
      this.clientId = generateId();
      localStorage.setItem('clientId', this.clientId);
    }
    const ping = () => this.worker.postMessage({ type: 'ping' });
    setInterval(ping, 25000);
    document.addEventListener('visibilitychange', ping);
  }

  getElements() {
    this.installBtn = document.getElementById('install-btn');
    this.sendMessageBtn = document.getElementById('send-message-btn');
    this.updateCacheBtn = document.getElementById('update-cache-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.sendBtn = document.getElementById('send-btn');
    this.messageInput = document.getElementById('message-input');
    this.connectionStatus = document.getElementById('connection-status');
    this.installStatus = document.getElementById('install-status');
    this.notification = document.getElementById('notification');
  }

  setupEventListeners() {
    this.installBtn.onclick = () => this.install();
    this.sendMessageBtn.onclick = () => this.sendMessage();
    this.updateCacheBtn.onclick = () => this.updateCache();
    this.clearBtn.onclick = () => this.logger.clear();
    this.sendBtn.onclick = () => this.sendMessage();
    this.messageInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.sendMessage();
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      this.logger.log('Message:', event.data);
      this.onWorkerMessage(event.data);
    });
    window.addEventListener('beforeunload', () => {
      this.worker.postMessage({ type: 'disconnect' });
    });
  }

  setupNetworkStatus() {
    window.addEventListener('online', () => {
      this.online = true;
      this.worker.postMessage({ type: 'online' });
      this.updateConnectionStatus();
      this.logger.log('Network: Online');
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.worker.postMessage({ type: 'offline' });
      this.updateConnectionStatus();
      this.logger.log('Network: Offline');
    });
  }

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.prompt = event;
      this.showInstallButton();
      this.logger.log('Install prompt available');
    });
    window.addEventListener('appinstalled', () => {
      this.hideInstallButton();
      this.logger.log('App installed successfully');
      this.showNotification('App installed successfully!', 'success');
    });
  }

  onWorkerMessage(message) {
    if (message.type === 'status') {
      this.updateUI();
      if (message.connected) {
        this.logger.log('Service worker connected');
        this.showNotification('Service worker connected', 'success');
      } else {
        this.logger.log('Service worker disconnected');
        this.showNotification('Service worker disconnected', 'warning');
      }
    }
    if (message.type === 'message') {
      this.showNotification(`Message: ${message.content}`, 'info');
      this.logger.log('Message:', message.content);
    }
    if (message.type === 'error') {
      this.logger.log('Service worker error:', message.error);
      this.showNotification('Service worker error', 'error');
    }
    if (message.type === 'cacheUpdated') {
      this.logger.log('Cache updated successfully');
      this.showNotification('Cache updated successfully!', 'success');
      this.updateCacheBtn.disabled = false;
      this.updateCacheBtn.textContent = 'Update Cache';
    }
    if (message.type === 'cacheUpdateFailed') {
      this.logger.log('Cache update failed:', message.error);
      this.showNotification('Cache update failed', 'error');
      this.updateCacheBtn.disabled = false;
      this.updateCacheBtn.textContent = 'Update Cache';
    }
  }

  async sendMessage() {
    const content = this.messageInput?.value?.trim();
    this.messageInput.value = '';
    if (!content) {
      this.showNotification('Please enter a message', 'warning');
      return;
    }
    this.worker.postMessage({ type: 'message', content });
    this.logger.log('Sent message:', content);
  }

  async install() {
    if (!this.prompt) {
      this.logger.log('Install prompt not available');
      return;
    }
    this.prompt.prompt();
    const { outcome } = await this.prompt.userChoice;
    const message = outcome === 'accepted' ? 'accepted' : 'dismissed';
    this.logger.log(`Install prompt ${message}`);
    this.prompt = null;
    this.hideInstallButton();
  }

  async updateCache() {
    this.logger.log('Requesting cache update...');
    this.updateCacheBtn.disabled = true;
    this.updateCacheBtn.textContent = 'Updating...';
    try {
      this.worker.postMessage({ type: 'updateCache' });
      this.showNotification('Cache update requested', 'info');
    } catch (error) {
      this.logger.log('Failed to request cache update:', error);
      this.showNotification('Failed to update cache', 'error');
      this.updateCacheBtn.disabled = false;
      this.updateCacheBtn.textContent = 'Update Cache';
    }
  }

  showInstallButton() {
    this.installBtn.classList.remove('hidden');
    this.installStatus.classList.remove('hidden');
  }

  hideInstallButton() {
    this.installBtn.classList.add('hidden');
    this.installStatus.classList.add('hidden');
  }

  updateConnectionStatus() {
    const status = this.online ? 'online' : 'offline';
    this.connectionStatus.textContent = status.toUpperCase();
    this.connectionStatus.className = `status-indicator ${status}`;
  }

  updateUI() {
    this.sendMessageBtn.disabled = !this.online;
    this.updateConnectionStatus();
  }

  showNotification(message, type = 'info') {
    if (!this.notification) return;
    this.notification.textContent = message;
    this.notification.className = `notification ${type}`;
    this.notification.classList.remove('hidden');
    setTimeout(() => {
      this.notification.classList.add('hidden');
    }, 3000);
  }

  async requestNotificationPermission() {
    const permission = await Notification.requestPermission();
    this.logger.log('Notification permission:', permission);
    return permission === 'granted';
  }

  async sendTestNotification() {
    const notification = new Notification('PWA Example', {
      body: 'This is a test notification from the PWA!',
      icon: '/icon.svg',
      badge: '/icon.svg',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    this.logger.log('Test notification sent');
  }
}

window.Application = Application;

navigator.serviceWorker.register('./worker.js');

navigator.serviceWorker.ready.then((registration) => {
  window.application = new Application(registration.active);
});
