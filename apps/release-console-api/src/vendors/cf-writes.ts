/**
 * Cloudflare writes for a new server (brief v7): its tunnel and the environment's DNS records.
 * A record that already points somewhere else is never overwritten: the step stops and says so.
 */
import { VendorError, arr, getJson, rec, sendJson, str } from './http.js';

const API = 'https://api.cloudflare.com/client/v4';

async function call(
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	path: string,
	key: string,
	body?: unknown,
): Promise<unknown> {
	const url = `${API}${path}`;
	const a =
		method === 'GET'
			? await getJson(url, key)
			: method === 'DELETE'
				? await (async () => {
						const res = await fetch(url, {
							method: 'DELETE',
							headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
							signal: AbortSignal.timeout(15_000),
						});
						return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
					})()
				: await sendJson(method, url, key, body);
	const answer = rec(a.body);
	if (a.status >= 400 || answer['success'] === false) {
		const first = rec(arr(answer['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${a.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			a.status,
		);
	}
	return answer['result'];
}

export interface ZoneRef {
	id: string;
	name: string;
	accountId: string;
}

export interface TunnelRef {
	id: string;
	name: string;
}

/** The zone that holds a host name (the longest zone name it ends with). */
export function zoneFor(host: string, zones: string[]): string | null {
	const h = host.toLowerCase().replace(/\.$/, '');
	return (
		[...zones]
			.sort((a, b) => b.length - a.length)
			.find((z) => h === z.toLowerCase() || h.endsWith(`.${z.toLowerCase()}`)) ?? null
	);
}

export const cfWrites = {
	async zone(key: string, name: string): Promise<ZoneRef> {
		const z = rec(arr(await call('GET', `/zones?name=${encodeURIComponent(name)}`, key))[0]);
		if (!str(z['id'])) throw new VendorError(`The Cloudflare key does not see the zone ${name}.`, 404);
		return { id: str(z['id']), name: str(z['name']), accountId: str(rec(z['account'])['id']) };
	},
	async tunnelNamed(key: string, accountId: string, name: string): Promise<TunnelRef | null> {
		const list = arr(
			await call(
				'GET',
				`/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
				key,
			),
		).map(rec);
		const t = list.find((x) => str(x['name']) === name);
		return t ? { id: str(t['id']), name } : null;
	},
	/** A remotely managed tunnel (its settings live at Cloudflare), the kind `cloudflared service install` joins. */
	async createTunnel(key: string, accountId: string, name: string): Promise<TunnelRef> {
		const t = rec(await call('POST', `/accounts/${accountId}/cfd_tunnel`, key, { name, config_src: 'cloudflare' }));
		return { id: str(t['id']), name };
	},
	/** The token the server's cloudflared joins with; passed straight to the first-boot file, never kept. */
	async tunnelToken(key: string, accountId: string, id: string): Promise<string> {
		const token = await call('GET', `/accounts/${accountId}/cfd_tunnel/${id}/token`, key);
		if (typeof token !== 'string' || !token) throw new VendorError('Cloudflare gave no token for the tunnel.', 502);
		return token;
	},
	async tunnelConnections(key: string, accountId: string, id: string): Promise<number> {
		const t = rec(await call('GET', `/accounts/${accountId}/cfd_tunnel/${id}`, key));
		return arr(t['connections']).length;
	},
	async deleteTunnel(key: string, accountId: string, id: string): Promise<void> {
		await call('DELETE', `/accounts/${accountId}/cfd_tunnel/${id}/connections`, key).catch(() => undefined);
		await call('DELETE', `/accounts/${accountId}/cfd_tunnel/${id}`, key);
	},
	/**
	 * Points `host` at `ip` through Cloudflare's proxy. Creates the record when missing, leaves it
	 * when it already points there, and refuses when it points anywhere else.
	 */
	async pointHost(key: string, zoneId: string, host: string, ip: string): Promise<'created' | 'kept'> {
		const existing = arr(
			await call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=50`, key),
		).map(rec);
		const same = existing.find((r) => str(r['type']) === 'A' && str(r['content']) === ip);
		if (same) return 'kept';
		const other = existing.find((r) => ['A', 'AAAA', 'CNAME'].includes(str(r['type'])));
		if (other)
			throw new VendorError(
				`${host} already points to ${str(other['content'])} (${str(other['type'])}); the console does not overwrite it.`,
				409,
			);
		await call('POST', `/zones/${zoneId}/dns_records`, key, {
			type: 'A',
			name: host,
			content: ip,
			proxied: true,
			ttl: 1,
			comment: 'Release Console: server created from the console',
		});
		return 'created';
	},
	/** Removes `host`'s A records that point at `ip` only. */
	async unpointHost(key: string, zoneId: string, host: string, ip: string): Promise<number> {
		const ours = arr(
			await call('GET', `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(host)}&per_page=50`, key),
		)
			.map(rec)
			.filter((r) => str(r['content']) === ip);
		for (const r of ours) await call('DELETE', `/zones/${zoneId}/dns_records/${str(r['id'])}`, key);
		return ours.length;
	},
};
