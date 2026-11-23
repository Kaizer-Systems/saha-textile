import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { when } from '../pages/format-time';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';

/**
 * Run › Server, Infrastructure, Live logs and Watch › Health on an environment that runs on a server
 * (Release Path brief Part 7, Q8 approved 23 Nov): the server from DigitalOcean's monitoring, the
 * shop from the API's /ops address, containers and logs through the observer login once the server
 * has it. The same panels as the brief's Infrastructure drawing; this Mac's screens stay as they are.
 */
@Component({
	selector: 'rc-server-state',
	imports: [Icon, Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (view.data(); as s) {
			<div class="rc-g3">
				<div class="rc-panel">
					<span class="rc-label">
						<rc-icon name="tabler/server" />
						Server · DigitalOcean monitoring
					</span>
					@if (s.machine.state === 'ok') {
						<span class="rc-mono">
							CPU {{ pct(s.machine.cpuPercent) }} · memory {{ pct(s.machine.memoryPercent) }} · disk
							{{ pct(s.machine.diskPercent) }}
						</span>
					}
					<span class="rc-note">{{ s.machine.message }}</span>
				</div>
				<div class="rc-panel">
					<span class="rc-label">
						<rc-icon name="tabler/building-store" />
						Shop · /ops
					</span>
					<span
						[class.ok]="s.shop.state === 'ok' && s.shop.message === 'queues empty'"
						[class.amber]="s.shop.state !== 'ok' || s.shop.message !== 'queues empty'"
					>
						{{ s.shop.state === 'ok' ? 'ready · ' + s.shop.message : s.shop.message }}
					</span>
				</div>
				<div class="rc-panel">
					<span class="rc-label">
						<rc-icon name="tabler/brand-docker" />
						Containers · observer
					</span>
					<span class="rc-note">{{ s.containers.message }}</span>
				</div>
			</div>
			@if (s.shop.queues.length) {
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Queue</th>
								<th>Waiting</th>
								<th>Active</th>
								<th>Delayed</th>
								<th>Failed</th>
							</tr>
						</thead>
						<tbody>
							@for (q of s.shop.queues; track q.queue) {
								<tr>
									<td class="rc-mono">{{ q.queue }}</td>
									<td>{{ q.waiting }}</td>
									<td>{{ q.active }}</td>
									<td>{{ q.delayed }}</td>
									<td [class.red]="q.failed > 0">{{ q.failed }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			}
			<p class="rc-note">
				Read {{ when(s.readAt) }} for {{ envLabel() }}: no new open port and no agent on the server. This Mac's
				own containers are on the Local tab.
			</p>
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>The server could not be read.</b>
					{{ view.error().message }}
				</div>
			</div>
		} @else {
			<rc-loading what="Reading the server from DigitalOcean and the shop's /ops…" />
		}
	`,
})
export class ServerStateScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	protected readonly when = when;
	private readonly envName = computed(() => this.state.environment());
	protected readonly envLabel = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.envName())?.label ?? this.envName(),
	);
	protected readonly view = injectQuery(() => ({
		queryKey: ['server-state', this.ctx.projectId(), this.ctx.repoId(), this.envName()],
		queryFn: () => this.api.serverState(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.envName()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId() && !!this.envName(),
		refetchInterval: 60_000,
	}));
	protected pct(v: number | null): string {
		return v === null ? '—' : `${Math.round(v)}%`;
	}
}
