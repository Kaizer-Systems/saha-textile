import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { formatBytes } from './format';
import { TroubleSteps } from './trouble';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { Icon } from '../shared/icons';

/** “1.2 MB/s” for a byte rate; “—” when unknown. */
export function formatRate(bytesPerSecond: number | null | undefined): string {
	if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return '—';
	return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** Percent of `part` in `whole`, rounded; 0 when unknown. */
export function percent(part: number | null | undefined, whole: number | null | undefined): number {
	if (!part || !whole) return 0;
	return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/** The brief's colour for a load level: green, amber over 70 %, red over 90 %. */
export const levelColour = (pct: number): string => (pct >= 90 ? '#ff5d5d' : pct >= 70 ? '#ffb547' : '#5ed6ff');

/** Points of a sparkline (`rc-spark`) for values, as the brief draws them. */
export function sparkPoints(values: number[], w = 300, h = 70, max?: number): string {
	if (values.length < 2) return '';
	const top = max ?? (Math.max(...values) * 1.15 || 1);
	const step = w / (values.length - 1);
	return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / top) * (h - 6) - 3).toFixed(1)}`).join(' ');
}

/** The brief's sparkline: a filled line over 70 px, its newest point marked. */
@Component({
	selector: 'rc-spark-line',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-sw">
			<svg
				class="rc-spark"
				viewBox="0 0 300 70"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				@for (f of [0.25, 0.5, 0.75]; track f) {
					<line
						x1="0"
						x2="300"
						[attr.y1]="70 * f"
						[attr.y2]="70 * f"
						stroke="rgba(94,214,255,0.08)"
					/>
				}
				@if (line()) {
					<polygon
						[attr.points]="'0,70 ' + line() + ' 300,70'"
						[attr.fill]="colour()"
						fill-opacity="0.12"
					/>
					<polyline
						[attr.points]="line()"
						fill="none"
						[attr.stroke]="colour()"
						stroke-width="1.6"
						vector-effect="non-scaling-stroke"
					/>
				}
			</svg>
		</div>
	`,
})
export class SparkLine {
	readonly values = input<number[]>([]);
	readonly colour = input('#5ed6ff');
	readonly max = input<number | undefined>(undefined);
	protected readonly line = computed(() => sparkPoints(this.values(), 300, 70, this.max()));
}

/** The brief's ring gauge (`rc-ring`). */
@Component({
	selector: 'rc-gauge',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-ring">
			<svg
				viewBox="0 0 100 100"
				width="92"
				height="92"
				aria-hidden="true"
			>
				<circle
					cx="50"
					cy="50"
					r="40"
					fill="none"
					stroke="rgba(94,214,255,0.12)"
					stroke-width="8"
				/>
				<circle
					cx="50"
					cy="50"
					r="40"
					fill="none"
					[attr.stroke]="colour()"
					stroke-width="8"
					pathLength="100"
					[attr.stroke-dasharray]="value() + ' 100'"
					transform="rotate(-90 50 50)"
				/>
				<text
					x="50"
					y="55"
					text-anchor="middle"
					fill="#d9f4ff"
					font-size="19"
					font-family="Chakra Petch, sans-serif"
					font-weight="600"
				>
					{{ value() }}%
				</text>
			</svg>
			<span>
				@if (icon()) {
					<rc-icon [name]="icon()" />
				}
				{{ label() }}
			</span>
		</div>
	`,
})
export class Gauge {
	readonly value = input(0, { transform: (v: number) => Math.round(v) });
	readonly label = input('');
	readonly icon = input('');
	protected readonly colour = computed(() => levelColour(this.value()));
}

/**
 * Shown above every screen that reads this Mac: whether the environment runs here, and whether the
 * Mac helper answers. The screen's own body shows only when both are true.
 */
@Component({
	selector: 'rc-local-gate',
	imports: [TroubleSteps],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (!onThisComputer()) {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					<b>No server is linked for this environment.</b>
					Its figures appear here once the console's agent runs on its server. Choose an environment that runs
					on this computer to see this Mac.
				</div>
			</div>
		} @else if (helper.data(); as h) {
			@if (h.reachable) {
				<ng-content />
			} @else {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>The Mac helper is not answering.</b>
						{{ h.message }} It runs beside the console and reads this Mac and Docker for it.
					</div>
				</div>
				<rc-trouble-steps trouble="helper" />
			}
		} @else if (helper.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div><b>The console API is not answering.</b></div>
			</div>
		} @else {
			<p class="rc-p muted">Asking the Mac helper…</p>
		}
	`,
})
export class LocalGate {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	protected readonly onThisComputer = computed(() => {
		const env = this.ctx.environments().find((e) => e.name === this.state.environment());
		return !env || env.cloudId === null;
	});
	protected readonly helper = injectQuery(() => ({
		queryKey: ['helper'],
		queryFn: () => this.api.helper(),
		refetchInterval: 10_000,
	}));
}
