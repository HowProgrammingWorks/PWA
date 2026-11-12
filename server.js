'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Server } = require('metacom');

const HOST = '0.0.0.0';
const PORT = 8000;

const MIME_TYPES = {
  default: 'application/octet-stream',
  html: 'text/html; charset=UTF-8',
  js: 'application/javascript; charset=UTF-8',
  json: 'application/json',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const HEADERS_HTML = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
};

const STATIC_PATH = path.join(process.cwd(), 'Application', 'static');

// Browser builds of Metarhia libraries are served from node_modules
const VENDOR = {
  '/metacom.js': require.resolve('metacom/metacom.mjs'),
  '/metautil.js': require.resolve('metautil/metautil.mjs'),
};

const toBool = [() => true, () => false];

const prepareFile = async (url) => {
  const vendorPath = VENDOR[url];
  if (vendorPath) {
    const stream = fs.createReadStream(vendorPath);
    return { found: true, ext: 'js', stream };
  }
  const paths = [STATIC_PATH, url];
  if (url.endsWith('/')) paths.push('index.html');
  const filePath = path.join(...paths);
  const pathTraversal = !filePath.startsWith(STATIC_PATH);
  const exists = await fs.promises.access(filePath).then(...toBool);
  const found = !pathTraversal && exists;
  const streamPath = found ? filePath : path.join(STATIC_PATH, '404.html');
  const ext = path.extname(streamPath).substring(1).toLowerCase();
  const stream = fs.createReadStream(streamPath);
  return { found, ext, stream };
};

const handleRequest = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const file = await prepareFile(url.pathname);
  const statusCode = file.found ? 200 : 404;
  const mimeType = MIME_TYPES[file.ext] || MIME_TYPES.default;

  const headers = { ...HEADERS, 'Content-Type': mimeType };
  if (file.ext === 'html') Object.assign(headers, HEADERS_HTML);

  res.writeHead(statusCode, headers);
  file.stream.pipe(res);
};

class SyncServer {
  constructor(crdt) {
    this.clients = new Set();
    this.state = new Map();
    this.applied = new Set();
    this.deltas = [];
    this.crdt = crdt;
    this.dataPath = path.join(process.cwd(), 'data');
    this.dataFile = path.join(this.dataPath, 'data.json');
    return this.#init();
  }

  async #init() {
    await fs.promises.mkdir(this.dataPath, { recursive: true });
    await this.loadData().catch(() => this.saveData());
    return this;
  }

  async loadData() {
    const data = await fs.promises.readFile(this.dataFile, 'utf8');
    const parsed = JSON.parse(data);
    this.state.clear();
    this.applied.clear();
    this.deltas = parsed.deltas || [];
    this.crdt.applyDeltas(this.state, this.deltas, this.applied);
  }

  // State is rebuilt from deltas on load, so only deltas are stored
  async saveData() {
    const data = JSON.stringify({ deltas: this.deltas });
    await fs.promises.writeFile(this.dataFile, data);
  }

  async applyDeltas(deltas) {
    const { crdt } = this;
    const clean = deltas.map(crdt.snapshotDelta);
    const fresh = crdt.applyDeltas(this.state, clean, this.applied);
    if (fresh.length === 0) return fresh;
    this.deltas.push(...fresh);
    await this.saveData();
    return fresh;
  }

  // One client is one browser: its service worker shares the connection
  subscribe(client) {
    if (this.clients.has(client)) return;
    this.clients.add(client);
    client.on('close', () => {
      this.clients.delete(client);
      console.log(`Client disconnected: ${client.source}`);
    });
    console.log(`Client subscribed: ${client.source}`);
  }

  broadcast(deltas, exclude) {
    for (const client of this.clients) {
      if (client !== exclude) client.emit('chat/delta', deltas);
    }
  }
}

const createApi = (sync) => ({
  chat: {
    subscribe: async (args, context) => {
      sync.subscribe(context.client);
      return true;
    },

    sync: async ({ lastDeltaId = 0 }) => {
      const deltas = sync.deltas.slice(lastDeltaId);
      return { deltas };
    },

    delta: async ({ deltas }, context) => {
      const fresh = await sync.applyDeltas(deltas);
      if (fresh.length > 0) sync.broadcast(fresh, context.client);
      return { applied: fresh.length };
    },
  },
});

const createProcedure = (method) => ({
  access: 'public',
  enter: async () => {},
  leave: () => {},
  invoke: (context, args) => method(args, context),
});

// Minimal application for metacom server: procedures and introspection
const createApplication = (api) => {
  const units = new Map();
  for (const unit in api) {
    const methods = api[unit];
    const procedures = new Map();
    for (const name in methods) {
      procedures.set(name, createProcedure(methods[name]));
    }
    units.set(unit, procedures);
  }

  const introspect = createProcedure(async (names) => {
    const result = {};
    for (const unit of names) {
      const procedures = units.get(unit);
      if (!procedures) continue;
      result[unit] = {};
      for (const name of procedures.keys()) result[unit][name] = {};
    }
    return result;
  });

  const getMethod = (unit, version, name) => {
    if (unit === 'system' && name === 'introspect') return introspect;
    const procedures = units.get(unit);
    return procedures?.get(name) ?? null;
  };

  const auth = { saveSession: async () => {} };
  return { console, auth, getMethod };
};

const startServer = async () => {
  const crdt = await import('./Application/static/crdt.js');
  const sync = await new SyncServer(crdt);
  const application = createApplication(createApi(sync));
  const options = {
    host: HOST,
    port: PORT,
    protocol: 'http',
    timeouts: { bind: 2000 },
    cors: { origin: '*' },
  };
  const server = new Server(application, options);

  // Metacom handles /api over http and websocket upgrade, the rest is static
  server.httpServer.on('request', (req, res) => {
    if (!req.url.startsWith('/api')) handleRequest(req, res);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    await server.close();
    console.log('Server closed');
    process.exit(0);
  });

  await server.listen();
  console.log(`PWA Server running at http://127.0.0.1:${PORT}/`);
};

startServer();
