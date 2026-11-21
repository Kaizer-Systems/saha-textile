import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';

/** Every minute while open, and at once on opening (brief's refresh table). */
export const CLIENTS_REFRESH_MS = 60 * 1000;

/** A share as a whole percent, or '—' without requests. */
export function share(part: number, whole: number): string {
	return whole ? `${Math.round((100 * part) / whole)}%` : '—';
}

/**
 * Client versions (brief 26gq3NbcbBESea6abRtsa3, screen 4): which builds of the shop and the admin
 * people are running, in the browser or as the installed app, from the build number each sends with
 * its first call after a page load (the edge logs it; the console counts it once a minute).
 */
@Component({
	selector: 'rc-clients-screen',
	imports: [Loading, Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-banner small">
			<span class="rc-dot cy"></span>
			<div>
				<b>Why this matters:</b>
				a shopper who had the shop open, or installed it as an app, keeps running the old build until it
				reloads. If a release changes the API, old builds can break. This shows how many are still out there.
			</div>
		</div>
		<div class="rc-row between">
			<span class="rc-note">Last 24 hours · {{ readAt() }}</span>
			<button
				type="button"
				class="rc-btn ghost"
				[disabled]="view.isFetching()"
				(click)="view.refetch()"
			>
				Check again
			</button>
		</div>
		@if (view.data(); as v) {
			@for (a of v.apps; track a.service) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							<rc-icon name="tabler/versions" />
							{{ a.service === 'storefront' ? 'Shop' : a.service === 'admin' ? 'Admin' : a.service }}
							builds
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Build</th>
									<th>Calls · 24 h</th>
									<th>Last hour</th>
									<th>Installed app</th>
									<th>First seen</th>
									<th>Last seen</th>
								</tr>
							</thead>
							<tbody>
								@for (b of a.builds; track b.build; let first = $first) {
									<tr>
										<td
											class="rc-mono"
											[class.ok]="first"
											[class.amber]="!first && b.lastHour > 0"
										>
											{{ b.build }}{{ first ? ' (newest)' : '' }}
										</td>
										<td class="rc-mono">{{ b.requests }}</td>
										<td class="rc-mono">{{ b.lastHour }}</td>
										<td class="rc-mono">{{ share(b.installed, b.requests) }}</td>
										<td class="rc-mono">{{ when(b.firstAt) }}</td>
										<td class="rc-mono">{{ when(b.lastAt) }}</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
					<p class="rc-note">
						An old build quiet for a day can be forgotten; the API may then drop what only it used.
					</p>
				</div>
			} @empty {
				<p class="rc-note">
					No build has called in the last 24 hours. Builds made by the pipeline send their build number; a
					local
					<code>pnpm dev</code>
					run does not.
					@if (v.source === 'none') {
						The stack’s edge is not running, so there is no request log to read.
					}
				</p>
			}
		} @else {
			<rc-loading what="Reading the request log…" />
		}
	`,
})
export class ClientsScreen {
	private readonly api = inject(ConsoleApi);
	protected readonly share = share;
	protected readonly view = injectQuery(() => ({
		queryKey: ['client-builds'],
		queryFn: () => this.api.clientBuilds(24),
		refetchOnMount: 'always' as const,
		refetchInterval: CLIENTS_REFRESH_MS,
	}));
	protected readonly readAt = computed(() =>
		this.view.dataUpdatedAt()
			? `read ${new Date(this.view.dataUpdatedAt()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);
	protected when(iso: string): string {
		return new Date(iso).toLocaleString('en-IN', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
}
