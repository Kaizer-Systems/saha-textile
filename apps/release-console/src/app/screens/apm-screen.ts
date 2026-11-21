import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { LATENCY_BUCKETS_MS, type RequestRoute } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { SparkLine } from './local-parts';
import { ConsoleApi } from '../data/console-api';
import { BrandLogo, Icon, serviceLogo } from '../shared/icons';
import { Loading } from '../shared/loading';

const WINDOWS: [number, string][] = [
	[15, '15 min'],
	[60, '1 hour'],
	[1440, '24 hours'],
	[10080, '7 days'],
];

/** “64 ms” or “1.3 s”; “—” when unknown. */
export const duration = (ms: number | null | undefined): string =>
	ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
/** A share as a percentage with one decimal. */
export const share = (v: number): string => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
const routeKey = (r: RequestRoute) => `${r.service} ${r.method} ${r.route}`;

/**
 * Watch › APM: each service's speed, traffic and errors, and any route's latency spread, read from
 * the local stack edge's request log (the time each request took at the edge). Where the time went
 * inside a request comes with tracing.
 */
@Component({
	selector: 'rc-apm-screen',
	imports: [Loading, Icon, BrandLogo, SparkLine],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-label">
				<rc-icon name="tabler/world-bolt" />
				From the local stack edge’s request log
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
		@if (view.data(); as v) {
			@if (v.note) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>No requests yet.</b>
						{{ v.note }} Start the stack on Ship › Live deploy, then open the shop at
						https://local.saha-textile.localhost.
					</div>
				</div>
			} @else if (tab() === 'endpoint') {
				@if (picked(); as r) {
					<div class="rc-row between">
						<div>
							<div class="rc-label">
								<rc-brand-logo
									[name]="logo(r.service)"
									[size]="13"
								/>
								{{ r.service }} · last
								{{ windowLabel() }}
							</div>
							<h3 class="rc-h">{{ r.method }} {{ r.route }}</h3>
						</div>
					</div>
					<div class="rc-g4">
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/activity" />
								Calls
							</span>
							<b>{{ r.count }}</b>
							<small>{{ r.perMinute }} a minute</small>
						</div>
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/gauge" />
								p50
							</span>
							<b>{{ duration(r.p50) }}</b>
							<small>half of the calls were faster</small>
						</div>
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/gauge" />
								p95
							</span>
							<b [class.amber]="(r.p95 ?? 0) > 1000">{{ duration(r.p95) }}</b>
							<small>p99 {{ duration(r.p99) }}</small>
						</div>
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/alert-triangle" />
								Errors
							</span>
							<b
								[class.red]="r.errorRate > 0.01"
								[class.ok]="r.errorRate === 0"
							>
								{{ share(r.errorRate) }}
							</b>
							<small>4xx {{ share(r.clientErrorRate) }}</small>
						</div>
					</div>
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/chart-bar" />
									How long calls took
								</span>
							</div>
							<div class="rc-hist">
								@for (n of r.buckets; track $index) {
									<i
										[style.height.%]="barHeight(r, n)"
										[attr.title]="bucketLabel($index) + ': ' + n + ' calls'"
									></i>
								}
							</div>
							<div class="rc-row between rc-mono">
								<span>0 ms</span>
								<span>500 ms</span>
								<span>8 s and more</span>
							</div>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/timeline" />
									Time inside this endpoint
								</span>
							</div>
							<p class="rc-p muted">
								Which calls inside the request took the time (database, Shiprocket, search) shows here
								once tracing runs on the local stack. The edge’s log gives each request’s total time
								only.
							</p>
						</div>
					</div>
				}
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/route" />
							Choose a route · slowest first
						</span>
					</div>
					<div class="rc-states">
						@for (r of v.routes; track routeKey(r)) {
							<button
								type="button"
								class="rc-chip"
								[class.on]="picked() === r"
								(click)="choice.set(routeKey(r))"
							>
								{{ r.method }} {{ r.route }} · {{ duration(r.p95) }}
							</button>
						}
					</div>
				</div>
			} @else {
				<div class="rc-g2">
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/gauge" />
								Latency p95, all services · now {{ duration(lastP95()) }}
							</span>
						</div>
						<rc-spark-line [values]="p95Values()" />
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/alert-triangle" />
								Server errors · now {{ share(lastErrors()) }}
							</span>
						</div>
						<rc-spark-line
							[values]="errorValues()"
							colour="#ff5d5d"
						/>
					</div>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Service</th>
								<th>Req / min</th>
								<th>p50</th>
								<th>p95</th>
								<th>p99</th>
								<th>Errors</th>
								<th>Apdex</th>
							</tr>
						</thead>
						<tbody>
							@for (s of v.services; track s.service) {
								<tr [class.amber]="(s.apdex ?? 1) < 0.9">
									<td>
										<b>
											<rc-brand-logo
												[name]="logo(s.service)"
												[size]="14"
												[label]="s.service"
											/>
										</b>
									</td>
									<td class="rc-mono">{{ s.perMinute }}</td>
									<td class="rc-mono">{{ duration(s.p50) }}</td>
									<td class="rc-mono">{{ duration(s.p95) }}</td>
									<td class="rc-mono">{{ duration(s.p99) }}</td>
									<td class="rc-mono">
										<span [class.red]="s.errorRate > 0.01">{{ share(s.errorRate) }}</span>
									</td>
									<td class="rc-mono">{{ s.apdex ?? '—' }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/route" />
							Slowest routes
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Route</th>
									<th>Calls</th>
									<th>p50</th>
									<th>p95</th>
									<th>p99</th>
									<th>Errors</th>
								</tr>
							</thead>
							<tbody>
								@for (r of v.routes.slice(0, 12); track routeKey(r)) {
									<tr>
										<td>
											<rc-brand-logo
												[name]="logo(r.service)"
												[size]="13"
											/>
											<span class="rc-mono">{{ r.method }} {{ r.route }}</span>
										</td>
										<td class="rc-mono">{{ r.count }}</td>
										<td class="rc-mono">{{ duration(r.p50) }}</td>
										<td class="rc-mono">{{ duration(r.p95) }}</td>
										<td class="rc-mono">{{ duration(r.p99) }}</td>
										<td class="rc-mono">
											<span [class.red]="r.errorRate > 0.01">{{ share(r.errorRate) }}</span>
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
				<p class="rc-note">
					APM means watching each service’s speed, traffic and errors. Apdex is a 0 to 1 score of how many
					requests felt fast (under 0.5 s). Times are each request’s total at the edge; routes drop query
					strings and IDs, and the console keeps minute summaries for 7 days, never the requests themselves.
				</p>
			}
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div><b>The console API is not answering.</b></div>
			</div>
		} @else {
			<rc-loading what="Reading the request log…" />
		}
	`,
})
export class ApmScreen {
	private readonly api = inject(ConsoleApi);
	readonly tab = input('services');
	protected readonly windows = WINDOWS;
	protected readonly minutes = signal(60);
	protected readonly choice = signal<string | null>(null);
	protected readonly duration = duration;
	protected readonly share = share;
	protected readonly logo = serviceLogo;
	protected readonly routeKey = routeKey;
	protected readonly view = injectQuery(() => ({
		queryKey: ['requests', this.minutes()],
		queryFn: () => this.api.requests(this.minutes()),
		refetchInterval: 30_000,
	}));
	protected readonly windowLabel = computed(() => WINDOWS.find((w) => w[0] === this.minutes())?.[1] ?? '');
	protected readonly picked = computed(() => {
		const routes = this.view.data()?.routes ?? [];
		return routes.find((r) => routeKey(r) === this.choice()) ?? routes[0] ?? null;
	});
	protected readonly p95Values = computed(() => (this.view.data()?.series ?? []).map(([, p95]) => p95 ?? 0));
	protected readonly errorValues = computed(() => (this.view.data()?.series ?? []).map(([, , e]) => e * 100));
	protected readonly lastP95 = computed(() => this.view.data()?.series.at(-1)?.[1] ?? null);
	protected readonly lastErrors = computed(() => this.view.data()?.series.at(-1)?.[2] ?? 0);

	protected barHeight(r: RequestRoute, n: number): number {
		const top = Math.max(...r.buckets, 1);
		return n ? Math.max(4, Math.round((n / top) * 100)) : 0;
	}
	protected bucketLabel(i: number): string {
		const upper = LATENCY_BUCKETS_MS[i];
		const lower = i === 0 ? 0 : LATENCY_BUCKETS_MS[i - 1];
		return upper === undefined ? `over ${duration(lower)}` : `${duration(lower)} to ${duration(upper)}`;
	}
}
