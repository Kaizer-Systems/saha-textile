import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { envOfBranch } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { PullPage } from './pull-page';
import { checksSaid, reviewSaid } from './pull-view';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { when } from '../../pages/format-time';
import { VendorLogo } from '../../shared/vendor-logo';
import { injectDefaultBranch } from '../env-tag-dialog';
import { VendorState } from '../vendor-screens';

/**
 * Ship › Code › Pull requests: open pull requests (or the newest closed and merged ones) read live from GitHub,
 * each row opening that pull request's own page (`?pr=7`), as GitHub's list does (brief E5WE6RSF2AJvpxDyDA1EJt).
 */
@Component({
	selector: 'rc-pulls-screen',
	imports: [VendorState, VendorLogo, PullPage],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (pr(); as n) {
			<rc-pull-page [number]="n" />
		} @else {
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
							{{ state() === 'open' ? 'Open' : 'Closed and merged' }} pull requests ·
							{{ rows().length }} · read
							{{ when(readAt()) }}
						</span>
						<select
							class="rc-select"
							aria-label="Which pull requests"
							(change)="show($any($event.target).value)"
						>
							<option
								value="open"
								[selected]="state() === 'open'"
							>
								Open
							</option>
							<option
								value="closed"
								[selected]="state() === 'closed'"
							>
								Closed and merged
							</option>
						</select>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>#</th>
									<th>Title</th>
									<th>Checks</th>
									<th>Review</th>
									<th>Branch</th>
									<th>Updated</th>
									<th>Environment</th>
								</tr>
							</thead>
							<tbody>
								@for (p of rows(); track p.number) {
									@let c = checks(p.checks);
									@let r = review(p.review);
									<tr
										tabindex="0"
										class="row"
										[title]="'Open #' + p.number"
										(click)="open(p.number)"
										(keydown.enter)="open(p.number)"
									>
										<td class="rc-mono">{{ p.number }}</td>
										<td>
											<b>{{ p.title }}</b>
											@if (p.draft) {
												<span class="rc-pill muted">draft</span>
											}
											@if (p.state !== 'open') {
												<span [class]="'rc-pill ' + (p.state === 'merged' ? 'cy' : 'muted')">
													{{ p.state }}
												</span>
											}
											<br />
											<span class="rc-mono muted">
												{{ p.author }} · {{ count(p.commits) }}
												{{ p.commits === 1 ? 'commit' : 'commits' }} ·
												<span class="ok">+{{ count(p.additions) }}</span>
												<span class="red">&nbsp;−{{ count(p.deletions) }}</span>
											</span>
										</td>
										<td>
											<span [class]="c.tone">
												<span [class]="'rc-dot ' + c.tone"></span>
												{{ c.text }}
											</span>
										</td>
										<td>
											<span [class]="'rc-pill ' + r.tone">{{ r.text }}</span>
										</td>
										<td class="rc-mono">{{ p.branch }} → {{ p.base }}</td>
										<td class="rc-mono">{{ when(p.updatedAt) }}</td>
										<td>{{ envOfBranch(p.base) }}</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="7">
											{{
												state() === 'open'
													? 'No open pull requests.'
													: 'No closed or merged pull requests.'
											}}
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			</rc-vendor-state>
		}
	`,
})
export class PullsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	protected readonly when = when;
	protected readonly checks = checksSaid;
	protected readonly review = reviewSaid;
	protected readonly count = (x: number) => x.toLocaleString('en-IN');
	private readonly branches = injectDefaultBranch();

	private readonly params = toSignal(
		inject(ActivatedRoute).queryParamMap.pipe(map((q) => ({ pr: q.get('pr'), state: q.get('state') }))),
		{ initialValue: { pr: null, state: null } },
	);
	/** The pull request whose page is open, from `?pr=`; none shows the list. */
	readonly pr = computed(() => {
		const n = Number(this.params().pr);
		return Number.isInteger(n) && n > 0 ? n : null;
	});
	readonly state = computed<'open' | 'closed'>(() => (this.params().state === 'closed' ? 'closed' : 'open'));

	/** The environments a pull request's target branch deploys to (owner, 23 Nov). */
	protected envOfBranch(branch: string): string {
		const envs = this.ctx.repo()?.environments ?? [];
		return envOfBranch(envs, branch, this.branches.data()?.defaultBranch ?? '') ?? '—';
	}
	readonly q = injectQuery(() => ({
		queryKey: ['pulls', this.ctx.projectId(), this.ctx.repoId(), this.state()],
		queryFn: () => this.api.pulls(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.state()),
		refetchInterval: 60_000,
		enabled: this.pr() === null,
	}));
	readonly rows = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : [];
	});
	readonly readAt = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.readAt : null;
	});

	/** A row opens its pull request's own page (owner, 24 Nov: "it should be clickable"). */
	open(n: number): void {
		void this.router.navigate([], { queryParams: { pr: n, tab: 'overview' }, queryParamsHandling: 'merge' });
	}
	show(state: string): void {
		void this.router.navigate([], {
			queryParams: { state: state === 'closed' ? 'closed' : null },
			queryParamsHandling: 'merge',
		});
	}
}
