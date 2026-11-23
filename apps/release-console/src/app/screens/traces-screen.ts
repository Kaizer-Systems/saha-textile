import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { when } from '../pages/format-time';
import { Loading } from '../shared/loading';

import type { TraceSpan, TracesList } from '@saha-textile/release-console-contracts';

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
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (onServer()) {
			<div class="rc-banner small">
				<span class="rc-dot"></span>
				<div>
					<b>Tracing on {{ envLabel() }} waits for your yes.</b>
					It is built and measured on this computer first; switching it on for staging and production is
					DEC-TRACING-SERVERS. The Local tab shows this computer's traces.
				</div>
			</div>
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
	`,
})
export class TracesScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	private readonly router = inject(Router);
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
