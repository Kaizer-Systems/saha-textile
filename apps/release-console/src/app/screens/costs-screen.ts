import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { VENDOR_NAMES, type Vendor } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon } from '../shared/icons';
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
	imports: [Icon, VendorLogo],
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
