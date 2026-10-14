let csrfToken = null;

export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export const setCsrfToken = (token) => {
  csrfToken = token;
};

export async function ensureCsrfToken(force = false) {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch('/api/auth/csrf', { credentials: 'include' });
  const data = await parse(res);
  csrfToken = data?.csrfToken ?? null;
  return csrfToken;
}

export async function api(path, { method = 'GET', body } = {}, retry = true) {
  const headers = { Accept: 'application/json' };
  const init = { method, credentials: 'include', headers };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await ensureCsrfToken();
  if (body instanceof FormData) {
    init.body = body; // the browser sets the multipart Content-Type itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?', 'NETWORK');
  }
  const data = await parse(res);

  if (!res.ok) {
    const code = data?.error?.code;
    if (res.status === 403 && code === 'CSRF_INVALID' && retry) {
      await ensureCsrfToken(true);
      return api(path, { method, body }, false);
    }
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiError(res.status, data?.error?.message || `Request failed (${res.status})`, code, data?.error?.details);
  }
  return data;
}
