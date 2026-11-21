import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VENDOR_NAMES } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { BrandLogo, Icon, environmentIcon, serviceLogo } from '../shared/icons';
import { Loading } from '../shared/loading';
import { VendorLogo } from '../shared/vendor-logo';

/** The repository's environments at a glance. Those on this computer are live; servers appear once linked. */
@Component({
	selector: 'rc-overview-screen',
	imports: [Loading, Icon, VendorLogo, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-g3">
			@for (env of envs(); track env.name) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon [name]="env.icon" />
							{{ env.label }}
						</span>
						@if (env.vendor) {
							<rc-vendor-logo
								[vendor]="env.vendor"
								[size]="14"
							/>
						} @else {
							<span class="rc-mono">
								<rc-icon name="tabler/device-laptop" />
								this computer
							</span>
						}
					</div>
					@if (env.local) {
						@if (readiness.isPending() || services.isPending()) {
							<rc-loading what="Checking this computer's stack…" />
						}
						@if (readiness.data(); as r) {
							@if (r.status !== 'unknown') {
								<p class="rc-p">
									<span
										class="rc-dot"
										[class.ok]="r.status === 'ok'"
										[class.amber]="r.status === 'degraded'"
										[class.red]="r.status === 'down'"
									></span>
									<rc-brand-logo
										[name]="apiLogo"
										[size]="14"
									/>
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
								<rc-brand-logo
									name="logos/docker-icon"
									[size]="14"
								/>
								Containers:
								<b>{{ running() }}</b>
								running of {{ s.services.length }}
							</p>
						}
					} @else {
						<p class="rc-p muted">
							Its servers on {{ env.runsOnName }} show here once the console's agent is linked on them.
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
	protected readonly apiLogo = serviceLogo('api');
	protected readonly envs = computed(() => {
		const repo = this.ctx.repo();
		return (repo?.environments ?? []).map((e) => {
			const cloud = repo?.cloud.find((c) => c.id === e.cloudId);
			return {
				name: e.name,
				label: e.label,
				local: !cloud,
				icon: environmentIcon(e.name, !cloud),
				vendor: cloud?.vendor ?? null,
				runsOnName: cloud ? VENDOR_NAMES[cloud.vendor] : 'this computer',
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
