import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery, injectQueryClient } from '@tanstack/angular-query-experimental';

import { CodeChange } from './code-change';
import { CodeNav } from './code-nav';
import { BRANCH_VIEWS, type BranchView, branchSections, checkMark, ruleWords } from './code-view';
import { ConsoleApi } from '../../data/console-api';
import { when } from '../../pages/format-time';
import { Loading } from '../../shared/loading';

import type { BranchRow } from '@saha-textile/release-console-contracts';

/**
 * Branches (brief 7Hu1SuB3A8qiJzeDwvFZLR, C8), as GitHub's page: Overview, Yours, Active, Stale and All, a search and
 * New branch; each branch with its newest commit's date, how far behind and ahead of the default branch it is, its
 * pull request and checks; ✎ rename and 🗑 delete with the PIN, or ⚙ for a branch a rule guards, listing the rule.
 */
@Component({
	selector: 'rc-code-branches',
	imports: [Loading, CodeChange],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<div
				class="rc-tabs"
				role="tablist"
				aria-label="Branches"
			>
				@for (v of views; track v.key) {
					<span
						role="tab"
						tabindex="0"
						[class.on]="v.key === view()"
						[attr.aria-selected]="v.key === view()"
						(click)="nav.go({ view: v.key === 'overview' ? null : v.key })"
						(keydown.enter)="nav.go({ view: v.key === 'overview' ? null : v.key })"
					>
						{{ v.label }}
					</span>
				}
			</div>
			<span class="rc-row">
				<input
					class="rc-search"
					type="search"
					aria-label="Search branches"
					placeholder="Search branches"
					[value]="find()"
					(input)="find.set($any($event.target).value)"
				/>
				<button
					type="button"
					class="rc-btn primary"
					(click)="startNew()"
				>
					＋ New branch
				</button>
			</span>
		</div>
		@if (q.isPending()) {
			<rc-loading what="Reading the branches from GitHub…" />
		} @else if (data(); as d) {
			@for (s of sections(); track s.title) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">{{ s.title }} · {{ s.rows.length }}</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Branch</th>
									<th>Updated</th>
									<th>Behind | ahead of {{ d.defaultBranch }}</th>
									<th>Pull request</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								@for (b of s.rows; track b.name) {
									<tr>
										<td>
											<a
												href=""
												(click)="$event.preventDefault(); nav.at(b.name, '', 'tree')"
											>
												{{ b.name }}
											</a>
											@if (b.isDefault) {
												<span class="rc-pill">default</span>
											}
											@if (b.rule) {
												<span class="rc-pill">rule</span>
											}
											@if (mark(b.checks); as m) {
												<span [class]="m.tone">{{ m.text }}</span>
											}
										</td>
										<td class="rc-mono muted">{{ when(b.date) }} · {{ b.author }}</td>
										<td class="rc-mono">
											@if (b.isDefault) {
												<span class="muted">—</span>
											} @else {
												<span class="red">{{ count(b.behind) }}</span>
												|
												<span class="ok">{{ count(b.ahead) }}</span>
											}
										</td>
										<td>
											@if (b.pull; as pr) {
												<button
													type="button"
													[class]="'rc-pill ' + pullTone(pr.state)"
													(click)="openPull(pr.number)"
												>
													#{{ pr.number }} {{ pr.state }}
												</button>
											} @else if (!b.isDefault) {
												<button
													type="button"
													class="rc-btn ghost"
													(click)="
														nav.open('compare', { base: d.defaultBranch, head: b.name })
													"
												>
													New pull request
												</button>
											}
										</td>
										<td class="rc-row end">
											@if (b.rule || b.isDefault) {
												<button
													type="button"
													class="rc-btn ghost"
													aria-label="Rules for this branch"
													data-tip="Rules"
													(click)="rulesFor.set(b.name)"
												>
													⚙
												</button>
											} @else {
												<button
													type="button"
													class="rc-btn ghost"
													aria-label="Rename this branch"
													data-tip="Rename"
													(click)="startRename(b)"
												>
													✎
												</button>
												<button
													type="button"
													class="rc-btn ghost"
													aria-label="Delete this branch"
													data-tip="Delete"
													(click)="deleting.set(b.name)"
												>
													🗑
												</button>
											}
										</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="5">No branches here.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			}
		} @else {
			<div class="rc-banner small red">
				<span class="rc-dot red"></span>
				<div>{{ error() }}</div>
			</div>
		}
		@if (rulesFor(); as branch) {
			<div
				class="rc-modal-back"
				(keydown.escape)="rulesFor.set('')"
			>
				<div
					class="rc-modal"
					role="dialog"
					[attr.aria-label]="'Rules for ' + branch"
				>
					<div class="rc-row between">
						<h3 class="rc-h">Rules for {{ branch }}</h3>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="rulesFor.set('')"
						>
							Close
						</button>
					</div>
					@if (rq.isPending()) {
						<rc-loading what="Reading the rules…" />
					} @else if (rules(); as list) {
						<ul class="rc-checklist">
							@for (rule of list; track $index) {
								<li>
									{{ words(rule.type) }}
									<span class="rc-mono muted">{{ rule.ruleset }}</span>
								</li>
							} @empty {
								<li>No rule applies to this branch.</li>
							}
						</ul>
						<p class="rc-note">
							Rules are set in the repository's settings; GitHub refuses any change one forbids.
						</p>
					} @else {
						<p class="rc-note">{{ rulesError() }}</p>
					}
				</div>
			</div>
		}
		@if (making()) {
			<rc-code-change
				title="Create a branch"
				submit="Create branch"
				[ready]="!!newName().trim() && !!newFrom().trim()"
				[run]="createRun"
				(closed)="making.set(false)"
				(finished)="changed()"
			>
				<label>
					Branch name
					<input
						[value]="newName()"
						(input)="newName.set($any($event.target).value)"
					/>
				</label>
				<label>
					From (a branch, tag or commit)
					<input
						[value]="newFrom()"
						(input)="newFrom.set($any($event.target).value)"
					/>
				</label>
			</rc-code-change>
		}
		@if (renaming(); as from) {
			<rc-code-change
				title="Rename a branch"
				submit="Rename branch"
				[ready]="!!renameTo().trim() && renameTo().trim() !== from"
				[run]="renameRun(from)"
				(closed)="renaming.set(null)"
				(finished)="changed()"
			>
				<p class="rc-p">
					<b>{{ from }}</b>
					becomes
				</p>
				<label>
					New name
					<input
						[value]="renameTo()"
						(input)="renameTo.set($any($event.target).value)"
					/>
				</label>
				<p class="rc-note">GitHub moves its open pull requests and rules to the new name.</p>
			</rc-code-change>
		}
		@if (deleting(); as name) {
			<rc-code-change
				title="Delete a branch"
				submit="Delete branch"
				[danger]="true"
				[run]="deleteRun(name)"
				(closed)="deleting.set(null)"
				(finished)="changed()"
			>
				<p class="rc-p">
					<b>{{ name }}</b>
					is deleted on GitHub. Its commits stay reachable from any pull request.
				</p>
			</rc-code-change>
		}
	`,
})
export class CodeBranches {
	private readonly api = inject(ConsoleApi);
	private readonly queries = injectQueryClient();
	private readonly router = inject(Router);
	protected readonly nav = inject(CodeNav);
	protected readonly views = BRANCH_VIEWS;
	protected readonly when = when;
	protected readonly mark = checkMark;
	protected readonly words = ruleWords;
	protected readonly count = (n: number) => n.toLocaleString('en-IN');
	readonly find = signal('');
	readonly rulesFor = signal('');
	readonly making = signal(false);
	readonly newName = signal('');
	readonly newFrom = signal('');
	readonly renaming = signal<string | null>(null);
	readonly renameTo = signal('');
	readonly deleting = signal<string | null>(null);

	readonly view = computed<BranchView>(
		() => BRANCH_VIEWS.find((v) => v.key === this.nav.param('view'))?.key ?? 'overview',
	);
	protected readonly q = injectQuery(() => ({
		queryKey: ['code-branches', this.nav.p(), this.nav.r()],
		queryFn: () => this.api.codeBranches(this.nav.p(), this.nav.r()),
	}));
	readonly data = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	readonly error = computed(() => {
		const a = this.q.data();
		return a && a.state !== 'ok' ? a.message : 'The branches could not be read.';
	});
	readonly sections = computed(() => {
		const d = this.data();
		return d ? branchSections(d.rows, this.view(), d.viewer, this.find()) : [];
	});
	protected readonly rq = injectQuery(() => ({
		queryKey: ['code-rules', this.nav.p(), this.nav.r(), this.rulesFor()],
		queryFn: () => this.api.codeRules(this.nav.p(), this.nav.r(), this.rulesFor()),
		enabled: !!this.rulesFor(),
	}));
	readonly rules = computed(() => {
		const a = this.rq.data();
		return a?.state === 'ok' ? a.data.rules : null;
	});
	readonly rulesError = computed(() => {
		const a = this.rq.data();
		return a && a.state !== 'ok' ? a.message : 'The rules could not be read.';
	});

	pullTone(state: string): string {
		return { open: 'ok', draft: 'muted', merged: 'cy', closed: 'red' }[state] ?? 'muted';
	}
	/** A branch's pull request opens on the console's own pull request page. */
	openPull(n: number): void {
		void this.router.navigate(['/p', this.nav.p(), 'r', this.nav.r(), 'pulls'], {
			queryParams: { tab: 'overview', pr: n },
		});
	}
	startNew(): void {
		this.newName.set('');
		this.newFrom.set(this.data()?.defaultBranch ?? '');
		this.making.set(true);
	}
	startRename(b: BranchRow): void {
		this.renameTo.set(b.name);
		this.renaming.set(b.name);
	}
	readonly createRun = (pin: string) =>
		this.api.codeChange(this.nav.p(), this.nav.r(), 'branch', {
			pin,
			name: this.newName().trim(),
			from: this.newFrom().trim(),
		});
	renameRun(from: string) {
		return (pin: string) =>
			this.api.codeChange(this.nav.p(), this.nav.r(), 'branch/rename', {
				pin,
				name: from,
				to: this.renameTo().trim(),
			});
	}
	deleteRun(name: string) {
		return (pin: string) => this.api.codeChange(this.nav.p(), this.nav.r(), 'branch/delete', { pin, name });
	}
	changed(): void {
		this.making.set(false);
		this.renaming.set(null);
		this.deleting.set(null);
		void this.queries.invalidateQueries({ queryKey: ['code-branches'] });
		void this.queries.invalidateQueries({ queryKey: ['code-refs'] });
	}
}
