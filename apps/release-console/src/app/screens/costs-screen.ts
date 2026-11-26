import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VENDOR_NAMES, type Vendor } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectEnvTags } from './env-tag-dialog';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';
import { VendorLogo } from '../shared/vendor-logo';

/** Once a day while open (brief 26gq3NbcbBESea6abRtsa3: billing changes about daily), and at once on opening. */
export const COSTS_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Governance › Costs and quotas (brief 26gq3NbcbBESea6abRtsa3, screen 10): what each service of this
 * repository charges this month. DigitalOcean's figures come from its billing read (the read key
 * linked on Connections); a service whose bill the console cannot read says so.
 */
@Component({
	selector: 'rc-costs-screen',
	imports: [Loading, Icon, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/receipt" />
					This month · {{ readAt() }}
				</span>
				<button
					type="button"
					class="rc-btn ghost"
					[disabled]="bills.isFetching()"
					(click)="bills.refetch()"
				>
					Check again
				</button>
			</div>
			@if (bills.isPending()) {
				<rc-loading what="Reading DigitalOcean's billing…" />
			}
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Service</th>
							<th>This month so far</th>
							<th>Balance</th>
							<th>Read from</th>
						</tr>
					</thead>
					<tbody>
						@for (b of bills.data() ?? []; track b.slot) {
							<tr>
								<td>
									<rc-vendor-logo
										vendor="digitalocean"
										[size]="14"
									/>
								</td>
								@if (b.ok) {
									<td class="rc-mono">{{ money(b.usage) }}</td>
									<td class="rc-mono">{{ money(b.balance) }}</td>
									<td>DigitalOcean billing</td>
								} @else {
									<td colspan="3">
										<span class="rc-note">{{ b.message }}</span>
									</td>
								}
							</tr>
						}
						@for (v of others(); track v) {
							<tr>
								<td>
									<rc-vendor-logo
										[vendor]="v"
										[size]="14"
									/>
								</td>
								<td colspan="3">
									<span class="rc-note">The console reads no bill from {{ names[v] }}.</span>
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		@if (slots().length) {
			<!-- Owner, 23 Nov: costs per environment, from each server's environment tag. -->
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/server" />
						Servers by environment · monthly list price
					</span>
				</div>
				@if (servers.isPending()) {
					<rc-loading what="Reading DigitalOcean's droplets and prices…" />
				}
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Environment</th>
								<th>Servers</th>
								<th>A month</th>
							</tr>
						</thead>
						<tbody>
							@for (g of byEnv(); track g.env) {
								<tr>
									<td>{{ g.env }}</td>
									<td class="rc-mono">{{ g.names.join(', ') }}</td>
									<td class="rc-mono">{{ g.monthly === null ? '—' : '$' + g.monthly.toFixed(2) }}</td>
								</tr>
							} @empty {
								<tr><td colspan="3">No droplets on this account.</td></tr>
							}
						</tbody>
					</table>
				</div>
				<p class="rc-note">
					Each server counts under the environment it is tagged with on DigitalOcean › Droplets; volumes,
					backups and snapshots are billed on top.
				</p>
			</div>
		}
	`,
})
export class CostsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly names = VENDOR_NAMES;
	private readonly slots = computed(() => (this.ctx.repo()?.cloud ?? []).filter((c) => c.vendor === 'digitalocean'));
	protected readonly bills = injectQuery(() => ({
		queryKey: ['costs', this.ctx.projectId(), this.ctx.repoId(), this.slots().map((s) => s.id)],
		queryFn: () =>
			Promise.all(
				this.slots().map(async (s) => {
					const a = await this.api.cloudAccount(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', s.id);
					return a.state === 'ok'
						? {
								slot: s.id,
								ok: true,
								usage: a.data.monthToDateUsage,
								balance: a.data.accountBalance,
								message: '',
							}
						: { slot: s.id, ok: false, usage: null, balance: null, message: a.message };
				}),
			),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
		refetchInterval: COSTS_REFRESH_MS,
	}));
	private readonly tags = injectEnvTags();
	protected readonly servers = injectQuery(() => ({
		queryKey: ['costs-servers', this.ctx.projectId(), this.ctx.repoId(), this.slots().map((s) => s.id)],
		queryFn: () =>
			Promise.all(
				this.slots().map(async (s) => {
					const p = this.ctx.projectId() ?? '';
					const r = this.ctx.repoId() ?? '';
					const [droplets, catalog] = await Promise.all([
						this.api.droplets(p, r, s.id),
						this.api.doCatalog(p, r, s.id),
					]);
					const price = new Map(
						(catalog.state === 'ok' ? catalog.data.sizes : []).map((z) => [z.slug, z.priceMonthly]),
					);
					return (droplets.state === 'ok' ? droplets.data : []).map((d) => ({
						id: d.id,
						name: d.name,
						monthly: price.get(d.size) ?? null,
					}));
				}),
			).then((all) => all.flat()),
		enabled: this.slots().length > 0,
		refetchOnMount: 'always' as const,
		refetchInterval: COSTS_REFRESH_MS,
	}));
	/** Servers grouped by their environment tag, untagged ones last. */
	protected readonly byEnv = computed(() => {
		const envs = this.ctx.repo()?.environments ?? [];
		const tags = this.tags.data() ?? {};
		const groups = new Map<string, { env: string; names: string[]; monthly: number | null }>();
		for (const d of this.servers.data() ?? []) {
			const name = tags[`do:droplet:${d.id}`];
			const env = name ? (envs.find((e) => e.name === name)?.label ?? name) : 'no environment';
			const g = groups.get(env) ?? { env, names: [], monthly: 0 };
			g.names.push(d.name);
			g.monthly = g.monthly === null || d.monthly === null ? null : g.monthly + d.monthly;
			groups.set(env, g);
		}
		return [...groups.values()].sort((a, b) =>
			a.env === 'no environment' ? 1 : b.env === 'no environment' ? -1 : a.env.localeCompare(b.env),
		);
	});
	/** The repository's other services: their bills are not read. */
	protected readonly others = computed(() => {
		const r = this.ctx.repo();
		if (!r) return [] as Vendor[];
		const all: Vendor[] = [r.sourceCode.vendor, ...r.edge.map((e) => e.vendor), ...r.secrets.map((x) => x.vendor)];
		return [...new Set(all)];
	});
	protected readonly readAt = computed(() =>
		this.bills.dataUpdatedAt()
			? `read ${new Date(this.bills.dataUpdatedAt()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);
	protected money(value: string | null): string {
		return value === null || value === '' ? '—' : `$${value}`;
	}
}
