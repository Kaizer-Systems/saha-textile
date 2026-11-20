import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { SparkLine } from './local-parts';
import { ConsoleApi } from '../data/console-api';
import { Icon } from '../shared/icons';

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

/** What to do when an alert fires: the troubleshooting steps for its rule. */
export const ALERT_STEPS: Record<AlertRule, string[]> = {
	disk: [
		'Empty the Trash; files moved there still take space.',
		'In a terminal, `docker system df` shows what Docker keeps on disk.',
		'`docker builder prune` frees build cache and `docker image prune` removes images no container uses; neither touches the stack’s data volumes.',
		'Large caches are listed by `du -sh ~/Library/Caches/* | sort -h | tail`.',
	],
	'container-down': [
		'Open Run › Live logs, choose the container and read its last lines.',
		'On Ship › Live deploy, “Start shop containers” starts the stack’s own services again.',
		'If it stops again, run `pnpm stack:up` from the main folder: it writes the stack’s files and starts everything in order.',
	],
	'helper-down': [
		'From the main folder, run `pnpm console:up`; it starts the Mac helper beside the console.',
		'If port 4419 is taken, `lsof -nP -iTCP:4419` names the program using it.',
		'The helper refuses to start from a worktree; start it from the main folder.',
	],
	'run-failed': [
		'Open Ship › Live deploy › Recent runs and read the output of the stage that failed.',
		'Fix the cause, then start again from that stage with “From …” instead of running every stage.',
		'The checks stage refuses to run while `pnpm dev` servers are up; stop them or start from the proof stage.',
	],
	'key-expiring': [
		'Create a new key at the vendor (Project settings › Connections shows how for each kind).',
		'Save it in Infisical under the same name, then run `pnpm console:env` on this Mac.',
		'On Connections, “Check” confirms the new key at once.',
	],
	'errors-rising': [
		'Open Run › Live logs › Errors only to see the failing requests.',
		'Watch › APM shows which route is failing and since when.',
	],
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
	imports: [Icon, SparkLine],
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
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/list-check" />
									What to do
								</span>
							</div>
							<ul class="rc-lane">
								@for (s of steps[a.rule]; track $index) {
									<li>
										<span class="rc-dot cy"></span>
										<span>
											@for (part of parts(s); track $index) {
												@if ($odd) {
													<code>{{ part }}</code>
												} @else {
													{{ part }}
												}
											}
										</span>
										<span></span>
									</li>
								}
							</ul>
						</div>
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
			<p class="rc-p muted">Reading the alerts…</p>
		}
	`,
})
export class AlertsScreen {
	private readonly api = inject(ConsoleApi);
	readonly tab = input('rules');
	protected readonly icons = RULE_ICONS;
	protected readonly steps = ALERT_STEPS;
	protected readonly at = at;
	protected readonly lasted = lasted;
	/** A step split at its backticks: odd parts are commands, shown as code. */
	protected parts(step: string): string[] {
		return step.split('`');
	}
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
