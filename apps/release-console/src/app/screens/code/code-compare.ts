import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';
import { byDay, diffRows, fileRows } from '../pulls/pull-view';

import type { RepoInfo } from '@saha-textile/release-console-contracts';

/**
 * Compare (brief 7Hu1SuB3A8qiJzeDwvFZLR, C12): two refs, where they stand, the open pull request for them or the
 * Create pull request form (with the PIN), and their commits and changed files in the pull request page's views.
 */
@Component({
	selector: 'rc-code-compare',
	imports: [Icon, Loading, CodeChange, CodeSwitcher],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row">
			<span class="rc-mono muted">base</span>
			<rc-code-switcher
				[current]="base()"
				[canCreate]="false"
				(picked)="nav.go({ base: $event })"
				(viewAll)="nav.open($event)"
			/>
			<span class="muted">←</span>
			<span class="rc-mono muted">compare</span>
			<rc-code-switcher
				[current]="head()"
				[canCreate]="false"
				(picked)="nav.go({ head: $event })"
				(viewAll)="nav.open($event)"
			/>
			<button
				type="button"
				class="rc-btn ghost"
				aria-label="Swap the two"
				data-tip="Swap"
				(click)="nav.go({ base: head(), head: base() })"
			>
				⇄
			</button>
		</div>
		@if (base() === head()) {
			<p class="rc-note">Choose two different branches, tags or commits to compare.</p>
		} @else if (q.isPending()) {
			<rc-loading what="Comparing on GitHub…" />
		} @else if (c(); as cmp) {
			<p class="rc-mono">
				@switch (cmp.status) {
					@case ('identical') {
						<span class="muted">These are identical.</span>
					}
					@case ('behind') {
						<span class="amber">
							{{ head() }} is {{ count(cmp.behind) }} commits behind {{ base() }}, with nothing new.
						</span>
					}
					@default {
						<span class="ok">{{ count(cmp.ahead) }} commits ahead</span>
						@if (cmp.behind) {
							<span class="amber">· {{ count(cmp.behind) }} behind</span>
						}
						· {{ count(cmp.files.total) }} files changed
					}
				}
			</p>
			@if (cmp.pull; as pr) {
				<div class="rc-banner cy small">
					<span class="rc-dot cy"></span>
					<div>
						These branches already have a pull request:
						<b>#{{ pr.number }}</b>
						{{ pr.title }}
					</div>
					<button
						type="button"
						class="rc-btn"
						(click)="openPull(pr.number)"
					>
						Open #{{ pr.number }}
					</button>
				</div>
			} @else if (cmp.ahead) {
				<div class="rc-banner cy small">
					<span class="rc-dot cy"></span>
					<div>Discuss and review the changes in this comparison with others.</div>
					<button
						type="button"
						class="rc-btn primary"
						(click)="startPull(cmp.commits[0]?.headline ?? head())"
					>
						Create pull request
					</button>
				</div>
			}
			<div
				class="rc-tabs"
				role="tablist"
			>
				<span
					role="tab"
					tabindex="0"
					[class.on]="part() === 'commits'"
					[attr.aria-selected]="part() === 'commits'"
					(click)="nav.go({ part: null })"
					(keydown.enter)="nav.go({ part: null })"
				>
					Commits {{ count(cmp.ahead) }}
				</span>
				<span
					role="tab"
					tabindex="0"
					[class.on]="part() === 'files'"
					[attr.aria-selected]="part() === 'files'"
					(click)="nav.go({ part: 'files' })"
					(keydown.enter)="nav.go({ part: 'files' })"
				>
					Files changed {{ count(cmp.files.total) }}
				</span>
			</div>
			@if (part() === 'commits') {
				@if (cmp.ahead > cmp.commits.length) {
					<p class="rc-note">
						The newest {{ cmp.commits.length }} of {{ count(cmp.ahead) }} commits, as GitHub's compare shows
						them.
					</p>
				}
				<div class="rc-panel">
					<div class="rc-tw">
						<table class="rc-t">
							<tbody>
								@for (d of days(); track d.day) {
									<tr>
										<td
											colspan="2"
											class="rc-label"
										>
											Commits on {{ d.day }}
										</td>
									</tr>
									@for (x of d.commits; track x.sha) {
										<tr
											class="row"
											tabindex="0"
											(click)="nav.open('commits', { sha: x.sha })"
											(keydown.enter)="nav.open('commits', { sha: x.sha })"
										>
											<td>
												<b>{{ x.headline }}</b>
											</td>
											<td class="rc-mono muted">{{ x.author }} · {{ x.sha.slice(0, 7) }}</td>
										</tr>
									}
								} @empty {
									<tr>
										<td colspan="2">No commits.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			} @else {
				@if (cmp.files.note) {
					<div class="rc-banner small amber">
						<span class="rc-dot amber"></span>
						<div>{{ cmp.files.note }}</div>
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
			}
		} @else {
			<div class="rc-banner small red">
				<span class="rc-dot red"></span>
				<div>{{ error() }}</div>
			</div>
		}
		@if (pulling()) {
			<rc-code-change
				title="Open a pull request"
				submit="Create pull request"
				[ready]="!!pullTitle().trim()"
				[run]="pullRun"
				(closed)="pulling.set(false)"
				(finished)="pulled()"
			>
				<p class="rc-p">
					<b>{{ head() }}</b>
					into
					<b>{{ base() }}</b>
				</p>
				<label>
					Title
					<input
						[value]="pullTitle()"
						(input)="pullTitle.set($any($event.target).value)"
					/>
				</label>
				<label>
					Description (Markdown, @names, #numbers)
					<textarea
						rows="6"
						[value]="pullBody()"
						(input)="pullBody.set($any($event.target).value)"
					></textarea>
				</label>
				<label class="rc-row">
					<input
						type="checkbox"
						[checked]="pullDraft()"
						(change)="pullDraft.set($any($event.target).checked)"
					/>
					Open as a draft
				</label>
			</rc-code-change>
		}
	`,
})
export class CodeCompare {
	private readonly api = inject(ConsoleApi);
	private readonly router = inject(Router);
	private readonly queries = injectQueryClient();
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	protected readonly when = when;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly chosenPath = signal('');
	readonly closed = signal(new Set<string>());
	readonly pulling = signal(false);
	readonly pullTitle = signal('');
	readonly pullBody = signal('');
	readonly pullDraft = signal(false);

	readonly base = computed(() => this.nav.param('base') || this.info().defaultBranch);
	readonly head = computed(() => this.nav.param('head') || this.info().defaultBranch);
	readonly part = computed(() => (this.nav.param('part') === 'files' ? 'files' : 'commits'));
	protected readonly q = injectQuery(() => ({
		queryKey: ['code-compare', this.nav.p(), this.nav.r(), this.base(), this.head()],
		queryFn: () => this.api.codeCompare(this.nav.p(), this.nav.r(), this.base(), this.head()),
		enabled: this.base() !== this.head(),
	}));
	readonly c = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly error = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'GitHub could not compare them.';
	});
	readonly days = computed(() => byDay(this.c()?.commits ?? []));
	private readonly files = computed(() => this.c()?.files.files ?? []);
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
		queryKey: ['code-compare-diff', this.nav.p(), this.nav.r(), this.base(), this.head(), this.chosen()],
		queryFn: () =>
			this.api.codeCompareDiff(this.nav.p(), this.nav.r(), {
				base: this.base(),
				head: this.head(),
				path: this.chosen(),
				whole: false,
			}),
		enabled: this.part() === 'files' && !!this.chosen(),
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
	openPull(n: number): void {
		void this.router.navigate(['/p', this.nav.p(), 'r', this.nav.r(), 'pulls'], {
			queryParams: { tab: 'overview', pr: n },
		});
	}
	/** GitHub's form starts with the newest commit's headline as the title. */
	startPull(title: string): void {
		this.pullTitle.set(title);
		this.pullBody.set('');
		this.pullDraft.set(false);
		this.pulling.set(true);
	}
	readonly pullRun = (pin: string) =>
		this.api.codeChange(this.nav.p(), this.nav.r(), 'pull', {
			pin,
			base: this.base(),
			head: this.head(),
			title: this.pullTitle().trim(),
			body: this.pullBody(),
			draft: this.pullDraft(),
		});
	pulled(): void {
		this.pulling.set(false);
		void this.queries.invalidateQueries({ queryKey: ['code-compare'] });
	}
}
