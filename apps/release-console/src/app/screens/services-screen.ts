import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { formatBytes } from './format';
import { ConsoleApi } from '../data/console-api';
import { ConsoleState } from '../data/console-state';

/** Every container in the chosen environment, refreshed every 5 seconds. Local stack is live today. */
@Component({
	selector: 'rc-services-screen',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (state.environment() !== 'local') {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					<b>No {{ state.environment() }} server is linked yet.</b>
					The staging droplet is created after development, as planned; its containers appear here once its
					agent is linked.
				</div>
			</div>
		} @else if (services.isPending()) {
			<p class="rc-p muted">Reading Docker on this computer…</p>
		} @else if (services.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>The console API is not answering.</b>
					Start it with
					<code>pnpm console</code>
					. {{ services.error().message }}
				</div>
			</div>
		} @else {
			<div class="rc-g4">
				<div class="rc-stat">
					<span class="rc-label">Containers</span>
					<b>{{ rows().length }}</b>
					<small>saha-textile stack</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">Running</span>
					<b class="ok">{{ running() }}</b>
					<small>of {{ rows().length }}</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">Unhealthy</span>
					<b [class.red]="unhealthy() > 0">{{ unhealthy() }}</b>
					<small>health checks failing</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">Read at</span>
					<b>{{ readAt() }}</b>
					<small>every 5 s</small>
				</div>
			</div>
			<div class="rc-panel">
				<div class="rc-ph"><span class="rc-label">Local stack · Docker on this computer</span></div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Service</th>
								<th>State</th>
								<th>Up</th>
								<th>CPU</th>
								<th>Memory</th>
								<th>Image</th>
							</tr>
						</thead>
						<tbody>
							@for (s of rows(); track s.name) {
								<tr>
									<td>
										<span
											class="rc-dot"
											[class.ok]="s.state === 'running' && s.health !== 'unhealthy'"
											[class.red]="s.state !== 'running' || s.health === 'unhealthy'"
										></span>
										<b>{{ s.name }}</b>
									</td>
									<td>
										<span
											class="rc-pill"
											[class.ok]="s.state === 'running'"
											[class.muted]="s.state !== 'running'"
										>
											{{ s.state }}{{ s.health !== 'none' ? ' · ' + s.health : '' }}
										</span>
									</td>
									<td class="rc-mono">{{ s.uptime }}</td>
									<td class="rc-mono">{{ s.cpuPercent === null ? '—' : s.cpuPercent + '%' }}</td>
									<td class="rc-mono">{{ fmt(s.memoryBytes) }}</td>
									<td class="rc-mono">{{ s.image }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		}
	`,
})
export class ServicesScreen {
	protected readonly state = inject(ConsoleState);
	private readonly api = inject(ConsoleApi);
	protected readonly services = injectQuery(() => ({
		queryKey: ['local-services'],
		queryFn: () => this.api.localServices(),
		refetchInterval: 5000,
		enabled: this.state.environment() === 'local',
	}));
	protected readonly rows = computed(() => this.services.data()?.services ?? []);
	protected readonly running = computed(() => this.rows().filter((s) => s.state === 'running').length);
	protected readonly unhealthy = computed(() => this.rows().filter((s) => s.health === 'unhealthy').length);
	protected readonly readAt = computed(() => {
		const at = this.services.data()?.readAt;
		return at
			? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
			: '—';
	});
	protected readonly fmt = formatBytes;
}
