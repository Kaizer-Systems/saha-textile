import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';

import {
	COMMIT_FILES_LIMIT,
	FILE_LIMIT_BYTES,
	type CodeDone,
	type RepoInfo,
} from '@saha-textile/release-console-contracts';
import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { CodeMarkdown } from './code-markdown';
import { CodeNav } from './code-nav';
import { base64Of, crumbsOf, patchBranch, sizeSaid, textBase64 } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { Loading } from '../../shared/loading';

/**
 * Changing files from the console (brief 7Hu1SuB3A8qiJzeDwvFZLR, C9, Q6 A): ✎ Edit with Preview for Markdown, Create
 * new file and Upload files, each ending in the commit box. By default the change goes on a new branch with a pull
 * request (GitHub's "Propose changes"); straight onto the branch only when no rule guards it. GitHub signs the commit.
 */
@Component({
	selector: 'rc-code-edit',
	imports: [Loading, CodeChange, CodeMarkdown],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-mono">
				{{ info().name }} /
				@for (c of folders(); track c.path) {
					{{ c.name }} /
				}
				@if (mode() === 'edit') {
					<b>{{ name() }}</b>
				} @else if (mode() === 'new') {
					<input
						class="rc-search"
						aria-label="Name your file"
						placeholder="Name your file…"
						[value]="newName()"
						(input)="newName.set($any($event.target).value)"
					/>
				}
				in
				<b>{{ ref() }}</b>
			</span>
			<span class="rc-row">
				<button
					type="button"
					class="rc-btn ghost"
					(click)="cancel()"
				>
					Cancel changes
				</button>
				<button
					type="button"
					class="rc-btn primary"
					[disabled]="!changes().length"
					(click)="committing.set(true)"
				>
					Commit changes…
				</button>
			</span>
		</div>
		@if (mode() === 'upload') {
			<div
				class="rc-panel rc-center"
				role="region"
				aria-label="Drop files here"
				(dragover)="$event.preventDefault()"
				(drop)="$event.preventDefault(); take($any($event).dataTransfer?.files)"
			>
				<p class="rc-p">Drag files here, or</p>
				<label class="rc-btn">
					choose your files
					<input
						type="file"
						multiple
						hidden
						(change)="take($any($event.target).files)"
					/>
				</label>
				<p class="rc-note">Up to {{ maxFiles }} files, {{ size(maxSize) }} each, as on GitHub.</p>
				@for (u of uploads(); track u.path; let i = $index) {
					<p class="rc-row between">
						<span class="rc-mono">{{ u.path }} · {{ size(u.size) }}</span>
						<button
							type="button"
							class="rc-btn ghost"
							[attr.aria-label]="'Remove ' + u.path"
							(click)="drop(i)"
						>
							✕
						</button>
					</p>
				}
				@if (refused()) {
					<div class="rc-banner small amber">
						<span class="rc-dot amber"></span>
						<div>{{ refused() }}</div>
					</div>
				}
			</div>
		} @else {
			@if (mode() === 'edit' && q.isPending()) {
				<rc-loading what="Reading the file…" />
			} @else {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-row">
							<button
								type="button"
								class="rc-chip"
								[class.on]="!previewing()"
								(click)="previewing.set(false)"
							>
								Edit
							</button>
							@if (markdownFile()) {
								<button
									type="button"
									class="rc-chip"
									[class.on]="previewing()"
									(click)="preview()"
								>
									Preview
								</button>
							}
						</span>
					</div>
					@if (previewing()) {
						@if (previewHtml(); as html) {
							<rc-code-markdown
								[html]="html"
								[repoUrl]="info().url"
								[ref]="ref()"
							/>
						} @else {
							<rc-loading what="GitHub is drawing the preview…" />
						}
					} @else {
						<textarea
							class="rc-mono"
							rows="28"
							spellcheck="false"
							aria-label="The file's text"
							[value]="text()"
							(input)="text.set($any($event.target).value)"
						></textarea>
					}
				</div>
			}
		}
		@if (committing()) {
			<rc-code-change
				title="Commit changes"
				submit="Commit changes"
				[ready]="!!message().trim() && (!toNewBranch() || !!branchName().trim())"
				[run]="commitRun"
				(closed)="committing.set(false)"
				(finished)="done($event)"
			>
				<label>
					Commit message
					<input
						[value]="message()"
						(input)="message.set($any($event.target).value)"
					/>
				</label>
				<label>
					Extended description
					<textarea
						rows="3"
						[value]="description()"
						(input)="description.set($any($event.target).value)"
					></textarea>
				</label>
				<label class="rc-row">
					<input
						type="radio"
						name="where"
						[checked]="!toNewBranch()"
						[disabled]="ruled()"
						(change)="toNewBranch.set(false)"
					/>
					Commit directly to the {{ ref() }} branch
					@if (ruled()) {
						<span class="rc-note">(a rule guards it, so GitHub refuses direct changes)</span>
					}
				</label>
				<label class="rc-row">
					<input
						type="radio"
						name="where"
						[checked]="toNewBranch()"
						(change)="toNewBranch.set(true)"
					/>
					Create a new branch for this commit and start a pull request
				</label>
				@if (toNewBranch()) {
					<label>
						New branch
						<input
							[value]="branchName()"
							(input)="branchName.set($any($event.target).value)"
						/>
					</label>
				}
			</rc-code-change>
		}
	`,
})
export class CodeEdit {
	private readonly api = inject(ConsoleApi);
	private readonly queries = injectQueryClient();
	protected readonly nav = inject(CodeNav);
	readonly info = input.required<RepoInfo>();
	readonly ref = input.required<string>();
	readonly viewer = input('');
	/** ✎ Edit a file, Create new file or Upload files. */
	readonly mode = input.required<'edit' | 'new' | 'upload'>();
	protected readonly size = sizeSaid;
	protected readonly maxFiles = COMMIT_FILES_LIMIT;
	protected readonly maxSize = FILE_LIMIT_BYTES;
	readonly text = signal('');
	readonly newName = signal('');
	readonly uploads = signal<Array<{ path: string; size: number; file: Blob }>>([]);
	readonly refused = signal('');
	readonly previewing = signal(false);
	readonly previewHtml = signal<string | null>(null);
	readonly committing = signal(false);
	readonly message = signal('');
	readonly description = signal('');
	readonly toNewBranch = signal(true);
	readonly branchName = signal('');

	/** The folder the change is in: the file's own for Edit, the address's folder for a new file or an upload. */
	readonly folder = computed(() =>
		this.mode() === 'edit' ? this.nav.path().split('/').slice(0, -1).join('/') : this.nav.path(),
	);
	readonly folders = computed(() => crumbsOf(this.folder()));
	readonly name = computed(() => this.nav.path().slice(this.nav.path().lastIndexOf('/') + 1));
	readonly target = computed(() =>
		this.mode() === 'edit' ? this.nav.path() : [this.folder(), this.newName().trim()].filter(Boolean).join('/'),
	);
	readonly markdownFile = computed(() => /\.(md|markdown|mdx)$/i.test(this.target()));

	protected readonly q = injectQuery(() => ({
		queryKey: ['code-file', this.nav.p(), this.nav.r(), this.ref(), this.nav.path()],
		queryFn: () => this.api.codeFile(this.nav.p(), this.nav.r(), this.ref(), this.nav.path()),
		enabled: this.mode() === 'edit',
	}));
	private readonly original = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? (a.data.text ?? '') : '';
	});
	protected readonly rq = injectQuery(() => ({
		queryKey: ['code-refs', this.nav.p(), this.nav.r()],
		queryFn: () => this.api.codeRefs(this.nav.p(), this.nav.r()),
	}));
	/** A rule guards the branch: GitHub refuses a direct change. */
	readonly ruled = computed(() => {
		const a = this.rq.data();
		return a?.state === 'ok' && !!a.data.branches.find((b) => b.name === this.ref())?.rule;
	});
	/** What would be committed: the edited or new file, or the uploads. */
	readonly changes = computed(() => {
		if (this.mode() === 'upload') return this.uploads().map((u) => u.path);
		if (this.mode() === 'new') return this.newName().trim() ? [this.target()] : [];
		return this.text() !== this.original() ? [this.target()] : [];
	});

	constructor() {
		// The file's own text, once read, is where editing starts.
		effect(() => {
			if (this.mode() === 'edit') this.text.set(this.original());
		});
		// GitHub's suggested message and branch, filled in once the box opens.
		effect(() => {
			if (!this.committing()) return;
			const what = {
				edit: `Update ${this.name()}`,
				new: `Create ${this.newName().trim()}`,
				upload: 'Add files via upload',
			};
			this.message.set(what[this.mode()]);
			const a = this.rq.data();
			const taken = a?.state === 'ok' ? a.data.branches.map((b) => b.name) : [];
			this.branchName.set(patchBranch(this.viewer(), taken));
			this.toNewBranch.set(true);
		});
	}

	/** Files dropped or picked: kept up to GitHub's 100, each up to 25 MB; the rest are named and left out. */
	take(list: FileList | null | undefined): void {
		const picked = [...(list ?? [])];
		const over = picked.filter((f) => f.size > FILE_LIMIT_BYTES).map((f) => f.name);
		const kept = picked
			.filter((f) => f.size <= FILE_LIMIT_BYTES)
			.map((f) => ({ path: [this.folder(), f.name].filter(Boolean).join('/'), size: f.size, file: f as Blob }));
		const all = [...this.uploads(), ...kept].slice(0, COMMIT_FILES_LIMIT);
		this.uploads.set(all);
		this.refused.set(over.length ? `Over ${sizeSaid(FILE_LIMIT_BYTES)}, so left out: ${over.join(', ')}.` : '');
	}
	drop(i: number): void {
		this.uploads.set(this.uploads().filter((_, at) => at !== i));
	}
	async preview(): Promise<void> {
		this.previewing.set(true);
		this.previewHtml.set(null);
		const a = await this.api.codeMarkdown(this.nav.p(), this.nav.r(), this.text());
		this.previewHtml.set(a.state === 'ok' ? a.data.html : `<p>${a.message}</p>`);
	}
	cancel(): void {
		this.nav.go({ type: this.mode() === 'edit' ? 'blob' : null });
	}
	readonly commitRun = async (pin: string) => {
		const changes =
			this.mode() === 'upload'
				? await Promise.all(
						this.uploads().map(async (u) => ({ path: u.path, content: await base64Of(u.file) })),
					)
				: [{ path: this.target(), content: await textBase64(this.text()) }];
		return this.api.codeChange(this.nav.p(), this.nav.r(), 'commit', {
			pin,
			branch: this.ref(),
			message: this.message().trim(),
			description: this.description().trim(),
			changes,
			newBranch: this.toNewBranch() ? this.branchName().trim() : '',
			pull: true,
		});
	};
	done(d: CodeDone): void {
		this.committing.set(false);
		void this.queries.invalidateQueries({ queryKey: ['code-tree'] });
		void this.queries.invalidateQueries({ queryKey: ['code-file'] });
		const on = d.branch ?? this.ref();
		if (this.mode() === 'upload') this.nav.at(on, this.folder(), 'tree');
		else this.nav.at(on, this.target(), 'blob');
	}
}
