const generateId = () => Math.random().toString(36).substr(2, 9);

const getClientId = () => {
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = generateId();
    localStorage.setItem('clientId', clientId);
  }
  return clientId;
};

class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(eventName, listener) {
    let listeners = this.events[eventName];
    if (!listeners) {
      listeners = [];
      this.events[eventName] = listeners;
    }
    listeners.push(listener);
    return this;
  }

  off(eventName, listener) {
    const listeners = this.events[eventName];
    if (!listeners) return this;
    if (listener) {
      this.events[eventName] = listeners.filter((l) => l !== listener);
    } else {
      delete this.events[eventName];
    }
    return this;
  }

  emit(eventName, ...args) {
    const listeners = this.events[eventName] || [];
    if (!listeners) return false;
    for (const listener of listeners) {
      try {
        listener.apply(this, args);
      } catch (error) {
        console.error(`Error in event listener for ${eventName}:`, error);
      }
    }
    return true;
  }
}

const CONFIG_DEFAULTS = {
  pingInterval: 25000,
  notificationTimeout: 3000,
  serviceWorker: './worker.js',
};

class Application extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...CONFIG_DEFAULTS, ...config };
    this.state = new Map();
    this.worker = null;
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
    this.#setupServiceWorker();
    this.#setupNetworkStatus();
    this.#setupInstallPrompt();
    this.#setupNotifications();
    this.setupEvents();
    this.updateInterface();
  }

  #setupServiceWorker() {
    const worker = navigator.serviceWorker;
    worker.register(this.serviceWorker);
    const ping = () => this.post({ type: 'ping' });
    worker.ready.then((registration) => {
      setInterval(ping, this.config.pingInterval);
      this.worker = registration.active;
      const data = { clientId: this.clientId };
      this.post({ type: 'connect', data });
    });
    worker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      this.emit(type, data);
    });
    this.on('status', (data) => {
      this.connected = data.connected;
    });
    document.addEventListener('visibilitychange', () => {
      this.post({ type: 'ping' });
    });
  }

  #setupNetworkStatus() {
    window.addEventListener('online', () => {
      this.online = true;
      this.post({ type: 'online' });
      this.emit('network', { online: true });
      this.logger.log('Network: Online');
    });

    window.addEventListener('offline', () => {
      this.online = false;
      this.post({ type: 'offline' });
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

  post(data) {
    this.worker.postMessage(data);
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
