import { Database } from './database.js';

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
  constructor() {
    this.logger = new Logger('output');
    this.websocket = null;
    this.connected = false;
    this.prompt = null;
    this.online = navigator.onLine;
    this.db = new Database();
    this.init();
  }

  init() {
    this.getElements();
    this.setupEventListeners();
    this.setupNetworkListeners();
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
  }

  getElements() {
    this.installBtn = document.getElementById('install-btn');
    this.connectBtn = document.getElementById('connect-btn');
    this.disconnectBtn = document.getElementById('disconnect-btn');
    this.sendMessageBtn = document.getElementById('send-message-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.sendBtn = document.getElementById('send-btn');
    this.messageInput = document.getElementById('message-input');
    this.connectionStatus = document.getElementById('connection-status');
    this.installStatus = document.getElementById('install-status');
    this.notification = document.getElementById('notification');
  }

  setupEventListeners() {
    this.installBtn.onclick = () => this.install();
    this.connectBtn.onclick = () => this.connect();
    this.disconnectBtn.onclick = () => this.disconnect();
    this.sendMessageBtn.onclick = () => this.sendMessage();
    this.clearBtn.onclick = () => this.logger.clear();
    this.sendBtn.onclick = () => this.sendMessage();
    this.messageInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') this.sendMessage();
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.logger.log('Service Worker updated, reloading...');
      window.location.reload();
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      this.logger.log('SW Message:', event.data);
    });
  }

  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.online = true;
      this.updateConnectionStatus();
      this.logger.log('Network: Online');
      this.syncOfflineActions();
    });
    window.addEventListener('offline', () => {
      this.online = false;
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

  async connect() {
    if (this.connected) {
      this.logger.log('Already connected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;
    this.websocket = new WebSocket(url);

    this.websocket.onopen = () => {
      this.connected = true;
      this.updateUI();
      this.logger.log('WebSocket connected');
      this.showNotification('WebSocket connected!', 'success');
    };

    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.logger.log('Received:', data);
      this.handleWebSocketMessage(data);
    };

    this.websocket.onclose = () => {
      this.connected = false;
      this.updateUI();
      this.logger.log('WebSocket disconnected');
      this.showNotification('WebSocket disconnected', 'warning');
    };

    this.websocket.onerror = (error) => {
      this.logger.log('WebSocket error:', error);
      this.showNotification('WebSocket connection failed', 'error');
    };
  }

  disconnect() {
    if (!this.websocket) return;
    this.websocket.close();
    this.websocket = null;
  }

  async sendMessage() {
    const content = this.messageInput?.value?.trim();
    this.messageInput.value = '';

    if (!content) {
      this.showNotification('Please enter a message', 'warning');
      return;
    }

    const timestamp = new Date().toISOString();
    const clientId = this.clientId;
    const id = generateId();
    const data = { id, type: 'message', content, timestamp, clientId };

    if (this.connected) {
      this.websocket.send(JSON.stringify(data));
      this.logger.log('Sent via WebSocket:', data);
    } else {
      this.storeOfflineAction(data);
      this.logger.log('Stored for offline sync:', data);
      this.showNotification('Message stored for offline sync');
    }
  }

  handleWebSocketMessage(msg) {
    if (msg.type === 'broadcast') {
      this.logger.log('Broadcast:', msg.content);
      this.showNotification(`Broadcast: ${msg.content}`);
    } else if (msg.type === 'userCount') {
      this.logger.log(`Active users: ${msg.count}`);
    } else if (msg.type === 'system') {
      this.logger.log('System:', msg.content);
    }
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
    this.connectBtn.classList.toggle('hidden', this.connected);
    this.disconnectBtn.classList.toggle('hidden', !this.connected);
    this.sendMessageBtn.disabled = !this.connected && !this.online;
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

  async storeOfflineAction(data) {
    const timestamp = new Date().toISOString();
    navigator.serviceWorker.controller.postMessage({
      id: generateId(),
      type: 'STORE_OFFLINE_ACTION',
      data: { type: 'message', data, timestamp },
    });
    this.logger.log('Stored offline action:', data);
  }

  async syncOfflineActions() {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('background-sync');
      this.logger.log('Background sync registered');
    } catch (error) {
      this.logger.log('Background sync failed:', error.message);
    }
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
window.application = new Application();
