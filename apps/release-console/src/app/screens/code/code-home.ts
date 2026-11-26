import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { CodeMarkdown } from './code-markdown';
import { CodeNav } from './code-nav';
import { CodeSwitcher } from './code-switcher';
import { checkMark, cloneWays, crumbsOf, parentOf } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { GithubSignIn } from '../../shared/github-sign-in';
import { Icon } from '../../shared/icons';
import { Loading } from '../../shared/loading';

import type { RepoInfo } from '@saha-textile/release-console-contracts';

/**
 * A folder on a ref (brief 7Hu1SuB3A8qiJzeDwvFZLR, C1): the switcher, Go to file, Add file ▾ and Code ▾; the newest
 * commit reaching the folder; its files with each one's last commit; its README with the community files' tabs; and
 * at the top, GitHub's right column (About, Releases, Packages, Deployments, Contributors, Languages).
 */
@Component({
	selector: 'rc-code-home',
	imports: [Icon, Loading, CodeSwitcher, CodeMarkdown, CodeChange, GithubSignIn],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:click)': 'menu.set(null)' },
	template: `
		@let top = !nav.path();
		<div [class]="top ? 'rc-pr-cols' : 'rc-content'">
			<div class="rc-pr-main">
				<div class="rc-row between">
					<span class="rc-row">
						<rc-code-switcher
							[current]="ref()"
							(picked)="nav.at($event, nav.path(), 'tree')"
							(viewAll)="nav.open($event)"
						/>
						@if (top) {
							<button
								type="button"
								class="rc-btn ghost"
								(click)="nav.open('branches')"
							>
								<rc-icon name="tabler/git-branch" />
								{{ count(info().branches) }} {{ info().branches === 1 ? 'branch' : 'branches' }}
							</button>
							<button
								type="button"
								class="rc-btn ghost"
								(click)="nav.open('tags')"
							>
								<rc-icon name="tabler/tag" />
								{{ count(info().tags) }} {{ info().tags === 1 ? 'tag' : 'tags' }}
							</button>
						} @else {
							<span class="rc-mono">
								<a
									href=""
									(click)="$event.preventDefault(); nav.at(ref(), '', 'tree')"
								>
									{{ info().name }}
								</a>
								@for (c of crumbs(); track c.path) {
									/
									<a
										href=""
										(click)="$event.preventDefault(); nav.at(ref(), c.path, 'tree')"
									>
										{{ c.name }}
									</a>
								}
							</span>
						}
					</span>
					<span class="rc-row">
						<!-- GitHub's Go to file box: the console's menu search box, which opens the finder (t). -->
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
						<span
							class="rc-msearch"
							(click)="$event.stopPropagation()"
						>
							<button
								type="button"
								class="rc-btn"
								aria-haspopup="menu"
								[attr.aria-expanded]="menu() === 'add'"
								(click)="toggle('add')"
							>
								Add file ▾
							</button>
							@if (menu() === 'add') {
								<div
									class="rc-mres"
									role="menu"
								>
									<button
										type="button"
										class="rc-mrow"
										role="menuitem"
										(click)="add('new')"
									>
										<b>＋ Create new file</b>
										<span>in {{ nav.path() || 'the top folder' }}</span>
									</button>
									<button
										type="button"
										class="rc-mrow"
										role="menuitem"
										(click)="add('upload')"
									>
										<b>⤒ Upload files</b>
										<span>drop files or pick them</span>
									</button>
								</div>
							}
						</span>
						<span
							class="rc-msearch"
							(click)="$event.stopPropagation()"
						>
							<button
								type="button"
								class="rc-btn primary"
								aria-haspopup="menu"
								[attr.aria-expanded]="menu() === 'code'"
								(click)="toggle('code')"
							>
								&lt;&gt; Code ▾
							</button>
							@if (menu() === 'code') {
								<div
									class="rc-mres"
									role="menu"
								>
									<span class="rc-label">Clone</span>
									@for (w of clone(); track w.label) {
										<button
											type="button"
											class="rc-mrow"
											role="menuitem"
											[attr.aria-label]="'Copy ' + w.label + ' address'"
											(click)="copy(w.text)"
										>
											<b class="rc-mono">{{ w.text }}</b>
											<span>
												{{ w.label }} · {{ copied() === w.text ? 'Copied' : 'click to copy' }}
											</span>
										</button>
									}
									<button
										type="button"
										class="rc-mrow"
										role="menuitem"
										[disabled]="zipping()"
										(click)="zip()"
									>
										<b>⤓ Download ZIP</b>
										<span>
											{{
												zipping()
													? 'Reading the .zip from GitHub…'
													: ref() + ', straight from GitHub'
											}}
										</span>
									</button>
									<a
										class="rc-mrow"
										role="menuitem"
										[href]="'x-github-client://openRepo/' + info().url"
									>
										<b>Open with GitHub Desktop</b>
										<span>where the console runs on your Mac</span>
									</a>
									<a
										class="rc-mrow"
										role="menuitem"
										target="_blank"
										rel="noopener"
										[href]="
											'https://github.com/codespaces/new?repo=' +
											info().owner +
											'/' +
											info().name +
											'&ref=' +
											ref()
										"
									>
										<b>Codespaces ↗</b>
										<span>opens GitHub</span>
									</a>
								</div>
							}
						</span>
					</span>
				</div>
				@if (zipError()) {
					<div class="rc-banner small red">
						<span class="rc-dot red"></span>
						<div>{{ zipError() }}</div>
					</div>
				}
				@if (q.isPending()) {
					<rc-loading what="Reading the folder…" />
				} @else if (tree(); as t) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-row">
								<b>{{ t.head.author }}</b>
								<a
									href=""
									(click)="$event.preventDefault(); nav.open('commits', { sha: t.head.sha })"
								>
									{{ t.head.headline }}
								</a>
								@if (mark(t.head.checks); as m) {
									<span [class]="m.tone">{{ m.text }}</span>
								}
							</span>
							<span class="rc-row">
								<span class="rc-mono muted">
									{{ t.head.sha.slice(0, 7) }} · {{ when(t.head.date) }}
								</span>
								<button
									type="button"
									class="rc-btn ghost"
									(click)="nav.open('commits', { ref: ref(), path: nav.path() || null })"
								>
									⟲ {{ count(t.commits) }} {{ t.commits === 1 ? 'commit' : 'commits' }}
								</button>
							</span>
						</div>
						<div class="rc-tw">
							<table
								class="rc-t"
								aria-label="Files"
							>
								<tbody>
									@if (nav.path()) {
										<!-- GitHub's way up a level: a folder named "..", with where it leads on hover. -->
										<tr
											class="row"
											tabindex="0"
											[title]="'Up to ' + (parent() || info().name)"
											(click)="nav.at(ref(), parent(), 'tree')"
											(keydown.enter)="nav.at(ref(), parent(), 'tree')"
										>
											<td colspan="3">
												<rc-icon name="tabler/folder" />
												..
											</td>
										</tr>
									}
									@for (e of t.entries; track e.path) {
										<tr
											class="row"
											tabindex="0"
											(click)="openEntry(e.path, e.kind)"
											(keydown.enter)="openEntry(e.path, e.kind)"
										>
											<td>
												<rc-icon [name]="icon(e.kind)" />
												{{ e.name }}
											</td>
											<td class="muted">
												@if (e.last; as l) {
													<a
														href=""
														(click)="
															$event.preventDefault();
															$event.stopPropagation();
															nav.open('commits', { sha: l.sha })
														"
													>
														{{ l.headline }}
													</a>
												}
											</td>
											<td class="num rc-mono muted">{{ e.last ? when(e.last.date) : '' }}</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
					</div>
					@if (t.readme || (top && docs().length > 1)) {
						<div class="rc-panel">
							<div class="rc-ph">
								<div
									class="rc-tabs"
									role="tablist"
								>
									@for (d of docs(); track d.key) {
										<span
											role="tab"
											tabindex="0"
											[class.on]="d.key === doc()"
											[attr.aria-selected]="d.key === doc()"
											(click)="doc.set(d.key)"
											(keydown.enter)="doc.set(d.key)"
										>
											{{ d.label }}
										</span>
									}
								</div>
								@if (docPath(); as path) {
									<button
										type="button"
										class="rc-btn ghost"
										aria-label="Edit this file"
										data-tip="Edit"
										(click)="nav.go({ tab: 'files', type: 'edit', path })"
									>
										✎
									</button>
								}
							</div>
							@if (doc() === 'readme' && t.readme) {
								<rc-code-markdown
									[html]="t.readme.html"
									[repoUrl]="info().url"
									[ref]="ref()"
								/>
							} @else if (dq.isPending()) {
								<rc-loading what="Reading the file…" />
							} @else if (docHtml(); as html) {
								<rc-code-markdown
									[html]="html"
									[repoUrl]="info().url"
									[ref]="ref()"
								/>
							}
						</div>
					}
				} @else {
					<div class="rc-banner small red">
						<span class="rc-dot red"></span>
						<div>{{ treeError() }}</div>
					</div>
				}
			</div>
			@if (top) {
				<aside class="rc-pr-side">
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">About</span>
							<button
								type="button"
								class="rc-btn ghost"
								aria-label="Edit About"
								data-tip="Edit"
								(click)="editAbout()"
							>
								✎
							</button>
						</div>
						<p class="rc-p">{{ info().description || 'No description, website or topics yet.' }}</p>
						@if (info().homepage; as home) {
							<a
								[href]="home"
								target="_blank"
								rel="noopener"
							>
								{{ home }} ↗
							</a>
						}
						@if (info().topics.length) {
							<span class="rc-row">
								@for (topic of info().topics; track topic) {
									<span class="rc-chip on">{{ topic }}</span>
								}
							</span>
						}
						<div class="rc-kv">
							<div>
								<span>Stars</span>
								<em>{{ count(info().stars) }}</em>
							</div>
							<div>
								<span>Watching</span>
								<em>{{ count(info().watchers) }}</em>
							</div>
							<div>
								<span>Forks</span>
								<em>{{ count(info().forks) }}</em>
							</div>
							@if (info().license; as license) {
								<div>
									<span>Licence</span>
									<em>{{ license }}</em>
								</div>
							}
						</div>
						<span class="rc-row">
							<button
								type="button"
								class="rc-btn ghost"
								(click)="doc.set('readme')"
							>
								Readme
							</button>
							<button
								type="button"
								class="rc-btn ghost"
								(click)="nav.open('activity')"
							>
								Activity
							</button>
						</span>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Releases · {{ count(info().releases.total) }}</span>
						</div>
						@if (info().releases.latest; as l) {
							<p class="rc-p">
								<b>{{ l.name || l.tag }}</b>
								<span class="rc-pill ok">Latest</span>
								<br />
								<span class="rc-mono muted">{{ l.tag }} · {{ when(l.publishedAt) }}</span>
							</p>
						} @else {
							<p class="rc-note">No releases yet.</p>
						}
						<button
							type="button"
							class="rc-btn ghost"
							(click)="nav.open('releases', info().releases.total ? {} : { new: '1' })"
						>
							{{ info().releases.total ? 'All releases' : 'Create a new release' }}
						</button>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Packages</span>
						</div>
						@if (packages(); as list) {
							@for (pk of list; track pk.name) {
								<a
									class="rc-mono"
									[href]="pk.url"
									target="_blank"
									rel="noopener"
								>
									{{ pk.name }} ↗
								</a>
							} @empty {
								<p class="rc-note">No packages published.</p>
							}
						} @else {
							<p class="rc-note amber">{{ packagesError() }}</p>
							@if (needsRight()) {
								<button
									type="button"
									class="rc-btn"
									(click)="signing.set(true)"
								>
									Add the Packages right
								</button>
							}
						}
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Deployments · {{ info().environments.length }}</span>
						</div>
						@for (e of info().environments; track e.name) {
							<p class="rc-p">
								<span class="rc-pill">{{ e.name }}</span>
								<span class="rc-mono muted">
									{{
										e.deployedAt
											? when(e.deployedAt) + (e.state ? ' · ' + e.state : '')
											: 'no deployments yet'
									}}
								</span>
							</p>
						} @empty {
							<p class="rc-note">No environments.</p>
						}
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Contributors · {{ count(info().contributors.total) }}</span>
						</div>
						<span class="rc-row">
							@for (c of info().contributors.people; track c.login) {
								<span
									class="rc-chip"
									[attr.data-tip]="count(c.contributions) + ' commits'"
								>
									{{ c.login }}
								</span>
							}
						</span>
					</div>
					@if (info().languages.length) {
						<div class="rc-panel rc-code-langs">
							<div class="rc-ph">
								<span class="rc-label">Languages</span>
							</div>
							<span class="rc-bar">
								@for (l of info().languages; track l.name) {
									<i
										[style.width.%]="l.share"
										[style.background]="l.color"
									></i>
								}
							</span>
							<span class="rc-row">
								@for (l of info().languages; track l.name) {
									<span class="rc-mono">
										<span
											class="rc-dot"
											[style.background]="l.color"
										></span>
										{{ l.name }} {{ l.share }}%
									</span>
								}
							</span>
						</div>
					}
				</aside>
			}
		</div>
		@if (signing()) {
			<rc-github-sign-in
				mode="packages"
				[repository]="info().owner + '/' + info().name"
				(closed)="rightAdded()"
			/>
		}
		@if (about()) {
			<rc-code-change
				title="Edit About"
				submit="Save About"
				[run]="aboutRun"
				(closed)="about.set(false)"
				(finished)="changed()"
			>
				<label>
					Description
					<textarea
						rows="3"
						maxlength="350"
						[value]="aboutText()"
						(input)="aboutText.set($any($event.target).value)"
					></textarea>
				</label>
				<label>
					Website
					<input
						type="url"
						[value]="aboutHome()"
						(input)="aboutHome.set($any($event.target).value)"
					/>
				</label>
				<label>
					Topics (separated by spaces or commas)
					<input
						[value]="aboutTopics()"
						(input)="aboutTopics.set($any($event.target).value)"
					/>
				</label>
			</rc-code-change>
		}
	`,
})
export class CodeHome {
	private readonly api = inject(ConsoleApi);
	private readonly queries = injectQueryClient();
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	/** The ref shown: the address's, or the default branch. */
	readonly ref = input.required<string>();
	protected readonly when = when;
	protected readonly mark = checkMark;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly menu = signal<'add' | 'code' | null>(null);
	readonly copied = signal('');
	readonly zipping = signal(false);
	readonly zipError = signal('');
	readonly doc = signal<string>('readme');
	readonly about = signal(false);
	/** Adding GitHub's packages right (Q7 A): the owner approves it on GitHub's own page. */
	readonly signing = signal(false);
	readonly aboutText = signal('');
	readonly aboutHome = signal('');
	readonly aboutTopics = signal('');

	protected readonly q = injectQuery(() => ({
		queryKey: ['code-tree', this.nav.p(), this.nav.r(), this.ref(), this.nav.path()],
		queryFn: () => this.api.codeTree(this.nav.p(), this.nav.r(), this.ref(), this.nav.path()),
	}));
	readonly tree = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly treeError = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The folder could not be read.';
	});
	constructor() {
		// Git keeps no empty folders: a folder address with nothing under it names a file, which opens in its place,
		// as GitHub sends a folder address that names a file to the file's page.
		effect(() => {
			const t = this.tree();
			if (t?.path && !t.entries.length) untracked(() => this.nav.at(this.ref(), t.path, 'blob', null, true));
		});
	}
	readonly crumbs = computed(() => crumbsOf(this.nav.path()));
	readonly parent = computed(() => parentOf(this.nav.path()));
	readonly clone = computed(() => cloneWays(this.info().owner, this.info().name));
	/** README first, then the licence, code of conduct, contributing guide and security policy the branch has. */
	readonly docs = computed(() => {
		const readme = this.tree()?.readme;
		const first = readme ? [{ key: 'readme', label: 'README', path: readme.path }] : [];
		const rest = this.nav.path() ? [] : this.info().community.filter((c) => c.key !== 'readme');
		return [...first, ...rest];
	});
	readonly docPath = computed(() => this.docs().find((d) => d.key === this.doc())?.path ?? '');
	protected readonly dq = injectQuery(() => ({
		queryKey: ['code-doc', this.nav.p(), this.nav.r(), this.ref(), this.docPath()],
		queryFn: () => this.api.codeDoc(this.nav.p(), this.nav.r(), this.ref(), this.docPath()),
		enabled: this.doc() !== 'readme' && !!this.docPath(),
	}));
	readonly docHtml = computed(() => {
		const a = this.dq.data();
		return a?.state === 'ok' ? a.data.html : a ? `<p>${a.message}</p>` : '';
	});
	protected readonly pq = injectQuery(() => ({
		queryKey: ['code-packages', this.nav.p(), this.nav.r()],
		queryFn: () => this.api.codePackages(this.nav.p(), this.nav.r()),
		enabled: !this.nav.path(),
	}));
	readonly packages = computed(() => {
		const a = this.pq.data();
		return a?.state === 'ok' ? a.data.packages : null;
	});
	readonly packagesError = computed(() => {
		const a = this.pq.data();
		return a && a.state !== 'ok' ? a.message : 'Reading packages…';
	});

	/** The sign-in lacks the packages right: the box offers to add it. */
	readonly needsRight = computed(() => this.packagesError().includes('read:packages'));
	rightAdded(): void {
		this.signing.set(false);
		void this.pq.refetch();
	}
	icon(kind: string): string {
		return { dir: 'tabler/folder', module: 'tabler/folder-symlink', link: 'tabler/link' }[kind] ?? 'tabler/file';
	}
	openEntry(path: string, kind: string): void {
		this.nav.at(this.ref(), path, kind === 'dir' || kind === 'module' ? 'tree' : 'blob');
	}
	toggle(which: 'add' | 'code'): void {
		this.menu.set(this.menu() === which ? null : which);
	}
	add(mode: 'new' | 'upload'): void {
		this.menu.set(null);
		this.nav.go({ tab: 'files', type: mode });
	}
	copy(text: string): void {
		const done = () => {
			this.copied.set(text);
			setTimeout(() => this.copied.set(''), 1500);
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => undefined);
	}
	/** Download ZIP: GitHub's .zip of the ref, saved under its own name. */
	async zip(): Promise<void> {
		this.zipping.set(true);
		this.zipError.set('');
		try {
			save(
				await this.api.codeZip(this.nav.p(), this.nav.r(), this.ref()),
				`${this.info().name}-${this.ref().replace(/\//g, '-')}.zip`,
			);
			this.menu.set(null);
		} catch (error) {
			this.zipError.set((error as Error).message);
		} finally {
			this.zipping.set(false);
		}
	}
	editAbout(): void {
		this.aboutText.set(this.info().description ?? '');
		this.aboutHome.set(this.info().homepage ?? '');
		this.aboutTopics.set(this.info().topics.join(' '));
		this.about.set(true);
	}
	readonly aboutRun = (pin: string) =>
		this.api.codeChange(this.nav.p(), this.nav.r(), 'about', {
			pin,
			description: this.aboutText().trim(),
			homepage: this.aboutHome().trim(),
			topics: this.aboutTopics()
				.split(/[\s,]+/)
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean),
		});
	changed(): void {
		this.about.set(false);
		void this.queries.invalidateQueries({ queryKey: ['code-repo'] });
	}
}

/** Saves bytes under a name, as the browser's download. */
export function save(blob: Blob, name: string): void {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
