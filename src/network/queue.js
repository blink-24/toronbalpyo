import { mayUseLocalFallback } from './client.js';
export const QUEUE_KEY = 'chaeum:v5:submission-queue';
export function createSubmissionQueue({ storage = globalThis.localStorage, api, onChange = () => {}, now = () => Date.now(), online = () => globalThis.navigator?.onLine !== false } = {}) {
  let items;
  try { items = JSON.parse(storage.getItem(QUEUE_KEY) || '[]'); if (!Array.isArray(items)) items = []; } catch { items = []; }
  let running = false;
  let interval;
  const persist = () => { storage.setItem(QUEUE_KEY, JSON.stringify(items)); onChange(items); };
  async function flush({ force = false } = {}) {
    if (running || !online() || !api.isConfigured()) return { sent: 0, pending: items.length };
    running = true; let sent = 0;
    try {
      for (const item of [...items]) {
        if (item.blocked) continue;
        if (!force && item.nextAttemptAt > now()) continue;
        try {
          const ack = await api.post('submit', item.payload);
          if (ack?.ok !== true || ack?.data?.accepted !== true) throw Object.assign(new Error('No acknowledgement'), { code: 'INVALID_RESPONSE' });
          items = items.filter(x => x.payload.submissionId !== item.payload.submissionId); sent++; persist();
        } catch (error) {
          item.attempts = (item.attempts || 0) + 1;
          item.nextAttemptAt = now() + Math.min(300000, 30000 * 2 ** Math.min(item.attempts - 1, 4));
          item.errorCode = error?.code || 'NETWORK'; persist();
          if (!mayUseLocalFallback(error)) { item.blocked = true; persist(); }
        }
      }
    } finally { running = false; }
    return { sent, pending: items.length };
  }
  return {
    enqueue(payload) {
      if (!payload?.submissionId) throw new Error('submissionId is required');
      if (!items.some(x => x.payload.submissionId === payload.submissionId)) { items.push({ payload, attempts: 0, nextAttemptAt: 0 }); persist(); }
      return payload.submissionId;
    },
    flush,
    getItems: () => structuredClone(items),
    start() { if (!interval) interval = setInterval(() => flush(), 30000); return flush(); },
    stop() { clearInterval(interval); interval = null; },
    isRunning: () => running,
  };
}
