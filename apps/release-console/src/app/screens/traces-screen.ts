import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { when } from '../pages/format-time';
import { BrandLogo, Icon, serviceLogo } from '../shared/icons';
import { Loading } from '../shared/loading';

import type { Job, JobLine, TraceSpan, TracesList } from '@saha-textile/release-console-contracts';

/** The service map's columns, left to right: who calls whom. */
const LAYER: Record<string, number> = { shop: 0, API: 1, worker: 1, MongoDB: 2, Redis: 2, search: 2 };

/**
 * Watch › Traces (Release Path brief Part 6, Q7 approved 23 Nov): Slowest, Errors, Waterfall with
 * Diagnose, and Service map, from the local VictoriaTraces. Spans never hold a value: addresses use
 * {{token}} placeholders and database calls show their shape with "?". Servers wait for the owner's
 * yes on DEC-TRACING-SERVERS. Drawn with the brief's span rows and map, already in the stylesheet.
 */
@Component({
	selector: 'rc-traces-screen',
	imports: [Loading, Icon, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<!-- The tracing switch on this Mac (brief 8UmNaHHAuiGLez47McHkj8, approved 23 Nov): Live deploy's Output panel. -->
		@if (!onServer() && job(); as j) {
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
						<div [class]="'l ' + lineTone(l)">
							<span class="n">{{ lineTime(l) }}</span>
							<span class="m">{{ lineText(l) }}</span>
						</div>
					}
				</div>
			</div>
		}
		@if (!onServer() && sw.data()?.state === 'on' && quiet().length) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/send" />
						Sending · the last hour
					</span>
				</div>
				<div class="rc-kv">
					@for (a of sw.data()?.apps ?? []; track a.service) {
						<div>
							<span>
								<rc-brand-logo
									[name]="logo(a.service)"
									[size]="14"
									[label]="a.label"
								/>
							</span>
							<em [class]="a.tone">{{ a.note }}</em>
						</div>
					}
				</div>
			</div>
		}
		@if (onServer()) {
			<div class="rc-banner small">
				<span class="rc-dot"></span>
				<div>
					<b>Tracing on {{ envLabel() }} waits for your yes.</b>
					It is built and measured on this computer first; switching it on for staging and production is
					DEC-TRACING-SERVERS. The Local tab shows this computer's traces.
				</div>
			</div>
		} @else if (sw.data(); as s) {
			@if (s.state === 'no-docker') {
				<div class="rc-banner red small">
					<span class="rc-dot red"></span>
					<div>
						<b>Docker is not running on this Mac.</b>
						Start Docker Desktop, then press the button again.
					</div>
				</div>
			} @else if (s.state === 'stopped') {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>The trace store has stopped,</b>
						for example after Docker or the Mac restarted. The apps still have its address, so nothing else
						needs changing.
					</div>
				</div>
				<div class="rc-row">
					<label class="rc-form">
						PIN
						<div class="rc-msearch">
							<input
								#againPin
								type="password"
								inputmode="numeric"
								maxlength="6"
								autocomplete="off"
								aria-label="Console PIN to start the trace store again"
							/>
						</div>
					</label>
					<button
						type="button"
						class="rc-btn primary"
						[disabled]="busy() || running()"
						(click)="turn('tracing-on', againPin)"
					>
						Start it again
					</button>
				</div>
			} @else if (s.state === 'off') {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>Tracing is off on this Mac.</b>
						Nothing is recorded until you turn it on.
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/route" />
							Turn tracing on for this Mac
						</span>
					</div>
					<ol class="rc-note">
						<li>
							Start the trace store · VictoriaTraces in Docker · keeps 7 days, at most 2 GiB
							@if (s.store) {
								· already running
							}
						</li>
						<li>Give the API on this Mac the address</li>
						<li>
							Give the local stack the address, and restart its API, worker and shop if they run (about 20
							s)
						</li>
						<li>Wait for the first traces and say which apps send</li>
					</ol>
					<p class="rc-note">
						Address the apps send to:
						<span class="rc-mono">http://127.0.0.1:10428/insert/opentelemetry/v1/traces</span>
						· this Mac only · no account · not a secret
					</p>
					<div class="rc-row">
						<label class="rc-form">
							PIN
							<div class="rc-msearch">
								<input
									#onPin
									type="password"
									inputmode="numeric"
									maxlength="6"
									autocomplete="off"
									aria-label="Console PIN to turn tracing on"
								/>
							</div>
						</label>
						<button
							type="button"
							class="rc-btn primary"
							[disabled]="busy() || running()"
							(click)="turn('tracing-on', onPin)"
						>
							Turn tracing on
						</button>
					</div>
				</div>
			}
			@if (message()) {
				<p class="rc-note">{{ message() }}</p>
			}
		} @else if (sw.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ sw.error().message }}</div>
			</div>
		} @else if (!sw.data()) {
			<rc-loading what="Reading tracing on this Mac…" />
		}
		<!-- Server tabs show only their banner; on this Mac the traces show once tracing is on. -->
		@if (onServer() || (sw.data()?.state !== 'on' && !sw.isError())) {
		} @else if (tab() === 'waterfall' || tab() === 'diagnose') {
			@if (one.data(); as t) {
				<div class="rc-row between">
					<div>
						<h3 class="rc-h">{{ t.name }}</h3>
						<span class="rc-mono">
							{{ t.service }} · {{ ms(t.ms) }} · {{ t.status ?? '—' }} · {{ when(t.at) }}
							@if (t.requestId) {
								· request id {{ t.requestId }}
							}
							@if (t.build) {
								· build {{ t.build }}
							}
						</span>
					</div>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="go('list')"
					>
						Slowest
					</button>
				</div>
				@for (d of t.diagnose; track d.rule + (d.spanId ?? '')) {
					<div class="rc-banner amber small">
						<span class="rc-dot amber"></span>
						<div>
							<b>Diagnose:</b>
							{{ d.text }}
						</div>
						@if (d.rule === 'slow-database') {
							<button
								type="button"
								class="rc-btn ghost"
								(click)="openDatabase()"
							>
								Open in Database monitor
							</button>
						}
					</div>
				} @empty {
					@if (tab() === 'diagnose') {
						<div class="rc-banner ok small">
							<span class="rc-dot ok"></span>
							<div>Nothing stands out in this request: no span over half its time, no repeated call.</div>
						</div>
					}
				}
				@if (tab() === 'waterfall') {
					<div class="rc-panel">
						<div class="rc-spans">
							@for (s of t.spans; track s.id) {
								<div class="rc-span">
									<span
										class="name"
										[style.--d]="s.depth"
										[title]="s.query ?? s.name"
									>
										{{ s.name }}
									</span>
									<span class="rc-hopbar">
										<i
											[class.amber]="isSlow(s, t.ms)"
											[class.red]="s.error"
											[class.ok]="!s.error && isStore(s)"
											[style.margin-left.%]="(s.startMs / t.ms) * 100"
											[style.width.%]="bar(s, t.ms)"
										></i>
									</span>
									<span class="svc">{{ s.where }}</span>
									<span
										class="rc-mono"
										[class.amber]="isSlow(s, t.ms)"
									>
										{{ ms(s.ms) }}
									</span>
								</div>
							}
						</div>
					</div>
					<p class="rc-note">
						Never in a span: query values, request bodies, headers, cookies or tokens. Shoppers' browsers
						are not traced until the privacy policy rewrite (Chunk K).
					</p>
				}
			} @else if (one.isError()) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>{{ one.error().message }}</div>
				</div>
			} @else if (!traceId() && list.data()?.traces?.length === 0) {
				<p class="rc-note">
					No traces in the last hour: use the shop on this computer (traces appear within half a minute), then
					open the slowest one.
				</p>
			} @else {
				<rc-loading what="Reading the trace from VictoriaTraces…" />
			}
		} @else if (list.data(); as l) {
			@if (l.state === 'off') {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>No traces to read yet.</b>
						{{ l.message }}
					</div>
				</div>
			} @else if (tab() === 'map') {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">Service map · the last hour, average time per call</span>
					</div>
					<div class="rc-tw">
						<svg
							class="rc-map"
							[attr.viewBox]="'0 0 760 ' + mapHeight(l)"
							role="img"
							aria-label="Which service calls which, with the number of calls and their average time"
						>
							@for (e of l.edges; track e.from + e.to) {
								<path
									class="rc-edge"
									[class.amber]="e.ms >= 100"
									[attr.d]="edgePath(l, e.from, e.to)"
								/>
								<text
									class="rc-elabel"
									[class.amber]="e.ms >= 100"
									[attr.x]="(nodeX(e.from) + nodeX(e.to)) / 2 + 60"
									[attr.y]="(nodeY(l, e.from) + nodeY(l, e.to)) / 2 + 14"
									text-anchor="middle"
								>
									{{ e.calls }} · {{ e.ms }} ms
								</text>
							}
							@for (n of nodes(l); track n) {
								<g class="rc-node">
									<rect
										[attr.x]="nodeX(n)"
										[attr.y]="nodeY(l, n)"
										width="120"
										height="40"
										rx="6"
									/>
									<text
										[attr.x]="nodeX(n) + 60"
										[attr.y]="nodeY(l, n) + 25"
										text-anchor="middle"
									>
										{{ n }}
									</text>
								</g>
							}
						</svg>
					</div>
				</div>
			} @else {
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Request</th>
								<th>Where</th>
								<th>ms</th>
								<th>Status</th>
								<th>When</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (t of l.traces; track t.id) {
								<tr>
									<td class="rc-mono">{{ t.name }}</td>
									<td>{{ t.service }}</td>
									<td
										class="rc-mono"
										[class.amber]="t.ms >= 1000"
									>
										{{ ms(t.ms) }}
									</td>
									<td
										class="rc-mono"
										[class.red]="t.error"
									>
										{{ t.status ?? (t.error ? 'error' : '—') }}
									</td>
									<td class="rc-mono">{{ when(t.at) }}</td>
									<td>
										<button
											type="button"
											class="rc-btn ghost"
											(click)="open(t.id)"
										>
											Waterfall
										</button>
									</td>
								</tr>
							} @empty {
								<tr>
									<td colspan="6">
										{{
											tab() === 'errors'
												? 'No failed requests in the last hour.'
												: 'No traces in the last hour: use the shop on this computer; traces appear within half a minute.'
										}}
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<p class="rc-note">{{ l.message }} · {{ l.services.join(', ') || 'no services yet' }}</p>
			}
		} @else if (list.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ list.error().message }}</div>
			</div>
		} @else {
			<rc-loading what="Reading the last hour of traces…" />
		}
		@if (!onServer() && sw.data()?.state === 'on') {
			<div class="rc-row between">
				<p class="rc-note">Tracing on this Mac · {{ sendingWords() }} · traces kept 7 days</p>
				<div class="rc-row">
					<label class="rc-form">
						PIN
						<div class="rc-msearch">
							<input
								#offPin
								type="password"
								inputmode="numeric"
								maxlength="6"
								autocomplete="off"
								aria-label="Console PIN to turn tracing off"
							/>
						</div>
					</label>
					<button
						type="button"
						class="rc-btn danger"
						[disabled]="busy() || running()"
						(click)="turn('tracing-off', offPin)"
					>
						Turn tracing off
					</button>
				</div>
			</div>
			@if (message()) {
				<p class="rc-note">{{ message() }}</p>
			}
		}
	`,
})
export class TracesScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	private readonly router = inject(Router);
	private readonly queries = inject(QueryClient);
	readonly tab = input('list');
	protected readonly when = when;
	private readonly envName = computed(() => this.state.environment());
	protected readonly envLabel = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.envName())?.label ?? this.envName(),
	);
	protected readonly onServer = computed(
		() => (this.ctx.repo()?.environments.find((e) => e.name === this.envName())?.cloudId ?? null) !== null,
	);
	protected readonly traceId = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('trace') ?? '')), {
		initialValue: '',
	});
	protected readonly list = injectQuery(() => ({
		queryKey: ['traces', this.tab() === 'errors' ? 'errors' : 'slowest'],
		queryFn: () => this.api.traces(this.tab() === 'errors' ? 'errors' : 'slowest'),
		enabled: !this.onServer(),
		staleTime: 30_000,
	}));
	/** The trace the waterfall shows: the one opened, else the slowest of the last hour. */
	private readonly picked = computed(() => this.traceId() || this.list.data()?.traces[0]?.id || '');
	protected readonly one = injectQuery(() => ({
		queryKey: ['trace', this.picked()],
		queryFn: () => this.api.trace(this.picked()),
		enabled: !this.onServer() && !!this.picked() && (this.tab() === 'waterfall' || this.tab() === 'diagnose'),
		staleTime: 300_000,
	}));

	/* ----- the tracing switch on this Mac ----- */
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	protected readonly raw = signal(false);
	/** The run started here, or a tracing run already going when the screen opened. */
	private readonly watching = signal<string | null>(null);
	private readonly jobs = injectQuery(() => ({
		queryKey: ['jobs'],
		queryFn: () => this.api.jobs(),
		enabled: !this.onServer(),
		refetchInterval: 5000,
	}));
	private readonly jobId = computed(
		() =>
			this.watching() ??
			this.jobs.data()?.find((j) => j.status === 'running' && j.label.includes('tracing'))?.id ??
			null,
	);
	private readonly detail = injectQuery(() => ({
		queryKey: ['job', this.jobId()],
		queryFn: () => this.api.job(this.jobId() ?? ''),
		enabled: !!this.jobId(),
		refetchInterval: (q: { state: { data?: Job } }) =>
			q.state.data && q.state.data.status !== 'running' && q.state.data.status !== 'stopping' ? false : 2000,
	}));
	protected readonly job = computed<Job | null>(() => this.detail.data() ?? null);
	protected readonly running = computed(() => this.job()?.status === 'running' || this.job()?.status === 'stopping');
	protected readonly output = computed(() =>
		(this.raw()
			? (this.job()?.lines ?? [])
			: (this.job()?.lines ?? []).filter((l) => l.stream === 'out' || /error|fail/i.test(l.text))
		).slice(-500),
	);
	protected readonly sw = injectQuery(() => ({
		queryKey: ['tracing'],
		queryFn: () => this.api.localTracing(),
		enabled: !this.onServer(),
		refetchInterval: this.running() ? 3000 : 15_000,
	}));
	/** The apps not sending yet, which put the Sending list on screen. */
	protected readonly quiet = computed(() => (this.sw.data()?.apps ?? []).filter((a) => !a.sending));
	protected readonly sendingWords = computed(() => {
		const on = (this.sw.data()?.apps ?? []).filter((a) => a.sending).map((a) => a.label);
		return on.length ? `${on.join(', ')} sending` : 'no app sending in the last hour';
	});

	constructor() {
		// When a tracing run ends, read the switch and the traces again.
		let was = false;
		effect(() => {
			const now = this.running();
			if (was && !now) {
				void this.queries.invalidateQueries({ queryKey: ['tracing'] });
				void this.queries.invalidateQueries({ queryKey: ['traces'] });
			}
			was = now;
		});
	}

	protected async turn(action: 'tracing-on' | 'tracing-off', pinBox: HTMLInputElement): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			const job = await this.api.runLocal(action, pinBox.value);
			this.watching.set(job.id);
			pinBox.value = '';
			await this.queries.invalidateQueries({ queryKey: ['jobs'] });
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}
	/** The script starts each line with its time; the log's first column shows it. */
	protected lineTime(l: JobLine): string {
		return /^(\d\d:\d\d:\d\d) /.exec(l.text)?.[1] ?? String(l.seq);
	}
	protected lineText(l: JobLine): string {
		return l.text.replace(/^\d\d:\d\d:\d\d /, '');
	}
	protected lineTone(l: JobLine): string {
		const text = this.lineText(l);
		if (/^Failed\b/.test(text) || l.stream === 'err') return /^Failed\b/.test(text) ? 'err' : 'dim';
		return text.endsWith('…') ? '' : 'ok';
	}
	protected logo(service: string): string {
		return serviceLogo(service.replace('saha-textile-', ''));
	}

	protected ms(v: number): string {
		return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
	}
	protected bar(s: TraceSpan, total: number): number {
		return Math.max(0.6, Math.min(100 - (s.startMs / total) * 100, (s.ms / total) * 100));
	}
	protected isSlow(s: TraceSpan, total: number): boolean {
		return s.parentId !== null && s.ms / total >= 0.4;
	}
	protected isStore(s: TraceSpan): boolean {
		return s.where === 'MongoDB' || s.where === 'Redis' || s.where === 'search';
	}
	protected nodes(l: TracesList): string[] {
		return [...new Set(l.edges.flatMap((e) => [e.from, e.to]))].sort(
			(a, b) => (LAYER[a] ?? 3) - (LAYER[b] ?? 3) || a.localeCompare(b),
		);
	}
	protected nodeX(n: string): number {
		return 20 + (LAYER[n] ?? 3) * 190;
	}
	protected nodeY(l: TracesList, n: string): number {
		const same = this.nodes(l).filter((x) => (LAYER[x] ?? 3) === (LAYER[n] ?? 3));
		return 20 + same.indexOf(n) * 64;
	}
	protected mapHeight(l: TracesList): number {
		const counts = [0, 1, 2, 3].map((k) => this.nodes(l).filter((x) => (LAYER[x] ?? 3) === k).length);
		return Math.max(120, 40 + Math.max(...counts) * 64);
	}
	protected edgePath(l: TracesList, from: string, to: string): string {
		const x1 = this.nodeX(from) + 120;
		const y1 = this.nodeY(l, from) + 20;
		const x2 = this.nodeX(to);
		const y2 = this.nodeY(l, to) + 20;
		const mid = (x1 + x2) / 2;
		return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
	}
	protected open(id: string): void {
		void this.router.navigate([], { queryParams: { tab: 'waterfall', trace: id }, queryParamsHandling: 'merge' });
	}
	protected go(tab: string): void {
		void this.router.navigate([], { queryParams: { tab, trace: null }, queryParamsHandling: 'merge' });
	}
	protected openDatabase(): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', this.ctx.repoId(), 'queries'], {
			queryParams: { tab: 'top' },
		});
	}
}
