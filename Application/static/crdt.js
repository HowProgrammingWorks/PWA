const REACTIONS = ['like', 'dislike', 'love', 'smile', 'poo'];

const emptyReactions = () => {
  const reactions = {};
  for (const name of REACTIONS) reactions[name] = 0;
  return reactions;
};

const copyReactions = (source) => {
  const reactions = emptyReactions();
  if (!source) return reactions;
  for (const name of REACTIONS) {
    const count = source[name];
    if (typeof count === 'number') reactions[name] = count;
  }
  return reactions;
};

const deltaId = (delta) => {
  const { id } = delta;
  if (typeof id === 'string') return id;
  return '';
};

const createMessage = (record, reactions) => ({
  id: record.id,
  username: record.username,
  timestamp: record.timestamp,
  content: record.content,
  reactions,
});

// Keeps only known fields of a delta received from the network
const snapshotDelta = (delta) => {
  const id = deltaId(delta);
  const { strategy, entity, record } = delta;
  if (entity === 'message') {
    const reactions = copyReactions(record.reactions);
    const message = createMessage(record, reactions);
    return { id, strategy, entity, record: message };
  }
  const reaction = {
    messageId: record.messageId,
    reaction: record.reaction,
  };
  return { id, strategy, entity, record: reaction };
};

// State never holds the record itself: when queued message was the same
// object as local state, a later like rewrote it and replay added it twice
const applyMessage = (state, record) => {
  const current = state.get(record.id);
  const reactions = current ? current.reactions : emptyReactions();
  state.set(record.id, createMessage(record, reactions));
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

const applyDelta = (state, delta, applied) => {
  const id = deltaId(delta);
  if (id !== '' && applied.has(id)) return false;
  const apply = APPLY[delta.entity]?.[delta.strategy];
  if (!apply) return false;
  const changed = apply(state, delta.record);
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

export { emptyReactions, snapshotDelta, applyDelta, applyDeltas };
