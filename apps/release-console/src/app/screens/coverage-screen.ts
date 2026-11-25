import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	computed,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import {
	COVERAGE_METRICS,
	type Counts,
	type CoverageRuns,
	type Job,
	type CoverageSource,
	coverageBand,
	metricShare,
} from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { CoverageFile, type CoverageJump, type CoverageTab } from './coverage-file';
import { CoverageMap } from './coverage-map';
import {
	type CoverageRow,
	countsByPath,
	deltaOf,
	foldersAbove,
	foldersWithGaps,
	shareText,
	visibleRows,
} from './coverage-view';
import { injectDefaultBranch } from './env-tag-dialog';
import { VendorState } from './vendor-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';

type Flag = 'below' | 'measured' | 'low';
interface Chosen {
	source: CoverageSource;
	run: string;
}

/** The run a screen opens first: the newest CI run that kept reports, else this Mac's. */
export function firstRun(runs: CoverageRuns | undefined): { source: CoverageSource; run: string } | null {
	const ci = runs?.ci.find((r) => r.state === 'passed' || r.state === 'failed');
	if (ci) return { source: 'ci', run: ci.id };
	return runs?.mac ? { source: 'mac', run: 'mac' } : null;
}

/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23, approved 24 Nov 2026): the committed code tree
 * with every file's and every folder's coverage up to the whole codebase, a file opened at the side, and
 * a map of the whole codebase. Reads a CI run (any commit CI ran) or this Mac's latest `pnpm coverage`.
 */
@Component({
	selector: 'rc-coverage-screen',
	imports: [VendorState, CoverageFile, CoverageMap],
	changeDetection: ChangeDetectionStrategy.OnPush,
	// The keys work wherever focus is on the page while this screen is open (a pressed button may be gone).
	host: { '(document:keydown)': 'keys($event)' },
	template: `
		@let runs = runsQ.data();
		<div class="rc-panel">
			<span class="rc-label">Coverage from</span>
			<div class="rc-content">
				<div class="rc-row">
					<button
						type="button"
						class="rc-chip"
						[class.on]="chosen()?.source === 'ci'"
						[disabled]="!ciRuns().length"
						[title]="runs?.ciMessage ?? 'A CI run of any commit'"
						(click)="pickSource('ci')"
					>
						CI run
					</button>
					<button
						type="button"
						class="rc-chip"
						[class.on]="chosen()?.source === 'mac'"
						[disabled]="!runs?.mac"
						[title]="runs?.macMessage ?? 'Your latest pnpm coverage on this Mac'"
						(click)="pickSource('mac')"
					>
						This Mac
					</button>
					@if (chosen()?.source === 'ci') {
						<select
							class="rc-select"
							style="min-width: 0"
							aria-label="CI run"
							(change)="pickRun($any($event.target).value)"
						>
							@for (r of runs?.ci ?? []; track r.id) {
								<option
									[value]="r.id"
									[disabled]="r.state === 'running' || r.state === 'no-reports'"
									[selected]="r.id === chosen()?.run"
								>
									{{ r.ref }} · {{ r.sha.slice(0, 8) }} · {{ r.title }} · {{ runWords[r.state]
									}}{{ r.finishedAt ? ' · ' + when(r.finishedAt) : '' }}
								</option>
							}
						</select>
					} @else if (runs?.mac; as mac) {
						<span class="rc-mono">
							{{ mac.ref || 'this copy' }}{{ mac.sha ? ' · ' + mac.sha.slice(0, 8) : '' }} · measured
							{{ when(mac.finishedAt) }}{{ mac.uncommitted ? ' · with uncommitted changes' : '' }}
						</span>
					}
				</div>
			</div>
			@if (runsQ.isSuccess() && !chosen()) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>No coverage to show yet.</b>
						{{ runs?.ciMessage }} {{ runs?.macMessage }}
					</div>
				</div>
			}
		</div>
		@if (chosen()) {
			<rc-vendor-state
				vendor="The coverage reports"
				[answer]="treeQ.data()"
				[pending]="treeQ.isPending()"
				[failed]="treeQ.isError()"
			>
				@if (tree(); as t) {
					<!-- The console's content grid: 12 px between the tiles, the toolbar rows and the table (owner, 25 Nov: Compare with ran into the table). -->
					<div class="rc-content">
						<div class="rc-tiles">
							@for (m of tiles(); track m.label) {
								<div class="rc-stat">
									<span class="rc-label">{{ m.label }}</span>
									<b [class]="m.band">{{ m.text }}</b>
									<small>{{ m.detail }}</small>
								</div>
							}
						</div>
						<div class="rc-row between">
							<div class="rc-row">
								@for (f of flags; track f.key) {
									<button
										type="button"
										class="rc-chip"
										[class.on]="flagOn(f.key)"
										(click)="setFlag(f.key)"
									>
										{{ f.label }}
									</button>
								}
								<button
									type="button"
									class="rc-chip"
									[class.on]="base() === 'commit'"
									(click)="pickBase('commit')"
								>
									Changed in this commit
								</button>
								@if (mainBranch(); as main) {
									<button
										type="button"
										class="rc-chip"
										[class.on]="base() === main"
										(click)="pickBase(main)"
									>
										Changed since {{ main }}
									</button>
								}
							</div>
							<div class="rc-row">
								<div class="rc-msearch">
									<input
										#find
										aria-label="Find a file"
										placeholder="Find a file"
										[value]="query()"
										(input)="query.set($any($event.target).value)"
									/>
									<kbd>/</kbd>
								</div>
								<button
									type="button"
									class="rc-btn"
									title="Open every folder that is below 100%"
									(click)="openEveryGap()"
								>
									Open every gap
								</button>
							</div>
						</div>
						<div class="rc-row">
							<button
								type="button"
								class="rc-chip"
								[class.on]="showSlow()"
								(click)="showSlow.set(!showSlow())"
							>
								Slowest tests
							</button>
							<!-- The console's labelled dropdown, as Products' pickers draw it (product-screen.ts). -->
							<label class="rc-row">
								<span class="rc-label">Compare with</span>
								<select
									class="rc-select"
									aria-label="Compare with"
									(change)="pickCompare($any($event.target).value)"
								>
									<option
										value=""
										[selected]="!compareWith()"
									>
										nothing
									</option>
									@for (o of compareChoices(); track o.value) {
										<option
											[value]="o.value"
											[selected]="o.value === compareWith()"
										>
											{{ o.label }}
										</option>
									}
								</select>
							</label>
							@if (compareWith() && compareQ.isPending()) {
								<span class="rc-note">Reading the run to compare with…</span>
							}
						</div>
						@if (showSlow()) {
							<div class="rc-panel">
								<span class="rc-label">Slowest test files · this run</span>
								<div class="rc-kv">
									@for (s of t.tests.slowest; track s.file) {
										<div>
											<span>{{ s.file }}</span>
											<em>{{ seconds(s.ms) }}</em>
										</div>
									} @empty {
										<p class="rc-note">This run kept no test times.</p>
									}
								</div>
							</div>
						}
						@if (t.changed; as ch) {
							<div class="rc-banner small">
								<span [class]="'rc-dot ' + (patch().missed ? 'red' : 'ok')"></span>
								<div>
									<b>{{ patch().run }} of {{ patch().run + patch().missed }} changed lines ran</b>
									({{ ch.label }}, {{ ch.files.length }} measured files).
									@if (patch().missed) {
										{{ patch().missed }} changed lines no test ran: the project's rule is that every
										change keeps its own code at 100%.
									}
								</div>
							</div>
						}
						<div
							class="rc-g-side rc-cov-split"
							[class.open]="!!open()"
						>
							@if (tab() === 'map') {
								<rc-coverage-map
									[root]="t.tree"
									[focusPath]="mapFocus()"
									(focus)="mapFocus.set($event)"
									(open)="openFile($event)"
								/>
							} @else {
								<div class="rc-tw rc-cov-tree">
									<table
										class="rc-t"
										role="treegrid"
										aria-label="Code tree with coverage"
									>
										<thead>
											<tr>
												<th>Name</th>
												<th class="rc-cov-bar">Statements</th>
												<th>Stmts</th>
												<th>Branch</th>
												<th>Funcs</th>
												<th>Lines</th>
												@if (compared()) {
													<th
														title="Change in statements covered since the run compared with"
													>
														Δ
													</th>
												}
											</tr>
										</thead>
										<tbody>
											@for (row of rows(); track row.path) {
												<tr
													class="row"
													tabindex="-1"
													[class.sel]="row.path === open()"
													[class.unmeasured]="!row.counts"
													[class.in]="fresh().has(row.path)"
													[attr.data-path]="row.path"
													[attr.aria-expanded]="row.folder ? row.open : null"
													[attr.aria-level]="row.depth + 1"
													(click)="
														rowClick(row, $any($event).altKey || $any($event).shiftKey)
													"
												>
													<td>
														<span
															class="rc-cov-name"
															[style.padding-left.px]="row.depth * 14"
														>
															<span
																class="rc-cov-arrow"
																[class.open]="row.open"
															>
																{{ row.folder ? '▸' : '' }}
															</span>
															@if (row.path === '') {
																<b>{{ row.name }}</b>
																<span class="muted">whole codebase</span>
															} @else {
																{{ row.name }}
															}
															@if (failedIn(row.path); as n) {
																<span class="rc-pill red">
																	{{ n }} {{ n === 1 ? 'test' : 'tests' }} failed
																</span>
															}
														</span>
													</td>
													<td class="rc-cov-bar">
														@if (cells(row)[0]; as s) {
															<span class="rc-bar">
																<i
																	[class]="s.band"
																	[style.width.%]="s.share"
																></i>
															</span>
														}
													</td>
													@for (c of cells(row); track $index) {
														<td
															class="num"
															[class]="c ? 'num ' + c.band : 'num muted'"
															[title]="c?.title ?? 'not measured'"
														>
															{{ c ? c.text : '—' }}
														</td>
													}
													@if (compared(); as before) {
														@let d = delta(row, before);
														<td [class]="'num ' + (d?.band ?? 'muted')">
															{{ d?.text ?? '' }}
														</td>
													}
												</tr>
											}
										</tbody>
									</table>
								</div>
							}
							@if (open(); as path) {
								<rc-coverage-file
									[answer]="fileQ.data()"
									[pending]="fileQ.isPending()"
									[failed]="fileQ.isError()"
									[tab]="paneTab()"
									[line]="line()"
									[repository]="
										chosen()?.source === 'ci' ? (ctx.repo()?.sourceCode?.repository ?? null) : null
									"
									(closed)="close()"
									(tabChange)="paneTab.set($event)"
									(goTo)="jump($event)"
									[job]="runJob()"
									[runMessage]="runMessage()"
									(runSpec)="runSpec($event)"
								/>
							}
						</div>
					</div>
				}
			</rc-vendor-state>
		}
	`,
})
export class CoverageScreen {
	/** The page's tab: the tree or the map. */
	readonly tab = input<string>('tree');

	protected readonly api = inject(ConsoleApi);
	protected readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	protected readonly when = when;
	protected readonly runWords: Record<string, string> = {
		passed: 'tests passed',
		failed: 'tests failed',
		running: 'still running',
		'no-reports': 'no reports kept',
	};
	protected readonly flags: { key: Flag; label: string }[] = [
		{ key: 'below', label: 'Below 100%' },
		{ key: 'measured', label: 'Measured only' },
		{ key: 'low', label: 'Lowest first' },
	];

	private readonly picked = signal<{ source: CoverageSource; run: string } | null>(null);
	protected readonly base = signal<string | null>(null);
	protected readonly expanded = signal<ReadonlySet<string>>(new Set(['']));
	protected readonly fresh = signal<ReadonlySet<string>>(new Set());
	protected readonly open = signal<string | null>(this.route.snapshot?.queryParamMap.get('file') ?? null);
	protected readonly line = signal<{ n: number } | null>(lineFrom(this.route.snapshot?.queryParamMap.get('line')));
	protected readonly paneTab = signal<CoverageTab>('lines');
	protected readonly below = signal(false);
	protected readonly measured = signal(false);
	protected readonly low = signal(false);
	protected readonly query = signal('');
	protected readonly mapFocus = signal('');
	private readonly findBox = viewChild<ElementRef<HTMLInputElement>>('find');
	private readonly fileView = viewChild(CoverageFile);
	/** The project and repository this screen reads. */
	private readonly ids = (): [string, string] => [this.ctx.projectId() ?? '', this.ctx.repoId() ?? ''];
	private readonly branches = injectDefaultBranch();

	protected readonly runsQ = injectQuery(() => ({
		queryKey: ['coverage', 'runs', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.coverageRuns(...this.ids()),
		refetchInterval: 60_000,
	}));
	protected readonly ciRuns = computed(() =>
		(this.runsQ.data()?.ci ?? []).filter((r) => r.state === 'passed' || r.state === 'failed'),
	);
	protected readonly chosen = computed(() => this.picked() ?? firstRun(this.runsQ.data()));
	protected readonly mainBranch = computed(() => this.branches.data()?.defaultBranch ?? null);

	/* ----- slowest tests and comparing two runs ----- */
	protected readonly showSlow = signal(false);
	/** The run compared with: a CI run's id or 'mac'. */
	protected readonly compareWith = signal<string | null>(null);
	protected readonly compareChoices = computed(() => {
		const c = this.chosen();
		const runs = this.ciRuns()
			.filter((r) => !(c?.source === 'ci' && c.run === r.id))
			.map((r) => ({ value: r.id, label: `${r.ref} · ${r.sha.slice(0, 8)} · ${r.title}` }));
		return this.runsQ.data()?.mac && c?.source !== 'mac' ? [...runs, { value: 'mac', label: 'This Mac' }] : runs;
	});
	protected readonly compareQ = injectQuery(() => {
		const w = this.compareWith();
		const source = w === 'mac' ? 'mac' : 'ci';
		return {
			// the same key as the tree's own read, so a run read before answers at once
			queryKey: ['coverage', 'tree', this.ctx.projectId(), this.ctx.repoId(), source, w, null],
			queryFn: () => this.api.coverageTree(...this.ids(), { source, run: w as string, base: null }),
			enabled: !!w,
			staleTime: source === 'ci' ? Infinity : 30_000,
		};
	});
	/** Every path's counts in the run compared with, once it is read. */
	protected readonly compared = computed(() => {
		const a = this.compareQ.data();
		return this.compareWith() && a?.state === 'ok' ? countsByPath(a.data.tree) : null;
	});
	protected delta(row: CoverageRow, before: Map<string, Counts>) {
		return deltaOf(row.counts, before.get(row.path));
	}
	protected pickCompare(value: string): void {
		this.compareWith.set(value || null);
	}
	protected seconds(ms: number): string {
		return `${(ms / 1000).toFixed(1)} s`;
	}

	/* ----- Run on This Mac ----- */
	private readonly runWatch = signal<string | null>(null);
	protected readonly runMessage = signal('');
	private readonly runQ = injectQuery(() => ({
		queryKey: ['job', this.runWatch()],
		queryFn: () => this.api.job(this.runWatch() as string),
		enabled: !!this.runWatch(),
		refetchInterval: (q: { state: { data?: Job } }) => pollWhileRunning(q.state.data),
	}));
	protected readonly runJob = computed(() => this.runQ.data() ?? null);
	/** Runs one test file on this Mac after the PIN; its log shows in the file's Tests tab. */
	async runSpec(request: { spec: string; pin: string }): Promise<void> {
		this.runMessage.set('');
		try {
			const job = await this.api.runLocal('test-file', request.pin, { path: request.spec });
			this.runWatch.set(job.id);
		} catch (err) {
			this.runMessage.set((err as Error).message);
		}
	}

	protected readonly treeQ = injectQuery(() => {
		const c = this.chosen();
		return {
			queryKey: ['coverage', 'tree', this.ctx.projectId(), this.ctx.repoId(), c?.source, c?.run, this.base()],
			// runs only once a run is chosen (enabled below)
			queryFn: () => this.api.coverageTree(...this.ids(), { ...(c as Chosen), base: this.base() }),
			enabled: !!c,
			staleTime: c?.source === 'ci' ? Infinity : 30_000,
		};
	});
	protected readonly tree = computed(() => {
		const a = this.treeQ.data();
		return a?.state === 'ok' ? a.data : null;
	});
	protected readonly fileQ = injectQuery(() => {
		const c = this.chosen();
		const path = this.open();
		return {
			queryKey: [
				'coverage',
				'file',
				this.ctx.projectId(),
				this.ctx.repoId(),
				c?.source,
				c?.run,
				path,
				this.base(),
			],
			// runs only once a run is chosen and a file is open (enabled below)
			queryFn: () =>
				this.api.coverageFile(...this.ids(), { ...(c as Chosen), base: this.base(), path: path as string }),
			enabled: !!c && !!path,
			staleTime: c?.source === 'ci' ? Infinity : 30_000,
		};
	});

	protected readonly rows = computed(() => {
		const t = this.tree();
		if (!t) return [];
		return visibleRows(t.tree, {
			expanded: this.expanded(),
			below: this.below(),
			measured: this.measured(),
			low: this.low(),
			query: this.query(),
			only: t.changed ? new Set(t.changed.files.map((f) => f.path)) : null,
		});
	});
	protected readonly patch = computed(() =>
		(this.tree()?.changed?.files ?? []).reduce(
			(a, f) => ({ run: a.run + f.run.length, missed: a.missed + f.missed.length }),
			{
				run: 0,
				missed: 0,
			},
		),
	);
	protected readonly tiles = computed(() => {
		const t = this.tree();
		if (!t) return [];
		const c = t.tree.c ?? [0, 0, 0, 0, 0, 0, 0, 0];
		const metrics = COVERAGE_METRICS.map((metric, i) => {
			const share = metricShare(c, metric);
			return {
				label: metric,
				text: `${shareText(share)}%`,
				band: coverageBand(share),
				detail: `${c[i * 2]} of ${c[i * 2 + 1]} · whole codebase`,
			};
		});
		const tests = t.tests;
		return [
			...metrics,
			{
				label: 'tests',
				text: `${tests.failed} failed`,
				band: tests.failed ? 'red' : 'ok',
				detail: `${tests.passed} passed · ${tests.skipped} skipped`,
			},
		];
	});
	private readonly failedByDir = computed(
		() => new Map((this.tree()?.workspaces ?? []).filter((w) => w.failed).map((w) => [w.dir, w.failed])),
	);

	/** The four numbers of a row, as shown. */
	protected cells(row: CoverageRow) {
		const c = row.counts;
		return COVERAGE_METRICS.map((metric, i) => {
			if (!c) return null;
			const share = metricShare(c, metric);
			return {
				share,
				text: shareText(share),
				band: coverageBand(share),
				title: `${c[i * 2]} of ${c[i * 2 + 1]} ${metric}`,
			};
		});
	}
	protected failedIn(path: string): number {
		return this.failedByDir().get(path) ?? 0;
	}
	protected flagOn(flag: Flag): boolean {
		return this[flag]();
	}

	protected pickSource(source: CoverageSource): void {
		if (source === 'mac') this.picked.set({ source, run: 'mac' });
		else this.picked.set({ source, run: this.ciRuns()[0]?.id ?? '' });
	}
	protected pickRun(run: string): void {
		this.picked.set({ source: 'ci', run });
	}
	protected pickBase(base: string): void {
		this.base.update((b) => (b === base ? null : base));
	}
	protected setFlag(flag: Flag): void {
		this[flag].update((v) => !v);
	}

	/** Opens or closes a folder; alt- or shift-click also opens every folder below it that has a gap. */
	toggle(path: string, deep = false): void {
		const before = new Set(this.rows().map((r) => r.path));
		const ex = new Set(this.expanded());
		if (ex.has(path)) {
			for (const p of ex) if (p === path || p.startsWith(`${path}/`) || path === '') ex.delete(p);
		} else {
			ex.add(path);
			const t = this.tree();
			if (deep && t)
				for (const p of foldersWithGaps(t.tree))
					if (p === path || p.startsWith(`${path}/`) || path === '') ex.add(p);
		}
		this.expanded.set(ex);
		this.fresh.set(
			new Set(
				this.rows()
					.map((r) => r.path)
					.filter((p) => !before.has(p)),
			),
		);
	}
	protected rowClick(row: CoverageRow, deep: boolean): void {
		if (row.folder) this.toggle(row.path, deep);
		else this.openFile(row.path);
	}
	protected openEveryGap(): void {
		const t = this.tree();
		if (t) this.expanded.set(foldersWithGaps(t.tree));
	}

	/** Opens a file at the side (at a line, when given), with the folders above it open. */
	openFile(path: string, line: number | null = null, tab: CoverageTab = 'lines'): void {
		this.expanded.update((ex) => new Set([...ex, ...foldersAbove(path)]));
		this.open.set(path);
		this.paneTab.set(tab);
		this.line.set(line ? { n: line } : null);
		this.address(path, line);
	}
	protected jump(j: CoverageJump): void {
		if (j.path !== this.open()) {
			this.openFile(j.path, j.line, j.tab ?? 'lines');
			return;
		}
		this.paneTab.set(j.tab ?? this.paneTab());
		this.line.set({ n: j.line });
		this.address(j.path, j.line);
	}
	close(): void {
		this.open.set(null);
		this.line.set(null);
		this.address(null, null);
	}
	/** The open file and line in the address, so a link opens the same view. */
	private address(file: string | null, line: number | null): void {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { file, line },
			queryParamsHandling: 'merge',
			replaceUrl: true,
		});
	}

	/** Keys: / finds a file; Esc closes the file; n and p step through gaps; t shows its tests; arrows move in the tree. */
	keys(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
			if (event.key === 'Escape') target.blur();
			return;
		}
		if (event.key === '/') {
			event.preventDefault();
			this.findBox()?.nativeElement.focus();
		} else if (event.key === 'Escape' && this.open()) this.close();
		else if (event.key === 'n' && this.open()) this.fileView()?.step(1);
		else if (event.key === 'p' && this.open()) this.fileView()?.step(-1);
		else if (event.key === 't' && this.open()) this.paneTab.set('tests');
		else {
			const row = target.closest<HTMLElement>('tr.row');
			if (row) this.treeKey(event, row);
		}
	}
	private treeKey(event: KeyboardEvent, row: HTMLElement): void {
		const path = row.dataset['path'] ?? '';
		const r = this.rows().find((x) => x.path === path);
		if (!r) return;
		const move = (el: Element | null) => (el as HTMLElement | null)?.focus();
		if (event.key === 'ArrowDown') move(row.nextElementSibling);
		else if (event.key === 'ArrowUp') move(row.previousElementSibling);
		else if (event.key === 'ArrowRight' && r.folder && !r.open) this.toggle(path);
		else if (event.key === 'ArrowLeft' && r.folder && r.open) this.toggle(path);
		else if (event.key === 'Enter' || event.key === ' ') this.rowClick(r, false);
		else return;
		event.preventDefault();
	}
}

/** A job is read again every 2 seconds until it has finished. */
export function pollWhileRunning(job: Job | undefined): number | false {
	return job && job.status !== 'running' && job.status !== 'stopping' ? false : 2000;
}

/** A line number from the address, or nothing. */
export function lineFrom(value: string | null | undefined): { n: number } | null {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? { n } : null;
}
