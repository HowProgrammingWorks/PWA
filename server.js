'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('node:crypto');

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

const connections = new Map();
const messages = [];
const MAX_MESSAGES = 100;

const toBool = [() => true, () => false];

const prepareFile = async (url) => {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const file = await prepareFile(url.pathname);
  const statusCode = file.found ? 200 : 404;
  const mimeType = MIME_TYPES[file.ext] || MIME_TYPES.default;

  const headers = { ...HEADERS, 'Content-Type': mimeType };
  if (file.ext === 'html') Object.assign(headers, HEADERS_HTML);

  res.writeHead(statusCode, headers);
  file.stream.pipe(res);

  console.log(`${req.method} ${req.url} ${statusCode}`);
});

const wss = new WebSocketServer({ server });

const broadcast = (data, excludeClientId = '') => {
  const message = JSON.stringify(data);
  for (const [clientId, connection] of connections) {
    if (clientId !== excludeClientId && connection.ws.readyState === 1) {
      try {
        connection.ws.send(message);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
        connections.delete(clientId);
      }
    }
  }
};

wss.on('connection', (ws, req) => {
  const clientId = randomUUID();
  console.log(`WebSocket connection ${req.socket.remoteAddress}`);

  const connectedAt = new Date();
  const userAgent = req.headers['user-agent'];
  connections.set(clientId, { ws, connectedAt, userAgent });

  const userCount = connections.size;
  const recentMessages = messages.slice(-10);
  const data = { type: 'connected', clientId, userCount, recentMessages };
  ws.send(JSON.stringify(data));

  broadcast({ type: 'userCount', count: userCount }, clientId);
  console.log(`Client connected: ${clientId} (Total: ${connections.size})`);

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log(`Received from ${clientId}:`, message);
    const { type, content } = message;
    if (type === 'message') {
      const timestamp = new Date().toISOString();
      messages.push({ type, content, clientId, timestamp });
      if (messages.length > MAX_MESSAGES) messages.shift();
      broadcast(message, clientId);
    } else if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket connection closed: ${clientId}`);
    connections.delete(clientId);
    const count = connections.size;
    broadcast({ type: 'userCount', count }, clientId);
    console.log(`Client disconnected: ${clientId} (Total: ${count})`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
    connections.delete(clientId);
    const count = connections.size;
    broadcast({ type: 'userCount', count }, clientId);
  });
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  for (const connection of connections.values()) {
    connection.ws.close();
  }
  connections.clear();
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

server.listen(PORT, () => {
  console.log(`PWA Server running at http://127.0.0.1:${PORT}/`);
});
