import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';

import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { activityWords, fileLines, markWords } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Loading } from '../../shared/loading';

import type { CodeActivity, VendorAnswer } from '@saha-textile/release-console-contracts';

/**
 * Search this repository (brief 7Hu1SuB3A8qiJzeDwvFZLR, C11): the words in any case, on any branch or tag, searched
 * with git on the console's copy; each file's matching lines in the code view, a line opening the file there.
 */
@Component({
	selector: 'rc-code-search',
	imports: [Loading, CodeSwitcher],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<form
			class="rc-row"
			role="search"
			(submit)="$event.preventDefault(); nav.go({ q: typed().trim() || null })"
		>
			<input
				class="rc-search"
				type="search"
				aria-label="Search this repository"
				placeholder="Search this repository"
				[value]="typed()"
				(input)="typed.set($any($event.target).value)"
			/>
			<button
				type="submit"
				class="rc-btn primary"
			>
				Search
			</button>
			<rc-code-switcher
				[current]="ref()"
				[canCreate]="false"
				(picked)="nav.go({ ref: $event })"
				(viewAll)="nav.open($event)"
			/>
		</form>
		@if (!nav.param('q')) {
			<p class="rc-note">Type what to look for: every text file on {{ ref() }} is searched, in any case.</p>
		} @else if (q.isPending()) {
			<rc-loading what="Searching the repository…" />
		} @else if (found(); as f) {
			<p class="rc-mono muted">
				{{ count(f.total) }} {{ f.total === 1 ? 'match' : 'matches' }} in {{ f.files.length }}
				{{ f.files.length === 1 ? 'file' : 'files' }}{{ f.cut ? ' · the first 500 shown' : '' }}
			</p>
			@if (f.files.length) {
				<!-- One code box, as brief C11 draws it: each file a cyan row, its matching lines under it. -->
				<div class="rc-cov-body">
					<div class="rc-log rc-cov-code">
						@for (file of f.files; track file.path) {
							<div class="l hunk">
								<span class="n"></span>
								<span class="src"></span>
								<span class="m">
									<a
										href=""
										(click)="$event.preventDefault(); nav.at(ref(), file.path, 'blob')"
									>
										{{ file.path }}
									</a>
								</span>
							</div>
							@for (l of lines(file.path, file.lines); track l.n) {
								<div
									class="l row"
									tabindex="0"
									(click)="nav.at(ref(), file.path, 'blob', 'L' + l.n)"
									(keydown.enter)="nav.at(ref(), file.path, 'blob', 'L' + l.n)"
								>
									<span class="n">{{ l.n }}</span>
									<span class="src"></span>
									<span
										class="m"
										[innerHTML]="l.html"
									></span>
								</div>
							}
						}
					</div>
				</div>
			} @else {
				<div class="rc-panel">
					<p class="rc-note">Nothing on {{ ref() }} matches “{{ nav.param('q') }}”.</p>
				</div>
			}
		} @else {
			<div class="rc-banner small red">
				<span class="rc-dot red"></span>
				<div>{{ error() }}</div>
			</div>
		}
	`,
})
export class CodeSearchTab {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	readonly ref = input.required<string>();
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly typed = signal(this.nav.param('q'));
	protected readonly q = injectQuery(() => ({
		queryKey: ['code-search', this.nav.p(), this.nav.r(), this.ref(), this.nav.param('q')],
		queryFn: () => this.api.codeSearch(this.nav.p(), this.nav.r(), this.ref(), this.nav.param('q')),
		enabled: !!this.nav.param('q'),
	}));
	readonly found = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly error = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The repository could not be searched.';
	});
	/** Each matching line coloured by its file's type, keeping its own number, with the words marked. */
	lines(path: string, found: Array<{ n: number; text: string }>) {
		// The closing newline keeps a last empty line: fileLines drops one trailing newline.
		const drawn = fileLines(found.map((l) => l.text).join('\n') + '\n', path);
		const words = this.nav.param('q');
		return drawn.map((d, i) => ({ n: (found[i] as { n: number }).n, html: markWords(d.html, words) }));
	}
}

/**
 * Activity (brief 7Hu1SuB3A8qiJzeDwvFZLR, C13): every push, force push, branch made or deleted and merge, newest
 * first, by branch, person and kind, 30 at a time. Force pushes are marked.
 */
@Component({
	selector: 'rc-code-activity',
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row">
			<label class="rc-mono">
				Branch
				<input
					class="rc-search"
					aria-label="Activity on this branch"
					placeholder="any"
					[value]="nav.param('branch')"
					(change)="nav.go({ branch: $any($event.target).value.trim() || null })"
				/>
			</label>
			<label class="rc-mono">
				Person
				<input
					class="rc-search"
					aria-label="Activity by this GitHub user"
					placeholder="anyone"
					[value]="nav.param('actor')"
					(change)="nav.go({ actor: $any($event.target).value.trim() || null })"
				/>
			</label>
			<label class="rc-mono">
				Kind
				<select
					class="rc-select"
					aria-label="Kind of activity"
					[value]="nav.param('kind')"
					(change)="nav.go({ kind: $any($event.target).value || null })"
				>
					@for (k of kinds; track k.value) {
						<option [value]="k.value">{{ k.label }}</option>
					}
				</select>
			</label>
		</div>
		@if (q.isPending()) {
			<rc-loading what="Reading the activity from GitHub…" />
		} @else {
			<div class="rc-panel">
				<div class="rc-tw">
					<table class="rc-t">
						<tbody>
							@for (row of rows(); track $index) {
								<tr>
									<td>
										<b [class.amber]="row.kind === 'force_push'">{{ words(row.kind) }}</b>
										{{ row.ref }}
									</td>
									<td class="rc-mono muted">{{ row.actor }}</td>
									<td class="rc-mono cy">
										@if (!made(row.before)) {
											{{ row.before.slice(0, 7) }} →
										}
										{{ row.after.slice(0, 7) }}
									</td>
									<td class="rc-mono muted">{{ when(row.at) }}</td>
								</tr>
							} @empty {
								<tr>
									<td colspan="4">{{ error() || 'No activity matches.' }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				@if (q.hasNextPage()) {
					<div class="rc-center">
						<button
							type="button"
							class="rc-btn ghost"
							[disabled]="q.isFetchingNextPage()"
							(click)="q.fetchNextPage()"
						>
							{{ q.isFetchingNextPage() ? 'Reading…' : 'Older activity' }}
						</button>
					</div>
				}
			</div>
		}
	`,
})
export class CodeActivityTab {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	protected readonly when = when;
	protected readonly words = activityWords;
	protected readonly kinds = [
		{ value: '', label: 'Every kind' },
		{ value: 'push', label: 'Pushes' },
		{ value: 'force_push', label: 'Force pushes' },
		{ value: 'branch_creation', label: 'Branches made' },
		{ value: 'branch_deletion', label: 'Branches deleted' },
		{ value: 'pr_merge', label: 'Merges' },
	];
	readonly q = injectInfiniteQuery(() => {
		const filters = { ref: this.nav.param('branch'), actor: this.nav.param('actor'), kind: this.nav.param('kind') };
		return {
			queryKey: ['code-activity', this.nav.p(), this.nav.r(), filters],
			queryFn: ({ pageParam }: { pageParam: string }) =>
				this.api.codeActivity(this.nav.p(), this.nav.r(), { ...filters, after: pageParam }),
			initialPageParam: '',
			getNextPageParam: (last: VendorAnswer<CodeActivity>) =>
				last.state === 'ok' && last.data.next ? last.data.next : undefined,
		};
	});
	readonly rows = computed(() => (this.q.data()?.pages ?? []).flatMap((a) => (a.state === 'ok' ? a.data.rows : [])));
	/** A branch made has no commit before (GitHub sends zeros). */
	made(before: string): boolean {
		return !before || /^0+$/.test(before);
	}
	readonly error = computed(() => {
		const bad = (this.q.data()?.pages ?? []).find((a) => a.state !== 'ok');
		return bad ? bad.message : '';
	});
}
