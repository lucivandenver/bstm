export function browser(base) {
  return {
    cookie: '', csrf: '',
    async get(path) { return this.request(path); },
    async post(path, body = {}, csrf = this.csrf) {
      const form = new URLSearchParams({ _csrf: csrf });
      for (const [key, value] of Object.entries(body)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
      return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    },
    async request(path, options = {}) {
      const r = await fetch(base + path, { ...options, headers: { ...options.headers, cookie: this.cookie }, redirect: 'manual' });
      const cookie = r.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
      const html = await r.text(); const token = html.match(/name="_csrf" value="([^"]+)"/); if (token) this.csrf = token[1];
      return { status: r.status, location: r.headers.get('location'), html, response: r };
    },
    async login(address, password) { await this.get('/login'); const r = await this.post('/login', { email: address, password }); await this.get('/dashboard'); return r; }
  };
}
