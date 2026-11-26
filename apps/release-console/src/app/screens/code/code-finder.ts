import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { CodeNav } from './code-nav';
import { findFiles, marked } from './code-view';
import { ConsoleApi } from '../../data/console-api';

/**
 * Go to file (t), as GitHub's finder (brief 7Hu1SuB3A8qiJzeDwvFZLR, C4): the letters typed, in order, anywhere in the
 * path, best first, over every file of the branch from the console's copy. Arrows and Enter open one; Esc closes.
 * Drawn with the console's search list (rc-msearch, rc-mres, rc-mrow, mark).
 */
@Component({
	selector: 'rc-code-finder',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="rc-modal-back"
			(keydown.escape)="nav.finding.set(false)"
		>
			<div
				class="rc-modal"
				role="dialog"
				aria-label="Go to file"
			>
				<div class="rc-msearch">
					<input
						type="search"
						autofocus
						autocomplete="off"
						spellcheck="false"
						aria-label="Go to file"
						placeholder="Go to file"
						[value]="query()"
						(input)="query.set($any($event.target).value); active.set(0)"
						(keydown)="key($event)"
					/>
				</div>
				@if (q.isPending()) {
					<div class="rc-mnone">Reading the branch's files…</div>
				} @else if (paths(); as all) {
					@for (hit of hits(); track hit.path; let i = $index) {
						<button
							type="button"
							class="rc-mrow"
							role="option"
							[class.on]="i === active()"
							[attr.aria-selected]="i === active()"
							(click)="open(hit.path)"
						>
							<b class="rc-mono">
								@for (part of runs(hit.path, hit.at); track $index) {
									@if (part.on) {
										<mark>{{ part.text }}</mark>
									} @else {
										{{ part.text }}
									}
								}
							</b>
						</button>
					} @empty {
						<div class="rc-mnone">No file matches “{{ query() }}”.</div>
					}
					<div class="rc-mnone">
						{{ count(all.length) }} files on {{ ref() }} · ↑ ↓ to move · Enter to open · Esc to close
					</div>
				} @else {
					<div class="rc-mnone">{{ error() }}</div>
				}
			</div>
		</div>
	`,
})
export class CodeFinder {
	private readonly api = inject(ConsoleApi);
	protected readonly nav = inject(CodeNav);
	readonly ref = input.required<string>();
	protected readonly runs = marked;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly query = signal('');
	readonly active = signal(0);
	protected readonly q = injectQuery(() => ({
		queryKey: ['code-paths', this.nav.p(), this.nav.r(), this.ref()],
		queryFn: () => this.api.codePaths(this.nav.p(), this.nav.r(), this.ref()),
	}));
	readonly paths = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data.paths : null;
	});
	readonly error = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The files could not be read.';
	});
	readonly hits = computed(() => findFiles(this.paths() ?? [], this.query()));

	key(e: KeyboardEvent): void {
		const last = this.hits().length - 1;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.active.set(Math.min(this.active() + 1, last));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.active.set(Math.max(this.active() - 1, 0));
		} else if (e.key === 'Enter') {
			const hit = this.hits()[this.active()];
			if (hit) this.open(hit.path);
		}
	}
	open(path: string): void {
		this.nav.finding.set(false);
		this.nav.at(this.ref(), path, 'blob');
	}
}
