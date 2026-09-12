/* Thin fetch wrapper.  Errors carry their status so callers can tell a clash
   (409, the owner must choose) from a dropped connection (queue and retry). */

import { token } from './session.js';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

async function request(path, options = {}) {
  const bearer = await token();
  let response;
  try {
    response = await fetch(path, {
      ...options,
      // Merged last, and on top of options.headers: spreading options after
      // this would replace the whole headers object, silently dropping the
      // content type for any call that passes a header of its own.
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (cause) {
    throw new ApiError('offline', 0, { cause: String(cause) });
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (!response.ok) throw new ApiError(body.error || response.statusText, response.status, body);
  return body;
}

const qs = (params) => new URLSearchParams(
  Object.entries(params).filter(([, value]) => value != null && value !== '')
).toString();

export const api = {
  authConfig: () => request('/api/auth-config'),
  bootstrap: (locale) => request(`/api/bootstrap?${qs({ locale })}`),
  calendar: (start, end) => request(`/api/calendar?${qs({ start, end })}`),
  agenda: (start, end) => request(`/api/agenda?${qs({ start, end })}`),
  day: (date) => request(`/api/day?${qs({ date })}`),
  insights: (start, end) => request(`/api/insights?${qs({ start, end })}`),
  channels: () => request('/api/channels'),
  conflicts: () => request('/api/conflicts'),
  syncAll: () => request('/api/sync', { method: 'POST' }),
  syncChannel: (id) => request(`/api/channels/${id}/sync`, { method: 'POST' }),
  resolveConflict: (id, resolution) =>
    request(`/api/conflicts/${id}/resolve`, {
      method: 'POST', body: JSON.stringify({ resolution }) }),
  cancelBooking: (id, reason) =>
    request(`/api/bookings/${id}/cancel`, {
      method: 'POST', body: JSON.stringify({ reason }) }),
  moveBooking: (id, target) =>
    request(`/api/bookings/${id}/move`, { method: 'POST', body: JSON.stringify(target) }),
  createBooking: (payload, idempotencyKey) =>
    request('/api/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    }),
};
