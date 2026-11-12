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

// The queued message used to be the same object as local state, so a later
// like rewrote the snapshot. Replaying that log added the like twice.
const snapshotDelta = (delta) => {
  const id = deltaId(delta);
  const { strategy, entity, record } = delta;
  if (entity === 'message') {
    const message = {
      id: record.id,
      username: record.username,
      timestamp: record.timestamp,
      content: record.content,
      reactions: copyReactions(record.reactions),
    };
    return { id, strategy, entity, record: message };
  }
  const reaction = {
    messageId: record.messageId,
    reaction: record.reaction,
  };
  return { id, strategy, entity, record: reaction };
};

const applyMessage = (state, record) => {
  const current = state.get(record.id) ?? null;
  const reactions = current ? current.reactions : emptyReactions();
  const message = {
    id: record.id,
    username: record.username,
    timestamp: record.timestamp,
    content: record.content,
    reactions,
  };
  state.set(record.id, message);
  return true;
};

const applyReaction = (state, record) => {
  const message = state.get(record.messageId);
  if (!message) return false;
  const { reaction } = record;
  if (!Object.hasOwn(message.reactions, reaction)) return false;
  const count = message.reactions[reaction];
  message.reactions[reaction] = count + 1;
  return true;
};

const APPLY = {
  message: { lww: applyMessage },
  reaction: { counter: applyReaction },
};

const applyDelta = (state, delta, applied) => {
  const id = typeof delta.id === 'string' ? delta.id : '';
  if (id !== '' && applied.has(id)) return false;
  const strategies = APPLY[delta.entity];
  const apply = strategies ? strategies[delta.strategy] : undefined;
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

export {
  emptyReactions,
  copyReactions,
  snapshotDelta,
  applyDelta,
  applyDeltas,
};
