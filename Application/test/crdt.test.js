import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDeltas, cleanDelta } from '../static/crdt.js';

const message = (id, content) => ({
  id,
  username: 'ada',
  timestamp: 1,
  content,
});

const create = (id, record) => ({
  id,
  strategy: 'lww',
  entity: 'message',
  record,
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
  const created = create('create', message('m1', 'hello'));
  const deltas = [created, like('like-1', 'm1'), like('like-2', 'm1')];
  const state = replay(deltas);
  assert.equal(state.get('m1').reactions.like, 2);
});

test('counters carried by a message delta are ignored', () => {
  const record = { ...message('m1', 'hello'), reactions: { like: 2 } };
  const deltas = [
    create('create', record),
    like('like-1', 'm1'),
    like('like-2', 'm1'),
  ];
  const state = replay(deltas);
  assert.equal(state.get('m1').reactions.like, 2);
});

test('the same like is not applied twice', () => {
  const created = create('create', message('m1', 'hello'));
  const deltas = [created, like('like-1', 'm1')];
  const state = new Map();
  const applied = new Set();
  applyDeltas(state, deltas, applied);
  applyDeltas(state, deltas, applied);
  assert.equal(state.get('m1').reactions.like, 1);
});

test('message update keeps counters', () => {
  const deltas = [
    create('create', message('m1', 'hello')),
    like('like-1', 'm1'),
    create('edit', message('m1', 'edited')),
  ];
  const state = replay(deltas);
  assert.equal(state.get('m1').content, 'edited');
  assert.equal(state.get('m1').reactions.like, 1);
});

test('state does not alias the record', () => {
  const record = message('m1', 'hello');
  const state = replay([create('create', record)]);
  record.content = 'changed';
  assert.equal(state.get('m1').content, 'hello');
});

test('a reaction missing from stored counters starts from zero', () => {
  const stored = { ...message('m1', 'hello'), reactions: {} };
  const state = new Map([['m1', stored]]);
  applyDeltas(state, [like('like-1', 'm1')], new Set());
  assert.equal(state.get('m1').reactions.like, 1);
});

test('clean delta keeps known fields only', () => {
  const record = { ...message('m1', 'hi'), reactions: { like: 4 }, x: 1 };
  const clean = cleanDelta({ ...create('create', record), x: 1 });
  assert.deepEqual(clean, create('create', message('m1', 'hi')));
});

test('clean delta rejects a malformed delta', () => {
  assert.equal(cleanDelta({ type: 'delta', data: [] }), null);
  assert.equal(cleanDelta(null), null);
});
