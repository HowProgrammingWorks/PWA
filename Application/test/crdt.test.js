import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDeltas, emptyReactions, snapshotDelta } from '../static/crdt.js';

const message = (id, content) => ({
  id,
  username: 'ada',
  timestamp: 1,
  content,
  reactions: emptyReactions(),
});

const like = (id, messageId) => ({
  id,
  strategy: 'counter',
  entity: 'reaction',
  record: { messageId, reaction: 'like' },
});

const replay = (deltas) => {
  const state = new Map();
  applyDeltas(state, deltas, new Set());
  return state;
};

test('likes on a new message apply once', () => {
  const created = {
    id: 'create',
    strategy: 'lww',
    entity: 'message',
    record: message('m1', 'hello'),
  };
  const deltas = [created, like('like-1', 'm1'), like('like-2', 'm1')];
  const state = replay(deltas);
  assert.equal(state.get('m1').reactions.like, 2);
});

test('a mutated message snapshot is not added on top of its likes', () => {
  const record = message('m1', 'hello');
  record.reactions.like = 2;
  const deltas = [
    { id: 'create', strategy: 'lww', entity: 'message', record },
    like('like-1', 'm1'),
    like('like-2', 'm1'),
  ];
  const state = replay(deltas);
  assert.equal(state.get('m1').reactions.like, 2);
});

test('the same like is not applied twice', () => {
  const deltas = [
    {
      id: 'create',
      strategy: 'lww',
      entity: 'message',
      record: message('m1', 'hello'),
    },
    like('like-1', 'm1'),
  ];
  const state = new Map();
  const applied = new Set();
  applyDeltas(state, deltas, applied);
  applyDeltas(state, deltas, applied);
  assert.equal(state.get('m1').reactions.like, 1);
});

test('queued message keeps reactions from snapshot time', () => {
  const record = message('m1', 'hello');
  const delta = {
    id: 'create',
    strategy: 'lww',
    entity: 'message',
    record,
  };
  const queued = snapshotDelta(delta);
  record.reactions.like = 4;
  assert.equal(queued.record.reactions.like, 0);
  const state = replay([queued, like('like-1', 'm1')]);
  assert.equal(state.get('m1').reactions.like, 1);
});
