/**
 * Run screens on this Mac's stack (brief console.js and v5), read through the Mac helper's fixed,
 * read-only tools: processes, patches and the helper link, the fixed-command terminal, older log
 * lines, the network, MongoDB with its migrations, Meilisearch, the photo queue, schedules and
 * switches. Staging and production read the same way through their server agent once it exists.
 */
import type { ProductCtx, ProductScreen } from './kit.js';
import {
	action,
	ago,
	bytes,
	col,
	fact,
	form,
	formTab,
	note,
	pick,
	row,
	stat,
	table,
	text,
	toneOf,
	view,
	when,
} from './kit.js';
import { checkHost } from '../vendors/tls-check.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

interface Docker {
	containers: Array<{ name: string; image: string; state: string; status: string; ports: string }>;
	stats: Array<{
		name: string;
		cpuPercent: number | null;
		memoryBytes: number | null;
		memoryLimitBytes: number | null;
		netRxBytes: number | null;
		netTxBytes: number | null;
		pids: number;
	}>;
}
const docker = (ctx: ProductCtx) =>
	ctx.helper<Docker>('GET', '/docker').catch(() => ({ containers: [], stats: [] }) as Docker);
const named = (ctx: ProductCtx, want: RegExp) =>
	docker(ctx).then((d) => d.containers.filter((c) => c.state === 'running' && want.test(c.name)));
const LOCAL_DB = 'saha_textile_local';
const helperDown = note(
	'The Mac helper is not answering, so this Mac’s stack cannot be read. Start the console with pnpm console:up.',
	'red',
);

async function containerPick(ctx: ProductCtx, label = 'Container') {
	const d = await docker(ctx);
	const running = d.containers.filter((c) => c.state === 'running');
	return {
		d,
		picker: pick(
			label,
			running.map((c) => ({ value: c.name, label: c.name })),
			ctx.id,
		),
	};
}

/* ===== Processes ===== */

export const processesScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		live: async (ctx) => {
			const { d, picker } = await containerPick(ctx);
			if (!picker.value)
				return view({ notes: [d.containers.length ? note('No container is running.', 'amber') : helperDown] });
			const [top, facts] = await Promise.all([
				ctx.helper<Array<Record<string, unknown>>>('GET', `/inspect/top?container=${picker.value}`),
				ctx.helper<Record<string, unknown>>('GET', `/inspect/facts?container=${picker.value}`),
			]);
			const st = d.stats.find((s) => s.name === picker.value);
			return view(
				{
					head: {
						name: picker.value,
						status: `${str(facts['status'])} · health ${str(facts['health'])}`,
						tone: str(facts['health']) === 'unhealthy' ? 'red' : 'ok',
					},
					stats: [
						stat('CPU', `${st?.cpuPercent ?? '—'}%`),
						stat(
							'Memory',
							bytes(st?.memoryBytes ?? null),
							st?.memoryLimitBytes ? `of ${bytes(st.memoryLimitBytes)}` : '',
						),
						stat('Processes', st?.pids ?? arr(top).length),
						stat(
							'Restarts',
							num(facts['restarts']),
							facts['oomKilled'] === true ? 'last stop: out of memory' : '',
						),
					],
					facts: [
						fact('Image', str(facts['image'])),
						fact('Up since', `${when(str(facts['started']))} (${ago(str(facts['started']))})`),
						fact(
							'Ports',
							arr(facts['ports'])
								.map((p) => str(p))
								.join(' · '),
						),
						fact(
							'Networks',
							arr(facts['networks'])
								.map((p) => str(p))
								.join(' · '),
						),
						fact('Settings by name', arr(facts['envNames']).length),
					],
					tables: [
						table(
							'Processes inside',
							[
								col('pid', 'PID', true),
								col('cmd', 'Command'),
								col('cpu', 'CPU %', true),
								col('mem', 'Memory', true),
								col('up', 'Running for', true),
							],
							top.map((p) =>
								row(String(num(p['pid'])), str(p['command']), {
									pid: num(p['pid']),
									cmd: `${str(p['command'])} ${str(p['args'])}`.slice(0, 160),
									cpu: num(p['cpu']),
									mem: bytes(num(p['rssKb']) * 1024),
									up: str(p['elapsed']),
								}),
							),
							'No processes.',
						),
					],
					actions: [action('Restart this container', 'restart', 'danger')],
				},
				picker,
			);
		},
		profile: async (ctx) => {
			const d = await docker(ctx);
			const rows = [...d.stats].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));
			return view({
				tables: [
					table(
						'Where the CPU goes now',
						[col('name', 'Container', true), col('cpu', 'CPU %', true), col('pids', 'Processes', true)],
						rows.map((s) =>
							row(
								s.name,
								s.name,
								{ name: s.name, cpu: s.cpuPercent ?? '—', pids: s.pids },
								(s.cpuPercent ?? 0) > 80 ? 'amber' : null,
							),
						),
						d.containers.length ? 'No stats.' : 'The Mac helper is not answering.',
					),
				],
				notes: [
					note(
						'A 30-second flame graph needs the Node inspector on the API; the dev API on this Mac runs with --inspect when started by pnpm dev:api:debug, and Chrome DevTools draws it. The console shows where CPU goes per container.',
						'muted',
					),
				],
			});
		},
		heap: async (ctx) => {
			const d = await docker(ctx);
			const rows = [...d.stats].sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0));
			return view({
				tables: [
					table(
						'Memory per container now',
						[
							col('name', 'Container', true),
							col('mem', 'Memory', true),
							col('of', 'Of limit', true),
							col('share', 'Share', true),
						],
						rows.map((s) =>
							row(
								s.name,
								s.name,
								{
									name: s.name,
									mem: bytes(s.memoryBytes),
									of: bytes(s.memoryLimitBytes),
									share:
										s.memoryBytes && s.memoryLimitBytes
											? `${Math.round((s.memoryBytes / s.memoryLimitBytes) * 100)}%`
											: '—',
								},
								s.memoryBytes && s.memoryLimitBytes && s.memoryBytes / s.memoryLimitBytes > 0.8
									? 'red'
									: null,
							),
						),
						'No stats.',
					),
				],
				notes: [
					note(
						'Growth over time is on Run › Server (each container’s memory line). A container that keeps growing between restarts is the leak to look at.',
						'muted',
					),
				],
			});
		},
		actions: async (ctx) => restartForm(ctx),
	},
	forms: {
		restart: {
			read: (ctx) => restartForm(ctx),
			async send(ctx, w) {
				const name = w.id ?? ctx.id ?? text(w, 'container');
				if (!/^saha-textile-[a-z0-9-]+$/.test(name)) throw new VendorError('Choose a container.', 400);
				const c = (await docker(ctx)).containers.find((x) => x.name === name);
				if (!c) throw new VendorError('That container is not running here.', 400);
				if (w.confirm.trim() !== name) throw new VendorError(`Type ${name} to confirm.`, 400);
				await ctx.helper('POST', '/inspect/restart', { container: name });
				return { message: `${name} restarted`, productId: name, follow: [] };
			},
		},
	},
};

async function restartForm(ctx: ProductCtx) {
	const { picker } = await containerPick(ctx);
	return formTab(
		form({
			key: 'restart',
			title: picker.value ? `Restart ${picker.value}` : 'Restart a container',
			submit: 'Restart',
			danger: true,
			confirmName: picker.value,
			blocked: picker.value ? null : 'No container is running.',
			notes: [note('Requests to it fail for a few seconds while it starts again.', 'amber')],
		}),
		picker,
	);
}

/* ===== Server: patches and the link ===== */

export const serverScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		patches: async (ctx) => {
			const p = await ctx
				.helper<{ outdated: Array<Record<string, unknown>>; images: Array<Record<string, unknown>> }>(
					'GET',
					'/inspect/patches',
				)
				.catch(() => null);
			if (!p) return view({ notes: [helperDown] });
			return view({
				stats: [stat('Updates waiting (Homebrew)', p.outdated.length), stat('Stack images', p.images.length)],
				tables: [
					table(
						'Updates waiting on this Mac',
						[col('name', 'Package', true), col('now', 'Now', true), col('next', 'Newest', true)],
						p.outdated.map((o) =>
							row(
								str(o['name']),
								str(o['name']),
								{ name: str(o['name']), now: str(o['now']), next: str(o['next']) },
								/docker|node|openssl|git|gh|cloudflared|infisical/.test(str(o['name']))
									? 'amber'
									: null,
							),
						),
						'Everything is up to date.',
					),
					table(
						'Image ages',
						[col('image', 'Image', true), col('created', 'Built', true), col('size', 'Size', true)],
						p.images.map((i) =>
							row(str(i['image']), str(i['image']), {
								image: str(i['image']),
								created: str(i['created']),
								size: str(i['size']),
							}),
						),
						'No images.',
					),
				],
				notes: [
					note(
						'On a server, the agent lists apt updates and a reboot waits for the PIN. Here, run brew upgrade in a terminal yourself.',
						'muted',
					),
				],
			});
		},
		link: async (ctx) => {
			const h = await ctx.helper<Record<string, unknown>>('GET', '/health').catch(() => null);
			const servers = ctx.repo.environments.filter((e) => e.cloudId !== null);
			return view({
				head: {
					name: 'Links to the console',
					status: h ? 'this Mac linked' : 'Mac helper not answering',
					tone: h ? 'ok' : 'red',
				},
				tables: [
					table(
						'Places the console reads',
						[col('where', 'Where'), col('how', 'How'), col('state', 'Now')],
						[
							row(
								'mac',
								'This Mac',
								{
									where: 'This Mac (local)',
									how: 'Mac helper on 127.0.0.1:4419, token in docker/release-console/env/runner-token',
									state: h ? 'linked' : 'not answering',
								},
								h ? 'ok' : 'red',
							),
							...servers.map((e) =>
								row(
									e.name,
									e.label,
									{
										where: e.label,
										how: 'the server’s ops address (API_HOST) with its console key, SSH through its tunnel',
										state: e.domains.length ? 'linked when its server exists' : 'no domain yet',
									},
									'muted',
								),
							),
						],
						'Nothing.',
					),
				],
				notes: [
					note(
						'A new server links itself during DigitalOcean › Droplets › Create: tunnel, Access, GitHub environment and host key, so nothing is pasted by hand.',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Terminal (fixed commands only) ===== */

interface TermOut {
	command: string;
	container: string;
	ok: boolean;
	lines: string[];
}
async function termView(ctx: ProductCtx, commands: string[], containerHint?: RegExp) {
	const { d } = await containerPick(ctx);
	const running = d.containers.filter((c) => c.state === 'running' && (!containerHint || containerHint.test(c.name)));
	const list = await ctx.helper<Array<{ id: string; label: string }>>('GET', '/inspect/commands').catch(() => []);
	return {
		running,
		list,
		run: (c: string, command: string) =>
			ctx.helper<TermOut>('POST', '/inspect/terminal', { container: c, command }),
	};
}
const outTable = (o: TermOut) =>
	table(
		`${o.container} › ${o.command}`,
		[col('line', 'Output', true)],
		o.lines.map((l, i) =>
			row(String(i), String(i), { line: l || ' ' }, /error|fatal|denied|refused/i.test(l) ? 'red' : null),
		),
		'No output.',
	);

export const terminalScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		live: async (ctx) => {
			const { running, list, run } = await termView(ctx, []);
			const choices = running.flatMap((c) =>
				list
					.filter(
						(cmd) =>
							!/mongo|redis|meili/.test(cmd.id) || new RegExp(cmd.id.split('-')[0] ?? '').test(c.name),
					)
					.map((cmd) => ({ value: `${c.name}|${cmd.id}`, label: `${c.name} › ${cmd.label}` })),
			);
			const p = pick('Command', choices, ctx.id);
			if (!p.value) return view({ notes: [running.length ? note('No commands.', 'muted') : helperDown] });
			const [c, cmd] = p.value.split('|');
			const out = await run(c ?? '', cmd ?? '');
			return view(
				{
					tables: [outTable(out)],
					notes: [
						note(
							'Only the console’s fixed commands run here, read-only, on this Mac’s stack. A server’s terminal opens through its Cloudflare tunnel in the browser (DigitalOcean › Droplets › its SSH address).',
							'muted',
						),
					],
				},
				p,
			);
		},
		split: async (ctx) => {
			const { running, run } = await termView(ctx, []);
			const api = running.find((c) => /api/.test(c.name)) ?? running[0];
			const mongo = running.find((c) => /mongo/.test(c.name));
			if (!api) return view({ notes: [helperDown] });
			const [left, right] = await Promise.all([
				run(api.name, 'logs-200'),
				mongo ? run(mongo.name, 'mongo-ping') : Promise.resolve(null),
			]);
			return view({ tables: [outTable(left), ...(right ? [outTable(right)] : [])] });
		},
		guard: async (ctx) => {
			const list = await ctx
				.helper<Array<{ id: string; label: string }>>('GET', '/inspect/commands')
				.catch(() => []);
			return view({
				tables: [
					table(
						'What the terminal may run',
						[col('cmd', 'Command'), col('kind', 'Kind')],
						list.map((c) => row(c.id, c.label, { cmd: c.label, kind: 'reads only' }, 'ok')),
						'The Mac helper is not answering.',
					),
				],
				notes: [
					note(
						'Nothing typed in the browser is ever run. A changing action (restart) asks for the PIN and the container’s name; production commands go through the server’s tunnel with its own Access sign-in.',
						'cy',
					),
				],
			});
		},
	},
};

/* ===== Live logs: older lines and yesterday ===== */

const logsTab = (since: string, tail: number) => async (ctx: ProductCtx) => {
	const { picker } = await containerPick(ctx);
	if (!picker.value) return view({ notes: [helperDown] });
	const r = await ctx.helper<{ lines: string[] }>(
		'GET',
		`/logs?container=${picker.value}&tail=${tail}${since ? `&since=${since}` : ''}`,
	);
	const lines = r.lines.slice(-600);
	return view(
		{
			stats: [
				stat('Lines', r.lines.length, since ? `last ${since}` : `last ${tail}`),
				stat('Errors', lines.filter((l) => /error|fatal|exception/i.test(l)).length),
			],
			tables: [
				table(
					`${picker.value} log`,
					[col('at', 'When', true), col('line', 'Line', true)],
					lines.map((l, i) => {
						const m = /^(\S+)\s(.*)$/.exec(l);
						return row(
							String(i),
							String(i),
							{ at: (m?.[1] ?? '').slice(11, 19), line: (m?.[2] ?? l).slice(0, 400) },
							/error|fatal|exception/i.test(l) ? 'red' : /warn/i.test(l) ? 'amber' : null,
						);
					}),
					'No lines.',
				),
			],
			notes: [
				note(
					'Docker keeps each container’s log while it exists, so yesterday’s lines are here even if the console was off. Tokens in addresses are masked before they leave the helper.',
					'muted',
				),
			],
		},
		picker,
	);
};

export const tailMoreScreen: ProductScreen = {
	vendor: 'local',
	tabs: { scroll: logsTab('', 2000), history: logsTab('24h', 5000) },
};

/* ===== Network ===== */

const OUTSIDE: Array<[string, string]> = [
	['secure.ccavenue.com', 'CCAvenue payments'],
	['api-m.paypal.com', 'PayPal'],
	['control.msg91.com', 'MSG91 SMS and email'],
	['apiv2.shiprocket.in', 'Shiprocket shipping'],
	['v6.exchangerate-api.com', 'ExchangeRate-API'],
	['sgp1.digitaloceanspaces.com', 'DigitalOcean Spaces (photos)'],
	['oauth2.googleapis.com', 'Google sign-in and Gmail'],
	['www.googleapis.com', 'YouTube and Search Console'],
	['app.infisical.com', 'Infisical'],
	['api.cloudflare.com', 'Cloudflare'],
];

export const networkScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		normal: async (ctx) => {
			const [d, nets] = await Promise.all([
				docker(ctx),
				ctx.helper<Array<Record<string, unknown>>>('GET', '/inspect/networks').catch(() => []),
			]);
			const series = ctx.localRequests(60);
			const req = series.reduce((a, r) => a + r[3], 0);
			return view({
				stats: [
					stat('Requests, last hour', req),
					stat(
						'Server errors',
						series.reduce((a, r) => a + Math.round(r[2] * r[3]), 0),
					),
					stat('Networks', nets.length),
				],
				tables: [
					table(
						'Traffic per container (since it started)',
						[col('name', 'Container', true), col('in', 'Received', true), col('out', 'Sent', true)],
						d.stats.map((s) =>
							row(s.name, s.name, { name: s.name, in: bytes(s.netRxBytes), out: bytes(s.netTxBytes) }),
						),
						d.containers.length ? 'No stats.' : 'The Mac helper is not answering.',
					),
					table(
						'Docker networks',
						[col('name', 'Network', true), col('subnet', 'Range', true), col('members', 'On it')],
						nets.map((n) =>
							row(str(n['name']), str(n['name']), {
								name: str(n['name']),
								subnet: str(n['subnet']),
								members: arr(n['members'])
									.map((m) => str(m))
									.join(' · '),
							}),
						),
						'No stack networks.',
					),
				],
			});
		},
		incident: async (ctx) => {
			const series = ctx.localRequests(120);
			const bad = series.filter((r) => r[2] > 0.02 || (r[1] ?? 0) > 1500);
			return view({
				head: {
					name: 'The last two hours',
					status: bad.length ? `${bad.length} bad minutes` : 'nothing stands out',
					tone: bad.length ? 'red' : 'ok',
				},
				tables: [
					table(
						'Minutes that stand out',
						[
							col('at', 'Minute', true),
							col('req', 'Requests', true),
							col('err', 'Errors', true),
							col('p95', 'Slowest (p95)', true),
						],
						bad.map(([t, p95, e, n]) =>
							row(
								String(t),
								String(t),
								{
									at: when(new Date(t).toISOString()),
									req: n,
									err: `${Math.round(e * 1000) / 10}%`,
									p95: `${Math.round(p95 ?? 0)} ms`,
								},
								e > 0.02 ? 'red' : 'amber',
							),
						),
						'No minute with more than 2% errors or slower than 1.5 s.',
					),
				],
				notes: [
					note(
						'Which route was slow: Watch › APM; one request followed through: Live logs › One request.',
						'muted',
					),
				],
			});
		},
		log: async (ctx) => {
			const series = ctx.localRequests(60).slice(-60).reverse();
			return view({
				tables: [
					table(
						'Every minute of the last hour',
						[
							col('at', 'Minute', true),
							col('req', 'Requests', true),
							col('err', 'Errors', true),
							col('p95', 'p95', true),
						],
						series.map(([t, p95, e, n]) =>
							row(
								String(t),
								String(t),
								{
									at: when(new Date(t).toISOString()),
									req: n,
									err: `${Math.round(e * 1000) / 10}%`,
									p95: p95 === null ? '—' : `${Math.round(p95)} ms`,
								},
								e > 0.02 ? 'red' : null,
							),
						),
						'No requests in the last hour: the local stack’s edge has served nothing.',
					),
				],
				notes: [
					note(
						'Each request line, filterable, is on Live logs (edge container) and Watch › APM by route.',
						'muted',
					),
				],
			});
		},
		connections: async (ctx) => {
			const { picker } = await containerPick(ctx);
			if (!picker.value) return view({ notes: [helperDown] });
			const conns = await ctx.helper<Array<{ local: string; remote: string; state: string }>>(
				'GET',
				`/inspect/connections?container=${picker.value}`,
			);
			const groups = new Map<string, number>();
			for (const c of conns)
				groups.set(
					`${c.state}|${c.state === 'listening' ? c.local : c.remote.replace(/:\d+$/, '')}`,
					(groups.get(`${c.state}|${c.state === 'listening' ? c.local : c.remote.replace(/:\d+$/, '')}`) ??
						0) + 1,
				);
			return view(
				{
					stats: [
						stat('Connections', conns.length),
						stat('Listening', conns.filter((c) => c.state === 'listening').length),
					],
					tables: [
						table(
							`Who ${picker.value} talks to`,
							[col('state', 'State'), col('peer', 'Address', true), col('n', 'Connections', true)],
							[...groups]
								.sort((a, b) => b[1] - a[1])
								.map(([k, n]) => {
									const [state, peer] = k.split('|');
									return row(k, k, { state: state ?? '', peer: peer ?? '', n });
								}),
							'No TCP connections.',
						),
					],
				},
				picker,
			);
		},
		external: async () => {
			const checks = await Promise.all(
				OUTSIDE.map(async ([host, what]) => ({ host, what, r: await checkHost(host) })),
			);
			return view({
				tables: [
					table(
						'Outside services, checked now',
						[
							col('what', 'Service'),
							col('host', 'Address', true),
							col('ok', 'Reachable'),
							col('cert', 'Certificate until', true),
						],
						checks.map((c) =>
							row(
								c.host,
								c.what,
								{
									what: c.what,
									host: c.host,
									ok: c.r.ok ? 'yes' : `no: ${c.r.error}`,
									cert: when(c.r.expiresOn),
								},
								c.r.ok ? 'ok' : 'red',
							),
						),
						'Nothing.',
					),
				],
				notes: [
					note(
						'A TLS handshake from this Mac to each service the shop calls; their own status pages say more.',
						'muted',
					),
				],
			});
		},
		security: async (ctx) => {
			const d = await docker(ctx);
			const open = d.containers.filter((c) => /0\.0\.0\.0:|:::/.test(c.ports));
			return view({
				head: {
					name: 'Ports this Mac publishes',
					status: open.length ? `${open.length} open to the network` : 'only to this Mac',
					tone: open.length ? 'amber' : 'ok',
				},
				tables: [
					table(
						'Published ports',
						[col('name', 'Container', true), col('ports', 'Ports', true)],
						d.containers
							.filter((c) => c.ports)
							.map((c) =>
								row(
									c.name,
									c.name,
									{ name: c.name, ports: c.ports },
									/0\.0\.0\.0:|:::/.test(c.ports) ? 'amber' : null,
								),
							),
						'No published ports.',
					),
				],
				notes: [
					note(
						'Ports bound to 0.0.0.0 are reachable from the Wi-Fi network; the stack binds to 127.0.0.1 where it can. Blocked attacks and rate limits on the live site are on Cloudflare › Security.',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Database (MongoDB) and drift ===== */

interface MongoReport {
	db: string;
	stats: Record<string, unknown>;
	collections: Array<{
		name: string;
		count: number;
		size: number;
		storage: number;
		indexSize: number;
		indexes: Array<{ name: string; key: string; unique: boolean; ttl: number | null }>;
	}>;
	server: Record<string, unknown>;
	ops: Array<Record<string, unknown>>;
	profile: Record<string, unknown>;
	slow: Array<Record<string, unknown>>;
	rs: Array<Record<string, unknown>>;
	migrations: Array<Record<string, unknown>>;
	switches: Array<Record<string, unknown>>;
	settings: Array<Record<string, unknown>>;
	orders: Array<{ _id: string; n: number; inr: number }>;
}
export async function mongo(ctx: ProductCtx): Promise<MongoReport | null> {
	const c = (await named(ctx, /mongo/))[0];
	if (!c) return null;
	return ctx.helper<MongoReport>('GET', `/inspect/mongo?container=${c.name}&db=${LOCAL_DB}`);
}
const noMongo = view({
	notes: [note('The local MongoDB container is not running (or the Mac helper is not answering).', 'amber')],
});

export const databaseScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		normal: async (ctx) => {
			const m = await mongo(ctx);
			if (!m) return noMongo;
			const s = m.stats;
			const conn = rec(m.server['connections']);
			return view({
				head: {
					name: `MongoDB ${str(m.server['version'])} · ${m.db}`,
					status: m.rs.map((r) => `${str(r['state'])}`).join(', ') || 'standalone',
					tone: m.rs.some((r) => str(r['state']) === 'PRIMARY') ? 'ok' : 'amber',
				},
				stats: [
					stat('Collections', m.collections.length),
					stat('Documents', num(s['objects']).toLocaleString('en-IN')),
					stat('Data', bytes(num(s['dataSize'])), `indexes ${bytes(num(s['indexSize']))}`),
					stat('Connections', num(conn['current']), `${num(conn['available'])} free`),
				],
				facts: [
					fact('Up for', `${Math.round(num(m.server['uptime']) / 3600)} h`),
					fact('Replica set', m.rs.map((r) => `${str(r['name'])} ${str(r['state'])}`).join(' · ') || 'none'),
					fact('Migrations run', m.migrations.length),
					fact(
						'Running now',
						m.ops.length
							? m.ops.map((o) => `${str(o['op'])} ${str(o['ns'])} ${num(o['secs'])} s`).join(' · ')
							: 'nothing long',
					),
				],
				tables: [
					table(
						'Collections',
						[
							col('name', 'Collection', true),
							col('n', 'Documents', true),
							col('size', 'Data', true),
							col('idx', 'Indexes', true),
						],
						[...m.collections]
							.sort((a, b) => b.size - a.size)
							.map((c) =>
								row(c.name, c.name, {
									name: c.name,
									n: c.count,
									size: bytes(c.size),
									idx: `${c.indexes.length} · ${bytes(c.indexSize)}`,
								}),
							),
						'No collections.',
					),
					table(
						'Migrations run',
						[
							col('what', 'Migration'),
							col('result', 'Result'),
							col('at', 'When', true),
							col('ms', 'Took', true),
						],
						m.migrations.map((x, i) =>
							row(
								String(i),
								str(x['description']),
								{
									what: str(x['description']),
									result: str(x['result']),
									at: when(str(x['ranAt'])),
									ms: `${num(x['ms'])} ms`,
								},
								toneOf(str(x['result']) === 'ok' ? 'ok' : str(x['result'])),
							),
						),
						'None yet.',
					),
				],
				notes: [
					note(
						'Backups of this database: DigitalOcean › Backups and snapshots (servers), mongodump to Spaces nightly.',
						'muted',
					),
				],
			});
		},
		drift: async (ctx) => {
			const [m, files] = await Promise.all([
				mongo(ctx),
				ctx.helper<string[]>('GET', '/inspect/migration-files').catch(() => [] as string[]),
			]);
			if (!m) return noMongo;
			const ran = m.migrations.map((x) => str(x['description']).toLowerCase());
			const norm = (f: string) => f.replace(/\.ts$/, '').replace(/-/g, ' ');
			const due = files.filter(
				(f) => !ran.some((r) => r.includes(norm(f)) || r.includes(f.replace(/\.ts$/, ''))),
			);
			const noIndex = m.collections.filter((c) => c.count > 1000 && c.indexes.length <= 1);
			return view({
				head: {
					name: 'Due in the next release',
					status:
						due.length || noIndex.length
							? `${due.length} migrations, ${noIndex.length} collections without indexes`
							: 'nothing due',
					tone: due.length ? 'amber' : 'ok',
				},
				tables: [
					table(
						'Migrations in the code and whether this database ran them',
						[col('file', 'Migration file', true), col('state', 'Here')],
						files.map((f) =>
							row(
								f,
								f,
								{ file: f, state: due.includes(f) ? 'not run yet' : 'ran' },
								due.includes(f) ? 'amber' : 'ok',
							),
						),
						'No migration files.',
					),
					table(
						'Large collections with only the _id index',
						[col('name', 'Collection', true), col('n', 'Documents', true)],
						noIndex.map((c) => row(c.name, c.name, { name: c.name, n: c.count })),
						'Every large collection has its indexes.',
					),
				],
			});
		},
	},
};

/* ===== Search index (Meilisearch) ===== */

interface Meili {
	health: string;
	version: string;
	stats: Record<string, unknown>;
	indexes: Array<Record<string, unknown>>;
	failed: Array<Record<string, unknown>>;
}
async function meili(ctx: ProductCtx) {
	const c = (await named(ctx, /meili/))[0];
	return c ? ctx.helper<Meili>('GET', `/inspect/meili?container=${c.name}`) : null;
}

export const searchScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		normal: async (ctx) => {
			const m = await meili(ctx);
			if (!m) return view({ notes: [note('The local Meilisearch container is not running.', 'amber')] });
			const per = rec(m.stats['indexes']);
			return view({
				head: {
					name: `Meilisearch ${m.version}`,
					status: m.health,
					tone: m.health === 'available' ? 'ok' : 'red',
				},
				stats: [
					stat('Indexes', m.indexes.length),
					stat('Database', bytes(num(m.stats['databaseSize']))),
					stat('Failed tasks', m.failed.length),
					stat('Last update', ago(str(m.stats['lastUpdate']))),
				],
				tables: [
					table(
						'Indexes',
						[
							col('uid', 'Index', true),
							col('docs', 'Documents', true),
							col('busy', 'Indexing'),
							col('at', 'Changed', true),
						],
						m.indexes.map((i) => {
							const s = rec(per[str(i['uid'])]);
							return row(
								str(i['uid']),
								str(i['uid']),
								{
									uid: str(i['uid']),
									docs: num(s['numberOfDocuments']),
									busy: s['isIndexing'] === true ? 'yes' : 'no',
									at: when(str(i['updatedAt'])),
								},
								s['isIndexing'] === true ? 'amber' : null,
							);
						}),
						'No indexes.',
					),
				],
				notes: [
					note(
						'MongoDB is the truth; this index is rebuilt from it whenever needed (search rebuild in the release steps).',
						'muted',
					),
				],
			});
		},
		degraded: async (ctx) => {
			const m = await meili(ctx);
			if (!m)
				return view({
					head: { name: 'Search is down', status: 'degraded', tone: 'red' },
					notes: [
						note(
							'The shop falls back to its plain catalogue lists and queues each product change; the queue empties into the index when search is back.',
							'amber',
						),
					],
				});
			return view({
				head: {
					name: 'Failed search tasks',
					status: m.failed.length ? `${m.failed.length} failed` : 'none',
					tone: m.failed.length ? 'amber' : 'ok',
				},
				tables: [
					table(
						'Failed tasks',
						[
							col('at', 'When', true),
							col('index', 'Index', true),
							col('type', 'Task'),
							col('error', 'Why'),
						],
						m.failed.map((t) =>
							row(
								String(num(t['uid'])),
								str(t['type']),
								{
									at: when(str(t['at'])),
									index: str(t['index']),
									type: str(t['type']),
									error: str(t['error']).slice(0, 200),
								},
								'amber',
							),
						),
						'No failed tasks.',
					),
				],
			});
		},
	},
};

/* ===== Photos, schedules (Redis / BullMQ) ===== */

interface Redis {
	version: string;
	memory: string;
	clients: number;
	queues: Array<{
		queue: string;
		waiting: number;
		active: number;
		delayed: number;
		failed: number;
		completed: number;
		repeat: number;
	}>;
	failedJobs: Array<{ queue: string; id: string; name: string; reason: string; at: number; attempts: number }>;
	schedules: Array<{ queue: string; key: string; next: number }>;
}
async function redis(ctx: ProductCtx) {
	const c = (await named(ctx, /redis/))[0];
	return c ? ctx.helper<Redis>('GET', `/inspect/redis?container=${c.name}`) : null;
}
const noRedis = view({ notes: [note('The local Redis container is not running.', 'amber')] });

export const mediaScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		normal: async (ctx) => {
			const r = await redis(ctx);
			if (!r) return noRedis;
			const q = r.queues.find((x) => /media/.test(x.queue));
			return view({
				head: {
					name: 'Photo pipeline',
					status: q ? (q.failed ? `${q.failed} failed` : 'flowing') : 'no media queue yet',
					tone: q?.failed ? 'amber' : 'ok',
				},
				stats: q
					? [
							stat('Waiting', q.waiting),
							stat('Working', q.active),
							stat('Done', q.completed),
							stat('Failed', q.failed),
						]
					: [],
				tables: [
					table(
						'Every job queue',
						[
							col('q', 'Queue', true),
							col('w', 'Waiting', true),
							col('a', 'Working', true),
							col('d', 'Later', true),
							col('f', 'Failed', true),
							col('c', 'Done', true),
						],
						r.queues.map((x) =>
							row(
								x.queue,
								x.queue,
								{ q: x.queue, w: x.waiting, a: x.active, d: x.delayed, f: x.failed, c: x.completed },
								x.failed ? 'amber' : null,
							),
						),
						'No queues.',
					),
				],
				notes: [
					note(
						'Uploads resize into every size and format, then go to Spaces; Cloudflare caches them in front.',
						'muted',
					),
				],
			});
		},
		failing: async (ctx) => {
			const r = await redis(ctx);
			if (!r) return noRedis;
			return view({
				tables: [
					table(
						'Failed jobs',
						[
							col('at', 'When', true),
							col('q', 'Queue', true),
							col('name', 'Job'),
							col('why', 'Why'),
							col('tries', 'Tries', true),
						],
						r.failedJobs.map((j) =>
							row(
								`${j.queue}:${j.id}`,
								j.name,
								{
									at: j.at ? when(new Date(j.at).toISOString()) : '—',
									q: j.queue,
									name: j.name,
									why: j.reason,
									tries: j.attempts,
								},
								'red',
							),
						),
						'No failed jobs.',
					),
				],
				notes: [
					note(
						'A failed job waits for its retries; when storage is unreachable, jobs wait and retry instead of failing the upload.',
						'muted',
					),
				],
			});
		},
	},
};

export const cronScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const r = await redis(ctx);
			if (!r) return noRedis;
			const now = Date.now();
			return view({
				stats: [
					stat('Schedules', r.schedules.length),
					stat('Missed', r.schedules.filter((s) => s.next < now - 120_000).length),
				],
				tables: [
					table(
						'Every scheduled task',
						[col('name', 'Task'), col('q', 'Queue', true), col('next', 'Next run', true)],
						[...r.schedules]
							.sort((a, b) => a.next - b.next)
							.map((s) =>
								row(
									`${s.queue}:${s.key}`,
									s.key,
									{
										name: s.key.split(':')[0] ?? s.key,
										q: s.queue,
										next: `${when(new Date(s.next).toISOString())} (${s.next < now ? 'overdue' : `in ${Math.round((s.next - now) / 60000)} min`})`,
									},
									s.next < now - 120_000 ? 'red' : null,
								),
							),
						'No scheduled tasks: the worker registers them when it starts.',
					),
				],
			});
		},
	},
};

/* ===== Switches ===== */

export const flagsScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const m = await mongo(ctx);
			if (!m) return noMongo;
			return view({
				tables: [
					table(
						'Message switches (Settings › Communications)',
						[col('what', 'Message'), col('channel', 'Channel'), col('on', 'On')],
						m.switches.map((s, i) =>
							row(
								String(i),
								str(s['message'] ?? s['key']),
								{
									what: str(s['message'] ?? s['messageKey'] ?? s['key']),
									channel: str(s['channel']),
									on: s['enabled'] === false || s['on'] === false ? 'off' : 'on',
								},
								s['enabled'] === false || s['on'] === false ? 'amber' : null,
							),
						),
						'No message switched off: every message follows its default.',
					),
					table(
						'Site settings',
						[col('key', 'Setting', true), col('at', 'Changed', true)],
						m.settings.map((s, i) =>
							row(String(i), str(s['key']), { key: str(s['key']), at: when(str(s['updatedAt'])) }),
						),
						'No site settings saved.',
					),
				],
				notes: [
					note(
						'The transactional and marketing kill switches and the maintenance page are server settings (Run › Secrets); these are the shop’s own switches in its database. Changing them is done in the admin, which records who did it.',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Drift between environments ===== */

export const driftScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		diff: async (ctx) => {
			const envs = ctx.repo.environments;
			return view({
				tables: [
					table(
						'Environments side by side',
						[
							col('env', 'Environment'),
							col('cloud', 'Runs on'),
							col('domains', 'Domains', true),
							col('secrets', 'Secrets place'),
						],
						envs.map((e) =>
							row(e.name, e.label, {
								env: e.label,
								cloud: e.cloudId === null ? 'this Mac' : `cloud slot ${e.cloudId}`,
								domains: e.domains.join(', '),
								secrets: e.secretsId ?? '—',
							}),
						),
						'No environments.',
					),
				],
				notes: [
					note(
						'Secret names that differ between environments are on Run › Secrets (matrix). Data drift (indexes, migrations) is on Database › Drift. Server-level drift (packages, settings) is read by each server’s agent once servers exist.',
						'muted',
					),
				],
			});
		},
	},
};
