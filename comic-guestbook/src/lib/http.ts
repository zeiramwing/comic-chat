export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const json = (data: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
};

export const fail = (status: number, code: string, message?: string) => new HttpError(status, code, message);

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw fail(415, 'unsupported_media_type', 'send application/json');
  const text = await request.text();
  if (text.length > 64 * 1024) throw fail(413, 'too_large', 'request body is too large');
  try {
    const v = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw fail(400, 'bad_json', 'body must be a JSON object');
  }
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `cg_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const clearCookie = (request: Request): string => sessionCookie('', request, 0);

/** Positive integer from a query string, clamped. */
export function intParam(url: URL, name: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw fail(400, 'bad_param', `${name} must be an integer`);
  return Math.max(min, Math.min(max, n));
}
