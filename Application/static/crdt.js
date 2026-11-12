const REACTIONS = ['like', 'dislike', 'love', 'smile', 'poo'];

const emptyReactions = () => {
  const reactions = {};
  for (const name of REACTIONS) reactions[name] = 0;
  return reactions;
};

const deltaId = (delta) => {
  const { id } = delta;
  if (typeof id === 'string') return id;
  return '';
};

const pickMessage = (record) => ({
  id: record.id,
  username: record.username,
  timestamp: record.timestamp,
  content: record.content,
});

// Keeps known fields of a delta from the network, null for a malformed one
const cleanDelta = (delta) => {
  const record = delta?.record;
  if (typeof record !== 'object' || record === null) return null;
  const id = deltaId(delta);
  const { strategy, entity } = delta;
  if (entity === 'message') {
    return { id, strategy, entity, record: pickMessage(record) };
  }
  const reaction = { messageId: record.messageId, reaction: record.reaction };
  return { id, strategy, entity, record: reaction };
};

// Counters live in state only: when message delta carried a copy of them,
// replaying the log counted likes twice
const applyMessage = (state, record) => {
  const current = state.get(record.id);
  const reactions = current ? current.reactions : emptyReactions();
  state.set(record.id, { ...pickMessage(record), reactions });
  return true;
};

const applyReaction = (state, record) => {
  const message = state.get(record.messageId);
  const { reaction } = record;
  if (!message || !REACTIONS.includes(reaction)) return false;
  const count = message.reactions[reaction] || 0;
  message.reactions[reaction] = count + 1;
  return true;
};

const APPLY = {
  message: { lww: applyMessage },
  reaction: { counter: applyReaction },
};

// Counters are not idempotent: replica that can see a delta twice dedupes
const mergeDelta = (state, delta) => {
  const apply = APPLY[delta.entity]?.[delta.strategy];
  if (!apply) return false;
  return apply(state, delta.record);
};

const applyDelta = (state, delta, applied) => {
  const id = deltaId(delta);
  if (id !== '' && applied.has(id)) return false;
  const changed = mergeDelta(state, delta);
  if (changed && id !== '') applied.add(id);
  return changed;
};

const applyDeltas = (state, deltas, applied) => {
  const fresh = [];
  for (const delta of deltas) {
    if (applyDelta(state, delta, applied)) fresh.push(delta);
  }
  return fresh;
};

export { REACTIONS, cleanDelta, mergeDelta, applyDeltas };
