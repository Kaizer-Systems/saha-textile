import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon } from '../shared/icons';

/** Once a week while open, and at once on opening (owner, 21 Nov). */
export const DOMAINS_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A certificate this close to expiry is shown amber. */
export const EXPIRY_WARNING_DAYS = 30;

/** Days from now to an ISO date, or null. */
export function daysLeft(iso: string | null, now = Date.now()): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : Math.floor((t - now) / 86_400_000);
}

/**
 * Governance › Domains (brief 26gq3NbcbBESea6abRtsa3, screen 9): each Cloudflare zone's edge
 * certificates, and a direct handshake with every server environment's domain.
 */
@Component({
	selector: 'rc-domains-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@for (slot of slots(); track slot) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						<rc-icon name="tabler/certificate" />
						Certificates · {{ readAt() }}
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
				@if (answer(); as a) {
					@if (a.state === 'ok') {
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>Hosts</th>
										<th>Edge certificate</th>
										<th>Expires</th>
									</tr>
								</thead>
								<tbody>
									@for (c of a.data.certificates; track $index) {
										<tr>
											<td class="rc-mono">{{ c.hosts.join(', ') }}</td>
											<td>{{ c.issuer || '—' }} · {{ c.status }}</td>
											<td [class.amber]="soon(c.expiresOn)">{{ when(c.expiresOn) }}</td>
										</tr>
									} @empty {
										<tr><td colspan="3">No edge certificate in this zone.</td></tr>
									}
								</tbody>
							</table>
						</div>
						<span class="rc-label">Each server domain, checked directly</span>
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>Domain</th>
										<th>Environment</th>
										<th>Answers</th>
										<th>Expires</th>
									</tr>
								</thead>
								<tbody>
									@for (h of a.data.hosts; track h.host) {
										<tr>
											<td class="rc-mono">{{ h.host }}</td>
											<td>{{ h.environment }}</td>
											<td
												[class.ok]="h.ok"
												[class.red]="!h.ok"
											>
												{{ h.ok ? h.issuer : h.error }}
											</td>
											<td [class.amber]="soon(h.expiresOn)">{{ when(h.expiresOn) }}</td>
										</tr>
									} @empty {
										<tr><td colspan="4">No environment runs on a server yet.</td></tr>
									}
								</tbody>
							</table>
						</div>
					} @else {
						<p class="rc-note">{{ a.message }}</p>
					}
				} @else {
					<p class="rc-note">Reading Cloudflare and the domains…</p>
				}
			</div>
		} @empty {
			<p class="rc-note">This repository has no Cloudflare edge platform.</p>
		}
	`,
})
export class DomainsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly slots = computed(() =>
		(this.ctx.repo()?.edge ?? []).filter((e) => e.vendor === 'cloudflare').map((e) => e.id),
	);
	protected readonly view = injectQuery(() => ({
		queryKey: ['domains', this.ctx.projectId(), this.ctx.repoId(), this.slots()[0]],
		queryFn: () =>
			this.api.certificates(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.slots()[0] ?? ''),
		enabled: !!this.slots()[0],
		refetchOnMount: 'always' as const,
		refetchInterval: DOMAINS_REFRESH_MS,
	}));
	protected readonly answer = computed(() => this.view.data());
	protected readonly readAt = computed(() =>
		this.view.dataUpdatedAt()
			? `read ${new Date(this.view.dataUpdatedAt()).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);
	protected soon(iso: string | null): boolean {
		const d = daysLeft(iso);
		return d !== null && d < EXPIRY_WARNING_DAYS;
	}
	protected when(iso: string | null): string {
		const d = daysLeft(iso);
		return d === null
			? '—'
			: `${new Date(iso as string).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d} days`;
	}
}
