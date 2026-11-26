import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	afterRenderEffect,
	computed,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';

import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';

import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { checkMark } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';
import { byDay, diffRows, fileRows } from '../pulls/pull-view';

import type { CodeHistory, PullFile, VendorAnswer } from '@saha-textile/release-console-contracts';

/**
 * History (brief 7Hu1SuB3A8qiJzeDwvFZLR, C7): a branch's commits, or one file's, newest first and grouped by day,
 * 100 at a time as the end scrolls into view, with GitHub's author and date filters. A row opens the commit; ⧉ copies
 * its id; ‹› opens the code as it was at that commit.
 */
@Component({
	selector: 'rc-code-history',
	imports: [Loading, CodeSwitcher],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-row">
				<rc-code-switcher
					[current]="ref()"
					[canCreate]="false"
					(picked)="nav.go({ ref: $event })"
					(viewAll)="nav.open($event)"
				/>
				@if (nav.path()) {
					<span class="rc-mono">
						History of
						<b>{{ nav.path() }}</b>
					</span>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="nav.go({ path: null })"
					>
						All files
					</button>
				}
			</span>
			<span class="rc-row">
				<label class="rc-mono">
					Author
					<input
						class="rc-search"
						placeholder="any GitHub user"
						aria-label="Commits by this GitHub user"
						[value]="nav.param('author')"
						(change)="nav.go({ author: $any($event.target).value.trim() || null })"
					/>
				</label>
				<label class="rc-mono">
					Since
					<input
						type="date"
						aria-label="Commits since"
						[value]="nav.param('since')"
						(change)="nav.go({ since: $any($event.target).value || null })"
					/>
				</label>
				<label class="rc-mono">
					Until
					<input
						type="date"
						aria-label="Commits until"
						[value]="nav.param('until')"
						(change)="nav.go({ until: $any($event.target).value || null })"
					/>
				</label>
			</span>
		</div>
		@if (q.isPending()) {
			<rc-loading what="Reading the commits from GitHub…" />
		} @else if (failure(); as f) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ f }}</div>
			</div>
		} @else {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">{{ count(total()) }} {{ total() === 1 ? 'commit' : 'commits' }}</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<tbody>
							@for (d of days(); track d.day) {
								<tr>
									<td
										colspan="3"
										class="rc-label"
									>
										Commits on {{ d.day }}
									</td>
								</tr>
								@for (c of d.commits; track c.sha) {
									<tr
										class="row"
										tabindex="0"
										[title]="'Open ' + c.sha.slice(0, 7)"
										(click)="nav.go({ sha: c.sha })"
										(keydown.enter)="nav.go({ sha: c.sha })"
									>
										<td>
											<b>{{ c.headline }}</b>
											@if (mark(c.checks); as m) {
												<span [class]="m.tone">{{ m.text }}</span>
											}
										</td>
										<td class="rc-mono muted">{{ c.author }} · {{ when(c.date) }}</td>
										<td class="rc-mono cy">
											{{ c.sha.slice(0, 7) }}
											<button
												type="button"
												class="rc-btn ghost"
												aria-label="Copy the commit id"
												[attr.data-tip]="copied() === c.sha ? 'Copied' : 'Copy the commit id'"
												(click)="$event.stopPropagation(); copy(c.sha)"
											>
												⧉
											</button>
											<button
												type="button"
												class="rc-btn ghost"
												aria-label="Browse the code at this commit"
												data-tip="Browse the code at this commit"
												(click)="$event.stopPropagation(); nav.at(c.sha, '', 'tree')"
											>
												‹›
											</button>
										</td>
									</tr>
								}
							} @empty {
								<tr>
									<td colspan="3">No commits match.</td>
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
							{{ q.isFetchingNextPage() ? 'Reading…' : 'Show the next 100' }}
						</button>
					</div>
				}
			</div>
		}
	`,
})
export class CodeHistoryTab {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	readonly ref = input.required<string>();
	protected readonly when = when;
	protected readonly mark = checkMark;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly copied = signal('');
	private readonly more = viewChild<ElementRef<HTMLElement>>('more');

	readonly q = injectInfiniteQuery(() => {
		const filters = {
			ref: this.ref(),
			path: this.nav.path(),
			author: this.nav.param('author'),
			since: this.nav.param('since'),
			until: this.nav.param('until'),
		};
		return {
			queryKey: ['code-history', this.nav.p(), this.nav.r(), filters],
			queryFn: ({ pageParam }: { pageParam: string }) =>
				this.api.codeHistory(this.nav.p(), this.nav.r(), { ...filters, after: pageParam }),
			initialPageParam: '',
			getNextPageParam: (last: VendorAnswer<CodeHistory>) =>
				last.state === 'ok' && last.data.next ? last.data.next : undefined,
		};
	});
	private readonly answers = computed(() => this.q.data()?.pages ?? []);
	readonly failure = computed(() => {
		const bad = this.answers().find(
			(a): a is Exclude<VendorAnswer<CodeHistory>, { state: 'ok' }> => a.state !== 'ok',
		);
		return bad ? bad.message : null;
	});
	readonly commits = computed(() => this.answers().flatMap((a) => (a.state === 'ok' ? a.data.commits : [])));
	readonly days = computed(() => byDay(this.commits()));
	readonly total = computed(() => {
		const first = this.answers()[0];
		return first?.state === 'ok' ? first.data.total : 0;
	});

	constructor() {
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
	copy(sha: string): void {
		const done = () => {
			this.copied.set(sha);
			setTimeout(() => this.copied.set(''), 1500);
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(sha).then(done, () => undefined);
	}
}

/**
 * One commit (a history row, a file's last commit): its whole message, author, checks and its changed files with their
 * lines, from the pull request routes, which read a commit by its id alone (the number in their address is unused).
 * Drawn with the Files changed tab's tree and code view.
 */
@Component({
	selector: 'rc-code-commit',
	imports: [Icon, Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (cq.isPending()) {
			<rc-loading what="Reading the commit from GitHub…" />
		} @else if (commit(); as c) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">Commit {{ c.sha.slice(0, 7) }} · {{ c.author }} · {{ when(c.date) }}</span>
					<span class="rc-row">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="nav.at(c.sha, '', 'tree')"
						>
							Browse files
						</button>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="nav.go({ sha: null })"
						>
							Back to the history
						</button>
					</span>
				</div>
				<p class="rc-p">
					<b>{{ headline() }}</b>
				</p>
				@for (para of body(); track $index) {
					<p class="rc-note">{{ para }}</p>
				}
				<p class="rc-note">
					Checks: {{ c.checks.total }} ·
					<span class="ok">{{ c.checks.passed }} passed</span>
					·
					<span [class]="c.checks.failed ? 'red' : 'muted'">{{ c.checks.failed }} failed</span>
				</p>
			</div>
			@if (c.files.note) {
				<div class="rc-banner small amber">
					<span class="rc-dot amber"></span>
					<div>{{ c.files.note }}</div>
				</div>
			}
			<div class="rc-g-side rc-cov-split open rc-pr-split">
				<div class="rc-tw rc-cov-tree">
					<table
						class="rc-t"
						role="treegrid"
						aria-label="Changed files"
					>
						<tbody>
							@for (r of rows(); track r.path) {
								<tr
									class="row"
									tabindex="-1"
									[class.sel]="r.path === chosen()"
									[attr.aria-expanded]="r.folder ? r.open : null"
									(click)="pick(r.path, r.folder)"
								>
									<td>
										<span
											class="rc-cov-name"
											[style.padding-left.px]="r.depth * 14"
										>
											<span
												class="rc-cov-arrow"
												[class.open]="r.open"
											>
												{{ r.folder ? '▸' : '' }}
											</span>
											<rc-icon [name]="r.folder ? 'tabler/folder' : 'tabler/file'" />
											{{ r.name }}
										</span>
									</td>
									<td class="num ok">+{{ r.additions }}</td>
									<td class="num red">−{{ r.deletions }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<div class="rc-panel">
					@if (!chosen()) {
						<p class="rc-note">Choose a file.</p>
					} @else if (dq.isPending()) {
						<rc-loading what="Reading the changes…" />
					} @else if (lines(); as ls) {
						<div class="rc-cov-body">
							<div class="rc-log rc-cov-code">
								@for (l of ls; track $index) {
									<div [class]="'l ' + l.kind">
										<span class="n">{{ l.old ?? '' }}</span>
										<span class="src">{{ l.new ?? '' }}</span>
										@if (l.kind === 'hunk') {
											<span class="m">{{ l.text }}</span>
										} @else {
											<span
												class="m"
												[innerHTML]="l.html"
											></span>
										}
									</div>
								} @empty {
									<div class="l">
										<span class="m">No changed lines (a binary or renamed file).</span>
									</div>
								}
							</div>
						</div>
					} @else {
						<p class="rc-note">{{ diffError() }}</p>
					}
				</div>
			</div>
		} @else {
			<div class="rc-banner small red">
				<span class="rc-dot red"></span>
				<div>{{ commitError() }}</div>
			</div>
		}
	`,
})
export class CodeCommit {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	readonly sha = input.required<string>();
	protected readonly when = when;
	readonly chosenPath = signal('');
	/** Folders the person closed; every folder of a commit starts open. */
	readonly closed = signal(new Set<string>());
	protected readonly cq = injectQuery(() => ({
		queryKey: ['code-commit', this.nav.p(), this.nav.r(), this.sha()],
		queryFn: () => this.api.pullCommit(this.nav.p(), this.nav.r(), 1, this.sha()),
	}));
	readonly commit = computed(() => {
		const a = this.cq.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly commitError = computed(() => {
		const a = this.cq.data();
		return a && a.state !== 'ok' ? a.message : 'The commit could not be read.';
	});
	readonly headline = computed(() => this.commit()?.message.split('\n')[0] ?? '');
	readonly body = computed(() =>
		(this.commit()?.message ?? '')
			.split('\n')
			.slice(1)
			.join('\n')
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter(Boolean),
	);
	private readonly files = computed<PullFile[]>(() => this.commit()?.files.files ?? []);
	/** The chosen file, or the first one. */
	readonly chosen = computed(() => this.chosenPath() || this.files()[0]?.path || '');
	readonly rows = computed(() => {
		const open = new Set<string>();
		for (const f of this.files()) {
			const parts = f.path.split('/').slice(0, -1);
			parts.forEach((_, i) => open.add(parts.slice(0, i + 1).join('/')));
		}
		for (const folder of this.closed()) open.delete(folder);
		return fileRows(this.files(), open, '');
	});
	protected readonly dq = injectQuery(() => ({
		queryKey: ['code-commit-diff', this.nav.p(), this.nav.r(), this.sha(), this.chosen()],
		queryFn: () => this.api.pullDiff(this.nav.p(), this.nav.r(), 1, this.chosen(), false, this.sha()),
		enabled: !!this.chosen(),
	}));
	readonly lines = computed(() => {
		const a = this.dq.data();
		return a?.state === 'ok' ? diffRows(a.data.lines, a.data.path) : null;
	});
	readonly diffError = computed(() => {
		const a = this.dq.data();
		return a && a.state !== 'ok' ? a.message : 'The changes could not be read.';
	});

	pick(path: string, folder: boolean): void {
		if (!folder) {
			this.chosenPath.set(path);
			return;
		}
		const next = new Set(this.closed());
		if (next.has(path)) next.delete(path);
		else next.add(path);
		this.closed.set(next);
	}
}
