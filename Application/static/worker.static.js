const CACHE = 'v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/pwa.js',
  '/domain.js',
  '/worker.js',
  '/worker.sync.js',
  '/worker.static.js',
  '/worker.connection.js',
  '/manifest.json',
  '/icon.svg',
  '/favicon.ico',
  '/404.html',
];

export class CacheManager {
  constructor(name = CACHE, assets = ASSETS) {
    this.name = name;
    this.assets = assets;
  }

  async update() {
    const cache = await caches.open(this.name);
    await cache.addAll(this.assets);
  }

  async serve(request) {
    const cache = await caches.open(this.name);
    const response = await cache.match(request);
    return response;
  }

  async fetchFromNetwork(request) {
    const response = await fetch(request);
    if (response.status === 200) {
      const cache = await caches.open(this.name);
      await cache.put(request, response.clone());
    }
    return response;
  }

  async offlineFallback(request) {
    const cachedResponse = await this.serve(request);
    if (cachedResponse) return cachedResponse;
    if (request.mode === 'navigate') {
      const cache = await caches.open(this.name);
      const fallbackResponse = await cache.match('/index.html');
      if (fallbackResponse) {
        return fallbackResponse;
      }
    }
    return new Response('Offline - Content not available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  async cleanup() {
    const cacheNames = await caches.keys();
    const deletePromises = cacheNames
      .filter((cacheName) => cacheName !== this.name)
      .map(async (cacheName) => {
        await caches.delete(cacheName);
      });
    await Promise.all(deletePromises);
  }

  handleInstall(event) {
    const install = async () => {
      await this.update();
      await self.skipWaiting();
    };
    event.waitUntil(install());
  }

  handleFetch(event) {
    const { request } = event;
    if (request.method !== 'GET') return;
    if (!request.url.startsWith('http')) return;
    const respond = async () => {
      try {
        const response = await this.serve(request);
        if (response) return response;
        return await this.fetchFromNetwork(request);
      } catch {
        return await this.offlineFallback(request);
      }
    };
    event.respondWith(respond());
  }
}

export const cacheManager = new CacheManager();
