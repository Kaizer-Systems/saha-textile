import type { CloudAccount, Droplet } from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.digitalocean.com/v2';

/** The cloud slot's shape. DigitalOcean fills it today; AWS, Google Cloud or Azure adapters later. */
export interface CloudAdapter {
	servers(key: string): Promise<Droplet[]>;
	account(key: string): Promise<CloudAccount>;
}

export function toDroplet(d: unknown): Droplet {
	const r = rec(d);
	const v4 = arr(rec(r['networks'])['v4']).map(rec);
	const pub = v4.find((n) => n['type'] === 'public') ?? v4[0];
	return {
		id: num(r['id']),
		name: str(r['name']),
		status: str(r['status']),
		region: str(rec(r['region'])['slug']),
		size: str(r['size_slug']),
		vcpus: num(r['vcpus']),
		memoryMb: num(r['memory']),
		diskGb: num(r['disk']),
		ipv4: pub ? str(pub['ip_address']) || null : null,
		tags: arr(r['tags']).map((t) => str(t)),
		createdAt: str(r['created_at']),
	};
}

async function read(path: string, key: string): Promise<unknown> {
	const a = await getJson(`${API}${path}`, key);
	if (a.status === 401)
		throw new VendorError('DigitalOcean refused the key (401). Check it on the Connections screen.', 401);
	if (a.status === 403) throw new VendorError('The DigitalOcean key lacks the scope for this read (403).', 403);
	if (a.status >= 400) throw new VendorError(`DigitalOcean answered ${a.status}.`, a.status);
	return a.body;
}

export const digitalOceanAdapter: CloudAdapter = {
	async servers(key) {
		return arr(rec(await read('/droplets?per_page=200', key))['droplets']).map(toDroplet);
	},
	async account(key) {
		const account = rec(rec(await read('/account', key))['account']);
		const balance = await read('/customers/my/balance', key).then(rec, () => null);
		return {
			team: str(rec(account['team'])['name']) || str(account['email']),
			status: str(account['status']),
			dropletLimit: num(account['droplet_limit']),
			monthToDateUsage: balance ? str(balance['month_to_date_usage']) || null : null,
			accountBalance: balance ? str(balance['account_balance']) || null : null,
		};
	},
};
