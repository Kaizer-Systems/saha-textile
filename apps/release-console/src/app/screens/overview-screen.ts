import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VENDOR_NAMES } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

/** The repository's environments at a glance. Those on this computer are live; servers appear once linked. */
@Component({
	selector: 'rc-overview-screen',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-g3">
			@for (env of envs(); track env.name) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">{{ env.label }} · {{ env.runsOn }}</span>
					</div>
					@if (env.local) {
						@if (readiness.data(); as r) {
							@if (r.status !== 'unknown') {
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
							}
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
					} @else {
						<p class="rc-p muted">
							Its servers on {{ env.runsOn }} show here once the console's agent is linked on them.
							{{ env.domains }}
						</p>
					}
				</div>
			}
		</div>
	`,
})
export class OverviewScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly repoId = computed(() => this.ctx.repoId() ?? '');
	protected readonly envs = computed(() => {
		const repo = this.ctx.repo();
		return (repo?.environments ?? []).map((e) => {
			const cloud = repo?.cloud.find((c) => c.id === e.cloudId);
			return {
				name: e.name,
				label: e.label,
				local: !cloud,
				runsOn: cloud ? VENDOR_NAMES[cloud.vendor] : 'this computer',
				domains: e.domains.length ? `Domains: ${e.domains.join(', ')}.` : '',
			};
		});
	});
	protected readonly readiness = injectQuery(() => ({
		queryKey: ['local-readiness', this.repoId()],
		queryFn: () => this.api.localReadiness(this.repoId()),
		refetchInterval: 10_000,
		enabled: !!this.repoId(),
	}));
	protected readonly services = injectQuery(() => ({
		queryKey: ['local-services', this.repoId()],
		queryFn: () => this.api.localServices(this.repoId()),
		refetchInterval: 5000,
		enabled: !!this.repoId(),
	}));
	protected readonly running = computed(
		() => this.services.data()?.services.filter((s) => s.state === 'running').length ?? 0,
	);
}
