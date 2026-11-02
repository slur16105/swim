// Owns transient playback only; committed records always belong to the command Store.
export function createSessionController({ store, play, onChange = () => {}, onProgress = () => {}, onComplete = () => {}, completionBaseline = () => undefined }) {
  let epoch = 0, sequence = 0, active = null;
  const matches = context => active && context === active.context && context.epoch === epoch;
  return {
    get epoch() { return epoch; },
    get busy() { return active !== null; },
    get completing() { return active?.completing ?? false; },
    get current() { return active; },
    start(record, replay = record.status === 'complete') {
      if (active) return false;
      const context = Object.freeze({ epoch, id: record.id, sequence: ++sequence });
      active = { context, record: structuredClone(record), replay, completing: false };
      try { play(record, context); } catch (error) { active = null; onChange(); throw error; }
      onChange(); return true;
    },
    progress(distance, total, context) {
      if (matches(context) && !active.completing) onProgress(distance, total, active);
    },
    async complete(id, context) {
      if (!matches(context) || id !== context.id || active.completing) return;
      const session = active;
      session.levelBefore = completionBaseline();
      session.completing = true; onChange();
      const result = session.replay ? { ok: true } : await store.completeRecord(id, { epoch: context.epoch });
      if (!matches(context)) return;
      active = null; if (result.code !== 'CANCELLED') onComplete(result, session); onChange();
      return result;
    },
    invalidate() {
      store.invalidateEpoch(++epoch); active = null; onChange();
      return epoch;
    },
  };
}
