import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { PullChecksTab } from './pull-checks';
import { PullCommitsTab } from './pull-commits';
import { PullFilesTab } from './pull-files';
import { PullOverview } from './pull-overview';
import { mergeStatus } from './pull-view';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { when } from '../../pages/format-time';
import { BranchPicker } from '../../shared/branch-picker';
import { Icon } from '../../shared/icons';
import { ProductFormPart } from '../product-parts';
import { VendorState } from '../vendor-screens';

import type { ProductForm } from '@saha-textile/release-console-contracts';

export type PullTab = 'overview' | 'commits' | 'checks' | 'files';
export const PULL_TABS: readonly PullTab[] = ['overview', 'commits', 'checks', 'files'];
const FORM_TITLES: Record<string, string> = {
	merge: 'Merge',
	review: 'Review',
	prstate: 'Close, reopen or update',
	comment: 'Comment',
	automerge: 'Merge when ready',
	base: 'Change the base branch',
};

/**
 * One pull request's page (brief E5WE6RSF2AJvpxDyDA1EJt): its title, where it stands and its buttons, the merge
 * status at the top of every tab as GitHub's new page has it, then Overview, Commits, Checks and Files changed.
 * The address keeps the number and the tab (`?pr=7&tab=files`), so a link opens the same view.
 */
@Component({
	selector: 'rc-pull-page',
	imports: [
		VendorState,
		ProductFormPart,
		PullOverview,
		PullCommitsTab,
		PullChecksTab,
		PullFilesTab,
		BranchPicker,
		Icon,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'key($event)' },
	template: `
		<rc-vendor-state
			vendor="GitHub"
			[answer]="q.data()"
			[pending]="q.isPending()"
			[failed]="q.isError()"
		>
			@if (page(); as p) {
				@let m = merge(p);
				<!-- The console's content grid keeps its 12 px between the header, the merge status and the tabs (owner, 24 Nov: the branch boxes sat on the merge status box's border). -->
				<div class="rc-content">
					<div class="rc-pr-head">
						<h3 class="rc-h rc-pr-title">
							<span class="muted">#{{ p.number }}</span>
							{{ p.title }}
							<span [class]="'rc-pill ' + m.tone">{{ stateWord() }}</span>
						</h3>
						<button
							type="button"
							class="rc-btn ghost rc-pr-actbtn"
							[attr.aria-expanded]="actionsShown()"
							(click)="actionsShown.set(!actionsShown())"
						>
							Actions ▾
						</button>
						<div
							class="rc-row rc-pr-acts"
							[class.shown]="actionsShown()"
						>
							@if (p.state === 'open') {
								<button
									type="button"
									class="rc-btn primary"
									[disabled]="!m.canMerge"
									[title]="m.why || 'Merge this pull request'"
									(click)="act('merge')"
								>
									Merge
								</button>
								<button
									type="button"
									class="rc-btn"
									(click)="act('review')"
								>
									Review
								</button>
							}
							<button
								type="button"
								class="rc-btn"
								(click)="act('prstate')"
							>
								Close, reopen or update
							</button>
							<a
								class="rc-btn ghost"
								[href]="p.url"
								target="_blank"
								rel="noopener"
							>
								GitHub ↗
							</a>
						</div>
						<div class="rc-pr-meta">
							<span
								[class]="
									'rc-pill ' + (p.state === 'open' ? 'ok' : p.state === 'merged' ? 'cy' : 'muted')
								"
							>
								{{
									p.state === 'open'
										? p.draft
											? 'Draft'
											: 'Open'
										: p.state === 'merged'
											? 'Merged'
											: 'Closed'
								}}
							</span>
							<b>{{ p.author }}</b>
							{{ p.state === 'merged' ? 'merged' : 'wants to merge' }}
							<b>{{ count(p.commits) }} {{ p.commits === 1 ? 'commit' : 'commits' }}</b>
							into
							@if (baseOpen()) {
								<!-- The base's ▾ opens the console's branch picker in its place (brief 7Hu1SuB3A8qiJzeDwvFZLR, A2). -->
								<span
									(focusout)="baseLeft($event)"
									(keydown.escape)="baseOpen.set(false)"
								>
									<rc-branch-picker
										context="the base of this pull request"
										[branches]="baseChoices()"
										[value]="p.base"
										[defaultBranch]="bq.data()?.defaultBranch ?? null"
										[notes]="baseNotes()"
										[waitingText]="bq.data()?.note || 'loading branches…'"
										[refreshing]="bq.isFetching()"
										(picked)="changeBase($event)"
										(refresh)="bq.refetch()"
									/>
								</span>
							} @else {
								<span class="rc-pr-pair">
									<button
										type="button"
										class="rc-chip on"
										[attr.aria-label]="'Open ' + p.base + ' in Code'"
										(click)="openBranch(p.base)"
									>
										{{ p.base }}
									</button>
									@if (p.state === 'open') {
										<button
											type="button"
											class="rc-chip on"
											data-tip="Change the base branch"
											aria-label="Change the base branch"
											(click)="openBase()"
										>
											▾
										</button>
									}
								</span>
							}
							from
							<span class="rc-pr-pair">
								@if (gone(p.head)) {
									<span
										class="rc-chip"
										data-head
									>
										{{ p.head }} · deleted
									</span>
								} @else {
									<button
										type="button"
										class="rc-chip on"
										data-head
										[attr.aria-label]="'Open ' + p.head + ' in Code'"
										(click)="openBranch(p.head)"
									>
										{{ p.head }}
									</button>
								}
								<button
									type="button"
									class="rc-chip on"
									aria-label="Copy the branch name"
									[attr.data-tip]="copied() ? 'Copied' : 'Copy the branch name'"
									(click)="copy(p.head)"
								>
									<rc-icon [name]="copied() ? 'tabler/check' : 'tabler/copy'" />
								</button>
							</span>
							<span class="rc-mono muted">
								· opened {{ when(p.createdAt) }} · updated {{ when(p.updatedAt) }}
							</span>
						</div>
					</div>
					<div
						class="rc-mergebox"
						[class]="'rc-mergebox ' + m.tone"
					>
						<span class="rc-label">Merge status</span>
						<div class="rc-pr-sum">
							@for (i of m.items; track i.text) {
								<span [class]="i.tone">{{ i.text }}</span>
							}
						</div>
						@if (p.state === 'open' && m.offerAuto) {
							<button
								type="button"
								class="rc-btn"
								(click)="act('automerge')"
							>
								Merge when ready
							</button>
						}
					</div>
					<div
						class="rc-tabs"
						role="tablist"
						aria-label="Pull request"
					>
						@for (t of tabs; track t) {
							<span
								role="tab"
								tabindex="0"
								[class.on]="t === tab()"
								[attr.aria-selected]="t === tab()"
								(click)="go(t)"
								(keydown.enter)="go(t)"
							>
								{{ label(t) }}
								@if (t !== 'overview') {
									<span class="rc-pr-n">
										{{
											count(
												t === 'commits'
													? p.commits
													: t === 'checks'
														? p.checks.total
														: p.changedFiles
											)
										}}
									</span>
								}
							</span>
						}
					</div>
					@switch (tab()) {
						@case ('commits') {
							<rc-pull-commits [pull]="p" />
						}
						@case ('checks') {
							<rc-pull-checks
								[pull]="p"
								(again)="act('prstate')"
							/>
						}
						@case ('files') {
							<rc-pull-files [pull]="p" />
						}
						@default {
							<rc-pull-overview
								[pull]="p"
								[(draft)]="draft"
								(comment)="comment($event)"
							/>
						}
					}
				</div>
			}
		</rc-vendor-state>
		@if (modal(); as m) {
			<div
				class="rc-modal-back"
				(keydown.escape)="modal.set(null)"
			>
				<div
					class="rc-modal"
					role="dialog"
					[attr.aria-label]="formTitle(m)"
				>
					<div class="rc-row between">
						<h3 class="rc-h">{{ formTitle(m) }}</h3>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="modal.set(null)"
						>
							Close
						</button>
					</div>
					@if (m === 'base') {
						<!-- Q1 B: what the pull request would hold against the new base, before the PIN. -->
						<div class="rc-kv">
							<div>
								<span>Into {{ page()?.base }}, today</span>
								<em>{{ held(page()?.commits ?? 0, page()?.changedFiles ?? 0) }}</em>
							</div>
							<div>
								<span>Into {{ baseTo() }}</span>
								<em class="cy">{{ previewSaid() }}</em>
							</div>
						</div>
					}
					<rc-vendor-state
						vendor="GitHub"
						[answer]="mq.data()"
						[pending]="mq.isPending()"
						[failed]="mq.isError()"
					>
						@if (modalForm(); as f) {
							<rc-product-form
								screen="pulls"
								[form]="f"
								[id]="modalId()"
								(sent)="sent()"
							/>
						}
					</rc-vendor-state>
				</div>
			</div>
		}
	`,
})
export class PullPage {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	private readonly queries = injectQueryClient();
	readonly number = input.required<number>();
	protected readonly when = when;
	protected readonly String = String;
	protected readonly tabs = PULL_TABS;
	protected readonly merge = mergeStatus;
	protected readonly count = (x: number) => x.toLocaleString('en-IN');

	private readonly query = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('tab'))), {
		initialValue: null,
	});
	/** The tab in the address; Overview when it names none of the four. */
	readonly tab = computed<PullTab>(() => PULL_TABS.find((t) => t === this.query()) ?? 'overview');

	protected readonly q = injectQuery(() => ({
		queryKey: ['pull', this.ctx.projectId(), this.ctx.repoId(), this.number()],
		queryFn: () => this.api.pull(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.number()),
		// While any check runs, the page reads again every 30 seconds, then stops.
		refetchInterval: (query: { state: { data?: unknown } }) => {
			const a = query.state.data as { state: string; data?: { checks: { running: number } } } | undefined;
			return a?.state === 'ok' && a.data?.checks.running ? 30_000 : false;
		},
	}));
	readonly page = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly status = computed(() => {
		const p = this.page();
		return p ? mergeStatus(p) : null;
	});
	/** The badge after the title: what most needs saying about where it stands. */
	readonly stateWord = computed(() => {
		const p = this.page();
		if (!p) return '';
		if (p.state !== 'open') return p.state;
		if (p.checks.failed) return 'merge blocked';
		if (p.checks.running) return 'checks running';
		return this.status()?.canMerge ? 'ready to merge' : 'not ready';
	});

	protected label(t: PullTab): string {
		return { overview: 'Overview', commits: 'Commits', checks: 'Checks', files: 'Files changed' }[t];
	}
	/** Opens a tab; the commit, check and file chosen in another tab are left behind. */
	go(t: PullTab): void {
		void this.router.navigate([], {
			queryParams: { tab: t, commit: null, check: null, file: null },
			queryParamsHandling: 'merge',
		});
	}

	/* the buttons: each opens its form (with the PIN) over the page */
	readonly modal = signal<string | null>(null);
	/** On a phone the buttons fold under Actions ▾. */
	readonly actionsShown = signal(false);
	/** What was typed in the comment box, carried into the Comment form. */
	readonly draft = signal('');
	protected readonly mq = injectQuery(() => ({
		queryKey: ['product-form', this.ctx.projectId(), this.ctx.repoId(), 'pulls', this.modal(), this.modalId()],
		queryFn: () =>
			this.api.productForm(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				'pulls',
				// The read is on only while a form is open.
				String(this.modal()),
				this.modalId(),
			),
		enabled: !!this.modal(),
	}));
	readonly modalForm = computed<ProductForm | null>(() => {
		const a = this.mq.data();
		if (a?.state !== 'ok' || a.data.type !== 'form') return null;
		const draft = this.draft();
		return {
			...a.data.form,
			fields: a.data.form.fields.map((f) => (f.key === 'body' && draft ? { ...f, value: draft } : f)),
		};
	});
	protected formTitle(form: string): string {
		return FORM_TITLES[form] ?? form;
	}
	act(form: string): void {
		this.modal.set(form);
	}
	/** The form's id: the pull request, and for Change the base branch the branch picked ("7:staging"). */
	readonly modalId = computed(() =>
		this.modal() === 'base' ? `${this.number()}:${this.baseTo()}` : String(this.number()),
	);

	/* the base's ▾ and the head's copy button (brief 7Hu1SuB3A8qiJzeDwvFZLR, A2–A4) */
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	readonly baseOpen = signal(false);
	/** The branch picked as the new base, carried into the form and its counts. */
	readonly baseTo = signal('');
	readonly copied = signal(false);
	protected readonly bq = injectQuery(() => {
		const repository = this.ctx.repo()?.sourceCode.repository ?? '';
		return {
			queryKey: ['pull-branches', repository],
			queryFn: () => this.api.repositoryBranches(repository),
			enabled: this.baseOpen() && !!repository,
		};
	});
	/** GitHub's branches only, never the one the pull request comes from. */
	readonly baseChoices = computed(() =>
		(this.bq.data()?.branches ?? []).filter((b) => b.onGitHub && b.name !== this.page()?.head),
	);
	readonly baseNotes = computed<Record<string, string>>(() => {
		const p = this.page();
		return p ? { [p.base]: 'the base now' } : {};
	});
	protected readonly pq = injectQuery(() => ({
		queryKey: ['pull-base-preview', this.ctx.projectId(), this.ctx.repoId(), this.number(), this.baseTo()],
		queryFn: () =>
			this.api.pullBasePreview(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.number(), this.baseTo()),
		enabled: this.modal() === 'base' && !!this.baseTo(),
	}));
	/** Q1 B: the new base's commits and files, or why they could not be counted. */
	readonly previewSaid = computed(() => {
		const a = this.pq.data();
		if (!a) return this.pq.isError() ? 'could not be counted' : 'counting…';
		return a.state === 'ok' ? this.held(a.data.commits, a.data.files) : a.message;
	});
	protected held(commits: number, files: number): string {
		const c = `${this.count(commits)} ${commits === 1 ? 'commit' : 'commits'}`;
		return `${c} · ${this.count(files)} ${files === 1 ? 'file' : 'files'}`;
	}
	openBase(): void {
		this.baseOpen.set(true);
	}
	/** Whether this opening of the picker has had its focus yet. */
	private baseFocused = false;
	/**
	 * Once the branches are in (the picker's box is off until then), its box takes the focus, which opens its list:
	 * once per opening.
	 */
	private readonly focusBase = effect(() => {
		if (!this.baseOpen()) {
			this.baseFocused = false;
			return;
		}
		if (!this.baseChoices().length || this.baseFocused) return;
		this.baseFocused = true;
		setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('rc-branch-picker input')?.focus());
	});
	/** Focus leaving the picker (a click elsewhere) puts the base box back. */
	baseLeft(e: FocusEvent): void {
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) this.baseOpen.set(false);
	}
	changeBase(branch: string): void {
		this.baseOpen.set(false);
		this.baseTo.set(branch);
		this.act('base');
	}
	/** The repository's branches, to tell a deleted head (common after a merge) from one to open. */
	protected readonly refsQ = injectQuery(() => ({
		queryKey: ['code-refs', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.codeRefs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
	}));
	/** A branch GitHub no longer has; unknown while the branches are read, so it stays a link. */
	gone(name: string): boolean {
		const a = this.refsQ.data();
		return a?.state === 'ok' && !a.data.branches.some((b) => b.name === name);
	}
	/** A branch name opens the console's Code page on that branch (brief 7Hu1SuB3A8qiJzeDwvFZLR, Q2 C). */
	openBranch(name: string): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', this.ctx.repoId(), 'code'], {
			queryParams: { tab: 'files', ref: name },
		});
	}
	/** Copies the branch's name; where the browser refuses, the name is selected for ⌘C instead. */
	copy(text: string): void {
		const done = () => {
			this.copied.set(true);
			setTimeout(() => this.copied.set(false), 1500);
		};
		const name = this.host.nativeElement.querySelector('[data-head]');
		const select = () => name && getSelection()?.selectAllChildren(name);
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, select);
		else select();
	}

	comment(text: string): void {
		this.draft.set(text);
		this.act('comment');
	}
	/** After a form went through: close it, forget the comment, and read the pull request again. */
	sent(): void {
		this.modal.set(null);
		this.draft.set('');
		void this.queries.invalidateQueries({ queryKey: ['pull'] });
		void this.queries.invalidateQueries({ queryKey: ['pulls'] });
	}

	/** 1–4 open the tabs; Esc goes back to the list. Typing in a field is left alone. */
	key(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		if (this.modal() || e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select')) return;
		const tab = PULL_TABS[Number(e.key) - 1];
		if (tab) this.go(tab);
		else if (e.key === 'Escape')
			void this.router.navigate([], {
				queryParams: { pr: null, tab: 'list', commit: null, check: null, file: null },
				queryParamsHandling: 'merge',
			});
	}
}
