import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { Icon } from '../../shared/icons';

import type { CodeDone } from '@saha-textile/release-console-contracts';

/**
 * The branch and tag switcher (brief 7Hu1SuB3A8qiJzeDwvFZLR, C2), as GitHub's: a search, Branches and Tags, the
 * default branch and rules marked, "View all", and "Create branch" for a name no branch has. Drawn with the
 * console's search list (rc-msearch, rc-mres, rc-mrow) and its tab strip.
 */
@Component({
	selector: 'rc-code-switcher',
	imports: [Icon, CodeChange],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:click)': 'outside($event)' },
	template: `
		<span class="rc-msearch">
			<button
				type="button"
				class="rc-chip on"
				aria-haspopup="listbox"
				[attr.aria-expanded]="open()"
				[attr.aria-label]="'Switch branches or tags: ' + current()"
				(click)="toggle()"
			>
				<rc-icon [name]="isTag() ? 'tabler/tag' : 'tabler/git-branch'" />
				{{ current() }} ▾
			</button>
			@if (open()) {
				<div
					class="rc-mres"
					role="dialog"
					aria-label="Switch branches or tags"
				>
					<div class="rc-row between rc-ph">
						<span class="rc-label">Switch branches or tags</span>
						<button
							type="button"
							class="rc-btn ghost"
							aria-label="Close"
							(click)="open.set(false)"
						>
							✕
						</button>
					</div>
					<div class="rc-msearch">
						<input
							#box
							type="search"
							autocomplete="off"
							spellcheck="false"
							[attr.aria-label]="tab() === 'tags' ? 'Find a tag' : 'Find or create a branch'"
							[placeholder]="tab() === 'tags' ? 'Find a tag' : 'Find or create a branch'"
							[value]="query()"
							(input)="query.set($any($event.target).value)"
							(keydown)="key($event)"
						/>
					</div>
					<div
						class="rc-tabs"
						role="tablist"
					>
						@for (t of kinds; track t.key) {
							<span
								role="tab"
								tabindex="0"
								[class.on]="tab() === t.key"
								[attr.aria-selected]="tab() === t.key"
								(click)="tab.set(t.key)"
								(keydown.enter)="tab.set(t.key)"
							>
								{{ t.label }}
							</span>
						}
					</div>
					@if (q.isPending()) {
						<div class="rc-mnone">Reading branches and tags…</div>
					} @else if (refs(); as r) {
						@for (name of hits(); track name; let i = $index) {
							<button
								type="button"
								class="rc-mrow"
								role="option"
								[class.on]="i === active()"
								[attr.aria-selected]="name === current()"
								(click)="pick(name)"
							>
								<b>
									{{ name === current() ? '✓' : '' }}
									<rc-icon [name]="tab() === 'tags' ? 'tabler/tag' : 'tabler/git-branch'" />
									{{ name }}
								</b>
								<span>{{ where(name) }}</span>
							</button>
						} @empty {
							@if (tab() === 'branches' && query().trim() && canCreate()) {
								<div class="rc-mnone">No branch is called {{ query().trim() }}.</div>
								<button
									type="button"
									class="rc-mrow on"
									(click)="creating.set(query().trim())"
								>
									<b>
										<rc-icon name="tabler/git-branch" />
										Create branch {{ query().trim() }}
									</b>
									<span>from {{ current() }} · asks for your PIN</span>
								</button>
							} @else {
								<div class="rc-mnone">
									{{
										tab() === 'tags'
											? r.tags.length
												? 'No tag matches.'
												: 'No tags yet. Tags appear here once a release or a deploy makes one.'
											: 'No branch matches.'
									}}
								</div>
							}
						}
						<button
							type="button"
							class="rc-mrow"
							(click)="viewAll.emit(tab()); open.set(false)"
						>
							<b>View all {{ tab() === 'tags' ? 'tags' : r.branches.length + ' branches' }}</b>
						</button>
					} @else {
						<div class="rc-mnone">{{ refsError() }}</div>
					}
				</div>
			}
		</span>
		@if (creating(); as name) {
			<rc-code-change
				title="Create a branch"
				submit="Create branch"
				[run]="createRun(name)"
				(closed)="creating.set(null)"
				(finished)="created(name, $event)"
			>
				<p class="rc-p">
					<b>{{ name }}</b>
					from
					<b>{{ current() }}</b>
				</p>
			</rc-code-change>
		}
	`,
})
export class CodeSwitcher {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	/** The branch, tag or commit shown now. */
	readonly current = input.required<string>();
	/** Compare's switchers pick only; the Files switcher can also create a branch. */
	readonly canCreate = input(true);
	readonly picked = output<string>();
	readonly viewAll = output<'branches' | 'tags'>();
	protected readonly kinds = [
		{ key: 'branches' as const, label: 'Branches' },
		{ key: 'tags' as const, label: 'Tags' },
	];
	readonly open = signal(false);
	readonly tab = signal<'branches' | 'tags'>('branches');
	readonly query = signal('');
	readonly active = signal(0);
	readonly creating = signal<string | null>(null);

	protected readonly q = injectQuery(() => ({
		queryKey: ['code-refs', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.codeRefs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''),
		enabled: this.open(),
	}));
	readonly refs = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly refsError = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'GitHub could not be read.';
	});
	readonly isTag = computed(() => !!this.refs()?.tags.includes(this.current()));
	/** The names matching what is typed, the default branch first, then by name. */
	readonly hits = computed(() => {
		const r = this.refs();
		if (!r) return [];
		const q = this.query().trim().toLowerCase();
		const names =
			this.tab() === 'tags'
				? r.tags
				: [...r.branches.map((b) => b.name)].sort((a, b) =>
						a === r.defaultBranch ? -1 : b === r.defaultBranch ? 1 : a.localeCompare(b),
					);
		return names.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 100);
	});
	/** "default · protected by a rule" on a branch's row. */
	where(name: string): string {
		const r = this.refs();
		if (!r || this.tab() === 'tags') return '';
		const b = r.branches.find((x) => x.name === name);
		return [name === r.defaultBranch ? 'default' : '', b?.rule ? 'protected by a rule' : '']
			.filter(Boolean)
			.join(' · ');
	}

	toggle(): void {
		this.open.set(!this.open());
		this.query.set('');
		this.active.set(0);
		if (this.open())
			setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.rc-mres input')?.focus());
	}
	/** Clicking outside closes the list. */
	outside(e: MouseEvent): void {
		if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
	}
	pick(name: string): void {
		this.open.set(false);
		this.picked.emit(name);
	}
	key(e: KeyboardEvent): void {
		const hits = this.hits();
		if (e.key === 'ArrowDown') this.active.set(Math.min(this.active() + 1, hits.length - 1));
		else if (e.key === 'ArrowUp') this.active.set(Math.max(this.active() - 1, 0));
		else if (e.key === 'Escape') this.open.set(false);
		else if (e.key === 'Enter') {
			e.preventDefault();
			const name = hits[this.active()];
			if (name) this.pick(name);
			else if (this.tab() === 'branches' && this.query().trim() && this.canCreate())
				this.creating.set(this.query().trim());
		}
	}
	createRun(name: string) {
		return (pin: string) =>
			this.api.codeChange(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', 'branch', {
				pin,
				name,
				from: this.current(),
			});
	}
	created(name: string, _done: CodeDone): void {
		this.creating.set(null);
		this.open.set(false);
		void this.q.refetch();
		this.picked.emit(name);
	}
}
