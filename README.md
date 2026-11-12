# Progressive Web Application with CRDT Sync

> A PWA with offline-first support and CRDT-based sync over a shared WebSocket connection.

Communication is built on [Metacom](https://github.com/metarhia/metacom):
tabs call the service worker with `Metacom` client, the service worker holds
one connection to the server with `MetacomProxy`.

## Installation

Prerequisite: Node.js 18+

1. Clone this repository
2. Install dependencies: `npm i`
3. Start the development server: `node server.js`
4. Open `http://localhost:8000` in your browser

## Features

- Installable app: a native App-like UX
- Real-time notifications using Websockets
- Offline support (works without an internet or server)
- Background sync and caching with service worker and CRDT
- Broad device/browser support, Linux, MacOS, Win, iOS, Android
- Single WebSocket connection shared across tabs
- Automatic reconnection, retrieving lost messages
- RPC and events between tabs, service worker and server with Metacom

## Structure

| File               | Role                                                  |
| ------------------ | ----------------------------------------------------- |
| `server.js`        | Static files and metacom server: `chat` unit          |
| `worker.js`        | `MetacomProxy`, local `chat` and `cache` units        |
| `worker.sync.js`   | Local state and offline queue in OPFS                 |
| `worker.static.js` | Static cache                                          |
| `pwa.js`           | Application base: service worker and `Metacom` client |
| `domain.js`        | Chat UI and domain logic                              |

| Call             | Handled by | Description                                 |
| ---------------- | ---------- | ------------------------------------------- |
| `chat/state`     | worker     | Messages from local state                   |
| `chat/delta`     | worker     | Apply, pass to all tabs, queue and send     |
| `chat/username`  | worker     | Pass username to other tabs                 |
| `chat/clear`     | worker     | Clear local state                           |
| `cache/update`   | worker     | Reload static cache                         |
| `chat/subscribe` | server     | Receive `chat/log` events                   |
| `chat/sync`      | server     | Log entries after `lastDeltaId`, log length |
| `chat/delta`     | server     | Called by worker: apply, append to log      |

Events from worker to tabs: `chat/delta`, `chat/state`, `chat/username`.
Event from server to workers: `chat/log` with `{ deltas, lastDeltaId }`,
the sender gets its own batch back. `lastDeltaId` is a position in the
server log, so the worker applies log entries in order and skips repeats.

- HTTPS headers and CORS support
- Reactions: like, dislike, etc. with counters

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
