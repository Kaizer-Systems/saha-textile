/**
 * DigitalOcean reads and writes for the product screens: paged lists, actions the console follows
 * until DigitalOcean says they finished, and the monitoring API's series.
 */
import { MONITOR_RANGE_SECONDS, type ProductSeries } from '@saha-textile/release-console-contracts';

import { type Follow, type ProductCtx, read, soft, write } from './kit.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

export const DO_API = 'https://api.digitalocean.com/v2';
const DO = 'DigitalOcean';

export const doGet = (path: string, key: string) => read(DO, `${DO_API}${path}`, key).then(rec);
export const doSoft = (path: string, key: string) =>
	soft(DO, `${DO_API}${path}`, key).then((b) => (b === null ? null : rec(b)));
export const doSend = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, key: string, body?: unknown) =>
	write(DO, method, `${DO_API}${path}`, key, body).then(rec);

/** Every page of a list (200 a page, at most 10 pages). */
export async function doAll(
	path: string,
	field: string,
	key: string,
	soft = false,
): Promise<Record<string, unknown>[] | null> {
	const out: Record<string, unknown>[] = [];
	let url: string | null = `${path}${path.includes('?') ? '&' : '?'}per_page=200`;
	for (let page = 0; url && page < 10; page++) {
		const body: Record<string, unknown> | null = soft ? await doSoft(url, key) : await doGet(url, key);
		if (!body) return page === 0 ? null : out;
		out.push(...arr(body[field]).map(rec));
		const next = str(rec(rec(body['links'])['pages'])['next']);
		url = next.startsWith(`${DO_API}/`) ? next.slice(DO_API.length) : null;
	}
	return out;
}

/** A droplet, volume or image action, done when DigitalOcean marks it completed. */
export function actionDone(label: string, actionId: () => number | null): Follow {
	return {
		label,
		async check(key) {
			const id = actionId();
			if (!id) return true;
			const a = rec((await doGet(`/actions/${id}`, key))['action']);
			const status = str(a['status']);
			if (status === 'errored') throw new VendorError(`DigitalOcean reports ${label.toLowerCase()} failed.`, 500);
			return status === 'completed';
		},
	};
}

/** Starts a droplet action and answers its id. */
export async function dropletAction(id: string, key: string, body: Record<string, unknown>): Promise<number> {
	const r = await doSend('POST', `/droplets/${encodeURIComponent(id)}/actions`, key, body);
	return num(rec(r['action'])['id']);
}

/**
 * A droplet action that starts only when the step before it finished, so power off → resize →
 * power on run in order.
 */
export function laterAction(label: string, start: (key: string) => Promise<number>): Follow {
	let id: number | null = null;
	return {
		label,
		async check(key) {
			if (id === null) {
				id = await start(key);
				return false;
			}
			return actionDone(label, () => id).check(key);
		},
	};
}

export const dropletsOf = async (key: string) => (await doAll('/droplets', 'droplets', key)) ?? [];
export const dropletName = (droplets: Record<string, unknown>[], id: unknown) =>
	str(droplets.find((d) => num(d['id']) === num(id))?.['name']) || String(id);
export const regionSlug = (v: unknown) => (typeof v === 'string' ? v : str(rec(v)['slug']));

/* ----- monitoring ----- */

interface Matrix {
	metric: Record<string, unknown>;
	values: Array<[number, number]>;
}

async function metric(ctx: ProductCtx, name: string, query: Record<string, string>): Promise<Matrix[]> {
	const end = Math.floor(Date.now() / 1000);
	const start = end - MONITOR_RANGE_SECONDS[ctx.range];
	const qs = new URLSearchParams({ ...query, start: String(start), end: String(end) });
	const body = await doSoft(`/monitoring/metrics/droplet/${name}?${qs.toString()}`, ctx.key);
	if (!body) return [];
	return arr(rec(body['data'])['result']).map((r) => {
		const m = rec(r);
		return {
			metric: rec(m['metric']),
			values: arr(m['values']).map((p) => {
				const pair = arr(p);
				return [num(pair[0]), Number(pair[1])] as [number, number];
			}),
		};
	});
}

const round = (v: number) => Math.round(v * 100) / 100;

/** CPU busy %, from the per-mode counters DigitalOcean's agent reports. */
async function cpuSeries(ctx: ProductCtx, hostId: string): Promise<ProductSeries | null> {
	const modes = await metric(ctx, 'cpu', { host_id: hostId });
	if (!modes.length) return null;
	const total = new Map<number, number>();
	const idle = new Map<number, number>();
	for (const m of modes)
		for (const [t, v] of m.values) {
			total.set(t, (total.get(t) ?? 0) + v);
			if (m.metric['mode'] === 'idle') idle.set(t, (idle.get(t) ?? 0) + v);
		}
	const times = [...total.keys()].sort((a, b) => a - b);
	const points: Array<[number, number]> = [];
	for (let i = 1; i < times.length; i++) {
		const t0 = times[i - 1] as number;
		const t1 = times[i] as number;
		const dt = (total.get(t1) ?? 0) - (total.get(t0) ?? 0);
		const di = (idle.get(t1) ?? 0) - (idle.get(t0) ?? 0);
		if (dt > 0) points.push([t1, round(Math.max(0, Math.min(100, (1 - di / dt) * 100)))]);
	}
	return { name: 'CPU', unit: '%', points };
}

async function ratio(
	ctx: ProductCtx,
	hostId: string,
	name: string,
	used: string,
	total: string,
	filter?: (m: Record<string, unknown>) => boolean,
): Promise<ProductSeries | null> {
	const [u, t] = await Promise.all([metric(ctx, used, { host_id: hostId }), metric(ctx, total, { host_id: hostId })]);
	const pickOne = (list: Matrix[]) => (filter ? list.find((m) => filter(m.metric)) : list[0]);
	const a = pickOne(u);
	const b = pickOne(t);
	if (!a || !b) return null;
	const totals = new Map(b.values);
	const points = a.values
		.filter(([time]) => (totals.get(time) ?? 0) > 0)
		.map(([time, v]) => [time, round(100 - (v / (totals.get(time) as number)) * 100)] as [number, number]);
	return { name, unit: '%', points };
}

async function plain(
	ctx: ProductCtx,
	hostId: string,
	name: string,
	path: string,
	unit: string,
	extra: Record<string, string> = {},
): Promise<ProductSeries | null> {
	const m = (await metric(ctx, path, { host_id: hostId, ...extra }))[0];
	return m ? { name, unit, points: m.values.map(([t, v]) => [t, round(v)] as [number, number]) } : null;
}

/** A droplet's charts: CPU, memory, disk used, bandwidth in and out, load. */
export async function dropletSeries(ctx: ProductCtx, hostId: string, mount?: string): Promise<ProductSeries[]> {
	const all = await Promise.all([
		cpuSeries(ctx, hostId),
		ratio(ctx, hostId, 'Memory used', 'memory_available', 'memory_total'),
		ratio(ctx, hostId, mount ? `Used on ${mount}` : 'Disk used', 'filesystem_free', 'filesystem_size', (m) =>
			mount ? str(m['mountpoint']) === mount : str(m['mountpoint']) === '/',
		),
		plain(ctx, hostId, 'Bandwidth out (public)', 'bandwidth', ' Mbps', {
			interface: 'public',
			direction: 'outbound',
		}),
		plain(ctx, hostId, 'Bandwidth in (public)', 'bandwidth', ' Mbps', {
			interface: 'public',
			direction: 'inbound',
		}),
		plain(ctx, hostId, 'Load (1 min)', 'load_1', ''),
	]);
	return all.filter((s): s is ProductSeries => !!s && s.points.length > 0);
}
