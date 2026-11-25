import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';

import {
	FILE_LIMIT_BYTES,
	type CodeRelease,
	type CodeReleases,
	type CodeTags,
	type RepoInfo,
	type VendorAnswer,
} from '@saha-textile/release-console-contracts';
import { injectInfiniteQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { CodeMarkdown } from './code-markdown';
import { CodeNav } from './code-nav';
import { base64Of, sizeSaid } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Loading } from '../../shared/loading';

/**
 * Tags (brief 7Hu1SuB3A8qiJzeDwvFZLR, C10): newest first with each one's commit, date, .zip and .tar.gz, and whether
 * a release was made from it.
 */
@Component({
	selector: 'rc-code-tags',
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (q.isPending()) {
			<rc-loading what="Reading the tags from GitHub…" />
		} @else {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">Tags</span>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="nav.open('releases', { new: '1' })"
					>
						Create a release
					</button>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<tbody>
							@for (t of tags(); track t.name) {
								<tr>
									<td>
										<a
											href=""
											(click)="$event.preventDefault(); nav.at(t.name, '', 'tree')"
										>
											{{ t.name }}
										</a>
										@if (t.release) {
											<span class="rc-pill ok">release</span>
										}
									</td>
									<td class="rc-mono muted">{{ t.date ? when(t.date) : '' }}</td>
									<td class="rc-mono cy">{{ t.sha.slice(0, 7) }}</td>
									<td class="rc-row end">
										<a
											class="rc-btn ghost"
											target="_blank"
											rel="noopener"
											[href]="info().url + '/archive/refs/tags/' + t.name + '.zip'"
										>
											.zip
										</a>
										<a
											class="rc-btn ghost"
											target="_blank"
											rel="noopener"
											[href]="info().url + '/archive/refs/tags/' + t.name + '.tar.gz'"
										>
											.tar.gz
										</a>
									</td>
								</tr>
							} @empty {
								<tr>
									<td colspan="4">
										{{
											error() ||
												'No tags yet. Tags appear here once a release or a deploy makes one.'
										}}
									</td>
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
							{{ q.isFetchingNextPage() ? 'Reading…' : 'Next 30' }}
						</button>
					</div>
				}
			</div>
		}
	`,
})
export class CodeTagsTab {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	protected readonly when = when;
	readonly q = injectInfiniteQuery(() => ({
		queryKey: ['code-tags', this.nav.p(), this.nav.r()],
		queryFn: ({ pageParam }: { pageParam: string }) => this.api.codeTags(this.nav.p(), this.nav.r(), pageParam),
		initialPageParam: '',
		getNextPageParam: (last: VendorAnswer<CodeTags>) =>
			last.state === 'ok' && last.data.next ? last.data.next : undefined,
	}));
	readonly tags = computed(() => (this.q.data()?.pages ?? []).flatMap((a) => (a.state === 'ok' ? a.data.tags : [])));
	readonly error = computed(() => {
		const bad = (this.q.data()?.pages ?? []).find((a) => a.state !== 'ok');
		return bad ? bad.message : '';
	});
}

/**
 * Releases (brief 7Hu1SuB3A8qiJzeDwvFZLR, C10): each release's notes as GitHub draws them, its files with sizes and
 * download counts, Latest, Pre-release and Draft marks; and the release form, with GitHub's own Generate release notes,
 * files to attach, Edit and Delete, every change with the PIN.
 */
@Component({
	selector: 'rc-code-releases',
	imports: [Loading, CodeChange, CodeMarkdown],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-label">Releases</span>
			<button
				type="button"
				class="rc-btn primary"
				(click)="draft(null)"
			>
				Draft a new release
			</button>
		</div>
		@if (q.isPending()) {
			<rc-loading what="Reading the releases from GitHub…" />
		} @else {
			@for (r of releases(); track r.id) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-row">
							<b>{{ r.name }}</b>
							@if (r.latest) {
								<span class="rc-pill ok">Latest</span>
							}
							@if (r.prerelease) {
								<span class="rc-pill amber">Pre-release</span>
							}
							@if (r.draft) {
								<span class="rc-pill">Draft</span>
							}
						</span>
						<span class="rc-row">
							<span class="rc-mono muted">
								{{ r.tag }} · {{ r.author }} ·
								{{ r.publishedAt ? when(r.publishedAt) : 'not published' }}
							</span>
							<button
								type="button"
								class="rc-btn ghost"
								aria-label="Edit this release"
								data-tip="Edit"
								(click)="draft(r)"
							>
								✎
							</button>
							<button
								type="button"
								class="rc-btn ghost"
								aria-label="Delete this release"
								data-tip="Delete"
								(click)="deleting.set(r)"
							>
								🗑
							</button>
						</span>
					</div>
					@if (r.bodyHtml) {
						<rc-code-markdown
							[html]="r.bodyHtml"
							[repoUrl]="info().url"
							[ref]="r.tag"
							[withOutline]="false"
						/>
					}
					<div class="rc-kv">
						@for (a of r.assets; track a.id) {
							<div>
								<span>
									<a
										[href]="a.url"
										target="_blank"
										rel="noopener"
									>
										{{ a.name }}
									</a>
								</span>
								<em>{{ size(a.size) }} · {{ a.downloads }} downloads</em>
							</div>
						}
						<div>
							<span>Source code</span>
							<em>
								<a
									[href]="info().url + '/archive/refs/tags/' + r.tag + '.zip'"
									target="_blank"
									rel="noopener"
								>
									.zip
								</a>
								·
								<a
									[href]="info().url + '/archive/refs/tags/' + r.tag + '.tar.gz'"
									target="_blank"
									rel="noopener"
								>
									.tar.gz
								</a>
							</em>
						</div>
					</div>
				</div>
			} @empty {
				<div class="rc-panel">
					<p class="rc-note">{{ error() || 'No releases yet. Draft a new release to make the first.' }}</p>
				</div>
			}
			@if (q.hasNextPage()) {
				<div class="rc-center">
					<button
						type="button"
						class="rc-btn ghost"
						[disabled]="q.isFetchingNextPage()"
						(click)="q.fetchNextPage()"
					>
						{{ q.isFetchingNextPage() ? 'Reading…' : 'Older releases' }}
					</button>
				</div>
			}
		}
		@if (editing()) {
			<rc-code-change
				[title]="editingId() ? 'Edit release' : 'New release'"
				[submit]="asDraft() ? 'Save draft' : editingId() ? 'Update release' : 'Publish release'"
				[ready]="!!tag().trim() && !!target().trim()"
				[run]="saveRun"
				(closed)="editing.set(false)"
				(finished)="changed()"
			>
				<label>
					Tag (an existing one, or a new one made on publishing)
					<input
						[value]="tag()"
						(input)="tag.set($any($event.target).value)"
					/>
				</label>
				<label>
					Target (the branch or commit a new tag is made on)
					<input
						[value]="target()"
						(input)="target.set($any($event.target).value)"
					/>
				</label>
				<label>
					Title
					<input
						[value]="title()"
						(input)="title.set($any($event.target).value)"
					/>
				</label>
				<label>
					Notes
					<textarea
						rows="8"
						[value]="notes()"
						(input)="notes.set($any($event.target).value)"
					></textarea>
				</label>
				<span class="rc-row">
					<input
						class="rc-search"
						aria-label="Previous tag for the notes"
						placeholder="previous tag (optional)"
						[value]="previous()"
						(input)="previous.set($any($event.target).value)"
					/>
					<button
						type="button"
						class="rc-btn ghost"
						[disabled]="writing() || !tag().trim()"
						(click)="generate()"
					>
						{{ writing() ? 'GitHub is writing…' : '✦ Generate release notes' }}
					</button>
				</span>
				@if (notesError()) {
					<p class="rc-note red">{{ notesError() }}</p>
				}
				<label class="rc-row">
					<input
						type="checkbox"
						[checked]="prerelease()"
						(change)="prerelease.set($any($event.target).checked)"
					/>
					Set as a pre-release
				</label>
				<label class="rc-row">
					<input
						type="checkbox"
						[checked]="latest()"
						[disabled]="prerelease() || asDraft()"
						(change)="latest.set($any($event.target).checked)"
					/>
					Set as the latest release
				</label>
				<label class="rc-row">
					<input
						type="checkbox"
						[checked]="asDraft()"
						(change)="asDraft.set($any($event.target).checked)"
					/>
					Save as a draft (not public yet)
				</label>
				<label>
					Attach files ({{ files().length }}, up to 10, {{ size(maxSize) }} each)
					<input
						type="file"
						multiple
						(change)="attach($any($event.target).files)"
					/>
				</label>
				@for (f of files(); track f.name; let i = $index) {
					<span class="rc-row between">
						<span class="rc-mono">{{ f.name }} · {{ size(f.size) }}</span>
						<button
							type="button"
							class="rc-btn ghost"
							[attr.aria-label]="'Remove ' + f.name"
							(click)="files.set(files().filter((_, at) => at !== i))"
						>
							✕
						</button>
					</span>
				}
				@if (editingId(); as id) {
					@for (a of existing(); track a.id) {
						<span class="rc-row between">
							<span class="rc-mono">{{ a.name }} · {{ size(a.size) }}</span>
							<button
								type="button"
								class="rc-btn ghost"
								[attr.aria-label]="'Remove ' + a.name + ' from the release'"
								(click)="removing.set(a.id)"
							>
								🗑
							</button>
						</span>
					}
				}
			</rc-code-change>
		}
		@if (removing(); as id) {
			<rc-code-change
				title="Remove a release file"
				submit="Remove file"
				[danger]="true"
				[run]="removeRun(id)"
				(closed)="removing.set(null)"
				(finished)="removedAsset(id)"
			>
				<p class="rc-p">The file is removed from the release on GitHub.</p>
			</rc-code-change>
		}
		@if (deleting(); as r) {
			<rc-code-change
				title="Delete a release"
				submit="Delete release"
				[danger]="true"
				[run]="deleteRun(r.id)"
				(closed)="deleting.set(null)"
				(finished)="changed()"
			>
				<p class="rc-p">
					<b>{{ r.name }}</b>
					is deleted. Its tag {{ r.tag }} stays.
				</p>
			</rc-code-change>
		}
	`,
})
export class CodeReleasesTab {
	private readonly api = inject(ConsoleApi);
	private readonly queries = injectQueryClient();
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	protected readonly when = when;
	protected readonly size = sizeSaid;
	protected readonly maxSize = FILE_LIMIT_BYTES;
	readonly editing = signal(false);
	readonly editingId = signal<number | null>(null);
	readonly tag = signal('');
	readonly target = signal('');
	readonly title = signal('');
	readonly notes = signal('');
	readonly previous = signal('');
	readonly prerelease = signal(false);
	readonly latest = signal(true);
	readonly asDraft = signal(false);
	readonly writing = signal(false);
	readonly notesError = signal('');
	readonly files = signal<File[]>([]);
	readonly existing = signal<CodeRelease['assets']>([]);
	readonly removing = signal<number | null>(null);
	readonly deleting = signal<CodeRelease | null>(null);

	readonly q = injectInfiniteQuery(() => ({
		queryKey: ['code-releases', this.nav.p(), this.nav.r()],
		queryFn: ({ pageParam }: { pageParam: number }) => this.api.codeReleases(this.nav.p(), this.nav.r(), pageParam),
		initialPageParam: 1,
		getNextPageParam: (last: VendorAnswer<CodeReleases>, all: unknown[]) =>
			last.state === 'ok' && last.data.more ? all.length + 1 : undefined,
	}));
	readonly releases = computed(() =>
		(this.q.data()?.pages ?? []).flatMap((a) => (a.state === 'ok' ? a.data.releases : [])),
	);
	readonly error = computed(() => {
		const bad = (this.q.data()?.pages ?? []).find((a) => a.state !== 'ok');
		return bad ? bad.message : '';
	});

	constructor() {
		// "Create a new release" from the home or Tags opens the form.
		effect(() => {
			if (this.nav.param('new') === '1') {
				this.draft(null);
				this.nav.go({ new: null });
			}
		});
	}

	draft(r: CodeRelease | null): void {
		this.editingId.set(r?.id ?? null);
		this.tag.set(r?.tag ?? '');
		this.target.set(r?.target ?? this.info().defaultBranch);
		this.title.set(r?.name ?? '');
		this.notes.set(r?.body ?? '');
		this.previous.set('');
		this.prerelease.set(r?.prerelease ?? false);
		this.latest.set(r ? r.latest : true);
		this.asDraft.set(r?.draft ?? false);
		this.files.set([]);
		this.existing.set(r?.assets ?? []);
		this.notesError.set('');
		this.editing.set(true);
	}
	attach(list: FileList | null): void {
		const picked = [...(list ?? [])].filter((f) => f.size <= FILE_LIMIT_BYTES);
		this.files.set([...this.files(), ...picked].slice(0, 10));
	}
	/** GitHub's own notes: the pull requests merged since the previous release (or the tag named). */
	async generate(): Promise<void> {
		this.writing.set(true);
		this.notesError.set('');
		try {
			const a = await this.api.codeNotes(this.nav.p(), this.nav.r(), {
				tag: this.tag().trim(),
				target: this.target().trim(),
				previous: this.previous().trim(),
			});
			if (a.state === 'ok') {
				this.notes.set(a.data.body);
				if (!this.title().trim()) this.title.set(a.data.name);
			} else this.notesError.set(a.message);
		} finally {
			this.writing.set(false);
		}
	}
	readonly saveRun = async (pin: string) =>
		this.api.codeChange(this.nav.p(), this.nav.r(), 'release', {
			pin,
			id: this.editingId(),
			tag: this.tag().trim(),
			target: this.target().trim(),
			name: this.title().trim(),
			body: this.notes(),
			draft: this.asDraft(),
			prerelease: this.prerelease(),
			latest: this.latest(),
			assets: await Promise.all(this.files().map(async (f) => ({ name: f.name, content: await base64Of(f) }))),
		});
	removeRun(id: number) {
		return (pin: string) => this.api.codeChange(this.nav.p(), this.nav.r(), 'asset/delete', { pin, id });
	}
	deleteRun(id: number) {
		return (pin: string) => this.api.codeChange(this.nav.p(), this.nav.r(), 'release/delete', { pin, id });
	}
	removedAsset(id: number): void {
		this.removing.set(null);
		this.existing.set(this.existing().filter((a) => a.id !== id));
		void this.queries.invalidateQueries({ queryKey: ['code-releases'] });
	}
	changed(): void {
		this.editing.set(false);
		this.deleting.set(null);
		void this.queries.invalidateQueries({ queryKey: ['code-releases'] });
		void this.queries.invalidateQueries({ queryKey: ['code-tags'] });
		void this.queries.invalidateQueries({ queryKey: ['code-repo'] });
	}
}
