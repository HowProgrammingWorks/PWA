import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory OPFS: one directory with text files
const files = new Map();
const root = {
  getFileHandle: async (name) => ({
    getFile: async () => ({ text: async () => files.get(name) ?? '' }),
    createWritable: async () => {
      let data = '';
      return {
        write: async (chunk) => {
          data += chunk;
        },
        close: async () => {
          files.set(name, data);
        },
      };
    },
  }),
};
const storage = { getDirectory: async () => root };
Object.defineProperty(navigator, 'storage', { value: storage });

const { SyncManager } = await import('../static/worker.sync.js');

const create = (id, messageId) => ({
  id,
  strategy: 'lww',
  entity: 'message',
  record: { id: messageId, username: 'ada', timestamp: 1, content: 'hi' },
});

const like = (id, messageId) => ({
  id,
  strategy: 'counter',
  entity: 'reaction',
  record: { messageId, reaction: 'like' },
});

const open = async () => {
  const sync = new SyncManager();
  await sync.ready;
  return sync;
};

const likes = (sync, id) => sync.state.get(id).reactions.like;

test('own deltas returned by the server log apply once', async () => {
  files.clear();
  const sync = await open();
  const own = [create('d1', 'm1'), like('d2', 'm1')];
  assert.deepEqual(sync.commit(own), own);
  assert.equal(sync.queue.length, 2);
  assert.deepEqual(sync.append(own, 2), []);
  assert.equal(likes(sync, 'm1'), 1);
  assert.equal(sync.lastDeltaId, 2);
  assert.equal(sync.pending.size, 0);
});

test('overlapping entries are skipped by position', async () => {
  files.clear();
  const sync = await open();
  const entries = [create('d1', 'm1'), like('d2', 'm1'), like('d3', 'm1')];
  sync.append(entries.slice(0, 2), 2);
  const fresh = sync.append(entries.slice(1), 3);
  assert.deepEqual(fresh, [entries[2]]);
  assert.equal(likes(sync, 'm1'), 2);
  assert.equal(sync.lastDeltaId, 3);
});

test('entries after a gap are not applied', async () => {
  files.clear();
  const sync = await open();
  sync.append([create('d1', 'm1')], 1);
  assert.equal(sync.append([like('d5', 'm1')], 5), null);
  assert.equal(likes(sync, 'm1'), 0);
  assert.equal(sync.lastDeltaId, 1);
});

test('own deltas sent offline do not move the cursor', async () => {
  files.clear();
  const sync = await open();
  sync.append([create('d1', 'm1')], 1);
  sync.commit([like('own', 'm1')]);
  assert.equal(sync.lastDeltaId, 1);
  const fresh = sync.append([like('other', 'm1'), like('own', 'm1')], 3);
  assert.deepEqual(
    fresh.map(({ id }) => id),
    ['other'],
  );
  assert.equal(likes(sync, 'm1'), 2);
});

test('state survives a restart', async () => {
  files.clear();
  const sync = await open();
  sync.append([create('d1', 'm1')], 1);
  sync.commit([like('own', 'm1')]);
  await sync.saveState();
  const restarted = await open();
  assert.equal(restarted.lastDeltaId, 1);
  assert.deepEqual(restarted.queue, sync.queue);
  assert.deepEqual([...restarted.pending], ['own']);
  assert.equal(likes(restarted, 'm1'), 1);
});
