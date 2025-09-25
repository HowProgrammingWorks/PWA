# Progressive Web Application with CRDT Sync

> A PWA with offline-first support and CRDT-based sync over a shared WebSocket connection.

## Installation

Prerequisite: Node.js 18+

1. Clone this repository
2. Install dependencies: `npm i`
3. Start the development server: `node server.js`
4. Open `http://localhost:8000` in your browser

## Features

- Installable like a native app
- Offline support (works without an internet connection)
- Background sync and caching
- App-like UX
- Broad device support
- Real-time notifications
- Single WebSocket connection shared across tabs
- Automatic reconnection
- HTTPS headers and CORS support

## TODO

- Changes to `./Application/static/domain.js`
  - Move Logger to `logger.js` and export it as a singleton
  - Decompose `ChatApplication`: extract `ui.js` and `domain.js`
  - Domain logic should live in `domain.js`
  - Visualization and UI logic should live in `ui.js`
- Unify CRDT implementations and reuse across the app, service worker, and server
  - Extract `lww` and `counter` into `crdt.js`; apply the Strategy pattern
  - Import `crdt.js` from the service worker and server to reuse code
- Changes to `pwa.js`
  - Extract utility helpers (e.g., ID generation) into `utils.js`
  - Move `EventEmitter` into `events.js`

Copyright (c) 2025 How.Programming.Works contributors
