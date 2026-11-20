import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { Icon } from './icons';

import type { Branch } from '@saha-textile/release-console-contracts';

/** The branches a typed text matches, best first: exact, then starts-with, then contains. */
export function matchBranches(branches: Branch[], text: string, limit = 50): Branch[] {
	const q = text.trim().toLowerCase();
	if (!q) return branches.slice(0, limit);
	const rank = (b: Branch) => {
		const n = b.name.toLowerCase();
		return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
	};
	return branches
		.filter((b) => rank(b) < 3)
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/** Where a branch lives, in words, for its row in the list. */
export function branchWhere(b: Branch, defaultBranch: string | null, current: string | null): string {
	const parts = [
		b.name === defaultBranch ? 'default branch' : '',
		b.name === current ? 'checked out on this computer' : '',
		b.onGitHub && !b.onThisComputer ? 'on GitHub' : '',
		b.onThisComputer && !b.onGitHub ? 'only on this computer' : '',
		b.onGitHub && b.onThisComputer ? 'on GitHub and this computer' : '',
	];
	return parts.filter(Boolean).join(' · ');
}

/**
 * A branch picker (owner, 20 Nov: "a search select drop down … with branch icon"; and "a small
 * refresh icon" beside it): type to search the repository's branches, pick one with a click or
 * the arrow keys and Enter. Built from the console's menu-search box and results list
 * (`rc-msearch`, `rc-mres`, `rc-mrow`), so it looks like the search it already has.
 */
@Component({
	selector: 'rc-branch-picker',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<!-- rc-step's grid (icon · box · button) keeps the refresh button beside the box at any width. -->
		<div class="rc-step">
			<span>
				<rc-icon name="tabler/git-branch" />
				@if (label()) {
					<span class="rc-note">{{ label() }}</span>
				}
			</span>
			<div class="rc-msearch">
				<input
					type="search"
					autocomplete="off"
					spellcheck="false"
					[attr.aria-label]="'Branch for ' + context()"
					[placeholder]="branches().length ? 'search branches' : waitingText()"
					[value]="open() ? query() : value()"
					[disabled]="!branches().length"
					(focus)="openList()"
					(blur)="open.set(false)"
					(input)="query.set($any($event.target).value); active.set(0)"
					(keydown)="key($event)"
				/>
				@if (open()) {
					<div
						class="rc-mres"
						role="listbox"
					>
						@for (b of hits(); track b.name) {
							<button
								type="button"
								class="rc-mrow"
								role="option"
								[class.on]="$index === active()"
								[attr.aria-selected]="b.name === value()"
								(mousedown)="pick(b.name)"
							>
								<b>
									<rc-icon name="tabler/git-branch" />
									{{ b.name }}
								</b>
								<span>{{ where(b) }}</span>
							</button>
						} @empty {
							<div class="rc-mnone">No branch matches “{{ query() }}”.</div>
						}
					</div>
				}
			</div>
			<button
				type="button"
				class="rc-btn ghost"
				title="Fetch the branches again"
				aria-label="Fetch the branches again"
				[disabled]="refreshing()"
				(click)="refresh.emit()"
			>
				<rc-icon name="tabler/refresh" />
			</button>
		</div>
	`,
})
export class BranchPicker {
	/** The repository's branches, GitHub's and this computer's. */
	readonly branches = input<Branch[]>([]);
	readonly value = input('');
	readonly defaultBranch = input<string | null>(null);
	readonly current = input<string | null>(null);
	/** A name before the box, e.g. the repository when an environment has several; none by default. */
	readonly label = input('');
	/** What the branch is for, for screen readers: an environment or a run. */
	readonly context = input('');
	/** Shown while there is no list yet: loading, or why it is missing. */
	readonly waitingText = input('loading branches…');
	readonly refreshing = input(false);
	readonly picked = output<string>();
	/** Fetch the list again (the page runs git fetch on this computer and asks GitHub). */
	readonly refresh = output<void>();

	protected readonly open = signal(false);
	protected readonly query = signal('');
	protected readonly active = signal(0);
	protected readonly hits = computed(() => matchBranches(this.branches(), this.query()));

	protected where(b: Branch): string {
		return branchWhere(b, this.defaultBranch(), this.current());
	}

	protected openList(): void {
		this.query.set('');
		this.active.set(0);
		this.open.set(true);
	}

	protected pick(name: string): void {
		this.picked.emit(name);
		this.open.set(false);
	}

	protected key(e: KeyboardEvent): void {
		const n = this.hits().length;
		if (e.key === 'ArrowDown' && n) this.active.update((i) => (i + 1) % n);
		else if (e.key === 'ArrowUp' && n) this.active.update((i) => (i - 1 + n) % n);
		else if (e.key === 'Enter') {
			const hit = this.hits()[this.active()];
			if (hit) this.pick(hit.name);
		} else if (e.key === 'Escape') this.open.set(false);
		else return;
		e.preventDefault();
	}
}
