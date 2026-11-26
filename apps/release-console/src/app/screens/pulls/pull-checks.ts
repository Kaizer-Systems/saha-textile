import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { checkIcon, tookSaid } from './pull-view';
import { ConsoleApi } from '../../data/console-api';
import { ConsoleContext } from '../../data/console-context';
import { Loading } from '../../shared/loading';

import type { PullCheck, PullPage } from '@saha-textile/release-console-contracts';

/**
 * The Checks tab: every check on the newest commit, and a failed GitHub Actions check's log right here (its last
 * 200 lines, errors red). A check from another tool links to that tool.
 */
@Component({
	selector: 'rc-pull-checks',
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let p = pull();
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">Checks on {{ p.headSha.slice(0, 8) }} · {{ p.checkList.length }}</span>
				@if (p.checks.failed && p.state === 'open') {
					<button
						type="button"
						class="rc-btn ghost"
						(click)="again.emit()"
					>
						Run failed checks again
					</button>
				}
			</div>
			<div class="rc-checks">
				@for (c of p.checkList; track c.id) {
					@let i = icon(c.status);
					<div class="rc-check">
						<span [class]="i.tone">{{ i.text }}</span>
						@if (c.status === 'failed' && c.actionsJob) {
							<button
								type="button"
								class="rc-btn ghost"
								(click)="show(c)"
							>
								{{ c.name }} · open its log
							</button>
						} @else {
							<b>{{ c.name }}</b>
						}
						<span class="rc-mono muted">
							{{ c.app }} ·
							<span [class]="c.completedAt ? '' : 'amber'">{{ took(c) }}</span>
							@if (!c.actionsJob && c.url) {
								·
								<a
									[href]="c.url"
									target="_blank"
									rel="noopener"
								>
									open on {{ c.app }} ↗
								</a>
							}
						</span>
					</div>
				} @empty {
					<p class="rc-note">No checks ran on this commit.</p>
				}
			</div>
		</div>
		@if (openCheck(); as c) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">Log of {{ c.name }} · last 200 lines, errors red</span>
					<a
						class="rc-mono"
						[href]="c.url"
						target="_blank"
						rel="noopener"
					>
						GitHub ↗
					</a>
				</div>
				@if (log.isPending()) {
					<rc-loading what="Reading the log from GitHub…" />
				} @else if (lines(); as ls) {
					<div class="rc-log">
						@for (l of ls; track l.n) {
							<div
								class="l"
								[class.err]="l.bad"
							>
								<span class="n">{{ l.n || '' }}</span>
								<span class="m">{{ l.text }}</span>
							</div>
						}
					</div>
				} @else {
					<p class="rc-note">{{ logError() }}</p>
				}
			</div>
		}
	`,
})
export class PullChecksTab {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	readonly pull = input.required<PullPage>();
	readonly again = output<void>();
	protected readonly icon = checkIcon;
	protected readonly took = (c: PullCheck) => tookSaid(c);

	readonly open = toSignal(
		inject(ActivatedRoute).queryParamMap.pipe(map((q) => (q.get('check') ? Number(q.get('check')) : null))),
		{ initialValue: null },
	);
	readonly openCheck = computed(
		() => this.pull().checkList.find((c) => c.id === this.open() && c.actionsJob) ?? null,
	);
	readonly log = injectQuery(() => ({
		queryKey: ['pull-log', this.ctx.projectId(), this.ctx.repoId(), this.openCheck()?.id],
		queryFn: () =>
			this.api.pullLog(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.pull().number,
				// The read is on only while a check is open.
				(this.openCheck() as PullCheck).id,
			),
		enabled: !!this.openCheck(),
	}));
	readonly lines = computed(() => {
		const a = this.log.data();
		return a?.state === 'ok' ? a.data.lines : null;
	});
	readonly logError = computed(() => {
		const a = this.log.data();
		return a && a.state !== 'ok' ? a.message : 'The console API is not answering.';
	});

	show(c: PullCheck): void {
		void this.router.navigate([], { queryParams: { check: c.id }, queryParamsHandling: 'merge' });
	}
}
