import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';

/** Every 5 minutes while open, and at once on opening (GitHub allows 5,000 calls an hour). */
export const CHANGES_REFRESH_MS = 5 * 60 * 1000;

/**
 * Ship › Release › Changes (brief 26gq3NbcbBESea6abRtsa3, screen 6): for each environment and the
 * next one, the commits its branch has that the next one's lacks, with database migrations and
 * secret-name changes called out, from GitHub's compare.
 */
@Component({
	selector: 'rc-changes-screen',
	imports: [Loading, Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-note">{{ readAt() }}</span>
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
				@for (c of a.data.comparisons; track c.from + c.to) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/git-compare" />
								{{ c.from }} ({{ c.fromBranch }}) → {{ c.to }} ({{ c.toBranch }})
							</span>
							@if (c.url) {
								<a
									class="rc-btn ghost"
									[href]="c.url"
									target="_blank"
									rel="noopener"
								>
									Open on GitHub
								</a>
							}
						</div>
						@if (c.note) {
							<p class="rc-note">{{ c.note }}</p>
						} @else {
							<div class="rc-states">
								<span class="rc-pill cy">{{ c.aheadBy }} commits · {{ c.files }} files</span>
								@if (c.migrations) {
									<span class="rc-pill amber">database migrations</span>
								}
								@if (c.secretNames) {
									<span class="rc-pill amber">secret names changed</span>
								}
							</div>
							@if (c.commits.length) {
								<div class="rc-tw">
									<table class="rc-t">
										<thead>
											<tr>
												<th>Commit</th>
												<th>Message</th>
												<th>Who</th>
											</tr>
										</thead>
										<tbody>
											@for (m of c.commits; track m.sha) {
												<tr>
													<td class="rc-mono">{{ m.sha }}</td>
													<td>{{ m.message }}</td>
													<td>{{ m.author }}</td>
												</tr>
											}
										</tbody>
									</table>
								</div>
							}
						}
					</div>
				} @empty {
					<p class="rc-note">This repository has one environment: nothing to compare.</p>
				}
			} @else {
				<p class="rc-note">{{ a.message }}</p>
			}
		} @else {
			<rc-loading what="Asking GitHub what each environment would receive…" />
		}
	`,
})
export class ChangesScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	protected readonly view = injectQuery(() => ({
		queryKey: ['releases', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.releases(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
		refetchInterval: CHANGES_REFRESH_MS,
	}));
	protected readonly readAt = computed(() =>
		this.view.dataUpdatedAt()
			? `read ${new Date(this.view.dataUpdatedAt()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
			: 'reading…',
	);
}
