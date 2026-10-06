export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** JSON request. Mutations carry the CSRF header the Worker requires. */
export async function api(method, path, body, { keepalive = false } = {}) {
  const headers = {};
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['x-requested-with'] = 'comic-guestbook';
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', keepalive });
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b, o) => api('PATCH', p, b, o);
export const del = (p, b = {}) => api('DELETE', p, b);
