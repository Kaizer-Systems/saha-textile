import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon } from '../shared/icons';

/** Hourly while open (GitHub updates alerts on its own schedule), and at once on opening. */
export const DEPS_REFRESH_MS = 60 * 60 * 1000;

/** Open alerts counted by severity, most severe first. */
export function bySeverity(alerts: { severity: string }[]): { severity: string; count: number }[] {
	const order = ['critical', 'high', 'medium', 'moderate', 'low', 'warning', 'note', 'error', ''];
	const counts = new Map<string, number>();
	for (const a of alerts) counts.set(a.severity.toLowerCase(), (counts.get(a.severity.toLowerCase()) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
		.map(([severity, count]) => ({ severity: severity || 'unrated', count }));
}

/**
 * Ship › Packages › Dependencies (brief 26gq3NbcbBESea6abRtsa3, screen 7): known security holes in
 * the packages this repository uses (Dependabot) and code-scanning findings, from GitHub (free for a
 * public repository), with a link to each alert.
 */
@Component({
	selector: 'rc-deps-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/shield-check" />
					Open alerts · {{ readAt() }}
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
			@if (view.data(); as a) {
				@if (a.state === 'ok') {
					<div class="rc-states">
						@for (s of severities(); track s.severity) {
							<span
								class="rc-pill"
								[class.red]="s.severity === 'critical' || s.severity === 'high'"
								[class.amber]="s.severity === 'medium' || s.severity === 'moderate'"
							>
								{{ s.count }} {{ s.severity }}
							</span>
						} @empty {
							<span class="rc-pill ok">no open alerts</span>
						}
					</div>
					@for (n of a.data.notes; track n) {
						<p class="rc-note">{{ n }}</p>
					}
					@if (a.data.alerts.length) {
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>Package or rule</th>
										<th>Where</th>
										<th>Severity</th>
										<th>Fixed in</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									@for (x of a.data.alerts; track x.url) {
										<tr>
											<td class="rc-mono">{{ x.name }}</td>
											<td class="rc-mono">{{ x.where }}</td>
											<td>{{ x.severity }}</td>
											<td class="rc-mono">{{ x.fixedIn || '—' }}</td>
											<td>
												<a
													class="rc-btn ghost"
													[href]="x.url"
													target="_blank"
													rel="noopener"
												>
													Open on GitHub
												</a>
											</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
					}
				} @else {
					<p class="rc-note">{{ a.message }}</p>
				}
			} @else {
				<p class="rc-note">Reading GitHub's alerts…</p>
			}
		</div>
	`,
})
export class DepsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly view = injectQuery(() => ({
		queryKey: ['security', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.security(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
		refetchInterval: DEPS_REFRESH_MS,
	}));
	protected readonly severities = computed(() => {
		const a = this.view.data();
		return a?.state === 'ok' ? bySeverity(a.data.alerts) : [];
	});
	protected readonly readAt = computed(() =>
		this.view.dataUpdatedAt()
			? `read ${new Date(this.view.dataUpdatedAt()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);
}
