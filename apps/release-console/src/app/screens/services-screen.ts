import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { formatBytes } from './format';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { BrandLogo, Icon, serviceLogo } from '../shared/icons';

/** Every container in the chosen environment, refreshed every 5 seconds. Local stack is live today. */
@Component({
	selector: 'rc-services-screen',
	imports: [Icon, BrandLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (!onThisComputer()) {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					<b>No server is linked for this environment.</b>
					Its containers appear here once the console's agent is linked on its server.
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
			<!-- Parts map (brief 26gq3NbcbBESea6abRtsa3, screen 1): the repository's parts from its .release-console.json,
			     each joined to its container by its compose service name. -->
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/sitemap" />
						Parts · from .release-console.json{{ branch() ? ' on ' + branch() : '' }} · read {{ readAt() }}
					</span>
					<button
						type="button"
						class="rc-btn ghost"
						[disabled]="manifest.isFetching() || services.isFetching()"
						(click)="checkAgain()"
					>
						Check again
					</button>
				</div>
				@if (parts().length) {
					<div class="rc-flow">
						@for (p of parts(); track p.id) {
							<div class="rc-job">
								<span
									class="rc-dot"
									[class.ok]="p.tone === 'ok'"
									[class.amber]="p.tone === 'amber'"
									[class.red]="p.tone === 'red'"
								></span>
								<b>{{ p.id }}</b>
								<span class="rc-mono">{{ p.kind }} · {{ p.tech }}</span>
								<small>{{ p.state }}</small>
							</div>
						}
					</div>
				} @else {
					<p class="rc-note">{{ partsNote() }}</p>
				}
			</div>
			<div class="rc-g4">
				<div class="rc-stat">
					<span class="rc-label">
						<rc-icon name="tabler/brand-docker" />
						Containers
					</span>
					<b>{{ rows().length }}</b>
					<small>{{ repoId() }} stack</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">
						<rc-icon name="tabler/player-play" />
						Running
					</span>
					<b class="ok">{{ running() }}</b>
					<small>of {{ rows().length }}</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">
						<rc-icon name="tabler/heart-broken" />
						Unhealthy
					</span>
					<b [class.red]="unhealthy() > 0">{{ unhealthy() }}</b>
					<small>health checks failing</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">
						<rc-icon name="tabler/clock" />
						Read at
					</span>
					<b>{{ readAt() }}</b>
					<small>every 5 s</small>
				</div>
			</div>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/brand-docker" />
						Local stack · Docker on this computer
					</span>
				</div>
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
										<b>
											<rc-brand-logo
												[name]="logo(s.name)"
												[size]="14"
												[label]="s.name"
											/>
										</b>
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
	private readonly ctx = inject(ConsoleContext);
	protected readonly repoId = computed(() => this.ctx.repoId() ?? '');
	/** An environment with no cloud runs on this computer, so Docker here is its truth. */
	protected readonly onThisComputer = computed(() => {
		const env = this.ctx.repo()?.environments.find((e) => e.name === this.state.environment());
		return !!env && env.cloudId === null;
	});
	protected readonly services = injectQuery(() => ({
		queryKey: ['local-services', this.repoId()],
		queryFn: () => this.api.localServices(this.repoId()),
		refetchInterval: 5000,
		enabled: this.onThisComputer() && !!this.repoId(),
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
	/** The repository's manifest, from the open environment's branch. */
	protected readonly branch = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.state.environment())?.branch ?? '',
	);
	protected readonly manifest = injectQuery(() => {
		const repo = this.ctx.repo();
		const repository = repo?.sourceCode.vendor === 'github' ? repo.sourceCode.repository : '';
		const ref = this.branch();
		return {
			queryKey: ['manifest', repository, ref],
			queryFn: () => this.api.repositoryFile({ vendor: 'github', repository, ...(ref ? { ref } : {}) }),
			enabled: !!repository,
			// Read on opening, then every minute while on screen (brief 26gq3NbcbBESea6abRtsa3, refresh table);
			// the containers themselves are read every 5 s above.
			refetchOnMount: 'always' as const,
			refetchInterval: 60_000,
		};
	});
	protected checkAgain(): void {
		void this.manifest.refetch();
		void this.services.refetch();
	}
	/** Each part with its container's state: joined by the compose service name (`<stack>-<service>-1`). */
	protected readonly parts = computed(() => {
		const answer = this.manifest.data();
		const manifest = answer?.state === 'ok' ? answer.data.manifest : null;
		return (manifest?.parts ?? []).map((p) => {
			const c = this.rows().find((s) => s.name === p.service || s.name.endsWith(`-${p.service}-1`));
			const tone = !c
				? 'red'
				: c.state !== 'running' || c.health === 'unhealthy'
					? 'red'
					: c.health === 'starting'
						? 'amber'
						: 'ok';
			const state = c ? `${c.state}${c.health !== 'none' ? ` · ${c.health}` : ''} · ${c.uptime}` : 'no container';
			return { id: p.id, kind: p.kind, tech: p.tech, tone, state };
		});
	});
	protected readonly partsNote = computed(() => {
		const a = this.manifest.data();
		if (this.manifest.isPending()) return 'Reading .release-console.json…';
		if (!a || a.state !== 'ok') return a && 'message' in a ? a.message : 'The manifest could not be read.';
		return a.data.found
			? 'The file lists no parts yet: add "parts" (version 2) to see each part here.'
			: 'No .release-console.json on this branch: add one (version 2) to describe this repository’s parts.';
	});
	protected readonly fmt = formatBytes;
	protected readonly logo = serviceLogo;
}
