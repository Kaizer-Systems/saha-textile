import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
	type Branches,
	type ContainerStat,
	type DockerSnapshot,
	type Job,
	type JobLine,
	type LocalAction,
	PIPELINE_STAGES,
	type PipelineStage,
} from '@saha-textile/release-console-contracts';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { formatBytes } from './format';
import { Gauge, LocalGate, SparkLine, formatRate, levelColour, percent } from './local-parts';
import { type Trouble, TroubleSteps, troubleFor } from './trouble';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { BranchPicker } from '../shared/branch-picker';
import { BrandLogo, Icon, STAGE_ICONS, serviceLogo } from '../shared/icons';
import { Loading } from '../shared/loading';

const WINDOWS: [number, string][] = [
	[15, '15 min'],
	[60, '1 hour'],
	[1440, '24 hours'],
	[10080, '7 days'],
];

/** Rates per second between two Docker readings, by container. */
export function containerRates(
	prev: DockerSnapshot | null,
	now: DockerSnapshot,
): Map<string, { rx: number | null; tx: number | null; read: number | null; write: number | null }> {
	const seconds = prev ? (Date.parse(now.at) - Date.parse(prev.at)) / 1000 : 0;
	const before = new Map((prev?.stats ?? []).map((s) => [s.name, s]));
	const r = (a: number | null | undefined, b: number | null | undefined) =>
		seconds > 0 && typeof a === 'number' && typeof b === 'number' && b >= a ? (b - a) / seconds : null;
	return new Map(
		now.stats.map((s) => {
			const p = before.get(s.name);
			return [
				s.name,
				{
					rx: r(p?.netRxBytes, s.netRxBytes),
					tx: r(p?.netTxBytes, s.netTxBytes),
					read: r(p?.blockReadBytes, s.blockReadBytes),
					write: r(p?.blockWriteBytes, s.blockWriteBytes),
				},
			];
		}),
	);
}

/* ======================================================================= Server */

/** Run › Server, Metrics tab, for an environment on this computer: the Mac itself. */
@Component({
	selector: 'rc-server-screen',
	imports: [Loading, LocalGate, Gauge, SparkLine, Icon, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-local-gate>
			@if (mac.data(); as m) {
				<div class="rc-g3">
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-brand-logo
									name="simple-icons/apple"
									color="#d9f4ff"
									[size]="13"
								/>
								This Mac · now
							</span>
						</div>
						<div class="rc-row">
							<rc-gauge
								[value]="m.cpu?.used ?? 0"
								label="CPU"
								icon="tabler/cpu"
							/>
							<rc-gauge
								[value]="memPct()"
								label="Memory"
								icon="tabler/device-sd-card"
							/>
							<rc-gauge
								[value]="diskPct()"
								label="Start-up disk"
								icon="tabler/device-floppy"
							/>
						</div>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/gauge" />
								Load and memory
							</span>
						</div>
						<div class="rc-kv">
							<div>
								<span>Load (1, 5, 15 min)</span>
								<em>{{ m.load ? m.load.one + ' · ' + m.load.five + ' · ' + m.load.fifteen : '—' }}</em>
							</div>
							<div>
								<span>CPU cores</span>
								<em>{{ m.cpus ?? '—' }}</em>
							</div>
							<div>
								<span>Memory in use</span>
								<em>{{ bytes(m.memory.used) }} of {{ bytes(m.memory.total) }}</em>
							</div>
							<div>
								<span>Compressed · wired</span>
								<em>{{ bytes(m.memory.compressed) }} · {{ bytes(m.memory.wired) }}</em>
							</div>
							<div>
								<span>Swap in use</span>
								<em [class.amber]="m.swapUsed > 2 * 1024 ** 3">{{ bytes(m.swapUsed) }}</em>
							</div>
							<div>
								<span>Disk free</span>
								<em [class.red]="diskPct() >= 90">
									{{ bytes(m.disk?.free ?? null) }} of {{ bytes(m.disk?.total ?? null) }}
								</em>
							</div>
						</div>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-brand-logo
									name="logos/docker-icon"
									[size]="14"
								/>
								Docker on this Mac
							</span>
						</div>
						@if (docker.data(); as d) {
							<div class="rc-kv">
								<div>
									<span>Docker</span>
									<em
										[class.ok]="d.reachable"
										[class.red]="!d.reachable"
									>
										{{ d.reachable ? 'running · ' + d.version : 'not running' }}
									</em>
								</div>
								<div>
									<span>Its virtual machine</span>
									<em>{{ d.cpus ?? '—' }} CPUs · {{ bytes(d.memoryTotal) }}</em>
								</div>
								<div>
									<span>Saha Textile containers</span>
									<em>{{ running(d) }} running of {{ d.containers.length }}</em>
								</div>
								<div>
									<span>Their memory</span>
									<em>{{ bytes(sum(d.stats, 'memoryBytes')) }}</em>
								</div>
								<div>
									<span>Their CPU</span>
									<em>{{ sum(d.stats, 'cpuPercent').toFixed(1) }}%</em>
								</div>
							</div>
						} @else {
							<rc-loading what="Reading Docker…" />
						}
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/chart-line" />
							History · every 5 seconds, minute averages beyond 2 hours
						</span>
						<div class="rc-states">
							@for (w of windows; track w[0]) {
								<button
									type="button"
									class="rc-chip"
									[class.on]="minutes() === w[0]"
									(click)="minutes.set(w[0])"
								>
									{{ w[1] }}
								</button>
							}
						</div>
					</div>
					<div class="rc-g2">
						@for (s of charts(); track s.label) {
							<div>
								<span class="rc-label">
									<rc-icon [name]="chartIcon(s.label)" />
									{{ s.label }} · now {{ s.now }}
								</span>
								<rc-spark-line
									[values]="s.values"
									[colour]="s.colour"
									[max]="s.max"
								/>
							</div>
						}
					</div>
					@if (!charts().length || !charts()[0]?.values?.length) {
						<p class="rc-note">
							The history fills as the console runs; the first points appear within seconds.
						</p>
					}
				</div>
			} @else if (mac.isError()) {
				<p class="rc-p red">{{ mac.error().message }}</p>
			} @else {
				<rc-loading what="Reading this Mac…" />
			}
		</rc-local-gate>
	`,
})
export class ServerScreen {
	protected readonly logo = serviceLogo;
	/** A history chart's icon. */
	protected chartIcon(label: string): string {
		if (label === 'CPU') return 'tabler/cpu';
		if (label === 'Memory') return 'tabler/device-sd-card';
		return label.endsWith('out') ? 'tabler/upload' : 'tabler/download';
	}
	private readonly api = inject(ConsoleApi);
	protected readonly windows = WINDOWS;
	protected readonly minutes = signal(60);
	protected readonly bytes = formatBytes;
	protected readonly mac = injectQuery(() => ({
		queryKey: ['mac'],
		queryFn: () => this.api.mac(),
		refetchInterval: 5000,
	}));
	protected readonly docker = injectQuery(() => ({
		queryKey: ['docker'],
		queryFn: () => this.api.docker(),
		refetchInterval: 5000,
	}));
	private readonly hist = injectQuery(() => ({
		queryKey: ['history', 'mac', this.minutes()],
		queryFn: () => this.api.history('mac', ['cpu', 'mem_used', 'net_rx_rate', 'net_tx_rate'], this.minutes()),
		refetchInterval: this.minutes() <= 60 ? 5000 : 60_000,
	}));
	protected readonly memPct = computed(() => percent(this.mac.data()?.memory.used, this.mac.data()?.memory.total));
	protected readonly diskPct = computed(() => percent(this.mac.data()?.disk?.used, this.mac.data()?.disk?.total));
	protected readonly charts = computed(() => {
		const series = this.hist.data() ?? [];
		const pick = (name: string) => series.find((s) => s.name === name)?.points.map(([, v]) => v) ?? [];
		const last = (v: number[]) => v[v.length - 1];
		const total = this.mac.data()?.memory.total ?? undefined;
		return [
			{
				label: 'CPU',
				values: pick('cpu'),
				colour: levelColour(last(pick('cpu')) ?? 0),
				max: 100,
				now: `${(last(pick('cpu')) ?? 0).toFixed(1)}%`,
			},
			{
				label: 'Memory',
				values: pick('mem_used'),
				colour: '#ffb547',
				max: total,
				now: formatBytes(last(pick('mem_used')) ?? null),
			},
			{
				label: 'Network in',
				values: pick('net_rx_rate'),
				colour: '#5dffa8',
				max: undefined,
				now: formatRate(last(pick('net_rx_rate'))),
			},
			{
				label: 'Network out',
				values: pick('net_tx_rate'),
				colour: '#c4b5fd',
				max: undefined,
				now: formatRate(last(pick('net_tx_rate'))),
			},
		];
	});
	protected running(d: DockerSnapshot): number {
		return d.containers.filter((c) => c.state === 'running').length;
	}
	protected sum(stats: ContainerStat[], key: 'memoryBytes' | 'cpuPercent'): number {
		return stats.reduce((n, s) => n + (s[key] ?? 0), 0);
	}
}

/* ======================================================================= Infrastructure */

/** Run › Infrastructure: every Saha Textile container on this Mac with its live figures and history. */
@Component({
	selector: 'rc-infra-screen',
	imports: [Loading, LocalGate, SparkLine, Icon, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-local-gate>
			@if (docker.data(); as d) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-brand-logo
								name="logos/docker-icon"
								[size]="14"
							/>
							Containers on this Mac · read {{ when(d.at) }} · every 5 s
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Container</th>
									<th>State</th>
									<th>CPU</th>
									<th>Memory</th>
									<th>Network in · out</th>
									<th>Disk read · write</th>
									<th>Processes</th>
								</tr>
							</thead>
							<tbody>
								@for (c of d.containers; track c.name) {
									@let s = stat(c.name);
									@let r = rates().get(c.name);
									<tr
										[class.on]="open() === c.name"
										(click)="open.set(open() === c.name ? null : c.name)"
									>
										<td>
											<span
												class="rc-dot"
												[class.ok]="c.state === 'running' && !c.status.includes('unhealthy')"
												[class.red]="c.state !== 'running' || c.status.includes('unhealthy')"
											></span>
											<b>
												<rc-brand-logo
													[name]="logo(c.name)"
													[size]="14"
													[label]="c.name"
												/>
											</b>
											<br />
											<span class="rc-mono">{{ c.image }}</span>
										</td>
										<td class="rc-mono">{{ c.status }}</td>
										<td>
											<span class="rc-bar">
												<i
													[class.amber]="(s?.cpuPercent ?? 0) >= 70"
													[class.red]="(s?.cpuPercent ?? 0) >= 90"
													[style.width.%]="bar(s?.cpuPercent ?? 0)"
												></i>
											</span>
											<span class="rc-mono">
												{{
													s?.cpuPercent === null || s?.cpuPercent === undefined
														? '—'
														: s.cpuPercent + '%'
												}}
											</span>
										</td>
										<td>
											<span class="rc-bar">
												<i [style.width.%]="bar(pct(s?.memoryBytes, s?.memoryLimitBytes))"></i>
											</span>
											<span class="rc-mono">{{ bytes(s?.memoryBytes ?? null) }}</span>
										</td>
										<td class="rc-mono">{{ rate(r?.rx) }} · {{ rate(r?.tx) }}</td>
										<td class="rc-mono">{{ rate(r?.read) }} · {{ rate(r?.write) }}</td>
										<td class="rc-mono">{{ s?.pids ?? '—' }}</td>
									</tr>
								} @empty {
									<tr><td colspan="7">No Saha Textile containers on this Mac.</td></tr>
								}
							</tbody>
						</table>
					</div>
					<p class="rc-note">Click a container for its last hour.</p>
				</div>
				@if (open(); as name) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-brand-logo
									[name]="logo(name)"
									[size]="14"
								/>
								{{ name }} · last hour
							</span>
						</div>
						<div class="rc-g2">
							<div>
								<span class="rc-label">
									<rc-icon name="tabler/cpu" />
									CPU %
								</span>
								<rc-spark-line [values]="series('cpu')" />
							</div>
							<div>
								<span class="rc-label">
									<rc-icon name="tabler/device-sd-card" />
									Memory
								</span>
								<rc-spark-line
									[values]="series('mem')"
									colour="#ffb547"
								/>
							</div>
							<div>
								<span class="rc-label">
									<rc-icon name="tabler/download" />
									Network in
								</span>
								<rc-spark-line
									[values]="series('net_rx_rate')"
									colour="#5dffa8"
								/>
							</div>
							<div>
								<span class="rc-label">
									<rc-icon name="tabler/device-floppy" />
									Disk write
								</span>
								<rc-spark-line
									[values]="series('block_write_rate')"
									colour="#c4b5fd"
								/>
							</div>
						</div>
					</div>
				}
			} @else if (docker.isError()) {
				<p class="rc-p red">{{ docker.error().message }}</p>
			} @else {
				<rc-loading what="Reading Docker…" />
			}
		</rc-local-gate>
	`,
})
export class InfraScreen {
	protected readonly logo = serviceLogo;
	private readonly api = inject(ConsoleApi);
	protected readonly when = when;
	protected readonly bytes = formatBytes;
	protected readonly rate = formatRate;
	protected readonly pct = percent;
	protected readonly open = signal<string | null>(null);
	private readonly prev = signal<DockerSnapshot | null>(null);
	protected readonly docker = injectQuery(() => ({
		queryKey: ['docker'],
		queryFn: () => this.api.docker(),
		refetchInterval: 5000,
	}));
	private last: DockerSnapshot | null = null;
	protected readonly rates = computed(() => {
		const now = this.docker.data();
		return now ? containerRates(this.prev(), now) : new Map();
	});
	private readonly hist = injectQuery(() => ({
		queryKey: ['history', this.open()],
		queryFn: () =>
			this.api.history(`container:${this.open()}`, ['cpu', 'mem', 'net_rx_rate', 'block_write_rate'], 60),
		enabled: !!this.open(),
		refetchInterval: 5000,
	}));

	constructor() {
		effect(() => {
			const now = this.docker.data();
			if (now && now !== this.last) {
				this.prev.set(this.last);
				this.last = now;
			}
		});
	}

	protected stat(name: string): ContainerStat | undefined {
		return this.docker.data()?.stats.find((s) => s.name === name);
	}
	protected bar(pct: number): number {
		return Math.max(2, Math.min(100, pct));
	}
	protected series(name: string): number[] {
		return (
			this.hist
				.data()
				?.find((s) => s.name === name)
				?.points.map(([, v]) => v) ?? []
		);
	}
}

/* ======================================================================= Live logs */

export interface LogLine {
	time: string;
	level: 'err' | 'warn' | 'ok' | 'dim' | '';
	source: string;
	message: string;
	requestId: string;
}

/** One `docker logs --timestamps` line, reading the apps' JSON log lines where it can. */
export function readLogLine(raw: string): LogLine {
	const space = raw.indexOf(' ');
	const stamp = space > 0 ? raw.slice(0, space) : '';
	const rest = space > 0 ? raw.slice(space + 1) : raw;
	const time = /^\d{4}-\d\d-\d\dT(\d\d:\d\d:\d\d)/.exec(stamp)?.[1] ?? '';
	let level: LogLine['level'] = /\b(error|err|fatal|exception)\b/i.test(rest)
		? 'err'
		: /\bwarn(ing)?\b/i.test(rest)
			? 'warn'
			: '';
	let message = rest;
	let source = '';
	let requestId =
		/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b/.exec(rest)?.[1] ?? '';
	if (rest.startsWith('{')) {
		try {
			const j = JSON.parse(rest) as Record<string, unknown>;
			const lvl = String(j['level'] ?? j['severity'] ?? '').toLowerCase();
			level = /error|fatal/.test(lvl)
				? 'err'
				: /warn/.test(lvl)
					? 'warn'
					: /debug|verbose/.test(lvl)
						? 'dim'
						: '';
			message = String(j['message'] ?? j['msg'] ?? rest);
			source = String(j['context'] ?? j['kind'] ?? '');
			requestId = String(j['requestId'] ?? j['request_id'] ?? requestId);
			const status = Number(j['status']);
			if (Number.isFinite(status) && j['uri']) {
				message = `${String(j['method'] ?? '')} ${String(j['uri'])} → ${status} · ${String(j['request_time'] ?? '')}s`;
				source = 'edge';
				level = status >= 500 ? 'err' : status >= 400 ? 'warn' : '';
			}
		} catch {
			/* not JSON: keep the line as it is */
		}
	}
	return { time, level, source, message, requestId };
}

/** Run › Live logs: one container's log, followed live, filtered by words, errors or one request. */
@Component({
	selector: 'rc-tail-screen',
	imports: [Loading, LocalGate, Icon, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-local-gate>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/logs" />
						Live logs · this Mac's containers
					</span>
					<div class="rc-states">
						@for (n of [100, 300, 1000]; track n) {
							<button
								type="button"
								class="rc-chip"
								[class.on]="tail() === n"
								(click)="tail.set(n)"
							>
								{{ n }} lines
							</button>
						}
					</div>
				</div>
				<div class="rc-states">
					@for (c of containers(); track c) {
						<button
							type="button"
							class="rc-chip"
							[class.on]="container() === c"
							(click)="container.set(c)"
						>
							<rc-brand-logo
								[name]="logo(c)"
								[size]="13"
								[label]="c.replace('saha-textile-', '')"
							/>
						</button>
					}
				</div>
				<div class="rc-form">
					<label>
						Find
						<div class="rc-msearch">
							<input
								type="search"
								autocomplete="off"
								placeholder="words in the line"
								[value]="find()"
								(input)="find.set($any($event.target).value)"
							/>
						</div>
					</label>
					<label>
						Request
						<div class="rc-msearch">
							<input
								type="search"
								autocomplete="off"
								placeholder="request id"
								[value]="request()"
								(input)="request.set($any($event.target).value.trim())"
							/>
						</div>
					</label>
				</div>
				@if (logs.isError()) {
					<p class="rc-p red">{{ logs.error().message }}</p>
				} @else if (logs.isPending() && container()) {
					<rc-loading [what]="'Reading the log of ' + container() + '…'" />
				} @else if (container()) {
					<p class="rc-note">
						{{ shown().length }} of {{ lines().length }} lines{{
							mode() === 'follow' ? ' · following, every 3 s' : ''
						}}. Personal data is masked by the apps before it is logged.
					</p>
					<div class="rc-log">
						@for (l of shown(); track $index) {
							<div
								class="l"
								[class]="'l ' + l.level"
							>
								<span class="n">{{ l.time || $index + 1 }}</span>
								@if (l.source) {
									<span class="src">{{ l.source }}</span>
								}
								<span class="m">
									@if (l.requestId) {
										<button
											type="button"
											class="tag t-request"
											[attr.title]="'Show request ' + l.requestId"
											(click)="request.set(l.requestId)"
										>
											request
										</button>
									}
									{{ l.message }}
								</span>
							</div>
						}
					</div>
				} @else {
					<p class="rc-p muted">Choose a container.</p>
				}
			</div>
		</rc-local-gate>
	`,
})
export class TailScreen {
	protected readonly logo = serviceLogo;
	private readonly api = inject(ConsoleApi);
	readonly mode = input('follow');
	protected readonly container = signal<string>('');
	protected readonly tail = signal(300);
	protected readonly find = signal('');
	protected readonly request = signal('');
	private readonly docker = injectQuery(() => ({
		queryKey: ['docker'],
		queryFn: () => this.api.docker(),
		refetchInterval: 15_000,
	}));
	protected readonly containers = computed(() => (this.docker.data()?.containers ?? []).map((c) => c.name));
	protected readonly logs = injectQuery(() => ({
		queryKey: ['logs', this.container(), this.tail()],
		queryFn: () => this.api.logs(this.container(), this.tail(), ''),
		enabled: !!this.container(),
		refetchInterval: this.mode() === 'follow' || this.mode() === 'errors' ? 3000 : false,
	}));
	protected readonly lines = computed(() => (this.logs.data()?.lines ?? []).map(readLogLine));
	protected readonly shown = computed(() => {
		const words = this.find().toLowerCase();
		const req = this.request();
		return this.lines().filter(
			(l) =>
				(this.mode() !== 'errors' || l.level === 'err' || l.level === 'warn') &&
				(!words || `${l.source} ${l.message}`.toLowerCase().includes(words)) &&
				(!req || l.requestId === req),
		);
	});

	constructor() {
		effect(() => {
			const names = this.containers();
			if (!this.container() && names.length)
				// names is not empty here, so the first name is always there.
				this.container.set(names.find((n) => n.includes('api')) ?? (names[0] as string));
		});
	}
}

/* ======================================================================= Health */

/** Watch › Health for this Mac: one tile per part, green, amber or red. */
@Component({
	selector: 'rc-health-screen',
	imports: [Loading, LocalGate, Icon, BrandLogo, TroubleSteps],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-local-gate>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/heartbeat" />
						Everything on this Mac · every 10 s
					</span>
				</div>
				@if (dockerPending()) {
					<rc-loading what="Reading Docker and the shop's health…" />
				}
				<div class="rc-tiles">
					@for (t of tiles(); track t.name) {
						<div
							class="rc-tile"
							[class]="'rc-tile ' + t.cls"
						>
							<b>
								<rc-brand-logo
									[name]="logo(t.name)"
									[size]="14"
									[label]="t.name"
								/>
							</b>
							<span>{{ t.state }}</span>
						</div>
					}
				</div>
				<p class="rc-note">
					Green: answering. Amber: running but not fully ready. Red: down or failing its check.
				</p>
				<rc-trouble-steps [trouble]="trouble()" />
			</div>
		</rc-local-gate>
	`,
})
export class HealthScreen {
	/** Nothing read yet: the tiles would be empty, so the screen says it is reading. */
	protected readonly dockerPending = computed(() => this.docker.isPending() || this.shop.isPending());
	/** Docker down, or the stack not answering: the steps to bring it back. */
	protected readonly trouble = computed<Trouble | null>(() => {
		const d = this.docker.data();
		if (d && !d.reachable) return 'docker';
		const stack = d?.containers.filter((c) => c.name.startsWith('saha-textile-stack-')) ?? [];
		if (d && (!stack.length || stack.some((c) => c.state !== 'running'))) return 'stack-down';
		const api = this.shop.data()?.stack;
		if (stack.length && this.shop.data() && (!api || (api.status ?? 500) >= 400)) return 'stack-down';
		return null;
	});
	/** Docker's own logo, or the product a container runs. */
	protected logo(name: string): string {
		return name === 'Docker' ? 'logos/docker-icon' : serviceLogo(name);
	}
	private readonly api = inject(ConsoleApi);
	private readonly docker = injectQuery(() => ({
		queryKey: ['docker'],
		queryFn: () => this.api.docker(),
		refetchInterval: 10_000,
	}));
	private readonly shop = injectQuery(() => ({
		queryKey: ['shop-health'],
		queryFn: () => this.api.shopHealth(),
		refetchInterval: 10_000,
	}));
	protected readonly tiles = computed(() => {
		const tiles: { name: string; state: string; cls: 'g' | 'a' | 'r' }[] = [];
		const d = this.docker.data();
		tiles.push({
			name: 'Docker',
			state: d?.reachable ? `running · ${d.version}` : 'not running',
			cls: d?.reachable ? 'g' : 'r',
		});
		for (const c of d?.containers ?? [])
			tiles.push({
				name: c.name.replace('saha-textile-', ''),
				state: c.status,
				cls:
					c.state !== 'running' || c.status.includes('unhealthy')
						? 'r'
						: c.status.includes('starting')
							? 'a'
							: 'g',
			});
		const s = this.shop.data();
		const ready = (label: string, a: { status?: number; body: unknown } | null | undefined) => {
			const body = a?.body && typeof a.body === 'object' ? (a.body as Record<string, unknown>) : {};
			const st = String(body['status'] ?? '');
			tiles.push({
				name: label,
				state: !a ? 'not running' : (a.status ?? 500) >= 400 ? `answered ${a.status}` : st || 'ok',
				cls: !a ? 'r' : (a.status ?? 500) >= 400 ? 'r' : st === 'degraded' ? 'a' : 'g',
			});
		};
		if (s) {
			ready('Shop API · pnpm dev', s.dev);
			ready(`Shop API · stack (:${s.stackPort})`, s.stack);
		}
		return tiles;
	});
}

/* ======================================================================= Live deploy */

interface StageView {
	stage: PipelineStage;
	cls: 'ok' | 'red' | 'run' | 'wait' | 'skip';
	time: string;
}

/** The lane of pipeline stages from a job's JSON events, in the brief's lane states. */
export function stageLane(
	job: Job | null,
	lines: JobLine[],
	plan: { from?: PipelineStage; only?: PipelineStage },
): StageView[] {
	const wanted = (s: PipelineStage) =>
		plan.only
			? s === plan.only
			: plan.from
				? PIPELINE_STAGES.indexOf(s) >= PIPELINE_STAGES.indexOf(plan.from)
				: true;
	const state = new Map<string, { status: string; seconds?: number }>();
	for (const l of lines) {
		const e = l.event;
		if (!e || typeof e['stage'] !== 'string' || typeof e['status'] !== 'string' || e['stage'] === 'run') continue;
		state.set(e['stage'], {
			status: e['status'],
			seconds: typeof e['seconds'] === 'number' ? e['seconds'] : undefined,
		});
	}
	return PIPELINE_STAGES.map((stage) => {
		const s = state.get(stage);
		const time = s?.seconds !== undefined ? `${Math.round(s.seconds)}s` : '';
		if (!wanted(stage)) return { stage, cls: 'skip', time: 'not in this run' };
		if (!s) return { stage, cls: 'wait', time: job?.status === 'running' ? 'waiting' : '' };
		if (s.status === 'passed') return { stage, cls: 'ok', time };
		if (s.status === 'failed') return { stage, cls: 'red', time: time || 'failed' };
		return {
			stage,
			cls: job?.status === 'running' ? 'run' : 'red',
			time: job?.status === 'running' ? 'running…' : 'stopped',
		};
	});
}

const STAGE_NAMES: Record<PipelineStage, string> = {
	checks: 'Checks (lint, tests, builds)',
	proof: 'Production proof (made-up keys)',
	images: 'Images to the local registry',
	release: 'Release folder from dev values',
	deploy: 'Deploy the local stack',
	record: 'Record the run',
};

/** Ship › Live deploy, Local tab: run the local pipeline and the stack from here, and watch it. */
@Component({
	selector: 'rc-deploy-screen',
	imports: [Loading, LocalGate, Icon, BrandLogo, TroubleSteps, BranchPicker],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-local-gate>
			@let lane = laneView();
			<div class="rc-g3 deploy">
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/route-2" />
							Pipeline
						</span>
					</div>
					<ul class="rc-lane">
						@for (s of lane; track s.stage) {
							<li [class]="s.cls">
								<span
									class="rc-dot"
									[class.ok]="s.cls === 'ok'"
									[class.red]="s.cls === 'red'"
									[class.cy]="s.cls === 'run'"
									[class.pulse]="s.cls === 'run'"
								></span>
								<span>
									<rc-icon [name]="stageIcons[s.stage]" />
									{{ stageNames[s.stage] }}
								</span>
								<span class="rc-mono">{{ s.time }}</span>
							</li>
						}
					</ul>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/rocket" />
							Release
						</span>
					</div>
					<div class="rc-reactor">
						<svg
							viewBox="0 0 240 240"
							aria-hidden="true"
						>
							<g [class.rc-spin]="running()">
								<circle
									cx="120"
									cy="120"
									r="112"
									fill="none"
									stroke="rgba(94,214,255,0.35)"
									stroke-width="1"
									stroke-dasharray="2 6"
								/>
							</g>
							<g [class.rc-spin-r]="running()">
								<circle
									cx="120"
									cy="120"
									r="102"
									fill="none"
									stroke="rgba(94,214,255,0.25)"
									stroke-width="6"
									stroke-dasharray="40 14 8 14"
								/>
							</g>
							<circle
								cx="120"
								cy="120"
								r="86"
								fill="none"
								stroke="rgba(94,214,255,0.12)"
								stroke-width="10"
							/>
							<circle
								cx="120"
								cy="120"
								r="86"
								fill="none"
								[attr.stroke]="reactorColour()"
								stroke-width="10"
								pathLength="100"
								[attr.stroke-dasharray]="progress() + ' 100'"
								transform="rotate(-90 120 120)"
							/>
							<text
								x="120"
								y="122"
								text-anchor="middle"
								fill="#d9f4ff"
								font-family="Chakra Petch, sans-serif"
								font-size="38"
								font-weight="600"
							>
								{{ progress() }}%
							</text>
							<text
								x="120"
								y="146"
								text-anchor="middle"
								fill="#7fa3b8"
								font-family="IBM Plex Mono, monospace"
								font-size="10.5"
							>
								{{ current()?.label ?? 'no run yet' }}
							</text>
						</svg>
					</div>
					<div class="rc-center">
						<b
							class="rc-big"
							[class.ok]="current()?.status === 'passed'"
							[class.red]="current()?.status === 'failed'"
						>
							{{ title() }}
						</b>
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/server" />
							Systems
						</span>
					</div>
					<div class="rc-kv">
						@for (k of systems(); track k[0]) {
							<div>
								<span>
									<rc-brand-logo
										[name]="systemLogo(k[0])"
										[size]="14"
										[label]="k[0]"
									/>
								</span>
								<em [class]="k[2]">{{ k[1] }}</em>
							</div>
						}
					</div>
					<div class="rc-label">
						<rc-icon name="tabler/list" />
						Events
					</div>
					<div class="rc-log">
						@for (e of events(); track $index) {
							<div
								class="l"
								[class]="'l ' + e.level"
							>
								<span class="n">{{ e.time }}</span>
								<span class="src">{{ e.stage }}</span>
								<span class="m">{{ e.text }}</span>
							</div>
						} @empty {
							<div class="l dim">
								<span class="n">—</span>
								<span class="m">Events of the run appear here.</span>
							</div>
						}
					</div>
				</div>
			</div>

			<div class="rc-g2">
				<form
					class="rc-panel"
					(submit)="start($event)"
				>
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/device-laptop" />
							Deploy to local · the same stages as GitHub
						</span>
					</div>
					<!-- On this computer the branch can change for one run (owner, 20 Nov); the run starts with git pull. -->
					@if (repository(); as repo) {
						<rc-branch-picker
							label="Branch"
							context="this run"
							[branches]="branchList()?.branches ?? []"
							[defaultBranch]="branchList()?.defaultBranch ?? null"
							[current]="branchList()?.current ?? null"
							[value]="branch()"
							[waitingText]="branchList()?.note || 'loading branches…'"
							[refreshing]="fetchingBranches()"
							(picked)="chosenBranch.set($event)"
							(refresh)="readBranches(repo, true)"
						/>
						<p class="rc-note">
							The run starts with a git pull of {{ branch() || 'this folder’s branch' }}: it fetches
							GitHub and fast-forwards when GitHub's copy is ahead. It never switches this folder's
							branch.
						</p>
					}
					<div class="rc-states">
						<button
							type="button"
							class="rc-chip"
							[class.on]="!plan().from && !plan().only"
							(click)="plan.set({})"
						>
							All stages
						</button>
						@for (s of stages; track s) {
							<button
								type="button"
								class="rc-chip"
								[class.on]="plan().from === s"
								(click)="plan.set({ from: s })"
							>
								From {{ s }}
							</button>
						}
					</div>
					<div class="rc-states">
						@for (s of stages; track s) {
							<button
								type="button"
								class="rc-chip"
								[class.on]="plan().only === s"
								(click)="plan.set({ only: s })"
							>
								Only {{ s }}
							</button>
						}
					</div>
					@if (checksBlocked()) {
						<div class="rc-banner amber small">
							<span class="rc-dot amber"></span>
							<div>
								<b>Checks would rebuild under your running dev servers ({{ busyServers() }}).</b>
								Stop them, or start from the proof stage.
							</div>
						</div>
					}
					<div class="rc-form">
						<label>
							PIN
							<div class="rc-msearch">
								<input
									#pin
									type="password"
									inputmode="numeric"
									maxlength="6"
									autocomplete="off"
									aria-label="Console PIN"
								/>
							</div>
						</label>
					</div>
					<div class="rc-row">
						<button
							type="submit"
							class="rc-btn primary"
							[disabled]="busy() || running()"
						>
							Start the run
						</button>
						@if (running()) {
							<button
								type="button"
								class="rc-btn danger"
								[disabled]="busy()"
								(click)="stop(pin.value)"
							>
								Stop the run
							</button>
						}
					</div>
					@if (message()) {
						<p class="rc-note">{{ message() }}</p>
						<rc-trouble-steps [trouble]="troubleFor(message())" />
					}
					<p class="rc-note">
						One run at a time. Proof uses made-up keys on purpose; the release and deploy stages use the
						real dev values from Infisical.
					</p>
				</form>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-brand-logo
								name="logos/docker-icon"
								[size]="14"
							/>
							The local stack
						</span>
					</div>
					<div class="rc-row">
						@for (a of stackActions; track a[0]) {
							<button
								type="button"
								class="rc-btn"
								[class.danger]="a[0] === 'stack-stop-apps'"
								[disabled]="busy() || running()"
								(click)="stackAction(a[0], stackPin.value)"
							>
								{{ a[1] }}
							</button>
						}
					</div>
					<div class="rc-form">
						<label>
							PIN
							<div class="rc-msearch">
								<input
									#stackPin
									type="password"
									inputmode="numeric"
									maxlength="6"
									autocomplete="off"
									aria-label="Console PIN for the stack"
								/>
							</div>
						</label>
					</div>
					<p class="rc-note">
						Stopping touches only the stack's own services; the search server that pnpm dev also uses keeps
						running.
					</p>
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/history" />
							Recent runs
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Run</th>
									<th>Started</th>
									<th>State</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								@if (jobs.isPending()) {
									<tr>
										<td colspan="4"><rc-loading what="Reading the runs on this Mac…" /></td>
									</tr>
								}
								@for (j of jobs.data() ?? []; track j.id) {
									<tr>
										<td>{{ j.label }}</td>
										<td class="rc-mono">{{ when(j.startedAt) }}</td>
										<td>
											<span
												class="rc-pill"
												[class.ok]="j.status === 'passed'"
												[class.red]="j.status === 'failed'"
												[class.cy]="j.status === 'running'"
												[class.muted]="j.status === 'stopped'"
											>
												{{ j.status }}
											</span>
										</td>
										<td>
											<button
												type="button"
												class="rc-btn ghost"
												(click)="watch(j.id)"
											>
												Show
											</button>
										</td>
									</tr>
								} @empty {
									<tr><td colspan="4">No runs since the helper started.</td></tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			@if (current(); as j) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/terminal-2" />
							Output · {{ j.label }}
						</span>
						<div class="rc-states">
							<button
								type="button"
								class="rc-chip"
								[class.on]="!raw()"
								(click)="raw.set(false)"
							>
								Events only
							</button>
							<button
								type="button"
								class="rc-chip"
								[class.on]="raw()"
								(click)="raw.set(true)"
							>
								Every line
							</button>
						</div>
					</div>
					<div class="rc-log">
						@for (l of output(); track l.seq) {
							<div
								class="l"
								[class]="'l ' + (l.stream === 'err' ? 'dim' : '')"
							>
								<span class="n">{{ l.seq }}</span>
								<span class="m">{{ l.text }}</span>
							</div>
						}
					</div>
				</div>
				@if (j.status === 'failed') {
					<rc-trouble-steps [trouble]="failedTrouble(j)" />
				}
			}
		</rc-local-gate>
	`,
})
export class DeployScreen {
	protected readonly troubleFor = troubleFor;
	/** A failed run's steps: from what its last lines say, or the general ones. */
	protected failedTrouble(j: Job): Trouble {
		return (
			troubleFor(
				j.lines
					.slice(-40)
					.map((l) => l.text)
					.join('\n'),
			) ?? 'run-failed'
		);
	}
	private readonly api = inject(ConsoleApi);
	private readonly queries = inject(QueryClient);
	private readonly router = inject(Router);
	protected readonly when = when;
	protected readonly stages = PIPELINE_STAGES;
	protected readonly stageNames = STAGE_NAMES;
	protected readonly stageIcons = STAGE_ICONS;
	/** The logo beside a system on the Systems list. */
	protected systemLogo(name: string): string {
		if (name === 'Mac helper') return 'simple-icons/apple';
		if (name.startsWith('Shop API')) return serviceLogo('api');
		if (name === 'Dev servers') return 'logos/nodejs-icon';
		return 'logos/docker-icon';
	}
	protected readonly stackActions: [LocalAction, string][] = [
		['stack-env', 'Write stack files'],
		['stack-up', 'Start the stack'],
		['stack-start-apps', 'Start shop containers'],
		['stack-stop-apps', 'Stop shop containers'],
	];
	protected readonly plan = signal<{ from?: PipelineStage; only?: PipelineStage }>({ from: 'proof' });
	private readonly ctx = inject(ConsoleContext);
	/** The Live deploy tab: an environment on this computer. */
	readonly environment = input('');
	protected readonly repository = computed(() => {
		const repo = this.ctx.repo();
		return repo?.sourceCode.vendor === 'github' ? repo.sourceCode.repository : null;
	});
	protected readonly branchList = signal<Branches | null>(null);
	protected readonly fetchingBranches = signal(false);
	/** A branch chosen for this run only; the environment's own until then. */
	protected readonly chosenBranch = signal('');
	protected readonly branch = computed(
		() =>
			this.chosenBranch() ||
			this.ctx.repo()?.environments.find((e) => e.name === this.environment())?.branch ||
			this.branchList()?.current ||
			'',
	);
	private readonly loadsBranches = effect(() => {
		const repo = this.repository();
		if (repo) void this.readBranches(repo);
	});
	protected async readBranches(repository: string, refresh = false): Promise<void> {
		this.fetchingBranches.set(true);
		try {
			this.branchList.set(await this.api.repositoryBranches(repository, refresh));
		} catch (err) {
			this.branchList.set({ defaultBranch: null, current: null, branches: [], note: (err as Error).message });
		} finally {
			this.fetchingBranches.set(false);
		}
	}
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	protected readonly raw = signal(false);
	protected readonly watching = signal<string | null>(null);
	private readonly lines = signal<JobLine[]>([]);
	private readonly lineJob = signal<string | null>(null);

	protected readonly jobs = injectQuery(() => ({
		queryKey: ['jobs'],
		queryFn: () => this.api.jobs(),
		refetchInterval: 5000,
	}));
	private readonly helper = injectQuery(() => ({
		queryKey: ['helper'],
		queryFn: () => this.api.helper(),
		refetchInterval: 10_000,
	}));
	private readonly docker = injectQuery(() => ({
		queryKey: ['docker'],
		queryFn: () => this.api.docker(),
		refetchInterval: 10_000,
	}));
	private readonly shop = injectQuery(() => ({
		queryKey: ['shop-health'],
		queryFn: () => this.api.shopHealth(),
		refetchInterval: 10_000,
	}));

	protected readonly currentId = computed(() => {
		const list = this.jobs.data() ?? [];
		return this.watching() ?? list.find((j) => j.status === 'running')?.id ?? list[list.length - 1]?.id ?? null;
	});
	private readonly detail = injectQuery(() => ({
		queryKey: ['job', this.currentId(), this.lines().length],
		queryFn: () =>
			this.api.job(
				this.currentId() ?? '',
				this.lineJob() === this.currentId() ? (this.lines().at(-1)?.seq ?? 0) : 0,
			),
		enabled: !!this.currentId(),
		refetchInterval: 2000,
	}));
	protected readonly current = computed<Job | null>(() => this.detail.data() ?? null);
	protected readonly running = computed(
		() => this.current()?.status === 'running' || this.current()?.status === 'stopping',
	);

	constructor() {
		effect(() => {
			const d = this.detail.data();
			if (!d) return;
			if (this.lineJob() !== d.id) {
				this.lineJob.set(d.id);
				this.lines.set(d.lines);
			} else if (d.lines.length) {
				const last = this.lines().at(-1)?.seq ?? 0;
				const fresh = d.lines.filter((l) => l.seq > last);
				if (fresh.length) this.lines.set([...this.lines(), ...fresh].slice(-5000));
			}
		});
	}

	private readonly runPlan = computed(() => {
		const label = this.current()?.label ?? '';
		const only = /\(only (\w+)\)/.exec(label)?.[1] as PipelineStage | undefined;
		const from = /\(from (\w+)\)/.exec(label)?.[1] as PipelineStage | undefined;
		return this.current()?.kind === 'pipeline' ? { only, from } : this.plan();
	});
	protected readonly laneView = computed(() =>
		stageLane(this.current()?.kind === 'pipeline' ? this.current() : null, this.lines(), this.runPlan()),
	);
	protected readonly progress = computed(() => {
		const lane = this.laneView().filter((s) => s.cls !== 'skip');
		return lane.length ? Math.round((lane.filter((s) => s.cls === 'ok').length / lane.length) * 100) : 0;
	});
	protected readonly title = computed(() => {
		const j = this.current();
		if (!j) return 'Ready';
		return { running: 'Running', stopping: 'Stopping', passed: 'Passed', failed: 'Failed', stopped: 'Stopped' }[
			j.status
		];
	});
	protected readonly reactorColour = computed(() =>
		this.current()?.status === 'failed' ? '#ff5d5d' : this.current()?.status === 'passed' ? '#5dffa8' : '#5ed6ff',
	);
	protected readonly events = computed(() =>
		this.lines()
			.filter((l) => l.event && (l.event['note'] || l.event['step'] || l.event['status']))
			.slice(-60)
			.map((l) => {
				// The filter above keeps only lines with an event.
				const e = l.event as Record<string, unknown>;
				const time = String(e['time'] ?? '').slice(11, 19);
				const status = String(e['status'] ?? '');
				const text = String(
					e['note'] ??
						e['step'] ??
						`${status}${e['reason'] ? ` · ${String(e['reason'])}` : ''}${typeof e['seconds'] === 'number' ? ` in ${Math.round(e['seconds'])}s` : ''}`,
				);
				return {
					time,
					stage: String(e['stage'] ?? ''),
					text,
					level: status === 'failed' ? 'err' : status === 'passed' ? 'ok' : '',
				};
			}),
	);
	protected readonly output = computed(() =>
		(this.raw()
			? this.lines()
			: this.lines().filter((l) => l.stream === 'out' || /error|fail/i.test(l.text))
		).slice(-1500),
	);
	protected readonly busyServers = computed(() =>
		Object.entries(this.helper.data()?.devServers ?? {})
			.filter(([, up]) => up)
			.map(([n]) => n)
			.join(', '),
	);
	protected readonly checksBlocked = computed(() => {
		const p = this.plan();
		const runsChecks = p.only ? p.only === 'checks' : !p.from || p.from === 'checks';
		return runsChecks && !!this.busyServers();
	});
	protected readonly systems = computed<[string, string, string][]>(() => {
		const h = this.helper.data();
		const d = this.docker.data();
		const s = this.shop.data();
		const up = (d?.containers ?? []).filter((c) => c.name.startsWith('saha-textile-stack-'));
		const ready = (a: { status?: number; body: unknown } | null | undefined): [string, string] => {
			const body = a?.body && typeof a.body === 'object' ? (a.body as Record<string, unknown>) : {};
			if (!a) return ['not running', 'muted'];
			if ((a.status ?? 500) >= 400) return [`answered ${a.status}`, 'red'];
			return [String(body['status'] ?? 'ok'), body['status'] === 'degraded' ? 'amber' : 'ok'];
		};
		return [
			['Mac helper', h?.reachable ? 'answering' : 'not answering', h?.reachable ? 'ok' : 'red'],
			['Docker', d?.reachable ? `running · ${d.version}` : 'not running', d?.reachable ? 'ok' : 'red'],
			[
				'Stack containers',
				`${up.filter((c) => c.state === 'running').length} running of ${up.length}`,
				up.length && up.every((c) => c.state === 'running') ? 'ok' : 'amber',
			],
			['Shop API · stack', ...ready(s?.stack)],
			['Shop API · pnpm dev', ...ready(s?.dev)],
			['Dev servers', this.busyServers() || 'none running', this.busyServers() ? 'amber' : 'ok'],
		];
	});

	protected watch(id: string): void {
		this.watching.set(id);
	}

	protected async start(e: Event): Promise<void> {
		e.preventDefault();
		const pin = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('input[type=password]');
		const branch = this.branch();
		await this.act(
			() => this.api.runLocal('pipeline', pin?.value ?? '', { ...this.plan(), ...(branch ? { branch } : {}) }),
			pin,
		);
	}

	protected async stackAction(action: LocalAction, pin: string): Promise<void> {
		await this.act(() => this.api.runLocal(action, pin));
	}

	protected async stop(pin: string): Promise<void> {
		const id = this.currentId();
		if (id) await this.act(() => this.api.stopJob(id, pin));
	}

	private async act(work: () => Promise<Job>, pinBox?: HTMLInputElement | null): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			const job = await work();
			this.watching.set(job.id);
			this.message.set(`${job.label}: ${job.status}.`);
			if (pinBox) pinBox.value = '';
			await this.queries.invalidateQueries({ queryKey: ['jobs'] });
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}
}
