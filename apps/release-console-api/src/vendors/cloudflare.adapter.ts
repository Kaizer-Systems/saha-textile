import type { DnsRecord, EdgeZone } from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.cloudflare.com/client/v4';

/** The edge slot's shape. Cloudflare fills it today; CloudFront or Fastly adapters later. */
export interface EdgeAdapter {
	zones(key: string): Promise<EdgeZone[]>;
	records(key: string, zone: string): Promise<DnsRecord[]>;
	/** The zone's edge certificates: hosts, status, issuer and the earliest expiry in each pack. */
	certificates(
		key: string,
		zone: string,
	): Promise<{ zone: string; hosts: string[]; status: string; issuer: string; expiresOn: string | null }[]>;
}

export function toZone(z: unknown): EdgeZone {
	const r = rec(z);
	return {
		id: str(r['id']),
		name: str(r['name']),
		status: str(r['status']),
		plan: str(rec(r['plan'])['name']),
		account: str(rec(r['account'])['name']),
	};
}

export function toRecord(d: unknown): DnsRecord {
	const r = rec(d);
	return {
		id: str(r['id']),
		type: str(r['type']),
		name: str(r['name']),
		content: str(r['content']),
		proxied: typeof r['proxied'] === 'boolean' ? r['proxied'] : null,
		ttl: num(r['ttl']),
	};
}

async function read(path: string, key: string): Promise<unknown> {
	const a = await getJson(`${API}${path}`, key);
	const body = rec(a.body);
	if (a.status >= 400 || body['success'] === false) {
		const first = rec(arr(body['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${a.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			a.status,
		);
	}
	return body['result'];
}

export const cloudflareAdapter: EdgeAdapter = {
	async zones(key) {
		return arr(await read('/zones?per_page=50', key)).map(toZone);
	},
	async records(key, zone) {
		const zones = arr(await read(`/zones?name=${encodeURIComponent(zone)}`, key)).map(toZone);
		const id = zones[0]?.id;
		if (!id) throw new VendorError(`The key does not see the zone ${zone}.`, 404);
		return arr(await read(`/zones/${id}/dns_records?per_page=500`, key)).map(toRecord);
	},
	async certificates(key, zone) {
		const zones = arr(await read(`/zones?name=${encodeURIComponent(zone)}`, key)).map(toZone);
		const id = zones[0]?.id;
		if (!id) throw new VendorError(`The key does not see the zone ${zone}.`, 404);
		return arr(await read(`/zones/${id}/ssl/certificate_packs?status=all`, key)).map((p) => {
			const pack = rec(p);
			const certs = arr(pack['certificates']).map(rec);
			const expiries = certs
				.map((c) => str(c['expires_on']))
				.filter(Boolean)
				.sort();
			return {
				zone,
				hosts: arr(pack['hosts']).map((h) => str(h)),
				status: str(pack['status']),
				issuer: str(pack['certificate_authority']) || str(certs[0]?.['issuer']),
				expiresOn: expiries[0] ?? null,
			};
		});
	},
};
