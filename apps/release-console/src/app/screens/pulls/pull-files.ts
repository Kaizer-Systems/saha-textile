import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	computed,
	effect,
	inject,
	input,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { FOLD_AT, changeStarts, diffRows, fileRows, filesInOrder } from './pull-view';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { when } from '../../pages/format-time';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';

import type { FileRow } from './pull-view';
import type { PullFile, PullPage } from '@saha-textile/release-console-contracts';

/** With this many files or fewer, every folder opens; past it, only the folders above the open file. */
const OPEN_ALL_UP_TO = 80;

/**
 * The Files changed tab: the Coverage screen's tree with each folder's added and removed lines, and the chosen
 * file's changes beside it with old and new line numbers. Opened from a commit (`?commit=`), it shows that
 * commit's message, checks and files instead. Keys: j and k next and previous file, n and p next and previous
 * change, / find a file.
 */
@Component({
	selector: 'rc-pull-files',
	imports: [Icon, Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'key($event)' },
	template: `
		@if (commitInfo(); as c) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">Commit {{ c.sha.slice(0, 8) }} · {{ c.author }} · {{ when(c.date) }}</span>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="allFiles()"
					>
						All files of #{{ pull().number }}
					</button>
				</div>
				<p class="rc-p">
					<b>{{ c.headline }}</b>
				</p>
				@for (para of c.body; track $index) {
					<p class="rc-note">{{ para }}</p>
				}
				<p class="rc-note">
					Checks: {{ c.checks.total }} ·
					<span class="ok">{{ c.checks.passed }} passed</span>
					·
					<span [class]="c.checks.failed ? 'red' : 'muted'">{{ c.checks.failed }} failed</span>
					@if (c.checks.running) {
						·
						<span class="amber">{{ c.checks.running }} running</span>
					}
				</p>
			</div>
		}
		@if (filesQ.isPending()) {
			<rc-loading what="Reading the changed files…" />
		} @else if (list(); as l) {
			@if (l.note) {
				<div
					class="rc-banner small"
					[class]="'rc-banner small ' + (l.source === 'copy' ? 'amber' : 'red')"
				>
					<span [class]="'rc-dot ' + (l.source === 'copy' ? 'amber' : 'red')"></span>
					<div>{{ l.note }}</div>
				</div>
			}
			<div class="rc-row between">
				<button
					type="button"
					class="rc-btn ghost rc-pr-treebtn"
					(click)="treeShown.set(!treeShown())"
				>
					Files ▾
				</button>
				<span class="rc-mono muted">◂ k · j ▸ files · p · n changes · / find</span>
			</div>
			<div
				class="rc-g-side rc-cov-split open rc-pr-split"
				[class.tree-hidden]="!treeShown()"
			>
				<div class="rc-tw rc-cov-tree">
					<div class="rc-msearch">
						<input
							#find
							class="rc-search"
							aria-label="Find a file"
							placeholder="Find a file"
							[value]="findText()"
							(input)="findText.set($any($event.target).value)"
						/>
						<kbd>/</kbd>
					</div>
					<table
						class="rc-t"
						role="treegrid"
						aria-label="Changed files"
					>
						<thead>
							<tr>
								<th>Name</th>
								<th class="num">+</th>
								<th class="num">−</th>
							</tr>
						</thead>
						<tbody>
							@for (r of rows(); track r.path) {
								<tr
									class="row"
									tabindex="-1"
									[class.sel]="r.path === chosen()?.path"
									[attr.aria-expanded]="r.folder ? r.open : null"
									(click)="pick(r)"
								>
									<td>
										<span
											class="rc-cov-name"
											[style.padding-left.px]="r.depth * 14"
										>
											@if (r.folder) {
												<span
													class="rc-cov-arrow"
													[class.open]="r.open"
												>
													▸
												</span>
											} @else {
												<span
													class="rc-cov-arrow"
													[class]="'rc-cov-arrow ' + (viewed().has(r.path) ? 'ok' : 'muted')"
												>
													{{ viewed().has(r.path) ? '✓' : '·' }}
												</span>
											}
											<rc-icon [name]="r.folder ? 'tabler/folder' : 'tabler/file'" />
											{{ r.name }}
										</span>
									</td>
									<td class="num ok">+{{ count(r.additions) }}</td>
									<td class="num red">−{{ count(r.deletions) }}</td>
								</tr>
							} @empty {
								<tr>
									<td colspan="3">{{ findText() ? 'No file matches.' : 'No changed files.' }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<div class="rc-panel">
					@if (chosen(); as f) {
						<div class="rc-ph">
							<span class="rc-mono cy">
								{{ f.previous ? f.previous + ' → ' + f.path : f.path }}
							</span>
							<span class="rc-row">
								<span class="rc-mono">
									<span class="ok">+{{ count(f.additions) }}</span>
									<span class="red">&nbsp;−{{ count(f.deletions) }}</span>
								</span>
								<label class="rc-mono">
									<input
										type="checkbox"
										[checked]="viewed().has(f.path)"
										(change)="toggleViewed(f.path)"
									/>
									Viewed
								</label>
								<button
									type="button"
									class="rc-chip"
									[class.on]="whole()"
									[attr.aria-pressed]="whole()"
									(click)="whole.set(!whole())"
								>
									Whole file
								</button>
							</span>
						</div>
						@if (diffQ.isPending()) {
							<rc-loading what="Reading the changes…" />
						} @else if (diff(); as d) {
							@if (d.binary) {
								<p class="rc-note">
									A binary file:
									{{ d.sizeBefore === null ? 'new' : size(d.sizeBefore) }} →
									{{ d.sizeAfter === null ? 'removed' : size(d.sizeAfter) }}.
								</p>
							} @else if (!d.lines.length) {
								<p class="rc-note">
									{{
										f.status === 'renamed'
											? 'Renamed with no changes to its lines.'
											: 'No changed lines.'
									}}
								</p>
							} @else {
								<div class="rc-cov-body">
									<div
										#code
										class="rc-log rc-cov-code"
									>
										@for (l of drawn(); track $index) {
											<div
												class="l"
												[class]="'l ' + l.kind"
												[attr.data-i]="$index"
											>
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
										}
										@if (folded()) {
											<div class="rc-center">
												<button
													type="button"
													class="rc-btn ghost"
													(click)="showAll.set(true)"
												>
													Show all {{ count(rowsAll().length) }} lines
												</button>
											</div>
										}
									</div>
								</div>
							}
						} @else {
							<p class="rc-note">{{ diffError() }}</p>
						}
					} @else {
						<p class="rc-note">Choose a file.</p>
					}
				</div>
			</div>
		} @else {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ filesError() }}</div>
			</div>
		}
	`,
})
export class PullFilesTab {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	readonly pull = input.required<PullPage>();
	protected readonly when = when;
	protected readonly count = (x: number) => x.toLocaleString('en-IN');
	protected size(bytes: number): string {
		return bytes < 1024
			? `${bytes} B`
			: bytes < 1_048_576
				? `${(bytes / 1024).toFixed(1)} KB`
				: `${(bytes / 1_048_576).toFixed(1)} MB`;
	}

	private readonly params = toSignal(
		inject(ActivatedRoute).queryParamMap.pipe(map((q) => ({ file: q.get('file'), commit: q.get('commit') }))),
		{ initialValue: { file: null, commit: null } },
	);
	readonly commit = computed(() => this.params().commit);

	readonly filesQ = injectQuery(() => ({
		queryKey: [
			'pull-files',
			this.ctx.projectId(),
			this.ctx.repoId(),
			this.pull().number,
			this.pull().headSha,
			this.commit(),
		],
		queryFn: async () => {
			const p = this.ctx.projectId() ?? '';
			const r = this.ctx.repoId() ?? '';
			const sha = this.commit();
			if (!sha) return this.api.pullFiles(p, r, this.pull().number);
			const c = await this.api.pullCommit(p, r, this.pull().number, sha);
			return c.state === 'ok' ? { ...c, data: c.data.files, commit: c.data } : c;
		},
	}));
	readonly list = computed(() => {
		const a = this.filesQ.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly filesError = computed(() => {
		const a = this.filesQ.data();
		return a && a.state !== 'ok' ? a.message : 'The console API is not answering.';
	});
	readonly commitInfo = computed(() => {
		const a = this.filesQ.data() as
			| { commit?: { sha: string; message: string; author: string; date: string; checks: PullPage['checks'] } }
			| undefined;
		if (!a?.commit) return null;
		const [headline, ...rest] = a.commit.message.split('\n');
		return {
			...a.commit,
			headline: headline as string,
			body: rest
				.join('\n')
				.trim()
				.split(/\n\s*\n/)
				.filter(Boolean),
		};
	});

	/* the tree */
	readonly findText = signal('');
	readonly open = signal<ReadonlySet<string>>(new Set());
	readonly treeShown = signal(true);
	private readonly files = computed(() => this.list()?.files ?? []);
	readonly rows = computed(() => fileRows(this.files(), this.open(), this.findText()));
	private readonly ordered = computed(() => filesInOrder(this.rows().flatMap((r) => (r.file ? [r.file] : []))));
	readonly chosen = computed<PullFile | null>(() => {
		const want = this.params().file;
		return this.files().find((f) => f.path === want) ?? filesInOrder(this.files())[0] ?? null;
	});

	constructor() {
		// A small pull request opens every folder; a big one only the folders above the open file.
		effect(() => {
			const files = this.files();
			const chosen = this.chosen();
			untracked(() => {
				const folders = new Set(this.open());
				const above = (path: string) =>
					path
						.split('/')
						.slice(0, -1)
						.map((_, i, all) => all.slice(0, i + 1).join('/'));
				for (const f of files.length <= OPEN_ALL_UP_TO ? files : files.filter((x) => x === chosen))
					for (const d of above(f.path)) folders.add(d);
				this.open.set(folders);
			});
		});
		// A new file starts with its changes only, folded when long.
		effect(() => {
			this.chosen();
			untracked(() => {
				this.whole.set(false);
				this.showAll.set(false);
			});
		});
	}

	pick(r: FileRow): void {
		if (r.folder) {
			const next = new Set(this.open());
			if (next.has(r.path)) next.delete(r.path);
			else next.add(r.path);
			this.open.set(next);
			return;
		}
		void this.router.navigate([], {
			queryParams: { file: r.path },
			queryParamsHandling: 'merge',
			replaceUrl: true,
		});
	}
	allFiles(): void {
		void this.router.navigate([], { queryParams: { commit: null, file: null }, queryParamsHandling: 'merge' });
	}

	/* the changes */
	readonly whole = signal(false);
	readonly showAll = signal(false);
	readonly diffQ = injectQuery(() => ({
		queryKey: [
			'pull-diff',
			this.ctx.projectId(),
			this.ctx.repoId(),
			this.pull().number,
			this.pull().headSha,
			this.commit(),
			this.chosen()?.path,
			this.whole(),
		],
		queryFn: () =>
			this.api.pullDiff(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.pull().number,
				// The read is on only while a file is chosen.
				(this.chosen() as PullFile).path,
				this.whole(),
				this.commit(),
			),
		enabled: !!this.chosen(),
	}));
	readonly diff = computed(() => {
		const a = this.diffQ.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly diffError = computed(() => {
		const a = this.diffQ.data();
		return a && a.state !== 'ok' ? a.message : 'The console API is not answering.';
	});
	readonly rowsAll = computed(() => {
		const d = this.diff();
		return d ? diffRows(d.lines, d.path) : [];
	});
	readonly folded = computed(() => !this.showAll() && this.rowsAll().length > FOLD_AT);
	readonly drawn = computed(() => (this.folded() ? this.rowsAll().slice(0, FOLD_AT) : this.rowsAll()));

	/* viewed ticks, kept per person in this browser for the pull request's newest commit */
	private readonly viewedKey = computed(
		() => `rc-pr-viewed:${this.ctx.repoId()}:${this.pull().number}:${this.pull().headSha}`,
	);
	readonly viewed = computed<ReadonlySet<string>>(() => {
		this.viewedTick();
		try {
			return new Set(JSON.parse(localStorage.getItem(this.viewedKey()) ?? '[]') as string[]);
		} catch {
			return new Set();
		}
	});
	private readonly viewedTick = signal(0);
	toggleViewed(path: string): void {
		const next = new Set(this.viewed());
		if (next.has(path)) next.delete(path);
		else next.add(path);
		try {
			localStorage.setItem(this.viewedKey(), JSON.stringify([...next]));
		} catch {
			// Storage refused (a private window): the tick lasts until the page is left.
		}
		this.viewedTick.update((n) => n + 1);
	}

	/* keys */
	private readonly findBox = viewChild<ElementRef<HTMLInputElement>>('find');
	private readonly code = viewChild<ElementRef<HTMLElement>>('code');
	private change = -1;
	key(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, .rc-modal')) return;
		if (e.key === '/') {
			e.preventDefault();
			this.findBox()?.nativeElement.focus();
		} else if (e.key === 'j' || e.key === 'k') this.step(e.key === 'j' ? 1 : -1);
		else if (e.key === 'n' || e.key === 'p') this.jump(e.key === 'n' ? 1 : -1);
	}
	/** The next or previous file of the tree as it is shown. */
	step(by: 1 | -1): void {
		const list = this.ordered();
		const at = list.findIndex((f) => f.path === this.chosen()?.path);
		const next = list[Math.min(list.length - 1, Math.max(0, at + by))];
		this.change = -1;
		if (next) this.pick({ path: next.path, folder: false } as FileRow);
	}
	/** The next or previous change of the open file, scrolled to the top of the code. */
	jump(by: 1 | -1): void {
		const starts = changeStarts(this.drawn());
		if (!starts.length) return;
		this.change = Math.min(starts.length - 1, Math.max(0, this.change + by));
		this.code()
			?.nativeElement.querySelector(`[data-i="${starts[this.change]}"]`)
			?.scrollIntoView({ block: 'start' });
	}
}
