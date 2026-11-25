import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';

import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeBranches } from './code-branches';
import { CodeChange } from './code-change';
import { CodeCompare } from './code-compare';
import { CodeEdit } from './code-edit';
import { CodeFileView } from './code-file';
import { CodeFinder } from './code-finder';
import { CodeCommit, CodeHistoryTab } from './code-history';
import { CodeHome } from './code-home';
import { CodeActivityTab, CodeSearchTab } from './code-more';
import { CodeNav } from './code-nav';
import { CodeReleasesTab, CodeTagsTab } from './code-releases';
import { CODE_TAB_LABELS, SHOWN_TABS } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';

type Change = 'watch' | 'star' | 'fork';

/**
 * Ship › Code › Code (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C, approved 24 Nov 2026): GitHub's repository pages in the
 * console. The header names the repository with its visibility, Search, Watch ▾, Fork ▾ and Star; the tabs are
 * GitHub's pages (Q5 B). Keys as GitHub's: t Go to file, w the branch switcher, s or / Search.
 */
@Component({
	selector: 'rc-code-screen',
	imports: [
		Icon,
		Loading,
		CodeChange,
		CodeHome,
		CodeFileView,
		CodeEdit,
		CodeFinder,
		CodeHistoryTab,
		CodeCommit,
		CodeBranches,
		CodeTagsTab,
		CodeReleasesTab,
		CodeCompare,
		CodeSearchTab,
		CodeActivityTab,
	],
	providers: [CodeNav],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'key($event)', '(document:click)': 'menu.set(null)' },
	template: `
		@if (q.isPending()) {
			<rc-loading what="Reading the repository from GitHub…" />
		} @else if (info(); as i) {
			<div class="rc-content">
				<div class="rc-row between">
					<span class="rc-row">
						<rc-icon name="tabler/book-2" />
						<b class="rc-mono">{{ i.owner }} / {{ i.name }}</b>
						<span class="rc-pill">{{ visibility(i.visibility) }}</span>
					</span>
					<span class="rc-row">
						<form
							role="search"
							class="rc-msearch"
							(submit)="$event.preventDefault(); search()"
						>
							<input
								class="rc-search"
								type="search"
								aria-label="Search this repository"
								placeholder="Search this repository  /"
								[value]="words()"
								(input)="words.set($any($event.target).value)"
							/>
						</form>
						<span
							class="rc-msearch"
							(click)="$event.stopPropagation()"
						>
							<button
								type="button"
								class="rc-btn"
								aria-haspopup="menu"
								[attr.aria-expanded]="menu() === 'watch'"
								(click)="toggle('watch')"
							>
								<rc-icon name="tabler/eye" />
								{{
									i.watching === 'none' ? 'Watch' : i.watching === 'ignored' ? 'Ignoring' : 'Unwatch'
								}}
								<span class="rc-pill">{{ count(i.watchers) }}</span>
								▾
							</button>
							@if (menu() === 'watch') {
								<div
									class="rc-mres"
									role="menu"
								>
									@for (w of watchWays; track w.value) {
										<button
											type="button"
											class="rc-mrow"
											role="menuitemradio"
											[attr.aria-checked]="i.watching === w.value"
											(click)="ask('watch', w.value)"
										>
											<b>{{ i.watching === w.value ? '✓ ' : '' }}{{ w.label }}</b>
											<span>{{ w.sub }}</span>
										</button>
									}
								</div>
							}
						</span>
						<span
							class="rc-msearch"
							(click)="$event.stopPropagation()"
						>
							<button
								type="button"
								class="rc-btn"
								aria-haspopup="menu"
								[attr.aria-expanded]="menu() === 'fork'"
								(click)="toggle('fork')"
							>
								<rc-icon name="tabler/git-fork" />
								Fork
								<span class="rc-pill">{{ count(i.forks) }}</span>
								▾
							</button>
							@if (menu() === 'fork') {
								<div
									class="rc-mres"
									role="menu"
								>
									<button
										type="button"
										class="rc-mrow"
										role="menuitem"
										(click)="ask('fork', '')"
									>
										<b>＋ Create a new fork</b>
										<span>in the account this key signs in as ({{ i.viewer }})</span>
									</button>
									<a
										class="rc-mrow"
										role="menuitem"
										target="_blank"
										rel="noopener"
										[href]="i.url + '/forks'"
									>
										<b>{{ count(i.forks) }} existing {{ i.forks === 1 ? 'fork' : 'forks' }} ↗</b>
										<span>GitHub's list of forks</span>
									</a>
								</div>
							}
						</span>
						<!-- The same wrapper as Watch and Fork, so the three sit on one line. -->
						<span class="rc-msearch">
							<button
								type="button"
								class="rc-btn"
								[attr.aria-pressed]="i.starred"
								(click)="ask('star', i.starred ? 'off' : 'on')"
							>
								<rc-icon [name]="i.starred ? 'tabler/star-filled' : 'tabler/star'" />
								{{ i.starred ? 'Starred' : 'Star' }}
								<span class="rc-pill">{{ count(i.stars) }}</span>
							</button>
						</span>
					</span>
				</div>
				<div
					class="rc-tabs"
					role="tablist"
					aria-label="Repository"
				>
					@for (t of tabs; track t) {
						<span
							role="tab"
							tabindex="0"
							[class.on]="t === nav.tab()"
							[attr.aria-selected]="t === nav.tab()"
							(click)="nav.open(t)"
							(keydown.enter)="nav.open(t)"
						>
							{{ labels[t] }}
							@if (tabCount(t); as n) {
								<span class="rc-pr-n">{{ count(n) }}</span>
							}
						</span>
					}
				</div>
				@switch (nav.tab()) {
					@case ('commits') {
						@if (nav.param('sha'); as sha) {
							<rc-code-commit [sha]="sha" />
						} @else {
							<rc-code-history [ref]="ref()" />
						}
					}
					@case ('branches') {
						<rc-code-branches />
					}
					@case ('tags') {
						<rc-code-tags [info]="i" />
					}
					@case ('releases') {
						<rc-code-releases [info]="i" />
					}
					@case ('compare') {
						<rc-code-compare [info]="i" />
					}
					@case ('activity') {
						<rc-code-activity />
					}
					@case ('search') {
						<rc-code-search [ref]="ref()" />
					}
					@default {
						@switch (mode()) {
							@case ('blob') {
								<rc-code-file
									[info]="i"
									[ref]="ref()"
									[viewer]="i.viewer"
								/>
							}
							@case ('tree') {
								<rc-code-home
									[info]="i"
									[ref]="ref()"
								/>
							}
							@default {
								<rc-code-edit
									[info]="i"
									[ref]="ref()"
									[viewer]="i.viewer"
									[mode]="editMode()"
								/>
							}
						}
					}
				}
			</div>
			@if (nav.finding()) {
				<rc-code-finder [ref]="ref()" />
			}
			@if (asking(); as a) {
				<rc-code-change
					[title]="a.title"
					[submit]="a.submit"
					[run]="a.run"
					(closed)="asking.set(null)"
					(finished)="changed()"
				>
					<p class="rc-p">{{ a.said }}</p>
					@if (a.kind === 'fork') {
						<label>
							Name (empty keeps {{ i.name }})
							<input
								[value]="forkName()"
								(input)="forkName.set($any($event.target).value)"
							/>
						</label>
						<label class="rc-row">
							<input
								type="checkbox"
								[checked]="forkDefaultOnly()"
								(change)="forkDefaultOnly.set($any($event.target).checked)"
							/>
							Copy the {{ i.defaultBranch }} branch only
						</label>
					}
				</rc-code-change>
			}
		} @else {
			<div class="rc-banner small red">
				<span class="rc-dot red"></span>
				<div>{{ error() }}</div>
			</div>
		}
	`,
})
export class CodeScreen {
	private readonly api = inject(ConsoleApi);
	private readonly queries = injectQueryClient();
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	protected readonly nav = inject(CodeNav);
	protected readonly tabs = SHOWN_TABS;
	protected readonly labels = CODE_TAB_LABELS;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	protected readonly watchWays = [
		{
			value: 'none' as const,
			label: 'Participating and @mentions',
			sub: 'only when you take part or are mentioned',
		},
		{ value: 'subscribed' as const, label: 'All activity', sub: 'every pull request, issue and release' },
		{ value: 'ignored' as const, label: 'Ignore', sub: 'never, not even when mentioned' },
	];
	readonly menu = signal<'watch' | 'fork' | null>(null);
	readonly words = signal(this.nav.param('q'));
	readonly forkName = signal('');
	readonly forkDefaultOnly = signal(true);
	readonly asking = signal<{
		kind: Change;
		title: string;
		submit: string;
		said: string;
		run: (pin: string) => ReturnType<ConsoleApi['codeChange']>;
	} | null>(null);

	protected readonly q = injectQuery(() => ({
		queryKey: ['code-repo', this.nav.p(), this.nav.r()],
		queryFn: () => this.api.codeRepo(this.nav.p(), this.nav.r()),
	}));
	readonly info = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly error = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The repository could not be read.';
	});
	/** The ref shown: the address's, or the default branch. */
	readonly ref = computed(() => this.nav.ref() || this.info()?.defaultBranch || '');
	/** Files shows a folder, a file, or the editor (Edit, Create new file, Upload files). */
	readonly mode = computed(() => {
		const type = this.nav.param('type');
		return type === 'blob' ? 'blob' : type === 'edit' || type === 'new' || type === 'upload' ? 'edit' : 'tree';
	});
	readonly editMode = computed(() => this.nav.param('type') as 'edit' | 'new' | 'upload');

	visibility(v: string): string {
		return { public: 'Public', private: 'Private', internal: 'Internal' }[v] ?? v;
	}
	tabCount(t: string): number {
		const i = this.info();
		return { branches: i?.branches ?? 0, tags: i?.tags ?? 0, releases: i?.releases.total ?? 0 }[t] ?? 0;
	}
	toggle(which: 'watch' | 'fork'): void {
		this.menu.set(this.menu() === which ? null : which);
	}
	search(): void {
		const q = this.words().trim();
		if (q) this.nav.open('search', { q });
	}

	/** Watch, Star and Fork each ask for the PIN in the console's form box. */
	ask(kind: Change, value: string): void {
		this.menu.set(null);
		const p = this.nav.p();
		const r = this.nav.r();
		if (kind === 'watch') {
			const watching = value as 'subscribed' | 'ignored' | 'none';
			const way = this.watchWays.find((w) => w.value === watching);
			this.asking.set({
				kind,
				title: 'Watch',
				submit: 'Save',
				said: `Notifications: ${way?.label} (${way?.sub}).`,
				run: (pin) => this.api.codeChange(p, r, 'watch', { pin, watching }),
			});
		} else if (kind === 'star') {
			const starred = value === 'on';
			this.asking.set({
				kind,
				title: starred ? 'Star' : 'Remove the star',
				submit: starred ? 'Star' : 'Remove star',
				said: starred ? 'Star this repository with the key’s account.' : 'Remove this repository’s star.',
				run: (pin) => this.api.codeChange(p, r, 'star', { pin, starred }),
			});
		} else {
			this.forkName.set('');
			this.forkDefaultOnly.set(true);
			this.asking.set({
				kind,
				title: 'Create a new fork',
				submit: 'Create fork',
				said: 'A copy of this repository in the account the key signs in as.',
				run: (pin) =>
					this.api.codeChange(p, r, 'fork', {
						pin,
						name: this.forkName().trim(),
						defaultOnly: this.forkDefaultOnly(),
					}),
			});
		}
	}
	changed(): void {
		this.asking.set(null);
		void this.queries.invalidateQueries({ queryKey: ['code-repo'] });
	}

	/** GitHub's keys: t Go to file, w the branch switcher, s or / Search. Typing in a field is left alone. */
	key(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === 't') {
			e.preventDefault();
			this.nav.finding.set(true);
		} else if (e.key === 'w') {
			e.preventDefault();
			this.host.nativeElement.querySelector<HTMLButtonElement>('rc-code-switcher button')?.click();
		} else if (e.key === 's' || e.key === '/') {
			e.preventDefault();
			this.host.nativeElement.querySelector<HTMLInputElement>('form[role="search"] input')?.focus();
		}
	}
}
