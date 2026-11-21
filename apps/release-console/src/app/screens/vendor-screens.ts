import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { SshList } from './ssh-list';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';
import { VendorLogo } from '../shared/vendor-logo';

import type { VendorAnswer } from '@saha-textile/release-console-contracts';

/** Why a vendor screen has no data: not connected (amber, with the way to connect) or an error (red). */
@Component({
	imports: [Loading],
	selector: 'rc-vendor-state',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let a = answer();
		@if (pending()) {
			<rc-loading [what]="'Reading ' + vendor() + '…'" />
		} @else if (failed()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>The console API is not answering.</b>
					Start it with
					<code>pnpm console</code>
					.
				</div>
			</div>
		} @else if (a && a.state === 'not-connected') {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					<b>Not connected.</b>
					{{ a.message }}
				</div>
				<button
					type="button"
					class="rc-btn"
					(click)="connect()"
				>
					Open Connections ›
				</button>
			</div>
		} @else if (a && a.state === 'error') {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>{{ vendor() }} answered with an error.</b>
					{{ a.message }}
				</div>
			</div>
		} @else if (a && a.state === 'ok') {
			<ng-content />
		}
	`,
})
export class VendorState {
	private readonly router = inject(Router);
	private readonly ctx = inject(ConsoleContext);
	readonly vendor = input.required<string>();
	readonly answer = input<VendorAnswer<unknown> | undefined>(undefined);
	readonly pending = input(false);
	readonly failed = input(false);
	protected connect(): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'settings'], { queryParams: { tab: 'connections' } });
	}
}

const ok = <T>(a: VendorAnswer<T> | undefined): T | null => (a?.state === 'ok' ? a.data : null);

/** Ship › Code › Pull requests: open pull requests, read live from GitHub. */
@Component({
	selector: 'rc-pulls-screen',
	imports: [VendorState, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="GitHub"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-vendor-logo
							vendor="github"
							[named]="false"
							[size]="14"
						/>
						Open pull requests · {{ rows().length }} · read {{ when(readAt()) }}
					</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>#</th>
								<th>Title</th>
								<th>Author</th>
								<th>Branch</th>
								<th>Updated</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (p of rows(); track p.number) {
								<tr>
									<td class="rc-mono">{{ p.number }}</td>
									<td>
										<b>{{ p.title }}</b>
										@if (p.draft) {
											<span class="rc-pill muted">draft</span>
										}
									</td>
									<td>{{ p.author }}</td>
									<td class="rc-mono">{{ p.branch }} → {{ p.base }}</td>
									<td class="rc-mono">{{ when(p.updatedAt) }}</td>
									<td>
										<a
											class="rc-mono"
											[href]="p.url"
											target="_blank"
											rel="noopener"
										>
											GitHub ↗
										</a>
									</td>
								</tr>
							} @empty {
								<tr><td colspan="6">No open pull requests.</td></tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		</rc-vendor-state>
	`,
})
export class PullsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly when = when;
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'pulls', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.pulls(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
		refetchInterval: 60_000,
	}));
	protected readonly rows = computed(() => ok(this.q.data()) ?? []);
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});
}

/** Ship › Code › Pipelines: the latest workflow runs, read live from GitHub Actions. */
@Component({
	selector: 'rc-pipelines-screen',
	imports: [VendorState, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="GitHub"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-vendor-logo
							vendor="github-secrets"
							[named]="false"
							[size]="14"
						/>
						Workflow runs · latest {{ rows().length }} · read {{ when(readAt()) }}
					</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Workflow</th>
								<th>Branch</th>
								<th>Event</th>
								<th>State</th>
								<th>Started</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (r of rows(); track r.id) {
								@let s = stateOf(r.status, r.conclusion);
								<tr>
									<td>
										<b>{{ r.name }}</b>
									</td>
									<td class="rc-mono">{{ r.branch }}</td>
									<td class="rc-mono">{{ r.event }}</td>
									<td>
										<span
											class="rc-pill"
											[class]="s[0]"
										>
											{{ s[1] }}
										</span>
									</td>
									<td class="rc-mono">{{ when(r.createdAt) }}</td>
									<td>
										<a
											class="rc-mono"
											[href]="r.url"
											target="_blank"
											rel="noopener"
										>
											GitHub ↗
										</a>
									</td>
								</tr>
							} @empty {
								<tr><td colspan="6">No runs yet.</td></tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		</rc-vendor-state>
	`,
})
export class PipelinesScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly when = when;
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'runs', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.runs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
		refetchInterval: 30_000,
	}));
	protected readonly rows = computed(() => ok(this.q.data()) ?? []);
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});
	protected stateOf(status: string, conclusion: string | null): [string, string] {
		if (status === 'waiting') return ['amber', 'waiting for approval'];
		if (status !== 'completed') return ['cy', status.replace('_', ' ')];
		if (conclusion === 'success') return ['ok', 'passed'];
		if (conclusion === 'failure') return ['red', 'failed'];
		return ['muted', conclusion ?? 'done'];
	}
}

/** The repository's first DigitalOcean slot, the one these screens read. */
function doSlot(ctx: ConsoleContext): string {
	return ctx.repo()?.cloud.find((c) => c.vendor === 'digitalocean')?.id ?? '';
}
function cfSlot(ctx: ConsoleContext) {
	return ctx.repo()?.edge.find((e) => e.vendor === 'cloudflare') ?? null;
}

/** DigitalOcean › Compute › Droplets: every droplet the read key sees. */
@Component({
	selector: 'rc-droplets-screen',
	imports: [VendorState, VendorLogo, SshList],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="DigitalOcean"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			<div class="rc-g4">
				<div class="rc-stat">
					<span class="rc-label">Droplets</span>
					<b>{{ rows().length }}</b>
					<small>{{ running() }} running · {{ rows().length - running() }} not running</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">This month</span>
					<b>{{ month() ? '$' + month() : '—' }}</b>
					<small>whole account · DigitalOcean billing</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">Droplet limit</span>
					<b>{{ limit() ?? '—' }}</b>
					<small>on this account</small>
				</div>
				<div class="rc-stat">
					<span class="rc-label">Read</span>
					<b>{{ when(readAt()) }}</b>
					<small>with the read key, every minute</small>
				</div>
			</div>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-vendor-logo
							vendor="digitalocean"
							[named]="false"
							[size]="14"
						/>
						Droplets · {{ rows().length }}
					</span>
					<div class="rc-row">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="open('creating')"
						>
							Create and destroy jobs
						</button>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="open('destroy')"
						>
							Destroy a server
						</button>
						<button
							type="button"
							class="rc-btn primary"
							(click)="open('region')"
						>
							<span
								class="lock"
								aria-hidden="true"
							></span>
							Create droplet
						</button>
					</div>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Name</th>
								<th>Status</th>
								<th>Region</th>
								<th>Size</th>
								<th>CPU · memory · disk</th>
								<th>IPv4</th>
								<th>Tags</th>
							</tr>
						</thead>
						<tbody>
							@for (d of rows(); track d.id) {
								<tr>
									<td>
										<span
											class="rc-dot"
											[class.ok]="d.status === 'active'"
											[class.red]="d.status === 'off'"
											[class.amber]="d.status === 'new'"
										></span>
										<b>{{ d.name }}</b>
									</td>
									<td>{{ d.status }}</td>
									<td class="rc-mono">{{ d.region }}</td>
									<td class="rc-mono">{{ d.size }}</td>
									<td class="rc-mono">
										{{ d.vcpus }} vCPU · {{ d.memoryMb / 1024 }} GB · {{ d.diskGb }} GB
									</td>
									<td class="rc-mono">{{ d.ipv4 ?? '—' }}</td>
									<td class="rc-mono">{{ d.tags.join(', ') || '—' }}</td>
								</tr>
							} @empty {
								<tr><td colspan="7">No droplets on this account.</td></tr>
							}
						</tbody>
					</table>
				</div>
			</div>
			<rc-ssh-list />
		</rc-vendor-state>
	`,
})
export class DropletsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly when = when;
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'droplets', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.droplets(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', doSlot(this.ctx)),
		refetchInterval: 60_000,
	}));
	protected readonly rows = computed(() => ok(this.q.data()) ?? []);
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});
	private readonly router = inject(Router);
	private readonly account = injectQuery(() => ({
		queryKey: ['vendor', 'do-account', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.cloudAccount(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', doSlot(this.ctx)),
	}));
	protected readonly running = computed(() => this.rows().filter((d) => d.status === 'active').length);
	protected readonly month = computed(() => ok(this.account.data())?.monthToDateUsage ?? null);
	protected readonly limit = computed(() => ok(this.account.data())?.dropletLimit ?? null);
	protected open(tab: string): void {
		void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
	}
}

/** DigitalOcean › Manage › Cloud account: the account, droplet limit and this cycle's usage. */
@Component({
	selector: 'rc-do-account-screen',
	imports: [VendorState, Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="DigitalOcean"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			@if (account(); as a) {
				<div class="rc-g4">
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/users" />
							Team
						</span>
						<b>{{ a.team || '—' }}</b>
						<small>{{ a.status }}</small>
					</div>
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/droplet" />
							Droplet limit
						</span>
						<b>{{ a.dropletLimit }}</b>
						<small>on this account</small>
					</div>
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/receipt" />
							This cycle so far
						</span>
						<b>{{ a.monthToDateUsage ? '$' + a.monthToDateUsage : '—' }}</b>
						<small>month to date</small>
					</div>
					<div class="rc-stat">
						<span class="rc-label">
							<rc-icon name="tabler/coin" />
							Balance
						</span>
						<b>{{ a.accountBalance ? '$' + a.accountBalance : '—' }}</b>
						<small>{{ a.accountBalance ? 'account balance' : 'needs the billing read scope' }}</small>
					</div>
				</div>
			}
		</rc-vendor-state>
	`,
})
export class DoAccountScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'do-account', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.cloudAccount(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', doSlot(this.ctx)),
	}));
	protected readonly account = computed(() => ok(this.q.data()));
}

/** Cloudflare › Account › Domains: every site (zone) the read token sees. */
@Component({
	selector: 'rc-cf-domains-screen',
	imports: [VendorState, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="Cloudflare"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-vendor-logo
							vendor="cloudflare"
							[named]="false"
							[size]="14"
						/>
						Sites on the account · read {{ when(readAt()) }}
					</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Domain</th>
								<th>Status</th>
								<th>Plan</th>
								<th>Account</th>
							</tr>
						</thead>
						<tbody>
							@for (z of rows(); track z.id) {
								<tr>
									<td>
										<span
											class="rc-dot"
											[class.ok]="z.status === 'active'"
											[class.amber]="z.status !== 'active'"
										></span>
										<b>{{ z.name }}</b>
									</td>
									<td>{{ z.status }}</td>
									<td>{{ z.plan }}</td>
									<td>{{ z.account }}</td>
								</tr>
							} @empty {
								<tr><td colspan="4">The token sees no site.</td></tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		</rc-vendor-state>
	`,
})
export class CfDomainsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly when = when;
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'zones', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.zones(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', cfSlot(this.ctx)?.id ?? ''),
	}));
	protected readonly rows = computed(() => ok(this.q.data()) ?? []);
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});
}

/** Cloudflare › Domain › DNS: every record in the slot's first zone. */
@Component({
	selector: 'rc-dns-screen',
	imports: [VendorState, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="Cloudflare"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-vendor-logo
							vendor="cloudflare"
							[named]="false"
							[size]="14"
						/>
						{{ zone() }} · {{ rows().length }} records · read {{ when(readAt()) }}
					</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Type</th>
								<th>Name</th>
								<th>Content</th>
								<th>Proxy</th>
								<th>TTL</th>
							</tr>
						</thead>
						<tbody>
							@for (r of rows(); track r.id) {
								<tr>
									<td class="rc-mono">
										<b>{{ r.type }}</b>
									</td>
									<td class="rc-mono">{{ r.name }}</td>
									<td class="rc-mono">{{ r.content }}</td>
									<td>
										@if (r.proxied === null) {
											—
										} @else {
											<span
												class="rc-pill"
												[class.amber]="r.proxied"
												[class.muted]="!r.proxied"
											>
												{{ r.proxied ? 'proxied' : 'DNS only' }}
											</span>
										}
									</td>
									<td class="rc-mono">{{ r.ttl === 1 ? 'auto' : r.ttl }}</td>
								</tr>
							} @empty {
								<tr><td colspan="5">No records.</td></tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		</rc-vendor-state>
	`,
})
export class DnsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly when = when;
	protected readonly zone = computed(() => cfSlot(this.ctx)?.zones[0] ?? '');
	protected readonly q = injectQuery(() => ({
		queryKey: ['vendor', 'dns', this.ctx.projectId(), this.ctx.repoId(), this.zone()],
		queryFn: () =>
			this.api.dns(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', cfSlot(this.ctx)?.id ?? '', this.zone()),
		enabled: !!this.zone(),
	}));
	protected readonly rows = computed(() => ok(this.q.data()) ?? []);
	protected readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});
}
