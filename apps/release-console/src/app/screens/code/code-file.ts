import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	afterRenderEffect,
	computed,
	effect,
	inject,
	input,
	signal,
} from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { save } from './code-home';
import { CodeMarkdown } from './code-markdown';
import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { blameLines, checkMark, crumbsOf, fileLines, linesFragment, sizeSaid } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';
import { fileRows } from '../pulls/pull-view';

import type { PullFile, RepoInfo } from '@saha-textile/release-console-contracts';

/**
 * A file on a ref (brief 7Hu1SuB3A8qiJzeDwvFZLR, C5–C6): the branch's tree on the left (the Coverage screen's), the
 * path with ⧉, the file's last commit and its History, then Code, Blame (custom C8) or a Markdown file's Preview, with
 * Raw, copy, Download, ✎ Edit and ⋯ (Delete, Copy permalink, View on GitHub). Line numbers mark lines in the address.
 */
@Component({
	selector: 'rc-code-file',
	imports: [Icon, Loading, CodeSwitcher, CodeMarkdown, CodeChange],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'key($event)', '(document:click)': 'more.set(false)' },
	template: `
		<div class="rc-row between">
			<span class="rc-row">
				<button
					type="button"
					class="rc-btn ghost rc-pr-treebtn"
					(click)="treeShown.set(!treeShown())"
				>
					Files ▾
				</button>
				<rc-code-switcher
					[current]="ref()"
					(picked)="nav.at($event, nav.path(), 'blob')"
					(viewAll)="nav.open($event)"
				/>
				<span class="rc-mono">
					<a
						href=""
						(click)="$event.preventDefault(); nav.at(ref(), '', 'tree')"
					>
						{{ info().name }}
					</a>
					@for (c of crumbs(); track c.path; let last = $last) {
						/
						@if (last) {
							<b>{{ c.name }}</b>
						} @else {
							<a
								href=""
								(click)="$event.preventDefault(); nav.at(ref(), c.path, 'tree')"
							>
								{{ c.name }}
							</a>
						}
					}
				</span>
				<button
					type="button"
					class="rc-btn ghost"
					aria-label="Copy the path"
					[attr.data-tip]="copied() === 'path' ? 'Copied' : 'Copy the path'"
					(click)="copy(nav.path(), 'path')"
				>
					<rc-icon name="tabler/copy" />
				</button>
			</span>
			<span class="rc-msearch">
				<input
					readonly
					aria-label="Go to file"
					aria-haspopup="dialog"
					aria-keyshortcuts="t"
					placeholder="Go to file"
					(click)="nav.finding.set(true)"
					(keydown.enter)="nav.finding.set(true)"
				/>
				<kbd>t</kbd>
			</span>
		</div>
		<div
			class="rc-g-side rc-cov-split open rc-pr-split"
			[class.tree-hidden]="!treeShown()"
		>
			<div class="rc-tw rc-cov-tree">
				<div class="rc-msearch">
					<input
						class="rc-search"
						aria-label="Find a file in the tree"
						placeholder="Find a file"
						[value]="findText()"
						(input)="findText.set($any($event.target).value)"
					/>
				</div>
				<table
					class="rc-t"
					role="treegrid"
					aria-label="Files of this branch"
				>
					<tbody>
						@for (r of rows(); track r.path) {
							<tr
								class="row"
								tabindex="-1"
								[class.sel]="r.path === nav.path()"
								[attr.aria-expanded]="r.folder ? r.open : null"
								(click)="pickRow(r.path, r.folder)"
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
							</tr>
						}
					</tbody>
				</table>
			</div>
			<div class="rc-content">
				@if (q.isPending()) {
					<rc-loading what="Reading the file…" />
				} @else if (file(); as f) {
					@if (f.last; as l) {
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-row">
									<b>{{ l.author }}</b>
									<a
										href=""
										(click)="$event.preventDefault(); nav.open('commits', { sha: l.sha })"
									>
										{{ l.headline }}
									</a>
									@if (mark(l.checks); as m) {
										<span [class]="m.tone">{{ m.text }}</span>
									}
								</span>
								<span class="rc-row">
									<span class="rc-mono muted">{{ l.sha.slice(0, 7) }} · {{ when(l.date) }}</span>
									<button
										type="button"
										class="rc-btn ghost"
										(click)="nav.open('commits', { ref: ref(), path: nav.path() })"
									>
										⟲ History
									</button>
								</span>
							</div>
						</div>
					}
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-row">
								@for (v of views(); track v.key) {
									<button
										type="button"
										class="rc-chip"
										[class.on]="v.key === shown()"
										[attr.aria-pressed]="v.key === shown()"
										(click)="nav.go({ view: v.key === 'code' ? null : v.key })"
									>
										{{ v.label }}
									</button>
								}
								<span class="rc-mono muted">
									{{
										f.lines !== null
											? count(f.lines) + (f.lines === 1 ? ' line · ' : ' lines · ')
											: ''
									}}{{ size(f.size) }}
								</span>
							</span>
							<span class="rc-row">
								<button
									type="button"
									class="rc-btn ghost"
									(click)="raw()"
								>
									Raw
								</button>
								@if (f.text !== null) {
									<button
										type="button"
										class="rc-btn ghost"
										aria-label="Copy the file"
										[attr.data-tip]="copied() === 'raw' ? 'Copied' : 'Copy the file'"
										(click)="copy(f.text, 'raw')"
									>
										<rc-icon name="tabler/copy" />
									</button>
								}
								<button
									type="button"
									class="rc-btn ghost"
									aria-label="Download the file"
									data-tip="Download"
									(click)="download()"
								>
									<rc-icon name="tabler/download" />
								</button>
								@if (f.kind === 'text') {
									<button
										type="button"
										class="rc-btn ghost"
										aria-label="Edit this file"
										data-tip="Edit"
										(click)="nav.go({ type: 'edit', view: null })"
									>
										✎
									</button>
								}
								<span
									class="rc-msearch"
									(click)="$event.stopPropagation()"
								>
									<button
										type="button"
										class="rc-btn ghost"
										aria-label="More"
										aria-haspopup="menu"
										[attr.aria-expanded]="more()"
										(click)="more.set(!more())"
									>
										⋯
									</button>
									@if (more()) {
										<div
											class="rc-mres"
											role="menu"
										>
											<button
												type="button"
												class="rc-mrow"
												role="menuitem"
												(click)="permalink()"
											>
												<b>Copy permalink</b>
												<span>
													{{
														copied() === 'link'
															? 'Copied'
															: 'this file at ' + f.sha.slice(0, 7)
													}}
												</span>
											</button>
											<a
												class="rc-mrow"
												role="menuitem"
												target="_blank"
												rel="noopener"
												[href]="info().url + '/blob/' + ref() + '/' + nav.path()"
											>
												<b>View on GitHub ↗</b>
											</a>
											<button
												type="button"
												class="rc-mrow"
												role="menuitem"
												(click)="deleting.set(true); more.set(false)"
											>
												<b class="red">Delete file</b>
												<span>a commit, with your PIN</span>
											</button>
										</div>
									}
								</span>
							</span>
						</div>
						@if (f.kind === 'image') {
							@if (picture(); as src) {
								<img
									class="rc-center"
									[src]="src"
									[alt]="nav.path()"
								/>
							} @else {
								<rc-loading what="Reading the picture…" />
							}
						} @else if (f.kind !== 'text') {
							<p class="rc-note">
								{{
									f.kind === 'big'
										? 'This file is too big to show (' + size(f.size) + ').'
										: 'A binary file (' + size(f.size) + ').'
								}}
								Raw and Download have it.
							</p>
						} @else if (shown() === 'preview' && f.html) {
							<rc-code-markdown
								[html]="f.html"
								[repoUrl]="info().url"
								[ref]="ref()"
							/>
						} @else if (shown() === 'blame') {
							@if (bq.isPending()) {
								<rc-loading what="Reading who wrote each line…" />
							} @else if (blamed(); as b) {
								<div class="rc-cov-body">
									<div class="rc-log rc-cov-code blame">
										@for (l of b; track $index) {
											<div
												class="l"
												[class.first]="l.first"
												[class.part]="isMarked($index + 1)"
												[attr.data-line]="$index + 1"
											>
												<span
													class="who"
													[attr.title]="l.run ? l.run.headline + ' · ' + l.run.author : ''"
													(click)="l.run && nav.open('commits', { sha: l.run.sha })"
												>
													@if (l.first && l.run) {
														@if (l.run.previous; as was) {
															<a
																href=""
																aria-label="The file before this change"
																data-tip="The file before this change"
																(click)="
																	$event.preventDefault();
																	$event.stopPropagation();
																	before(was)
																"
															>
																⟲
															</a>
														}
														{{ when(l.run.date) }} · {{ l.run.headline }}
													}
												</span>
												<span
													class="n"
													(click)="markLine($index + 1, $event)"
												>
													{{ $index + 1 }}
												</span>
												<span
													class="m"
													[innerHTML]="l.html"
												></span>
											</div>
										}
									</div>
								</div>
							} @else {
								<p class="rc-note">{{ blameError() }}</p>
							}
						} @else {
							<div class="rc-cov-body">
								<div class="rc-log rc-cov-code">
									@for (l of lines(); track $index) {
										<div
											class="l"
											[class.part]="isMarked($index + 1)"
											[attr.data-line]="$index + 1"
										>
											<span
												class="n"
												(click)="markLine($index + 1, $event)"
											>
												{{ $index + 1 }}
											</span>
											<span class="src"></span>
											<span
												class="m"
												[innerHTML]="l.html"
											></span>
										</div>
									}
								</div>
							</div>
						}
					</div>
				} @else {
					<div class="rc-banner small red">
						<span class="rc-dot red"></span>
						<div>{{ fileError() }}</div>
					</div>
				}
			</div>
		</div>
		@if (jumping()) {
			<div
				class="rc-modal-back"
				(keydown.escape)="jumping.set(false)"
			>
				<form
					class="rc-modal"
					role="dialog"
					aria-label="Jump to line"
					(submit)="$event.preventDefault(); jump()"
				>
					<h3 class="rc-h">Jump to line</h3>
					<div class="rc-form">
						<label>
							Line (1 to {{ file()?.lines }})
							<input
								type="number"
								min="1"
								autofocus
								[max]="file()?.lines"
								[value]="jumpTo()"
								(input)="jumpTo.set($any($event.target).value)"
							/>
						</label>
					</div>
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="jumping.set(false)"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rc-btn primary"
						>
							Go
						</button>
					</div>
				</form>
			</div>
		}
		@if (deleting()) {
			<rc-code-change
				title="Delete this file"
				submit="Delete file"
				[danger]="true"
				[ready]="!!message().trim()"
				[run]="deleteRun"
				(closed)="deleting.set(false)"
				(finished)="deleted()"
			>
				<p class="rc-p">
					<b>{{ nav.path() }}</b>
					on
					<b>{{ ref() }}</b>
				</p>
				<label>
					Commit message
					<input
						[value]="message()"
						(input)="message.set($any($event.target).value)"
					/>
				</label>
				<label>
					New branch for this change (empty: straight onto {{ ref() }})
					<input
						[value]="branchFor()"
						(input)="branchFor.set($any($event.target).value)"
					/>
				</label>
			</rc-code-change>
		}
	`,
})
export class CodeFileView {
	private readonly api = inject(ConsoleApi);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	readonly ref = input.required<string>();
	/** Who is signed in, for a change's branch name. */
	readonly viewer = input('');
	protected readonly when = when;
	protected readonly mark = checkMark;
	protected readonly size = sizeSaid;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly crumbs = computed(() => crumbsOf(this.nav.path()));
	readonly treeShown = signal(true);
	readonly findText = signal('');
	readonly opened = signal(new Set<string>());
	readonly copied = signal('');
	readonly more = signal(false);
	readonly deleting = signal(false);
	readonly message = signal('');
	readonly branchFor = signal('');
	/** Jump to line (l), asked in the console's own box. */
	readonly jumping = signal(false);
	readonly jumpTo = signal('');
	/** The first line of a range being marked (shift-click marks to the next one). */
	private anchor: number | null = null;

	protected readonly q = injectQuery(() => ({
		queryKey: ['code-file', this.nav.p(), this.nav.r(), this.ref(), this.nav.path()],
		queryFn: () => this.api.codeFile(this.nav.p(), this.nav.r(), this.ref(), this.nav.path()),
	}));
	readonly file = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly fileError = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The file could not be read.';
	});
	protected readonly pq = injectQuery(() => ({
		queryKey: ['code-paths', this.nav.p(), this.nav.r(), this.ref()],
		queryFn: () => this.api.codePaths(this.nav.p(), this.nav.r(), this.ref()),
	}));
	/** Blame's ⟲: the file's blame on the commit before this run's, under the path it had there. */
	before(was: { sha: string; path: string }): void {
		this.nav.go({ ref: was.sha, path: was.path, view: 'blame' });
	}
	/** The tree: the folders on the way to the file open, and any the person opened. */
	readonly rows = computed(() => {
		const a = this.pq.data();
		const paths = a?.state === 'ok' ? a.data.paths : [];
		const files: PullFile[] = paths.map((path) => ({
			path,
			previous: null,
			status: 'modified',
			additions: 0,
			deletions: 0,
			binary: false,
		}));
		const open = new Set(this.opened());
		for (const c of crumbsOf(this.nav.path()).slice(0, -1)) open.add(c.path);
		return fileRows(files, open, this.findText());
	});
	readonly views = computed(() => [
		...(this.file()?.html ? [{ key: 'preview', label: 'Preview' }] : []),
		{ key: 'code', label: 'Code' },
		{ key: 'blame', label: 'Blame' },
	]);
	/** A Markdown file opens as Preview, others as Code, unless the address says otherwise. */
	readonly shown = computed(() => this.nav.view() || (this.file()?.html ? 'preview' : 'code'));
	readonly lines = computed(() => {
		const f = this.file();
		return f?.text !== null && f?.text !== undefined ? fileLines(f.text, f.path) : [];
	});
	protected readonly bq = injectQuery(() => ({
		queryKey: ['code-blame', this.nav.p(), this.nav.r(), this.ref(), this.nav.path()],
		queryFn: () => this.api.codeBlame(this.nav.p(), this.nav.r(), this.ref(), this.nav.path()),
		enabled: this.shown() === 'blame',
	}));
	readonly blamed = computed(() => {
		const a = this.bq.data();
		return a?.state === 'ok' ? blameLines(a.data.lines, a.data.runs, a.data.path) : null;
	});
	readonly blameError = computed(() => {
		const a = this.bq.data();
		return a && a.state !== 'ok' ? a.message : 'The blame could not be read.';
	});
	readonly picture = signal<string | null>(null);

	constructor() {
		// A picture is read with the session, then shown from the browser's own copy.
		effect(() => {
			const f = this.file();
			if (f?.kind !== 'image') return;
			void this.api.codeRaw(this.nav.p(), this.nav.r(), this.ref(), f.path).then(
				(blob) => this.picture.set(URL.createObjectURL(blob)),
				() => this.picture.set(null),
			);
		});
		inject(DestroyRef).onDestroy(() => {
			const src = this.picture();
			if (src) URL.revokeObjectURL(src);
		});
		// The marked lines come into view once drawn.
		afterRenderEffect(() => {
			const at = this.nav.lines();
			this.lines();
			if (at)
				this.host.nativeElement.querySelector(`[data-line="${at.start}"]`)?.scrollIntoView({ block: 'center' });
		});
	}

	isMarked(n: number): boolean {
		const at = this.nav.lines();
		return !!at && n >= at.start && n <= at.end;
	}
	/** A line number marks its line; shift with a second one marks the lines between. */
	markLine(n: number, e: MouseEvent): void {
		const start = e.shiftKey && this.anchor !== null ? this.anchor : n;
		if (!e.shiftKey) this.anchor = n;
		this.nav.go({}, linesFragment(Math.min(start, n), Math.max(start, n)));
	}
	pickRow(path: string, folder: boolean): void {
		if (!folder) {
			this.nav.at(this.ref(), path, 'blob');
			return;
		}
		const next = new Set(this.opened());
		if (next.has(path)) next.delete(path);
		else next.add(path);
		this.opened.set(next);
	}
	copy(text: string, what: string): void {
		const done = () => {
			this.copied.set(what);
			setTimeout(() => this.copied.set(''), 1500);
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => undefined);
	}
	/** Copy permalink: this file at its commit, with the marked lines. */
	permalink(): void {
		const f = this.file();
		if (!f) return;
		const at = this.nav.lines();
		this.copy(this.nav.link({ ref: f.sha }, at ? linesFragment(at.start, at.end) : null), 'link');
	}
	async raw(): Promise<void> {
		const blob = await this.api.codeRaw(this.nav.p(), this.nav.r(), this.ref(), this.nav.path());
		window.open(URL.createObjectURL(blob), '_blank', 'noopener');
	}
	async download(): Promise<void> {
		const blob = await this.api.codeRaw(this.nav.p(), this.nav.r(), this.ref(), this.nav.path());
		save(blob, this.nav.path().slice(this.nav.path().lastIndexOf('/') + 1));
	}
	readonly deleteRun = (pin: string) =>
		this.api.codeChange(this.nav.p(), this.nav.r(), 'commit', {
			pin,
			branch: this.ref(),
			message: this.message().trim(),
			changes: [{ path: this.nav.path(), content: null }],
			newBranch: this.branchFor().trim(),
			pull: true,
		});
	jump(): void {
		const n = Number(this.jumpTo());
		const last = this.file()?.lines ?? 0;
		this.jumping.set(false);
		if (Number.isInteger(n) && n > 0 && n <= last) this.nav.go({}, linesFragment(n, n));
	}
	deleted(): void {
		this.deleting.set(false);
		this.nav.at(
			this.branchFor().trim() || this.ref(),
			crumbsOf(this.nav.path()).slice(-2, -1)[0]?.path ?? '',
			'tree',
		);
	}

	/** GitHub's keys on a file: b Blame, y the permalink in the address, l jump to a line. */
	key(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable]')) return;
		const f = this.file();
		if (!f) return;
		if (e.key === 'b') this.nav.go({ view: this.shown() === 'blame' ? null : 'blame' });
		else if (e.key === 'y') {
			const at = this.nav.lines();
			this.nav.go({ ref: f.sha }, at ? linesFragment(at.start, at.end) : null);
		} else if (e.key === 'l' && f.lines) {
			e.preventDefault();
			this.jumpTo.set('');
			this.jumping.set(true);
		}
	}
}
