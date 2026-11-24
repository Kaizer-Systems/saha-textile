/**
 * A signed-in admin for the accounts run: a cookie jar, the double-submit CSRF token, and calls that must succeed
 * (`ok`) or may be refused (`try`), with the refusal's code read the way the admin reads it.
 */
import { API_URL } from './stack.mjs';

export class Admin {
	constructor(label = 'admin') {
		this.label = label;
		this.cookies = new Map();
		this.token = '';
	}

	remember(response) {
		for (const line of response.headers.getSetCookie?.() ?? []) {
			const [pair] = line.split(';');
			const at = pair.indexOf('=');
			this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
		}
	}

	header() {
		return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	async csrf() {
		const response = await fetch(`${API_URL}/auth/admin/csrf`, { headers: { cookie: this.header() } });
		this.remember(response);
		this.token = (await response.json()).csrfToken;
		return this.token;
	}

	async signIn(identifier, password) {
		await this.csrf();
		const answer = await this.try('POST', '/auth/admin/login', { identifier, password });
		if (answer.status >= 300)
			throw new Error(`${this.label}: sign-in refused ${answer.status} ${JSON.stringify(answer.body)}`);
		await this.csrf();
		return answer.body;
	}

	/** A call that may be refused: its status, body and refusal code. */
	async try(method, path, body, query) {
		const url = new URL(`${API_URL}${path}`);
		for (const [k, v] of Object.entries(query ?? {}))
			if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
		const headers = { cookie: this.header() };
		if (method !== 'GET') {
			headers['x-csrf-token'] = this.token || (await this.csrf());
			headers['content-type'] = 'application/json';
		}
		const response = await fetch(url, {
			method,
			headers,
			body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
		});
		this.remember(response);
		const text = await response.text();
		let parsed = text;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			// not JSON
		}
		const issue = parsed?.error?.issues?.[0] ?? parsed?.issues?.[0];
		const code = issue?.code ?? issue?.message ?? parsed?.error?.message ?? parsed?.message ?? null;
		return { status: response.status, body: parsed, code };
	}

	/** A call that must succeed: its body. */
	async ok(method, path, body, query) {
		const answer = await this.try(method, path, body, query);
		if (answer.status >= 300)
			throw new Error(
				`${this.label} ${method} ${path} → ${answer.status} ${JSON.stringify(answer.body).slice(0, 800)}`,
			);
		return answer.body;
	}

	/** A call that must be refused with this code. */
	async refused(method, path, body, code, query) {
		const answer = await this.try(method, path, body, query);
		if (answer.status < 400) throw new Error(`${this.label} ${method} ${path} was accepted; expected ${code}`);
		if (code && !String(answer.code ?? '').includes(code) && !JSON.stringify(answer.body).includes(code))
			throw new Error(
				`${this.label} ${method} ${path} → ${answer.status} ${JSON.stringify(answer.body).slice(0, 400)}; expected ${code}`,
			);
		return answer;
	}
}
