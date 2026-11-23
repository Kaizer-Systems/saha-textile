/**
 * DigitalOcean writes for creating and destroying a server (brief v7). Each call is made with the
 * write key only after the owner's PIN, and the caller records it in the audit log. Messages never
 * carry the key or a request's secret parts.
 */
import { VendorError, arr, getJson, num, rec, sendJson, str } from './http.js';

const API = 'https://api.digitalocean.com/v2';

async function call(method: 'POST' | 'DELETE' | 'GET', path: string, key: string, body?: unknown): Promise<unknown> {
	const a =
		method === 'GET'
			? await getJson(`${API}${path}`, key)
			: method === 'DELETE'
				? await remove(`${API}${path}`, key)
				: await sendJson('POST', `${API}${path}`, key, body);
	if (a.status === 401) throw new VendorError('DigitalOcean refused the key (401).', 401);
	if (a.status === 403)
		throw new VendorError('The DigitalOcean key may not do this (403): it needs write scope.', 403);
	if (a.status >= 400) {
		const message = str(rec(a.body)['message']);
		throw new VendorError(`DigitalOcean answered ${a.status}${message ? `: ${message}` : ''}.`, a.status);
	}
	return a.body;
}

async function remove(url: string, key: string) {
	const res = await fetch(url, {
		method: 'DELETE',
		headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
		signal: AbortSignal.timeout(15_000),
	});
	const body: unknown = await res.json().catch(() => null);
	return { status: res.status, headers: res.headers, body };
}

export interface DropletState {
	id: number;
	name: string;
	status: string;
	ipv4: string | null;
	ipv6: string | null;
	privateIp: string | null;
}

export function toDropletState(v: unknown): DropletState {
	const r = rec(v);
	const nets = rec(r['networks']);
	const v4 = arr(nets['v4']).map(rec);
	const v6 = arr(nets['v6']).map(rec);
	const ip = (list: Record<string, unknown>[], type: string) =>
		str(list.find((n) => n['type'] === type)?.['ip_address']) || null;
	return {
		id: num(r['id']),
		name: str(r['name']),
		status: str(r['status']),
		ipv4: ip(v4, 'public'),
		ipv6: ip(v6, 'public'),
		privateIp: ip(v4, 'private'),
	};
}

/** Inbound 443 from Cloudflare's ranges only, everything outbound (plan §5; servers.mjs firewallRules). */
export function firewallBody(name: string, dropletId: number, ranges: string[], tags: string[], openToAll = false) {
	const cidrs = ranges.map((r) => r.trim()).filter((r) => /^[0-9a-f.:]+\/\d{1,3}$/i.test(r));
	if (cidrs.length < 5) throw new VendorError("Cloudflare's address ranges could not be read.", 502);
	const everywhere = { addresses: ['0.0.0.0/0', '::/0'] };
	return {
		name,
		// Hosts on DigitalOcean DNS are not behind Cloudflare, so 443 opens to everyone (Release Path brief C15).
		inbound_rules: [{ protocol: 'tcp', ports: '443', sources: openToAll ? everywhere : { addresses: cidrs } }],
		outbound_rules: [
			{ protocol: 'tcp', ports: 'all', destinations: everywhere },
			{ protocol: 'udp', ports: 'all', destinations: everywhere },
			{ protocol: 'icmp', destinations: everywhere },
		],
		droplet_ids: [dropletId],
		tags,
	};
}

export const doWrites = {
	/** The public half of one of the account's SSH keys (the admin's own sign-in). */
	async publicKey(key: string, id: number): Promise<string> {
		return str(rec(rec(await call('GET', `/account/keys/${id}`, key))['ssh_key'])['public_key']);
	},
	async createVolume(key: string, body: Record<string, unknown>): Promise<string> {
		return str(rec(rec(await call('POST', '/volumes', key, body))['volume'])['id']);
	},
	async createDroplet(key: string, body: Record<string, unknown>): Promise<number> {
		const answer = rec(await call('POST', '/droplets', key, body));
		const id = num(rec(answer['droplet'])['id']);
		if (!id) throw new VendorError('DigitalOcean accepted the request but named no droplet.', 502);
		return id;
	},
	async droplet(key: string, id: number): Promise<DropletState> {
		return toDropletState(rec(await call('GET', `/droplets/${id}`, key))['droplet']);
	},
	async dropletsTagged(key: string, tag: string): Promise<DropletState[]> {
		return arr(
			rec(await call('GET', `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=200`, key))['droplets'],
		).map(toDropletState);
	},
	async assign(key: string, projectId: string, urns: string[]): Promise<void> {
		await call('POST', `/projects/${projectId}/resources`, key, { resources: urns });
	},
	async createFirewall(key: string, body: Record<string, unknown>): Promise<string> {
		return str(rec(rec(await call('POST', '/firewalls', key, body))['firewall'])['id']);
	},
	async firewallsNamed(key: string, name: string): Promise<string[]> {
		return arr(rec(await call('GET', '/firewalls?per_page=200', key))['firewalls'])
			.map(rec)
			.filter((f) => str(f['name']) === name)
			.map((f) => str(f['id']));
	},
	async deleteFirewall(key: string, id: string): Promise<void> {
		await call('DELETE', `/firewalls/${id}`, key);
	},
	/** A firewall's inbound sources for port 443, by its name, or `null` when there is none. */
	async firewall443(key: string, name: string): Promise<string[] | null> {
		const fw = arr(rec(await call('GET', '/firewalls?per_page=200', key))['firewalls'])
			.map(rec)
			.find((f) => str(f['name']) === name);
		if (!fw) return null;
		return arr(fw['inbound_rules'])
			.map(rec)
			.filter((r) => str(r['ports']) === '443')
			.flatMap((r) => arr(rec(r['sources'])['addresses']).map((a) => str(a)));
	},
	/** The account's domains on DigitalOcean DNS. */
	async domains(key: string): Promise<string[]> {
		return arr(rec(await call('GET', '/domains?per_page=200', key))['domains']).map((d) => str(rec(d)['name']));
	},
	/**
	 * An A record for a host on DigitalOcean DNS (Release Path brief C15), with Cloudflare's rule: a
	 * record already pointing elsewhere stops the job instead of being overwritten.
	 */
	async pointDoHost(key: string, domain: string, host: string, ip: string): Promise<'created' | 'kept'> {
		const records = arr(
			rec(await call('GET', `/domains/${domain}/records?name=${encodeURIComponent(host)}&per_page=50`, key))[
				'domain_records'
			],
		).map(rec);
		if (records.some((r) => str(r['type']) === 'A' && str(r['data']) === ip)) return 'kept';
		const other = records.find((r) => ['A', 'AAAA', 'CNAME'].includes(str(r['type'])));
		if (other)
			throw new VendorError(
				`${host} already points to ${str(other['data'])} (${str(other['type'])}) on DigitalOcean DNS; the console does not overwrite it.`,
				409,
			);
		const name = host === domain ? '@' : host.slice(0, -(domain.length + 1));
		await call('POST', `/domains/${domain}/records`, key, { type: 'A', name, data: ip, ttl: 1800 });
		return 'created';
	},
	async deleteDroplet(key: string, id: number): Promise<void> {
		await call('DELETE', `/droplets/${id}`, key);
	},
};

/** Cloudflare's published address ranges, for the Cloud Firewall. */
export async function cloudflareRanges(): Promise<string[]> {
	const lists = await Promise.all(
		['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6'].map(async (u) => {
			const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
			if (!res.ok) throw new VendorError(`Cloudflare's address list answered ${res.status}.`, res.status);
			return (await res.text()).split(/\s+/).filter(Boolean);
		}),
	);
	return lists.flat();
}
