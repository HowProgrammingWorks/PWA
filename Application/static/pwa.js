import { Emitter } from './metautil.js';
import { Metacom } from './metacom.js';

const generateId = () => Math.random().toString(36).substr(2, 9);

const getClientId = () => {
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = generateId();
    localStorage.setItem('clientId', clientId);
  }
  return clientId;
};

const CONFIG_DEFAULTS = {
  notificationTimeout: 3000,
  serviceWorker: './worker.js',
};

class Application extends Emitter {
  constructor(config = {}) {
    super();
    this.config = { ...CONFIG_DEFAULTS, ...config };
    this.state = new Map();
    this.metacom = null;
    this.api = null;
    this.prompt = null;
    this.clientId = getClientId();
    this.serviceWorker = this.config.serviceWorker;
    this.logger = this.config.logger;
    this.online = navigator.onLine;
    this.connected = false;
    this.#init();
  }

  #init() {
    this.getElements();
    this.#setupServiceWorker().catch((error) => {
      this.logger.log('Service worker setup failed:', error.message);
    });
    this.#setupNetworkStatus();
    this.#setupInstallPrompt();
    this.#setupNotifications();
    this.setupEvents();
    this.updateInterface();
  }

  // Tab talks to service worker with the same api as to the server
  async #setupServiceWorker() {
    const { serviceWorker } = navigator;
    await serviceWorker.register(this.serviceWorker, { type: 'module' });
    const registration = await serviceWorker.ready;
    const worker = registration.active;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    const metacom = Metacom.create(url, { worker });
    metacom.on('status', ({ connected }) => {
      this.connected = connected;
      this.emit('status', { connected });
    });
    metacom.on('error', (error) => {
      this.logger.log('Metacom error:', error.message);
    });
    await metacom.open();
    await metacom.load('chat', 'cache');
    this.metacom = metacom;
    this.api = metacom.api;
    const { chat } = metacom.api;
    chat.on('delta', (deltas) => this.emit('delta', deltas));
    chat.on('state', (state) => this.emit('state', state));
    chat.on('username', (username) => this.emit('username', username));
    const state = await chat.state();
    this.emit('state', state);
  }

  #setupNetworkStatus() {
    window.addEventListener('online', () => {
      this.online = true;
      this.emit('network', { online: true });
      this.logger.log('Network: Online');
    });

    window.addEventListener('offline', () => {
      this.online = false;
      this.emit('network', { online: false });
      this.logger.log('Network: Offline');
    });
  }

  #setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.prompt = event;
      this.emit('install', { prompt: event });
      this.logger.log('Install prompt available');
    });

    window.addEventListener('appinstalled', () => {
      this.emit('installed');
      this.logger.log('App installed successfully');
    });
  }

  async #setupNotifications() {
    const permission = await Notification.requestPermission();
    this.logger.log('Notification permission:', permission);
    return permission === 'granted';
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
    this.emit('installed', { accepted: outcome === 'accepted' });
  }

  async notify(title, text) {
    const caption = title || 'PWA Example';
    const body = text || 'This is a test notification from the PWA!';
    const options = { body, icon: '/icon.svg', badge: '/icon.svg' };
    const notification = new Notification(caption, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    this.logger.log('Test notification sent');
  }
}

export { Application, generateId };
