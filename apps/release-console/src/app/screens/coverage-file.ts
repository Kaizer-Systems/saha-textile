import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	computed,
	effect,
	input,
	output,
	viewChild,
} from '@angular/core';

import {
	COVERAGE_METRICS,
	type CoverageFileAnswer,
	type VendorAnswer,
	coverageBand,
	metricShare,
} from '@saha-textile/release-console-contracts';

import { highlightedLines, shareText } from './coverage-view';
import { VendorState } from './vendor-screens';

export type CoverageTab = 'lines' | 'gaps' | 'tests';
/** Where the pane asks to go: a file (this one or another) at a line. */
export interface CoverageJump {
	path: string;
	line: number;
	tab?: CoverageTab;
}

/**
 * Ship › Code › Coverage, the file at the side (brief CRmpBdP3ce62g1JoCAhh23): its four numbers, its
 * lines with run counts, tints and gap words, the gap list, and the tests beside it with any failure,
 * expected against received, and each line the failure went through as a link.
 */
@Component({
	selector: 'rc-coverage-file',
	imports: [VendorState],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-vendor-state
			vendor="The coverage report"
			[answer]="answer()"
			[pending]="pending()"
			[failed]="failed()"
		>
			@if (data(); as d) {
				<div class="rc-panel">
					<div class="rc-ph">
						<div>
							<b>{{ name() }}</b>
							<span class="rc-crumb">{{ d.path }}</span>
						</div>
						<button
							type="button"
							class="rc-btn ghost"
							title="Close (Esc)"
							aria-label="Close the file"
							(click)="closed.emit()"
						>
							×
						</button>
					</div>
					<div class="rc-row">
						@for (s of shares(); track s.label) {
							<span
								[class]="'rc-pill ' + s.band"
								[title]="s.title"
							>
								{{ s.label }} {{ s.text }}%
							</span>
						} @empty {
							<span class="rc-pill muted">not measured</span>
						}
						<span [class]="'rc-pill ' + (d.gaps.length ? 'amber' : 'ok')">{{ d.gaps.length }} gaps</span>
						@if (d.failures.length) {
							<span class="rc-pill red">{{ d.failures.length }} failed</span>
						}
						@if (d.changed.length) {
							<span class="rc-pill cy">{{ d.changed.length }} changed lines</span>
						}
					</div>
					@if (d.note) {
						<div class="rc-banner amber small">
							<span class="rc-dot amber"></span>
							<div>{{ d.note }}</div>
						</div>
					}
					<div
						class="rc-tabs"
						role="tablist"
					>
						@for (t of tabs; track t.key) {
							<span
								role="tab"
								tabindex="0"
								[class.on]="t.key === tab()"
								[attr.aria-selected]="t.key === tab()"
								(click)="tabChange.emit(t.key)"
								(keydown.enter)="tabChange.emit(t.key)"
							>
								{{ t.label }}{{ t.key === 'gaps' ? ' ' + d.gaps.length : ''
								}}{{
									t.key === 'tests' && d.failures.length ? ' · ' + d.failures.length + ' failed' : ''
								}}
							</span>
						}
						<span
							class="rc-row end"
							style="flex: 1"
						>
							<button
								type="button"
								class="rc-btn"
								title="Previous gap (p)"
								[disabled]="!d.gaps.length"
								(click)="step(-1)"
							>
								◀ p
							</button>
							<button
								type="button"
								class="rc-btn"
								title="Next gap (n)"
								[disabled]="!d.gaps.length"
								(click)="step(1)"
							>
								n ▶
							</button>
							@if (githubAt(); as url) {
								<a
									class="rc-btn"
									target="_blank"
									rel="noopener"
									[href]="url"
								>
									GitHub ↗
								</a>
							}
						</span>
					</div>
					@if (tab() === 'lines') {
						<div class="rc-cov-body">
							<div
								#box
								class="rc-log rc-cov-code"
								tabindex="0"
								aria-label="The file's lines"
							>
								@for (row of rows(); track row.n) {
									<div
										[class]="'l ' + row.cls"
										[attr.data-ln]="row.n"
									>
										<span class="n">{{ row.n }}</span>
										<span class="src">{{ row.hits }}</span>
										<span class="m">
											<span [innerHTML]="row.html"></span>
											@for (note of row.notes; track $index) {
												<span
													[class]="'rc-pill ' + (row.cls === 'err' ? 'red' : 'amber')"
													[title]="note"
												>
													{{ note }}
												</span>
											}
											@if (row.changed) {
												<span class="rc-pill cy">changed</span>
											}
										</span>
									</div>
								}
							</div>
							<button
								type="button"
								class="rc-cov-gaps"
								title="Where the gaps are: press to jump there"
								aria-label="Where the gaps are"
								(click)="stripAt($event)"
							>
								@for (m of marks(); track m.line) {
									<i
										[class.red]="m.red"
										[style.top.%]="m.top"
										[style.height.%]="m.height"
									></i>
								}
							</button>
						</div>
					} @else if (tab() === 'gaps') {
						<div class="rc-kv">
							@for (g of d.gaps; track $index) {
								<div
									role="button"
									tabindex="0"
									(click)="goTo.emit({ path: d.path, line: g.from, tab: 'lines' })"
									(keydown.enter)="goTo.emit({ path: d.path, line: g.from, tab: 'lines' })"
								>
									<span>
										<span [class]="g.kind === 'miss' ? 'red' : 'amber'">
											{{ g.say }}{{ g.code ? ': ' : '' }}
										</span>
										@if (g.code) {
											<code>{{ g.code }}</code>
										}
									</span>
									<em>{{ g.from === g.to ? 'line ' + g.from : 'lines ' + g.from + '–' + g.to }}</em>
								</div>
							} @empty {
								<p class="rc-note">No gaps: every line, branch and function of this file ran.</p>
							}
						</div>
					} @else {
						<div class="rc-content">
							@for (f of d.failures; track $index) {
								<div class="rc-panel">
									<span class="rc-label red">Failed · {{ f.file }}</span>
									<b>{{ f.name }}</b>
									<div class="rc-log">
										<div class="l err">
											<span class="m">{{ f.error.message }}</span>
										</div>
									</div>
									@if (f.error.expected !== undefined || f.error.actual !== undefined) {
										<div class="rc-g2">
											<div class="rc-stat">
												<small>Expected</small>
												<code class="ok">{{ f.error.expected ?? '—' }}</code>
											</div>
											<div class="rc-stat">
												<small>Received</small>
												<code class="red">{{ f.error.actual ?? '—' }}</code>
											</div>
										</div>
									}
									<span class="rc-label">Where it went</span>
									@for (fr of f.error.frames; track $index) {
										<button
											type="button"
											class="rc-btn"
											(click)="goTo.emit({ path: fr.file, line: fr.line, tab: 'lines' })"
										>
											{{ fr.file }}:{{ fr.line }}
										</button>
									} @empty {
										<p class="rc-note">The report names no lines for this failure.</p>
									}
								</div>
							}
							@for (s of d.specs; track s.file) {
								<span class="rc-label">{{ s.file }} · {{ s.tests.length }} tests</span>
								<div class="rc-kv">
									@for (t of s.tests; track $index) {
										<div>
											<span
												[class]="
													t.state === 'passed' ? 'ok' : t.state === 'failed' ? 'red' : 'muted'
												"
											>
												{{ t.state === 'passed' ? '✓' : t.state === 'failed' ? '✕' : '–' }}
												{{ t.name }}
											</span>
											<em>{{ t.ms }} ms</em>
										</div>
									}
								</div>
							} @empty {
								@if (!d.failures.length) {
									<p class="rc-note">
										No test file sits beside this file. Its lines may still be run by tests
										elsewhere: the Lines tab shows which ran.
									</p>
								}
							}
						</div>
					}
				</div>
			}
		</rc-vendor-state>
	`,
})
export class CoverageFile {
	readonly answer = input<VendorAnswer<CoverageFileAnswer> | undefined>(undefined);
	readonly pending = input(false);
	readonly failed = input(false);
	readonly tab = input<CoverageTab>('lines');
	/** The line to bring into view and flash; a new object each time, so the same line can be shown again. */
	readonly line = input<{ n: number } | null>(null);
	/** The repository on GitHub (owner/name), for a link to the file at the run's commit. */
	readonly repository = input<string | null>(null);
	readonly closed = output<void>();
	readonly tabChange = output<CoverageTab>();
	readonly goTo = output<CoverageJump>();

	protected readonly tabs: { key: CoverageTab; label: string }[] = [
		{ key: 'lines', label: 'Lines' },
		{ key: 'gaps', label: 'Gaps' },
		{ key: 'tests', label: 'Tests' },
	];
	protected readonly data = computed(() => {
		const a = this.answer();
		return a?.state === 'ok' ? a.data : null;
	});
	protected readonly name = computed(() => this.data()?.path.split('/').pop() ?? '');
	protected readonly shares = computed(() => {
		const c = this.data()?.counts;
		if (!c) return [];
		return COVERAGE_METRICS.map((metric, i) => {
			const share = metricShare(c, metric);
			return {
				label: metric.charAt(0).toUpperCase(),
				text: shareText(share),
				band: coverageBand(share),
				title: `${c[i * 2]} of ${c[i * 2 + 1]} ${metric}`,
			};
		});
	});
	protected readonly rows = computed(() => {
		const d = this.data();
		if (!d) return [];
		const html = highlightedLines(d.text, d.path);
		const changed = new Set(d.changed);
		return d.lines.map((l, i) => ({
			n: i + 1,
			// a line that never ran reuses the job logs' red row
			cls: l.c === 'miss' ? 'err' : l.c,
			hits: l.h === null ? '' : `${l.h}×`,
			// the API sends one entry per line of text, so every line has its colours
			html: html[i] as string,
			notes: l.notes.map((n) => (n.code ? `${n.say}: ${n.code}` : n.say)),
			changed: changed.has(i + 1),
		}));
	});
	protected readonly marks = computed(() => {
		const d = this.data();
		const total = d?.lines.length ?? 0;
		return (d?.lines ?? []).flatMap((l, i) =>
			l.c === 'miss' || l.c === 'part'
				? [{ line: i + 1, red: l.c === 'miss', top: (i / total) * 100, height: 100 / total }]
				: [],
		);
	});
	protected readonly githubAt = computed(() => {
		const d = this.data();
		const repo = this.repository();
		return d && repo && d.sha ? `https://github.com/${repo}/blob/${d.sha}/${d.path}` : null;
	});
	private readonly box = viewChild<ElementRef<HTMLElement>>('box');
	private gap = -1;

	constructor() {
		effect(() => {
			const line = this.line();
			const box = this.box();
			if (line && box && this.rows().length) queueMicrotask(() => this.show(line.n));
		});
	}

	/** Brings a line into view and flashes it. */
	show(line: number): void {
		const box = this.box()?.nativeElement;
		const el = box?.querySelector<HTMLElement>(`[data-ln="${line}"]`);
		if (!box || !el) return;
		box.scrollTop = Math.max(el.offsetTop - box.clientHeight * 0.3, 0);
		el.classList.remove('flash');
		void el.offsetWidth;
		el.classList.add('flash');
	}

	/** The next (1) or previous (-1) gap, round the file. */
	step(direction: 1 | -1): void {
		const d = this.data();
		if (!d?.gaps.length) return;
		this.gap = (this.gap + direction + d.gaps.length) % d.gaps.length;
		this.goTo.emit({ path: d.path, line: (d.gaps[this.gap] as { from: number }).from, tab: 'lines' });
	}

	/** A press on the gap strip: the line at that height. */
	protected stripAt(event: MouseEvent): void {
		const d = this.data();
		const strip = event.currentTarget as HTMLElement;
		const r = strip.getBoundingClientRect();
		if (!d || !r.height) return;
		const line = Math.min(
			d.lines.length,
			Math.max(1, Math.round(((event.clientY - r.top) / r.height) * d.lines.length)),
		);
		this.goTo.emit({ path: d.path, line, tab: 'lines' });
	}
}
