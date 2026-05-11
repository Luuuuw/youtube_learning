export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return fetch(url, { ...options, headers }).then(res => {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ve-unauthorized'));
    }
    return res;
  });
}
