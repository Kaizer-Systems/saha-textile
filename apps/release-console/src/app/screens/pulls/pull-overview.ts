import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	afterRenderEffect,
	computed,
	inject,
	input,
	model,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { envOfBranch, type PullEvent, type PullPage } from '@saha-textile/release-console-contracts';

import { eventIcon, headingsIn, pullNumberOf } from './pull-view';
import { ConsoleContext } from '../../data/console-context';
import { when } from '../../pages/format-time';
import { injectDefaultBranch } from '../env-tag-dialog';

/**
 * The Overview tab: the whole description as GitHub draws it, with an outline of its headings beside it, the
 * conversation (comments, reviews, pushes and the newest commit's checks) and a comment box, and who and what.
 */
@Component({
	selector: 'rc-pull-overview',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let p = pull();
		<div class="rc-pr-cols">
			<div class="rc-pr-main">
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							Description · {{ count(p.bodyLength) }} characters · as GitHub draws it
						</span>
						<span class="rc-row">
							@if (outline().length) {
								<button
									type="button"
									class="rc-btn ghost rc-pr-outbtn"
									[attr.aria-expanded]="outlineShown()"
									(click)="outlineShown.set(!outlineShown())"
								>
									Outline ▾
								</button>
							}
							<a
								class="rc-mono"
								[href]="p.url"
								target="_blank"
								rel="noopener"
							>
								Edit on GitHub ↗
							</a>
						</span>
					</div>
					@if (p.bodyHtml) {
						<div
							#description
							class="rc-md"
							tabindex="0"
							[innerHTML]="p.bodyHtml"
							(click)="follow($event)"
							(scroll)="track()"
						></div>
					} @else {
						<p class="rc-note">No description.</p>
					}
				</div>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">Conversation</span>
						<span class="rc-mono muted">newest last</span>
					</div>
					<div class="rc-pr-tl">
						@for (e of p.events; track $index) {
							<div class="rc-pr-ev">
								<span
									class="rc-pr-ic"
									[class]="'rc-pr-ic ' + (e.tone ?? '')"
									aria-hidden="true"
								>
									{{ icon(e.kind) }}
								</span>
								<span>
									@if (e.who) {
										<b>{{ e.who }}</b>
									}
									{{ e.text }}
									@if (e.kind === 'check-failed' && e.checkId) {
										·
										<button
											type="button"
											class="rc-btn ghost"
											(click)="openLog(e)"
										>
											open its log
										</button>
									} @else if (e.kind === 'other' && e.url) {
										·
										<a
											[href]="e.url"
											target="_blank"
											rel="noopener"
										>
											GitHub ↗
										</a>
									}
								</span>
								<span class="rc-mono muted">{{ e.at ? when(e.at) : '' }}</span>
								@if (e.html) {
									<div
										class="rc-md rc-pr-comment"
										[innerHTML]="e.html"
										(click)="follow($event)"
									></div>
								}
							</div>
						}
					</div>
					<div class="rc-pr-compose">
						<textarea
							class="rc-search"
							rows="3"
							aria-label="Leave a comment"
							placeholder="Leave a comment (written like GitHub: Markdown, @names, #numbers)"
							[value]="draft()"
							(input)="draft.set($any($event.target).value)"
						></textarea>
						<div class="rc-row end">
							<button
								type="button"
								class="rc-btn"
								[disabled]="!draft().trim()"
								(click)="send()"
							>
								Comment
							</button>
						</div>
					</div>
				</div>
			</div>
			<div class="rc-pr-side">
				@if (outline().length) {
					<div
						class="rc-panel rc-pr-outpanel"
						[class.shown]="outlineShown()"
					>
						<div class="rc-ph">
							<span class="rc-label">Outline</span>
							<span class="rc-mono muted">{{ outline().length }}</span>
						</div>
						<nav
							class="rc-pr-outline"
							aria-label="Outline of the description"
						>
							@for (h of outline(); track h.id) {
								<button
									type="button"
									[class]="'h' + h.level"
									[class.on]="h.id === reading()"
									(click)="jump(h.id)"
								>
									{{ h.text }}
								</button>
							}
						</nav>
					</div>
				}
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">About</span></div>
					<div class="rc-kv">
						<div>
							<span>Reviewers</span>
							<em [class]="p.reviewers.length ? '' : 'amber'">{{ reviewers() }}</em>
						</div>
						<div>
							<span>Labels</span>
							<em>{{ p.labels.join(', ') || '—' }}</em>
						</div>
						<div>
							<span>Goes to</span>
							<em>{{ goesTo() }}</em>
						</div>
						<div>
							<span>Changes</span>
							<em>
								<span class="ok">+{{ count(p.additions) }}</span>
								<span class="red">&nbsp;−{{ count(p.deletions) }}</span>
							</em>
						</div>
						<div>
							<span>Files</span>
							<em>{{ count(p.changedFiles) }}</em>
						</div>
					</div>
				</div>
			</div>
		</div>
	`,
})
export class PullOverview {
	private readonly router = inject(Router);
	private readonly ctx = inject(ConsoleContext);
	private readonly branches = injectDefaultBranch();
	readonly pull = input.required<PullPage>();
	readonly comment = output<string>();
	protected readonly when = when;
	protected readonly icon = eventIcon;
	protected readonly count = (x: number) => x.toLocaleString('en-IN');

	private readonly description = viewChild<ElementRef<HTMLElement>>('description');
	readonly outline = signal<Array<{ id: string; level: number; text: string }>>([]);
	readonly reading = signal<string | null>(null);
	/** On a phone the outline is a menu, opened by Outline ▾ and closed by picking a heading. */
	readonly outlineShown = signal(false);
	/** The comment being written; the page keeps it so a cancelled PIN keeps the words and a posted one clears them. */
	readonly draft = model('');

	constructor() {
		// Once the description is on the page: name its headings for the outline, open its links in a new tab, and
		// put a link in place of any picture GitHub will not show without its own sign-in.
		afterRenderEffect(() => {
			this.pull();
			const el = this.description()?.nativeElement;
			this.outline.set(el ? headingsIn(el) : []);
			if (!el) return;
			for (const a of el.querySelectorAll('a')) {
				a.target = '_blank';
				a.rel = 'noopener';
			}
			for (const img of el.querySelectorAll('img'))
				img.addEventListener('error', () => this.unshown(img), { once: true });
		});
		inject(DestroyRef).onDestroy(() => this.outline.set([]));
	}

	readonly reviewers = computed(() => {
		const said = { approved: '✓', changes: '✕', commented: '…', requested: '?', dismissed: '–' };
		const list = this.pull().reviewers.map((r) => `${r.login} ${said[r.state]}`);
		return list.length ? list.join(', ') : 'none yet';
	});
	readonly goesTo = computed(() => {
		const envs = this.ctx.repo()?.environments ?? [];
		const base = this.pull().base;
		return `${envOfBranch(envs, base, this.branches.data()?.defaultBranch ?? '') ?? '—'} (${base})`;
	});

	/** A picture GitHub refuses (a private repository's needs a GitHub sign-in) becomes its name and a link. */
	unshown(img: HTMLImageElement): void {
		const a = document.createElement('a');
		a.href = img.src;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = `Picture: ${img.alt || img.src.split('/').pop()} ↗`;
		img.replaceWith(a);
	}

	/** A link to another pull request of this repository opens it here; every other link opens in a new tab. */
	follow(e: MouseEvent): void {
		const a = (e.target as HTMLElement).closest('a');
		const n = a ? pullNumberOf(a.href, this.pull().url) : null;
		if (n === null) return;
		e.preventDefault();
		void this.router.navigate([], { queryParams: { pr: n, tab: 'overview' }, queryParamsHandling: 'merge' });
	}

	/** Lights the heading being read: the last one whose top has passed the description's top. */
	track(): void {
		const el = this.description()?.nativeElement;
		if (!el) return;
		const top = el.getBoundingClientRect().top + 8;
		let current: string | null = null;
		for (const h of el.querySelectorAll<HTMLElement>('[id^="pr-h-"]'))
			if (h.getBoundingClientRect().top <= top) current = h.id;
		this.reading.set(current ?? this.outline()[0]?.id ?? null);
	}

	jump(id: string): void {
		this.description()
			?.nativeElement.querySelector(`#${id}`)
			?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		this.reading.set(id);
		this.outlineShown.set(false);
	}

	openLog(e: PullEvent): void {
		void this.router.navigate([], {
			queryParams: { tab: 'checks', check: e.checkId },
			queryParamsHandling: 'merge',
		});
	}

	send(): void {
		this.comment.emit(this.draft().trim());
	}
}
