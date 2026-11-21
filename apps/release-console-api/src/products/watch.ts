/**
 * Watch, Shop and Governance screens (brief console.js, v5, tracing): issues grouped from the stack's
 * logs, the incident room, request traces from the edge log, the MongoDB profiler, shopper
 * experience (Cloudflare Web Analytics), uptime and a shopper journey, service goals, the business
 * dashboard, payments, who has access, the audit log and privacy requests.
 */
import { LATENCY_BUCKETS_MS } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductScreen } from './kit.js';
import {
	action,
	ago,
	bytes,
	col,
	fact,
	field,
	form,
	formTab,
	note,
	option,
	pick,
	row,
	stat,
	table,
	text,
	view,
	when,
} from './kit.js';
import { cfCacheScreen } from './cf-zone.js';
import { accountOf, cfAll, graph, traffic, zoneOf, seriesOf, noAnalytics } from './cf-kit.js';
import { mongo } from './run.js';
import { checkHost } from '../vendors/tls-check.js';
import { VendorError, arr, num, rec, str } from '../vendors/http.js';

const helperDown = note(
	'The Mac helper is not answering, so this Mac’s stack cannot be read. Start the console with pnpm console:up.',
	'red',
);

/* ===== Issues: error lines grouped ===== */

interface Issue {
	id: string;
	title: string;
	container: string;
	count: number;
	first: string;
	last: string;
	samples: string[];
}

const fingerprint = (line: string) =>
	line
		.replace(/^\S+\s/, '')
		.replace(/\b[0-9a-f]{8,}\b/gi, '#')
		.replace(/\d+/g, 'n')
		.replace(/"[^"]{20,}"/g, '"…"')
		.slice(0, 160);

async function issues(ctx: ProductCtx): Promise<Issue[] | null> {
	const d = await ctx
		.helper<{ containers: Array<{ name: string; state: string }> }>('GET', '/docker')
		.catch(() => null);
	if (!d) return null;
	const running = d.containers.filter((c) => c.state === 'running' && !/release-console|registry/.test(c.name));
	const logs = await Promise.all(
		running.map(async (c) => ({
			c: c.name,
			lines: (
				await ctx
					.helper<{ lines: string[] }>('GET', `/logs?container=${c.name}&tail=3000&since=24h`)
					.catch(() => ({ lines: [] }))
			).lines,
		})),
	);
	const groups = new Map<string, Issue>();
	for (const { c, lines } of logs)
		for (const l of lines) {
			if (
				!/\b(error|fatal|exception|unhandled|ECONNREFUSED|ETIMEDOUT)\b/i.test(l) ||
				/level":"?(info|debug)/i.test(l)
			)
				continue;
			const fp = `${c}|${fingerprint(l)}`;
			const at = /^(\S+)/.exec(l)?.[1] ?? '';
			const g = groups.get(fp) ?? {
				id: Buffer.from(fp).toString('base64url').slice(0, 40),
				title: fingerprint(l).slice(0, 140),
				container: c,
				count: 0,
				first: at,
				last: at,
				samples: [],
			};
			g.count++;
			g.last = at;
			if (g.samples.length < 5) g.samples.push(l.replace(/^\S+\s/, '').slice(0, 500));
			groups.set(fp, g);
		}
	return [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export const issuesScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const list = await issues(ctx);
			if (!list) return view({ notes: [helperDown] });
			return view({
				stats: [
					stat('Issues, last 24 h', list.length),
					stat(
						'Occurrences',
						list.reduce((a, i) => a + i.count, 0),
					),
				],
				tables: [
					table(
						'Errors grouped into issues',
						[
							col('title', 'Issue', true),
							col('where', 'Where', true),
							col('n', 'Times', true),
							col('last', 'Last seen', true),
						],
						list.map((i) =>
							row(
								i.id,
								i.title,
								{ title: i.title, where: i.container, n: i.count, last: when(i.last) },
								i.count > 10 ? 'red' : 'amber',
							),
						),
						'No errors in the stack’s logs in the last 24 hours.',
						true,
					),
				],
				notes: [
					note(
						'Grouped from every stack container’s log (repeats folded, numbers and ids ignored). Servers group the same way through their agent.',
						'muted',
					),
				],
			});
		},
		detail: async (ctx) => {
			const list = (await issues(ctx)) ?? [];
			const p = pick(
				'Issue',
				list.map((i) => ({ value: i.id, label: `${i.container} · ${i.title.slice(0, 80)}` })),
				ctx.id,
			);
			const i = list.find((x) => x.id === p.value);
			if (!i) return view({ notes: [note('No issues.', 'ok')] });
			const deploys = ctx
				.recentAll('local-job-started')
				.filter((e) => e.at <= i.first)
				.slice(0, 1);
			return view(
				{
					head: { name: i.title, status: `${i.count} times`, tone: 'red' },
					facts: [
						fact('Where', i.container),
						fact('First seen', `${when(i.first)} (${ago(i.first)})`),
						fact('Last seen', `${when(i.last)} (${ago(i.last)})`),
						fact(
							'First release seen in',
							deploys[0]
								? `${deploys[0].detail} at ${when(deploys[0].at)}`
								: 'before the last local release the console recorded',
						),
					],
					tables: [
						table(
							'Sample lines',
							[col('line', 'Line', true)],
							i.samples.map((s, n) => row(String(n), String(n), { line: s }, 'red')),
							'No samples.',
						),
					],
				},
				p,
			);
		},
	},
};

/* ===== Incident room ===== */

export const incidentScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		room: async (ctx) => {
			const [list, health] = await Promise.all([
				issues(ctx),
				ctx.helper<Record<string, unknown>>('GET', '/shop-health').catch(() => null),
			]);
			const series = ctx.localRequests(180);
			const bad = series.filter((r) => r[2] > 0.02);
			const notes = ctx.recent('incident-note');
			const timeline = [
				...bad.map(([t, , e, n]) => ({
					at: new Date(t).toISOString(),
					what: `${Math.round(e * 100)}% of ${n} requests failed`,
					kind: 'errors',
				})),
				...(list ?? [])
					.slice(0, 20)
					.map((i) => ({
						at: i.last,
						what: `${i.container}: ${i.title.slice(0, 100)} (${i.count}×)`,
						kind: 'issue',
					})),
				...ctx
					.recentAll('local-job-started')
					.slice(0, 10)
					.map((e) => ({ at: e.at, what: `Release: ${e.detail}`, kind: 'release' })),
				...notes.map((n) => ({ at: n.at, what: n.detail, kind: 'note' })),
			]
				.sort((a, b) => b.at.localeCompare(a.at))
				.slice(0, 60);
			const stack = rec(health?.['stack']);
			const dev = rec(health?.['dev']);
			return view({
				head: {
					name: 'Incident room',
					status: bad.length || (list?.length ?? 0) ? 'something is wrong' : 'quiet',
					tone: bad.length ? 'red' : (list?.length ?? 0) ? 'amber' : 'ok',
				},
				facts: [
					fact('Shop API (stack)', str(stack['status']) || (health ? 'not running' : 'unknown')),
					fact('Shop API (dev server)', str(dev['status']) || (health ? 'not running' : 'unknown')),
					fact('Bad minutes, last 3 h', bad.length),
				],
				tables: [
					table(
						'Timeline, built by itself',
						[col('at', 'When', true), col('kind', 'Kind'), col('what', 'What')],
						timeline.map((t, i) =>
							row(
								String(i),
								t.what,
								{ at: when(t.at), kind: t.kind, what: t.what },
								t.kind === 'errors'
									? 'red'
									: t.kind === 'issue'
										? 'amber'
										: t.kind === 'note'
											? 'cy'
											: null,
							),
						),
						'Nothing happened in the last three hours.',
					),
				],
				notes: [
					note(
						'Runbook: 1 check Health and the failing service; 2 roll back if it started with a release (Ship › Rollback); 3 add notes as you go; the note list becomes the post-incident write-up.',
						'cy',
					),
				],
				actions: [action('Add a note', 'note', 'primary')],
			});
		},
	},
	forms: {
		note: {
			read: async () =>
				formTab(
					form({
						key: 'note',
						title: 'Add a note to the incident timeline',
						submit: 'Add note',
						fields: [field('text', 'Note', 'textarea', { required: true })],
					}),
				),
			async send(_ctx, w) {
				const t = text(w, 'text');
				if (t.length > 1000) throw new VendorError('Keep a note under 1,000 characters.', 400);
				return { message: t, productId: null, follow: [] };
			},
		},
	},
};

/* ===== Traces (from the edge's request log) ===== */

const bucketLabel = (i: number) =>
	i < LATENCY_BUCKETS_MS.length
		? `under ${LATENCY_BUCKETS_MS[i]} ms`
		: `over ${LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]} ms`;

export const tracesScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const v = ctx.localView(60);
			return view({
				stats: [stat('Routes, last hour', v.routes.length), stat('Services', v.services.length)],
				tables: [
					table(
						'Slowest requests by route',
						[
							col('route', 'Route', true),
							col('svc', 'Service', true),
							col('n', 'Requests', true),
							col('p95', 'p95', true),
							col('err', 'Errors', true),
						],
						v.routes.map((r) =>
							row(
								`${r.service} ${r.method} ${r.route}`,
								r.route,
								{
									route: `${r.method} ${r.route}`,
									svc: r.service,
									n: r.count,
									p95: r.p95 === null ? '—' : `${Math.round(r.p95)} ms`,
									err: `${Math.round(r.errorRate * 1000) / 10}%`,
								},
								r.errorRate > 0.02 ? 'red' : (r.p95 ?? 0) > 1000 ? 'amber' : null,
							),
						),
						v.note ?? 'No requests in the last hour.',
						true,
					),
				],
				notes: [
					note(
						'Built from the edge’s request log (every request with its timing). Span-level traces inside the API (database, search, outside calls) come once the API exports OpenTelemetry to the console.',
						'muted',
					),
				],
			});
		},
		waterfall: async (ctx) => {
			const v = ctx.localView(60);
			const p = pick(
				'Route',
				v.routes.map((r) => ({
					value: `${r.service} ${r.method} ${r.route}`,
					label: `${r.method} ${r.route} · ${r.service}`,
				})),
				ctx.id,
			);
			const r = v.routes.find((x) => `${x.service} ${x.method} ${x.route}` === p.value);
			if (!r) return view({ notes: [note(v.note ?? 'No requests in the last hour.', 'muted')] });
			const total = r.buckets.reduce((a, b) => a + b, 0) || 1;
			return view(
				{
					head: {
						name: `${r.method} ${r.route}`,
						status: `p50 ${Math.round(r.p50 ?? 0)} · p95 ${Math.round(r.p95 ?? 0)} · p99 ${Math.round(r.p99 ?? 0)} ms`,
						tone: (r.p95 ?? 0) > 1000 ? 'amber' : 'ok',
					},
					tables: [
						table(
							'Where its requests fall',
							[col('b', 'Time', true), col('n', 'Requests', true), col('share', 'Share', true)],
							r.buckets.map((n, i) =>
								row(
									String(i),
									bucketLabel(i),
									{ b: bucketLabel(i), n, share: `${Math.round((n / total) * 1000) / 10}%` },
									i >= 6 && n ? 'amber' : null,
								),
							),
							'No requests.',
						),
					],
				},
				p,
			);
		},
		map: async (ctx) => {
			const v = ctx.localView(60);
			return view({
				tables: [
					table(
						'Who serves what (last hour)',
						[
							col('svc', 'Service', true),
							col('n', 'Requests', true),
							col('routes', 'Routes', true),
							col('p95', 'p95', true),
							col('err', 'Errors', true),
						],
						v.services.map((s) =>
							row(
								s.service,
								s.service,
								{
									svc: s.service,
									n: s.count,
									routes: v.routes.filter((r) => r.service === s.service).length,
									p95: s.p95 === null ? '—' : `${Math.round(s.p95)} ms`,
									err: `${Math.round(s.errorRate * 1000) / 10}%`,
								},
								s.errorRate > 0.02 ? 'red' : null,
							),
						),
						v.note ?? 'No requests in the last hour.',
					),
				],
				notes: [
					note(
						'Edge → storefront and API; the API talks to MongoDB, Redis and Meilisearch (Run › Network › Connections shows those links live).',
						'muted',
					),
				],
			});
		},
		diagnose: async (ctx) => {
			const v = ctx.localView(60);
			const worst = [...v.routes].sort((a, b) => b.errorRate - a.errorRate || (b.p95 ?? 0) - (a.p95 ?? 0))[0];
			if (!worst) return view({ notes: [note(v.note ?? 'No requests to diagnose in the last hour.', 'muted')] });
			const m = await mongo(ctx).catch(() => null);
			const slowDb = (m?.slow ?? []).filter((s) => num(s['ms']) > 100);
			const reasons = [
				worst.errorRate > 0.02
					? `${Math.round(worst.errorRate * 100)}% of its requests fail with a server error: Watch › Issues has the error lines.`
					: '',
				(worst.p95 ?? 0) > 1000 ? `It is slow (p95 ${Math.round(worst.p95 ?? 0)} ms).` : '',
				slowDb.length
					? `MongoDB recorded ${slowDb.length} slow queries; the slowest took ${Math.max(...slowDb.map((s) => num(s['ms'])))} ms (Database monitor).`
					: m?.profile && num(rec(m.profile)['was']) === 0
						? 'The MongoDB profiler is off; turn it on in Database monitor to see slow queries.'
						: '',
			].filter(Boolean);
			return view({
				head: {
					name: `${worst.method} ${worst.route}`,
					status: reasons.length ? 'needs a look' : 'healthy',
					tone: reasons.length ? 'amber' : 'ok',
				},
				notes: (reasons.length ? reasons : ['Nothing stands out: errors under 2% and p95 under a second.']).map(
					(r) => note(r, reasons.length ? 'amber' : 'ok'),
				),
			});
		},
	},
};

/* ===== Database monitor (MongoDB profiler) ===== */

export const queriesScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		top: async (ctx) => {
			const m = await mongo(ctx);
			if (!m) return view({ notes: [note('The local MongoDB container is not running.', 'amber')] });
			const groups = new Map<
				string,
				{ ns: string; shape: string; n: number; total: number; max: number; plan: string }
			>();
			for (const s of m.slow) {
				const k = `${str(s['ns'])}|${str(s['shape'])}`;
				const g = groups.get(k) ?? {
					ns: str(s['ns']),
					shape: str(s['shape']),
					n: 0,
					total: 0,
					max: 0,
					plan: str(s['plan']),
				};
				g.n++;
				g.total += num(s['ms']);
				g.max = Math.max(g.max, num(s['ms']));
				groups.set(k, g);
			}
			const on = num(rec(m.profile)['was']) > 0;
			return view({
				head: {
					name: 'Slow queries (over 100 ms)',
					status: on ? 'profiler on' : 'profiler off',
					tone: on ? 'ok' : 'amber',
				},
				tables: [
					table(
						'Ranked by total time',
						[
							col('ns', 'Collection', true),
							col('shape', 'Query shape', true),
							col('n', 'Times', true),
							col('total', 'Total', true),
							col('max', 'Slowest', true),
							col('plan', 'Plan', true),
						],
						[...groups.values()]
							.sort((a, b) => b.total - a.total)
							.map((g, i) =>
								row(
									String(i),
									g.ns,
									{
										ns: g.ns,
										shape: g.shape,
										n: g.n,
										total: `${g.total} ms`,
										max: `${g.max} ms`,
										plan: g.plan,
									},
									/COLLSCAN/.test(g.plan) ? 'red' : null,
								),
							),
						on ? 'No query took over 100 ms.' : 'The profiler is off: turn it on to collect slow queries.',
						true,
					),
				],
				actions: [
					action(
						on ? 'Turn the profiler off' : 'Turn the profiler on (100 ms)',
						'profile',
						on ? 'ghost' : 'primary',
					),
				],
			});
		},
		explain: async (ctx) => {
			const m = await mongo(ctx);
			const slow = m?.slow ?? [];
			const p = pick(
				'Slow query',
				slow.map((s, i) => ({
					value: String(i),
					label: `${str(s['ns'])} · ${num(s['ms'])} ms · ${str(s['plan'])}`,
				})),
				ctx.id,
			);
			const s = slow[Number(p.value ?? -1)];
			if (!s)
				return view({
					notes: [note('No slow queries recorded. Turn the profiler on in the Top tab.', 'muted')],
				});
			const fields = Object.keys(JSON.parse(str(s['shape']) || '{}')).filter((k) => !k.startsWith('$'));
			const scan = /COLLSCAN/.test(str(s['plan']));
			return view(
				{
					head: {
						name: `${str(s['ns'])} · ${num(s['ms'])} ms`,
						status: str(s['plan']),
						tone: scan ? 'red' : 'ok',
					},
					facts: [
						fact('Operation', str(s['op'])),
						fact('Query shape', str(s['shape'])),
						fact('Index keys read', num(s['keys'])),
						fact('Documents read', num(s['docs'])),
						fact('Returned', num(s['returned'])),
						fact('When', when(str(s['at']))),
					],
					notes: [
						note(
							scan
								? `It reads the whole collection. An index on { ${fields.map((f) => `${f}: 1`).join(', ')} } would let it read only what it returns; add it in the adapter’s index list and the next release creates it.`
								: num(s['docs']) > num(s['returned']) * 10
									? 'It reads far more documents than it returns: a more selective index (or a compound one) would help.'
									: 'Its plan uses an index; time likely went to the data size returned.',
							scan ? 'red' : 'cy',
						),
					],
				},
				p,
			);
		},
	},
	forms: {
		profile: {
			read: async (ctx) => {
				const m = await mongo(ctx);
				const on = num(rec(m?.profile)['was']) > 0;
				return formTab(
					form({
						key: 'profile',
						title: on ? 'Turn the profiler off' : 'Turn the profiler on',
						submit: on ? 'Turn off' : 'Turn on',
						blocked: m ? null : 'The local MongoDB container is not running.',
						notes: [
							note(
								'Local database only. It records queries slower than 100 ms in system.profile.',
								'muted',
							),
						],
					}),
				);
			},
			async send(ctx) {
				const m = await mongo(ctx);
				if (!m) throw new VendorError('The local MongoDB container is not running.', 400);
				const on = num(rec(m.profile)['was']) === 0;
				const c = (
					await ctx.helper<{ containers: Array<{ name: string; state: string }> }>('GET', '/docker')
				).containers.find((x) => /mongo/.test(x.name) && x.state === 'running');
				await ctx.helper('POST', '/inspect/mongo/profile', { container: c?.name, db: m.db, on });
				return {
					message: `MongoDB profiler ${on ? 'on (100 ms)' : 'off'} for ${m.db}`,
					productId: null,
					follow: [],
				};
			},
		},
	},
};

/* ===== Shopper experience (Cloudflare Web Analytics) ===== */

export const rumScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		vitals: async (ctx) => {
			const a = await accountOf(ctx);
			const sites = (await cfAll(`/accounts/${a}/rum/site_info/list`, ctx.key)) ?? [];
			const site = sites.find((s) =>
				ctx.zones.some((z) => str(rec(s['ruleset'])['zone_name']) === z || str(s['host']).endsWith(z)),
			);
			if (!site)
				return view({
					notes: [
						note(
							'Cloudflare Web Analytics is off for this domain. Turning it on is free (Cloudflare › Analytics › Web Analytics); real shoppers’ speed fills this tab after that. The cookie banner already lets shoppers say no to analytics.',
							'amber',
						),
					],
				});
			const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
			const data = await graph(
				ctx,
				`query($a: String!, $s: String!, $since: Time!) { viewer { accounts(filter: {accountTag: $a}) { rumWebVitalsEventsAdaptiveGroups(limit: 20, filter: {siteTag: $s, datetime_geq: $since}, orderBy: [count_DESC]) { count dimensions { requestPath } quantiles { largestContentfulPaintP75 cumulativeLayoutShiftP75 interactionToNextPaintP75 } } } } }`,
				{ a, s: str(site['site_tag']), since },
			);
			const rows = arr(rec(arr(rec(data?.['viewer'])['accounts'])[0])['rumWebVitalsEventsAdaptiveGroups']).map(
				rec,
			);
			return view({
				tables: [
					table(
						'Pages by real shoppers, last 7 days (75th percentile)',
						[
							col('page', 'Page', true),
							col('n', 'Visits', true),
							col('lcp', 'Largest paint', true),
							col('cls', 'Layout shift', true),
							col('inp', 'Interaction', true),
						],
						rows.map((r, i) => {
							const q = rec(r['quantiles']);
							return row(
								String(i),
								str(rec(r['dimensions'])['requestPath']),
								{
									page: str(rec(r['dimensions'])['requestPath']),
									n: num(r['count']),
									lcp: `${Math.round(num(q['largestContentfulPaintP75']) / 1000) / 1000} s`,
									cls: Math.round(num(q['cumulativeLayoutShiftP75']) * 1000) / 1000,
									inp: `${Math.round(num(q['interactionToNextPaintP75']) / 1000)} ms`,
								},
								num(q['largestContentfulPaintP75']) > 2_500_000 ? 'amber' : null,
							);
						}),
						data
							? 'No visits measured yet.'
							: 'Cloudflare did not return Web Analytics with this key (it needs Account Analytics read).',
					),
				],
			});
		},
		errors: async () =>
			view({
				notes: [
					note(
						'Errors in shoppers’ browsers need the shop’s own error beacon (sent only with analytics consent, no personal data); it comes with the storefront’s RUM chunk. Cloudflare Web Analytics measures speed, not errors.',
						'muted',
					),
				],
			}),
	},
};

/* ===== Health: what fails ===== */

export const healthMoreScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		failing: async (ctx) => {
			const [h, d] = await Promise.all([
				ctx.helper<Record<string, unknown>>('GET', '/shop-health').catch(() => null),
				ctx
					.helper<{ containers: Array<{ name: string; state: string; status: string }> }>('GET', '/docker')
					.catch(() => null),
			]);
			if (!h || !d) return view({ notes: [helperDown] });
			const down = d.containers.filter((c) => c.state !== 'running' || /unhealthy/.test(c.status));
			const api = rec(h['stack']);
			const detail = rec(api['detail']);
			const failing = Object.entries(rec(detail['checks'] ?? detail)).filter(
				([, v]) => !/ok|up|true/i.test(JSON.stringify(v)),
			);
			return view({
				head: {
					name: 'What is failing now',
					status: down.length || failing.length ? `${down.length + failing.length} failing` : 'nothing',
					tone: down.length || failing.length ? 'red' : 'ok',
				},
				tables: [
					table(
						'Containers down or unhealthy',
						[col('name', 'Container', true), col('status', 'Now')],
						down.map((c) => row(c.name, c.name, { name: c.name, status: c.status }, 'red')),
						'Every container is up and healthy.',
					),
					table(
						'Shop API checks failing',
						[col('what', 'Check'), col('detail', 'Says', true)],
						failing.map(([k, v]) => row(k, k, { what: k, detail: JSON.stringify(v).slice(0, 160) }, 'red')),
						'Every API check passes.',
					),
				],
				notes: [
					note(
						'When Redis is down the shop still sells: carts and sessions fall back, queued jobs wait, and the alert goes to the owner (Watch › Alerts).',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Uptime and journeys ===== */

async function probe(url: string): Promise<{ status: number; ms: number; size: number; error: string }> {
	const t0 = performance.now();
	try {
		const r = await fetch(url, {
			headers: { 'user-agent': 'release-console-uptime' },
			signal: AbortSignal.timeout(15_000),
			redirect: 'follow',
		});
		const b = await r.arrayBuffer();
		return { status: r.status, ms: Math.round(performance.now() - t0), size: b.byteLength, error: '' };
	} catch (err) {
		return { status: 0, ms: Math.round(performance.now() - t0), size: 0, error: (err as Error).message };
	}
}

export const uptimeScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		checks: async (ctx) => {
			const envs = ctx.repo.environments.filter((e) => e.domains[0] && e.domains[0] !== 'localhost');
			const targets = envs.flatMap((e) =>
				[`https://${e.domains[0]}/`, `https://${e.domains[0]}/robots.txt`].map((u) => ({
					env: e.label,
					url: u,
				})),
			);
			const results = await Promise.all(
				targets.map(async (t) => ({ ...t, r: await probe(t.url), tls: await checkHost(new URL(t.url).host) })),
			);
			const h = await ctx.helper<Record<string, unknown>>('GET', '/shop-health').catch(() => null);
			return view({
				tables: [
					table(
						'Checked now from this Mac',
						[
							col('env', 'Where'),
							col('url', 'Address', true),
							col('status', 'Answer', true),
							col('ms', 'Time', true),
							col('cert', 'Certificate until', true),
						],
						[
							...results.map((x) =>
								row(
									x.url,
									x.url,
									{
										env: x.env,
										url: x.url,
										status: x.r.status || x.r.error,
										ms: `${x.r.ms} ms`,
										cert: when(x.tls.expiresOn),
									},
									x.r.status >= 200 && x.r.status < 400 ? 'ok' : 'red',
								),
							),
							row(
								'local',
								'local',
								{
									env: 'Local',
									url: 'api-local…/health/ready',
									status: str(rec(h?.['stack'])['status']) || 'not running',
									ms: '',
									cert: '',
								},
								str(rec(h?.['stack'])['status']) === 'ok' ? 'ok' : 'muted',
							),
						],
						'Nothing to check.',
					),
				],
				notes: [
					note(
						'Checks from three regions every minute are DigitalOcean uptime checks (DigitalOcean › Monitoring and uptime › Uptime); this tab checks from this Mac each time it opens.',
						'muted',
					),
				],
			});
		},
		journey: async (ctx) => {
			const envs = ctx.repo.environments.filter((e) => e.domains[0] && e.domains[0] !== 'localhost');
			const p = pick(
				'Where',
				envs.map((e) => ({ value: e.name, label: `${e.label} · ${e.domains[0]}` })),
				ctx.id,
			);
			const env = envs.find((e) => e.name === p.value);
			if (!env) return view({ notes: [note('No environment with a domain to walk through yet.', 'muted')] });
			const base = `https://${env.domains[0]}`;
			const steps: Array<[string, string]> = [
				['Home', '/'],
				['A category', '/en/sarees'],
				['Search', '/api/search/suggest?q=silk'],
				['Cart', '/en/cart'],
				['Checkout page', '/en/checkout'],
			];
			const done: Array<{ name: string; path: string; r: Awaited<ReturnType<typeof probe>> }> = [];
			for (const [name, path] of steps) done.push({ name, path, r: await probe(`${base}${path}`) });
			const total = done.reduce((a, d) => a + d.r.ms, 0);
			const broken = done.find((d) => !(d.r.status >= 200 && d.r.status < 400));
			return view(
				{
					head: {
						name: `Shopper journey on ${env.label}`,
						status: broken ? `stops at ${broken.name}` : `${total} ms in all`,
						tone: broken ? 'red' : 'ok',
					},
					tables: [
						table(
							'Each step, walked now',
							[
								col('n', 'Step'),
								col('path', 'Page', true),
								col('status', 'Answer', true),
								col('ms', 'Time', true),
								col('size', 'Size', true),
							],
							done.map((d) =>
								row(
									d.path,
									d.name,
									{
										n: d.name,
										path: d.path,
										status: d.r.status || d.r.error,
										ms: `${d.r.ms} ms`,
										size: bytes(d.r.size),
									},
									d.r.status >= 200 && d.r.status < 400 ? 'ok' : 'red',
								),
							),
							'No steps.',
						),
					],
					notes: [
						note(
							'It stops before paying: no order is made. Until the new shop goes live the domain still serves the old site, so some steps answer 404.',
							'muted',
						),
					],
				},
				p,
			);
		},
	},
};

/* ===== Service goals ===== */

export const sloScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		budget: async (ctx) => {
			const series = ctx.localRequests(7 * 24 * 60);
			const req = series.reduce((a, r) => a + r[3], 0);
			const err = series.reduce((a, r) => a + r[2] * r[3], 0);
			const fast = series.filter((r) => (r[1] ?? 0) < 1000).length;
			const avail = req ? 1 - err / req : 1;
			const budget = 0.005 * req;
			const spent = budget ? err / budget : 0;
			return view({
				head: {
					name: 'Service goals, last 7 days (local)',
					status:
						spent >= 1
							? 'budget spent: risky releases pause'
							: `${Math.round((1 - spent) * 100)}% of the error budget left`,
					tone: spent >= 1 ? 'red' : spent > 0.5 ? 'amber' : 'ok',
				},
				tables: [
					table(
						'Goals',
						[col('goal', 'Goal'), col('target', 'Target', true), col('now', 'Now', true)],
						[
							row(
								'a',
								'Availability',
								{
									goal: 'Requests without a server error',
									target: '99.5%',
									now: req ? `${Math.round(avail * 10000) / 100}%` : 'no traffic yet',
								},
								avail < 0.995 ? 'red' : 'ok',
							),
							row(
								's',
								'Speed',
								{
									goal: 'Minutes with p95 under 1 s',
									target: '99%',
									now: series.length
										? `${Math.round((fast / series.length) * 1000) / 10}%`
										: 'no traffic yet',
								},
								series.length && fast / series.length < 0.99 ? 'amber' : 'ok',
							),
						],
						'No goals.',
					),
				],
				notes: [
					note(
						'Staging and production get the same goals from their own request data once their servers report to the console.',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Business dashboard ===== */

export const dashboardsScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		business: async (ctx) => {
			const [m, d] = await Promise.all([
				mongo(ctx).catch(() => null),
				ctx
					.helper<{ containers: Array<{ name: string; state: string; status: string }> }>('GET', '/docker')
					.catch(() => null),
			]);
			const series = ctx.localRequests(24 * 60);
			const orders = m?.orders ?? [];
			return view({
				stats: [
					stat(
						'Orders, 30 days',
						orders.reduce((a, o) => a + o.n, 0),
						m ? 'local database' : 'database not running',
					),
					stat(
						'Takings, 30 days',
						`₹${Math.round(orders.reduce((a, o) => a + o.inr, 0)).toLocaleString('en-IN')}`,
					),
					stat(
						'Requests, 24 h',
						series.reduce((a, r) => a + r[3], 0),
					),
					stat(
						'Containers up',
						d
							? `${d.containers.filter((c) => c.state === 'running').length} of ${d.containers.length}`
							: '—',
					),
				],
				tables: [
					table(
						'Orders by day',
						[col('day', 'Day', true), col('n', 'Orders', true), col('inr', 'Takings', true)],
						[...orders]
							.reverse()
							.map((o) =>
								row(o._id, o._id, {
									day: o._id,
									n: o.n,
									inr: `₹${Math.round(o.inr).toLocaleString('en-IN')}`,
								}),
							),
						'No orders in the last 30 days.',
					),
					table(
						'Payments by state, 30 days',
						[col('s', 'State'), col('n', 'Payments', true)],
						arr(rec(m ?? {})['payments'])
							.map(rec)
							.map((p) =>
								row(str(p['_id']), str(p['_id']), { s: str(p['_id']) || 'unknown', n: num(p['n']) }),
							),
						'No payments yet.',
					),
				],
			});
		},
	},
};

/* ===== Shop › Payments ===== */

export const paymentsScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		health: async (ctx) => {
			const [m, ccav, paypal] = await Promise.all([
				mongo(ctx).catch(() => null),
				checkHost('secure.ccavenue.com'),
				checkHost('api-m.paypal.com'),
			]);
			const stuck = num(rec(m ?? {})['stuckAttempts']);
			return view({
				tables: [
					table(
						'Gateways, checked now',
						[col('g', 'Gateway'), col('host', 'Address', true), col('ok', 'Reachable')],
						[
							row(
								'ccav',
								'CCAvenue',
								{ g: 'CCAvenue (INR)', host: 'secure.ccavenue.com', ok: ccav.ok ? 'yes' : ccav.error },
								ccav.ok ? 'ok' : 'red',
							),
							row(
								'pp',
								'PayPal',
								{
									g: 'PayPal (foreign)',
									host: 'api-m.paypal.com',
									ok: paypal.ok ? 'yes' : paypal.error,
								},
								paypal.ok ? 'ok' : 'red',
							),
						],
						'No gateways.',
					),
					table(
						'Payments by state, 30 days (local)',
						[col('s', 'State'), col('n', 'Payments', true)],
						arr(rec(m ?? {})['payments'])
							.map(rec)
							.map((p) =>
								row(str(p['_id']), str(p['_id']), { s: str(p['_id']) || 'unknown', n: num(p['n']) }),
							),
						'No payments yet.',
					),
				],
				facts: [fact('Stuck payment attempts (pending over 30 min)', stuck, stuck ? 'red' : 'ok')],
				notes: [
					note(
						'Webhook deliveries are recorded once the CCAvenue adapter is switched on with its UAT keys (waiting on HDFC).',
						'muted',
					),
				],
			});
		},
		reconcile: async () =>
			view({
				notes: [
					note(
						'Daily reconciliation compares our orders with the gateway’s settlement report; it starts once CCAvenue sends settlement files (after go-live).',
						'muted',
					),
				],
			}),
	},
};

/* ===== Governance ===== */

export const accessScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const m = await mongo(ctx).catch(() => null);
			const sessions = arr(rec(m ?? {})['sessions']).map(rec);
			return view({
				tables: [
					table(
						'Keys this console holds',
						[
							col('label', 'Key'),
							col('kind', 'Kind'),
							col('state', 'State'),
							col('until', 'Expires', true),
						],
						ctx.keyRefs.map((k) =>
							row(
								k.id,
								k.label,
								{
									label: k.label,
									kind: k.kind,
									state: k.state,
									until: k.expiresAt
										? `${when(k.expiresAt)} (${ago(k.expiresAt).replace(' ago', '')})`
										: 'no expiry',
								},
								k.state === 'expired'
									? 'red'
									: k.expiresAt && Date.parse(k.expiresAt) - Date.now() < 14 * 86_400_000
										? 'amber'
										: null,
							),
						),
						'No keys.',
					),
					table(
						'Admin accounts (local shop)',
						[col('email', 'Account', true), col('status', 'State'), col('last', 'Last sign-in', true)],
						arr(rec(m ?? {})['admins'])
							.map(rec)
							.map((a, i) =>
								row(String(i), str(a['email']), {
									email: str(a['email']),
									status: str(a['status']) || 'active',
									last: ago(str(a['lastLoginAt'])),
								}),
							),
						m ? 'No admin accounts.' : 'The local database is not running.',
					),
					table(
						'Live sessions (local shop)',
						[col('kind', 'Kind'), col('n', 'Sessions', true)],
						sessions.map((s) =>
							row(str(s['_id']), str(s['_id']), { kind: str(s['_id']) || 'unknown', n: num(s['n']) }),
						),
						'No live sessions.',
					),
					table(
						'SSH sign-in list (all servers)',
						[col('email', 'Person', true)],
						(ctx.repo as unknown as { sshEmails?: string[] }).sshEmails?.map((e) =>
							row(e, e, { email: e }),
						) ?? [],
						'Set on DigitalOcean › Droplets.',
					),
				],
				notes: [
					note(
						'GitHub collaborators, Cloudflare members (Cloudflare › Manage account) and DigitalOcean team members are on their own screens; Infisical members on Run › Secrets.',
						'muted',
					),
				],
			});
		},
	},
};

export const auditScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		list: async (ctx) => {
			const log = ctx.auditLog(500);
			return view({
				stats: [
					stat('Entries', log.length),
					stat(
						'With the PIN, today',
						log.filter((e) => e.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
					),
				],
				tables: [
					table(
						'Every action in this console',
						[col('at', 'When', true), col('what', 'Action', true), col('detail', 'Detail')],
						log.map((e, i) =>
							row(
								String(i),
								e.action,
								{ at: when(e.at), what: e.action, detail: e.detail.slice(0, 300) },
								/fail|refused/.test(e.action) ? 'red' : null,
							),
						),
						'Nothing recorded yet.',
					),
				],
				notes: [
					note(
						'Everything that changed something went through the PIN; the console runs on this Mac only, so “from where” is this Mac.',
						'muted',
					),
				],
			});
		},
	},
};

export const privacyScreen: ProductScreen = {
	vendor: 'local',
	tabs: {
		queue: async (ctx) => {
			const m = await mongo(ctx).catch(() => null);
			const consent = arr(rec(m ?? {})['consent']).map(rec);
			return view({
				tables: [
					table(
						'Cookie consent, last 30 days (local)',
						[col('d', 'Choice'), col('n', 'Times', true)],
						consent.map((c) =>
							row(str(c['_id']), str(c['_id']), { d: str(c['_id']) || 'recorded', n: num(c['n']) }),
						),
						'No consent recorded yet.',
					),
				],
				notes: [
					note(
						'Requests to see or delete one’s data, with their legal deadline, and the breach register arrive with the privacy chunk (Chunk K). Consent totals are live now.',
						'muted',
					),
				],
			});
		},
	},
};

/* ===== Cache and CDN (Cloudflare) ===== */

export const cdnScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		stats: async (ctx) => {
			const z = await zoneOf(ctx);
			const rows = await traffic({ ...ctx, range: '7d' }, z);
			if (!rows) return view({ notes: [noAnalytics], actions: [action('Purge', 'purge', 'primary')] });
			const req = rows.reduce((a, r) => a + r.requests, 0);
			const cached = rows.reduce((a, r) => a + r.cached, 0);
			const saved = rows.reduce((a, r) => a + r.cachedBytes, 0);
			const s = seriesOf(rows, 'Hit rate', '%', (r) => (r.requests ? (r.cached / r.requests) * 100 : 0));
			return view({
				stats: [
					stat('Hit rate, 7 days', req ? `${Math.round((cached / req) * 1000) / 10}%` : '—'),
					stat('Bandwidth saved', bytes(saved)),
					stat('Requests', req.toLocaleString('en-IN')),
				],
				tables: [
					table(
						'By day',
						[col('d', 'Day', true), col('hit', 'Hit rate', true)],
						s.points.map(([t, v]) =>
							row(String(t), String(t), {
								d: new Date(t * 1000).toISOString().slice(0, 10),
								hit: `${v}%`,
							}),
						),
						'No traffic.',
					),
				],
				actions: [action('Purge', 'purge', 'primary')],
			});
		},
	},
	forms: {
		purge: {
			read: async () =>
				formTab(
					form({
						key: 'purge',
						title: 'Purge by address or folder',
						submit: 'Purge',
						fields: [
							field('what', 'What', 'select', {
								value: 'files',
								options: [
									option('files', 'These addresses'),
									option('prefixes', 'Everything under a folder'),
									option('everything', 'Everything'),
								],
							}),
							field('list', 'Addresses or folders', 'textarea'),
						],
					}),
				),
			async send(ctx, w) {
				const op = cfCacheScreen.forms?.['op'];
				if (!op) throw new VendorError('Purge is not available.', 500);
				return op.send(ctx, w);
			},
		},
	},
};
