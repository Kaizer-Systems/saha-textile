import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	afterRenderEffect,
	computed,
	inject,
	input,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

import { byDay } from './pull-view';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { Loading } from '../../shared/loading';

import type { PullCommit, PullCommits, PullPage, VendorAnswer } from '@saha-textile/release-console-contracts';

const CHECKS: Record<PullCommit['checks'], { tone: string; icon: string; said: string }> = {
	passed: { tone: 'ok', icon: '✓', said: 'checks passed' },
	failed: { tone: 'red', icon: '✕', said: 'a check failed' },
	running: { tone: 'amber', icon: '◔', said: 'checks running' },
	none: { tone: 'muted', icon: '', said: 'no checks' },
};

/**
 * The Commits tab: every commit, newest first and grouped by day, 100 at a time as you scroll. They come from
 * GitHub's compare list, which pages past the 250 a pull request's own list stops at. A commit opens its own
 * changes in Files changed, with its message and checks above them.
 */
@Component({
	selector: 'rc-pull-commits',
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (total() > 250) {
			<div class="rc-banner cy small">
				<span class="rc-dot cy"></span>
				<div>
					{{ count(total()) }} commits, all from GitHub: its compare list pages past the 250 a pull request’s
					own list stops at (up to 10,000).
				</div>
			</div>
		}
		@if (q.isPending()) {
			<rc-loading what="Reading the commits from GitHub…" />
		} @else if (failure(); as f) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ f }}</div>
			</div>
		} @else {
			<div class="rc-panel">
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Message</th>
								<th>Who</th>
								<th>Commit</th>
							</tr>
						</thead>
						<tbody>
							@for (d of days(); track d.day) {
								<tr>
									<td
										colspan="3"
										class="rc-label"
									>
										{{ d.day }}
									</td>
								</tr>
								@for (c of d.commits; track c.sha) {
									<tr
										tabindex="0"
										class="row"
										[title]="'Open the changes of ' + c.sha.slice(0, 8)"
										(click)="open(c)"
										(keydown.enter)="open(c)"
									>
										<td>
											<b>{{ c.headline }}</b>
										</td>
										<td class="rc-mono muted">{{ c.author }}</td>
										<td class="rc-mono cy">
											{{ c.sha.slice(0, 8) }}
											<span
												[class]="checks[c.checks].tone"
												[title]="checks[c.checks].said"
											>
												{{ checks[c.checks].icon }}
											</span>
										</td>
									</tr>
								}
							} @empty {
								<tr>
									<td colspan="3">No commits.</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				@if (q.hasNextPage()) {
					<div
						#more
						class="rc-center"
					>
						<button
							type="button"
							class="rc-btn ghost"
							[disabled]="q.isFetchingNextPage()"
							(click)="next()"
						>
							{{
								q.isFetchingNextPage()
									? 'Reading…'
									: 'Show the next 100 · ' + count(total() - shown()) + ' more'
							}}
						</button>
					</div>
				}
			</div>
		}
	`,
})
export class PullCommitsTab {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	readonly pull = input.required<PullPage>();
	protected readonly checks = CHECKS;
	protected readonly count = (x: number) => x.toLocaleString('en-IN');
	private readonly more = viewChild<ElementRef<HTMLElement>>('more');

	readonly q = injectInfiniteQuery(() => ({
		queryKey: ['pull-commits', this.ctx.projectId(), this.ctx.repoId(), this.pull().number, this.pull().headSha],
		queryFn: ({ pageParam }: { pageParam: number }) =>
			this.api.pullCommits(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.pull().number, pageParam),
		initialPageParam: 1,
		getNextPageParam: (last: VendorAnswer<PullCommits>) =>
			last.state === 'ok' && last.data.page < last.data.pages ? last.data.page + 1 : undefined,
	}));
	private readonly answers = computed(() => this.q.data()?.pages ?? []);
	readonly failure = computed(() => {
		const bad = this.answers().find(
			(a): a is Exclude<VendorAnswer<PullCommits>, { state: 'ok' }> => a.state !== 'ok',
		);
		return bad ? bad.message : null;
	});
	readonly commits = computed(() => this.answers().flatMap((a) => (a.state === 'ok' ? a.data.commits : [])));
	readonly days = computed(() => byDay(this.commits()));
	readonly total = computed(() => {
		const first = this.answers()[0];
		return first?.state === 'ok' ? first.data.total : this.pull().commits;
	});
	readonly shown = computed(() => this.commits().length);

	constructor() {
		// The next 100 come as the end of the list scrolls into view.
		let seen: IntersectionObserver | null = null;
		afterRenderEffect(() => {
			const el = this.more()?.nativeElement;
			seen?.disconnect();
			if (!el || typeof IntersectionObserver === 'undefined') return;
			seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && this.next());
			seen.observe(el);
		});
		inject(DestroyRef).onDestroy(() => seen?.disconnect());
	}

	next(): void {
		if (this.q.hasNextPage() && !this.q.isFetchingNextPage()) void this.q.fetchNextPage();
	}
	open(c: PullCommit): void {
		void this.router.navigate([], {
			queryParams: { tab: 'files', commit: c.sha, file: null },
			queryParamsHandling: 'merge',
		});
	}
}
