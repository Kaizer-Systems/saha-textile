import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { SparkLine } from './local-parts';
import { type Trouble, TroubleSteps } from './trouble';
import { ConsoleApi } from '../data/console-api';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';

import type { Alert, AlertRule } from '@saha-textile/release-console-contracts';

/** Each rule's icon on the Rules table. */
const RULE_ICONS: Record<AlertRule, string> = {
	disk: 'tabler/device-floppy',
	'container-down': 'tabler/brand-docker',
	'helper-down': 'tabler/plug-connected',
	'run-failed': 'tabler/rocket',
	'key-expiring': 'tabler/key',
	'errors-rising': 'tabler/alert-triangle',
};

/** Each rule's steps on Firing now, from the shared troubleshooting list. */
const RULE_TROUBLE: Record<AlertRule, Trouble> = {
	disk: 'disk',
	'container-down': 'stack-down',
	'helper-down': 'helper',
	'run-failed': 'run-failed',
	'key-expiring': 'key',
	'errors-rising': 'errors',
};

const at = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const lasted = (a: Alert) => {
	const ms = new Date(a.resolvedAt ?? Date.now()).getTime() - new Date(a.firedAt).getTime();
	const min = Math.round(ms / 60_000);
	return min < 60 ? `${min} min` : `${Math.round(min / 6) / 10} h`;
};

/**
 * Watch › Alerts: the local rules and what fires now, checked by the console every 5 seconds for
 * environments on this computer. A server's own rules come with its agent.
 */
@Component({
	selector: 'rc-alerts-screen',
	imports: [Loading, Icon, SparkLine, TroubleSteps],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (view.data(); as v) {
			@if (tab() === 'firing') {
				@for (a of v.firing; track a.id) {
					<div
						class="rc-banner"
						[class.red]="a.level === 'red'"
						[class.amber]="a.level === 'amber'"
					>
						<span
							class="rc-dot pulse"
							[class.red]="a.level === 'red'"
							[class.amber]="a.level === 'amber'"
						></span>
						<div>
							<b>{{ a.title }}.</b>
							{{ a.detail }} Fired {{ at(a.firedAt) }} · shown in Attention.
						</div>
					</div>
					<div class="rc-g2">
						<rc-trouble-steps [trouble]="troubles[a.rule]" />
						@if (a.rule === 'disk') {
							<div class="rc-panel">
								<div class="rc-ph">
									<span class="rc-label">
										<rc-icon name="tabler/device-floppy" />
										Start-up disk used · last 24 hours
									</span>
								</div>
								<rc-spark-line
									[values]="diskValues()"
									[max]="100"
									colour="#ff5d5d"
								/>
							</div>
						}
					</div>
				} @empty {
					<div class="rc-banner ok">
						<span class="rc-dot ok"></span>
						<div>
							<b>Nothing is firing.</b>
							Last checked {{ at(v.checkedAt) }}.
						</div>
					</div>
				}
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/history" />
							Ended in the last 7 days
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Alert</th>
									<th>Fired</th>
									<th>Ended</th>
									<th>Lasted</th>
								</tr>
							</thead>
							<tbody>
								@for (a of v.recent; track a.id) {
									<tr>
										<td>
											<rc-icon [name]="icons[a.rule]" />
											<b>{{ a.title }}</b>
										</td>
										<td class="rc-mono">{{ at(a.firedAt) }}</td>
										<td class="rc-mono">{{ at(a.resolvedAt) }}</td>
										<td class="rc-mono">{{ lasted(a) }}</td>
									</tr>
								} @empty {
									<tr><td colspan="4">None.</td></tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			} @else {
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Rule</th>
								<th>Watches</th>
								<th>Fires when</th>
								<th>Sends to</th>
								<th>State</th>
							</tr>
						</thead>
						<tbody>
							@for (r of v.rules; track r.rule) {
								<tr>
									<td>
										<rc-icon [name]="icons[r.rule]" />
										<b>{{ r.label }}</b>
										@if (r.note) {
											<br />
											<span class="rc-note">{{ r.note }}</span>
										}
									</td>
									<td>{{ r.watches }}</td>
									<td>{{ r.firesWhen }}</td>
									<td>{{ r.sendsTo }}</td>
									<td>
										<span
											class="rc-pill"
											[class.ok]="r.state === 'ok'"
											[class.red]="r.state === 'firing'"
											[class.cy]="r.state === 'waiting'"
										>
											{{ r.state === 'waiting' ? 'waits' : r.state }}
										</span>
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<p class="rc-note">
					The console checks these every 5 seconds while it runs on this Mac; last checked
					{{ at(v.checkedAt) }}. Email and phone delivery come with the server agent, which keeps checking
					while this Mac is off.
				</p>
			}
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div><b>The console API is not answering.</b></div>
			</div>
		} @else {
			<rc-loading what="Reading the alerts…" />
		}
	`,
})
export class AlertsScreen {
	private readonly api = inject(ConsoleApi);
	readonly tab = input('rules');
	protected readonly icons = RULE_ICONS;
	protected readonly troubles = RULE_TROUBLE;
	protected readonly at = at;
	protected readonly lasted = lasted;
	protected readonly view = injectQuery(() => ({
		queryKey: ['alerts'],
		queryFn: () => this.api.alerts(),
		refetchInterval: 5000,
	}));
	private readonly disk = injectQuery(() => ({
		queryKey: ['history', 'mac', 'disk', 1440],
		queryFn: () => this.api.history('mac', ['disk_used', 'disk_total'], 1440),
		enabled: this.tab() === 'firing' && !!this.view.data()?.firing.some((a) => a.rule === 'disk'),
		refetchInterval: 60_000,
	}));
	protected readonly diskValues = computed(() => {
		const used = this.disk.data()?.find((s) => s.name === 'disk_used')?.points ?? [];
		const total = this.disk
			.data()
			?.find((s) => s.name === 'disk_total')
			?.points.at(-1)?.[1];
		return total ? used.map(([, v]) => Math.round((v / total) * 100)) : used.map(([, v]) => v);
	});
}
