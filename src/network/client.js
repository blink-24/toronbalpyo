export class ApiError extends Error {
  constructor(message, code = 'NETWORK', details = null) { super(message); this.name = 'ApiError'; this.code = code; this.details = details; }
}
export function createApiClient({ endpoint = '', timeoutMs = 20000, fetchImpl = globalThis.fetch } = {}) {
  let currentEndpoint = String(endpoint).trim();
  async function request(action, payload, method) {
    if (!currentEndpoint) throw new ApiError('아직 제출 연결이 준비되지 않았어요.', 'NOT_CONFIGURED');
    const controller = new AbortController();
    let timeout;
    const work = (async () => {
      const url = new URL(currentEndpoint, globalThis.location?.href || 'https://localhost/');
      const options = { method, mode: 'cors', credentials: 'omit', signal: controller.signal, redirect: 'follow' };
      if (method === 'GET') {
        url.searchParams.set('action', action);
        Object.entries(payload || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });
      } else {
        options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        options.body = JSON.stringify({ ...payload, action });
      }
      let response;
      try { response = await fetchImpl(url.toString(), options); }
      catch (error) { throw new ApiError(error.name === 'AbortError' ? '응답이 늦어지고 있어요.' : '연결을 확인해 주세요.', error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'); }
      if (!response.ok) throw new ApiError('요청을 처리하지 못했어요.', `HTTP_${response.status}`);
      let result;
      try { result = await response.json(); } catch { throw new ApiError('응답을 확인하지 못했어요.', 'INVALID_RESPONSE'); }
      if (result?.ok !== true) {
        throw new ApiError(result?.error?.message || '요청을 확인해 주세요.', result?.error?.code || 'INVALID_RESPONSE', result?.error || null);
      }
      return result;
    })();
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new ApiError('응답이 늦어지고 있어요.', 'TIMEOUT')); }, timeoutMs);
    });
    try { return await Promise.race([work, deadline]); } finally { clearTimeout(timeout); }
  }
  return {
    get: (action, payload = {}) => request(action, payload, 'GET'),
    post: (action, payload = {}) => request(action, payload, 'POST'),
    isConfigured: () => Boolean(currentEndpoint),
    setEndpoint: value => { currentEndpoint = String(value || '').trim(); },
    getEndpoint: () => currentEndpoint,
  };
}

export const mayUseLocalFallback = error => ['NETWORK', 'TIMEOUT', 'NOT_CONFIGURED', 'SERVER_ERROR', 'HTTP_429', 'INVALID_RESPONSE'].includes(error?.code) || /^HTTP_5\d\d$/.test(error?.code || '');
