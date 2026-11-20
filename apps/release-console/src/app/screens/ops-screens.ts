import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { Icon } from '../shared/icons';

/** Both screens read every minute while open, and at once on opening (brief's refresh table). */
export const OPS_REFRESH_MS = 60 * 1000;

/** A channel's delivered-or-sent share, as a whole percent; '—' without messages. */
export function reachedShare(c: { total: number; sent: number; delivered: number }): string {
	return c.total ? `${Math.round((100 * (c.sent + c.delivered)) / c.total)}%` : '—';
}

const CHANNEL_NAMES: Record<string, string> = { sms: 'Texts (SMS)', email: 'Emails', whatsapp: 'WhatsApp' };
export const channelName = (c: string): string => CHANNEL_NAMES[c] ?? c;

const readAt = (at: number) =>
	at ? `read ${new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'reading…';

/**
 * Run › Job queues (brief 26gq3NbcbBESea6abRtsa3, screen 8): each background queue's waiting,
 * running, delayed and failed jobs, from the shop API's read-only `/ops` address.
 */
@Component({
	selector: 'rc-jobs-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/stack-2" />
					Queues · {{ read() }}
				</span>
				<button
					type="button"
					class="rc-btn ghost"
					[disabled]="view.isFetching()"
					(click)="view.refetch()"
				>
					Check again
				</button>
			</div>
			@if (view.data(); as a) {
				@if (a.state === 'ok') {
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Queue</th>
									<th>Waiting</th>
									<th>Running</th>
									<th>Delayed</th>
									<th>Failed</th>
									<th>Done (kept)</th>
								</tr>
							</thead>
							<tbody>
								@for (q of a.data.queues; track q.queue) {
									<tr>
										<td class="rc-mono">{{ q.queue }}</td>
										<td
											class="rc-mono"
											[class.amber]="q.waiting > 10"
										>
											{{ q.waiting }}
										</td>
										<td class="rc-mono">{{ q.active }}</td>
										<td class="rc-mono">{{ q.delayed }}</td>
										<td
											class="rc-mono"
											[class.red]="q.failed > 0"
										>
											{{ q.failed }}
										</td>
										<td class="rc-mono">{{ q.completed }}</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="6">Redis answered for no queue.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
					<p class="rc-note">
						Counts only, never a job's data. Scheduled jobs (search changes, exchange rates, mail sync) keep
						their runs elsewhere and come later.
					</p>
				} @else {
					<p class="rc-note">{{ a.message }}</p>
				}
			} @else {
				<p class="rc-note">Reading the shop API's operations address…</p>
			}
		</div>
	`,
})
export class JobsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	protected readonly view = injectQuery(() => ({
		queryKey: ['ops-jobs', this.ctx.projectId(), this.ctx.repoId(), this.state.environment()],
		queryFn: () => this.api.opsJobs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.state.environment()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
		refetchInterval: OPS_REFRESH_MS,
	}));
	protected readonly read = computed(() => readAt(this.view.dataUpdatedAt()));
}

/**
 * Messages (brief 26gq3NbcbBESea6abRtsa3, screen 3): every text and email the shop sent in the last
 * 24 hours per channel and how each ended, from the API's outbox through `/ops`. Never a destination
 * or a message's text.
 */
@Component({
	selector: 'rc-messages-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-note">Last 24 hours · {{ read() }}</span>
			<button
				type="button"
				class="rc-btn ghost"
				[disabled]="view.isFetching()"
				(click)="view.refetch()"
			>
				Check again
			</button>
		</div>
		@if (view.data(); as a) {
			@if (a.state === 'ok') {
				<div class="rc-g4">
					@for (c of a.data.channels; track c.channel) {
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/send" />
								{{ name(c.channel) }}
							</span>
							<b [class.ok]="c.failed === 0">{{ c.total }}</b>
							<small>
								{{ reached(c) }} sent or delivered · {{ c.failed }} failed · {{ c.suppressed }} held
								back
							</small>
						</div>
					} @empty {
						<div class="rc-stat">
							<span class="rc-label">
								<rc-icon name="tabler/send" />
								Messages
							</span>
							<b>0</b>
							<small>nothing sent in 24 hours</small>
						</div>
					}
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/key" />
							Sign-in codes
						</span>
						<b>—</b>
						<small>success needs a counter the API does not keep yet</small>
					</div>
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/coin" />
							MSG91 balance
						</span>
						<b>—</b>
						<small>after MSG91 onboarding (MSG91_AUTH_KEY)</small>
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/list" />
							Newest messages
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>When</th>
									<th>Kind</th>
									<th>Template</th>
									<th>Result</th>
								</tr>
							</thead>
							<tbody>
								@for (m of a.data.recent; track $index) {
									<tr>
										<td class="rc-mono">{{ when(m.at) }}</td>
										<td>{{ name(m.channel) }}</td>
										<td class="rc-mono">{{ m.template }}</td>
										<td
											[class.ok]="m.status === 'sent' || m.status === 'delivered'"
											[class.red]="m.status === 'failed'"
										>
											{{ m.status }}
										</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="4">No messages in the last 24 hours.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
					<p class="rc-note">
						The console never shows a phone number, an email address, a message's text or a code.
					</p>
				</div>
			} @else {
				<p class="rc-note">{{ a.message }}</p>
			}
		} @else {
			<p class="rc-note">Reading the shop API's operations address…</p>
		}
	`,
})
export class MessagesScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	protected readonly name = channelName;
	protected readonly reached = reachedShare;
	protected readonly view = injectQuery(() => ({
		queryKey: ['ops-messages', this.ctx.projectId(), this.ctx.repoId(), this.state.environment()],
		queryFn: () =>
			this.api.opsMessages(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.state.environment()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
		refetchInterval: OPS_REFRESH_MS,
	}));
	protected readonly read = computed(() => readAt(this.view.dataUpdatedAt()));
	protected when(iso: string): string {
		return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
	}
}
