import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';

/** Every environment at a glance. Local is live; staging and production appear once they exist. */
@Component({
	selector: 'rc-overview-screen',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-g3">
			<div class="rc-panel">
				<div class="rc-ph"><span class="rc-label">Local stack · this computer</span></div>
				@if (readiness.data(); as r) {
					<p class="rc-p">
						<span
							class="rc-dot"
							[class.ok]="r.status === 'ok'"
							[class.amber]="r.status === 'degraded'"
							[class.red]="r.status === 'down'"
						></span>
						Shop API:
						<b>{{ r.reachable ? r.status : 'not running' }}</b>
					</p>
				} @else if (readiness.isError()) {
					<p class="rc-p red">
						The console API is not answering. Start it with
						<code>pnpm console</code>
						.
					</p>
				}
				@if (services.data(); as s) {
					<p class="rc-p">
						Containers:
						<b>{{ running() }}</b>
						running of {{ s.services.length }}
					</p>
				}
			</div>
			<div class="rc-panel">
				<div class="rc-ph"><span class="rc-label">Staging</span></div>
				<p class="rc-p muted">
					Not created yet. The staging droplet is made when development is complete (deployment plan, step 3).
				</p>
			</div>
			<div class="rc-panel">
				<div class="rc-ph"><span class="rc-label">Production</span></div>
				<p class="rc-p muted">Not created yet. Production comes after staging and the go-live checks.</p>
			</div>
		</div>
	`,
})
export class OverviewScreen {
	private readonly api = inject(ConsoleApi);
	protected readonly readiness = injectQuery(() => ({
		queryKey: ['local-readiness'],
		queryFn: () => this.api.localReadiness(),
		refetchInterval: 10_000,
	}));
	protected readonly services = injectQuery(() => ({
		queryKey: ['local-services'],
		queryFn: () => this.api.localServices(),
		refetchInterval: 5000,
	}));
	protected readonly running = computed(
		() => this.services.data()?.services.filter((s) => s.state === 'running').length ?? 0,
	);
}
