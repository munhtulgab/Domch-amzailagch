const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Сүлжээний холболтоо шалгаад дахин оролдоно уу.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data && (data.message || data.detail)) || `Алдаа гарлаа (${res.status}).`;
    throw new ApiError(typeof message === 'string' ? message : 'Алдаа гарлаа.', res.status, data && data.fields);
  }
  return data;
}

export function query(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function track(name, meta = {}) {
  try {
    const payload = JSON.stringify({ name, meta });
    const blob = new Blob([payload], { type: 'application/json' });
    const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(`${BASE}/events`, blob);
    if (!sent) {
      fetch(`${BASE}/events`, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    }
  } catch {
    /* analytics must never break the page */
  }
}
