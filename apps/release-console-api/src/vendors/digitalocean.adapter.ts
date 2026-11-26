import {
	type CloudAccount,
	type DoCatalog,
	type DoImage,
	type DoProject,
	type DoRegion,
	type DoSize,
	type DoSshKey,
	type DoVpc,
	type Droplet,
	type ImageKind,
	sizeFamily,
} from '@saha-textile/release-console-contracts';

import { VendorError, arr, getJson, num, rec, str } from './http.js';

const API = 'https://api.digitalocean.com/v2';
/** At most this many pages of 200 per list (the Marketplace is the long one). */
const MAX_PAGES = 8;

/** The cloud slot's shape. DigitalOcean fills it today; AWS, Google Cloud or Azure adapters later. */
export interface CloudAdapter {
	servers(key: string): Promise<Droplet[]>;
	account(key: string): Promise<CloudAccount>;
	catalog(key: string): Promise<DoCatalog>;
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

export function toRegion(v: unknown): DoRegion {
	const r = rec(v);
	return {
		slug: str(r['slug']),
		name: str(r['name']),
		available: r['available'] === true,
		sizes: arr(r['sizes']).map((s) => str(s)),
		features: arr(r['features']).map((s) => str(s)),
	};
}

export function toSize(v: unknown): DoSize {
	const r = rec(v);
	const slug = str(r['slug']);
	return {
		slug,
		description: str(r['description']),
		family: sizeFamily(slug),
		memoryMb: num(r['memory']),
		vcpus: num(r['vcpus']),
		diskGb: num(r['disk']),
		transferTb: num(r['transfer']),
		priceMonthly: num(r['price_monthly']),
		priceHourly: num(r['price_hourly']),
		regions: arr(r['regions']).map((s) => str(s)),
		available: r['available'] === true,
	};
}

/** An image as DigitalOcean lists it; `kind` from which list it came from and its own type. */
export function toImage(v: unknown, from: 'os' | 'app' | 'private', of: string | null = null): DoImage {
	const r = rec(v);
	const type = str(r['type']).toLowerCase();
	const kind: ImageKind =
		from !== 'private' ? from : type === 'custom' ? 'custom' : type === 'backup' ? 'backup' : 'snapshot';
	return {
		id: num(r['id']),
		slug: str(r['slug']) || null,
		name: str(r['name']),
		distribution: str(r['distribution']),
		kind: of ? 'backup' : kind,
		regions: arr(r['regions']).map((s) => str(s)),
		minDiskGb: num(r['min_disk_size']),
		sizeGb: typeof r['size_gigabytes'] === 'number' ? r['size_gigabytes'] : null,
		createdAt: str(r['created_at']),
		of,
	};
}

export function toSshKey(v: unknown): DoSshKey {
	const r = rec(v);
	return { id: num(r['id']), name: str(r['name']), fingerprint: str(r['fingerprint']) };
}

export function toVpc(v: unknown): DoVpc {
	const r = rec(v);
	return {
		id: str(r['id']),
		name: str(r['name']),
		region: str(r['region']),
		ipRange: str(r['ip_range']),
		isDefault: r['default'] === true,
	};
}

export function toProject(v: unknown): DoProject {
	const r = rec(v);
	return { id: str(r['id']), name: str(r['name']), isDefault: r['is_default'] === true };
}

function refuse(status: number): never {
	if (status === 401)
		throw new VendorError('DigitalOcean refused the key (401). Check it on the Connections screen.', 401);
	if (status === 403) throw new VendorError('The DigitalOcean key lacks the scope for this read (403).', 403);
	throw new VendorError(`DigitalOcean answered ${status}.`, status);
}

async function read(path: string, key: string): Promise<unknown> {
	const a = await getJson(`${API}${path}`, key);
	if (a.status >= 400) refuse(a.status);
	return a.body;
}

/** Every page of one list (200 a page), following DigitalOcean's own `links.pages.next`. */
export async function readAll(path: string, field: string, key: string, maxPages = MAX_PAGES): Promise<unknown[]> {
	const out: unknown[] = [];
	let url: string | null = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=200`;
	for (let page = 0; url && page < maxPages; page++) {
		const a = await getJson(url, key);
		if (a.status >= 400) refuse(a.status);
		const body = rec(a.body);
		out.push(...arr(body[field]));
		const next = str(rec(rec(body['links'])['pages'])['next']);
		url = next.startsWith(`${API}/`) ? next : null;
	}
	return out;
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
	/**
	 * Everything the create steps choose from. A list the key may not read is named in `missing`
	 * so its step can say so; a refused key (401) still fails the whole read.
	 */
	async catalog(key) {
		const missing: string[] = [];
		const soft = async <T>(name: string, work: Promise<T[]>): Promise<T[]> => {
			try {
				return await work;
			} catch (err) {
				if (err instanceof VendorError && err.status === 401) throw err;
				missing.push(name);
				return [];
			}
		};
		const [regions, sizes, os, apps, own, sshKeys, vpcs, projects, droplets] = await Promise.all([
			soft(
				'regions',
				readAll('/regions', 'regions', key).then((l) => l.map(toRegion)),
			),
			soft(
				'sizes',
				readAll('/sizes', 'sizes', key).then((l) => l.map(toSize)),
			),
			soft(
				'OS images',
				readAll('/images?type=distribution', 'images', key).then((l) => l.map((i) => toImage(i, 'os'))),
			),
			soft(
				'Marketplace images',
				readAll('/images?type=application', 'images', key).then((l) => l.map((i) => toImage(i, 'app'))),
			),
			soft(
				'your images and snapshots',
				readAll('/images?private=true', 'images', key).then((l) => l.map((i) => toImage(i, 'private'))),
			),
			soft(
				'SSH keys',
				readAll('/account/keys', 'ssh_keys', key).then((l) => l.map(toSshKey)),
			),
			soft(
				'VPCs',
				readAll('/vpcs', 'vpcs', key).then((l) => l.map(toVpc)),
			),
			soft(
				'projects',
				readAll('/projects', 'projects', key).then((l) => l.map(toProject)),
			),
			soft(
				'droplets',
				readAll('/droplets', 'droplets', key).then((l) => l.map(rec)),
			),
		]);
		const withBackups = droplets.filter((d) => arr(d['backup_ids']).length > 0);
		const backups = (
			await Promise.all(
				withBackups.map((d) =>
					soft(
						`backups of ${str(d['name'])}`,
						readAll(`/droplets/${num(d['id'])}/backups`, 'backups', key).then((l) =>
							l.map((b) => toImage(b, 'private', str(d['name']))),
						),
					),
				),
			)
		).flat();
		const images = [...os, ...apps, ...own, ...backups].filter((i) => i.id > 0);
		return { regions, sizes, images, sshKeys, vpcs, projects, missing };
	},
};
