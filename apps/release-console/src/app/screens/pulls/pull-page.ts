import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
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
};

/**
 * One pull request's page (brief E5WE6RSF2AJvpxDyDA1EJt): its title, where it stands and its buttons, the merge
 * status at the top of every tab as GitHub's new page has it, then Overview, Commits, Checks and Files changed.
 * The address keeps the number and the tab (`?pr=7&tab=files`), so a link opens the same view.
 */
@Component({
	selector: 'rc-pull-page',
	imports: [VendorState, ProductFormPart, PullOverview, PullCommitsTab, PullChecksTab, PullFilesTab],
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
							[class]="'rc-pill ' + (p.state === 'open' ? 'ok' : p.state === 'merged' ? 'cy' : 'muted')"
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
						<span class="rc-chip on">{{ p.base }}</span>
						from
						<span class="rc-chip on">{{ p.head }}</span>
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
								[id]="String(number())"
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
		queryKey: ['product-form', this.ctx.projectId(), this.ctx.repoId(), 'pulls', this.modal(), this.number()],
		queryFn: () =>
			this.api.productForm(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				'pulls',
				// The read is on only while a form is open.
				String(this.modal()),
				String(this.number()),
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
