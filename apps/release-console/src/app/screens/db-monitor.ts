import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { Loading } from '../shared/loading';

/**
 * Watch › Database monitor on an environment that runs on a server (Release Path brief Q9, approved
 * 23 Nov): the server's figures, slow-query shapes with every value shown as "?", and index use,
 * read by observe.sh's `db-report` with the read-only monitor login. This Mac's tab reads the local
 * MongoDB as before.
 */
@Component({
	selector: 'rc-db-monitor',
	imports: [Loading],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (view.data(); as d) {
			@if ('error' in d) {
				<div class="rc-banner amber small">
					<span class="rc-dot amber"></span>
					<div>
						<b>{{ d.error }}</b>
						Set /infrastructure/mongo-monitor-password for {{ envLabel() }} (Run › Secrets › Rotate,
						Database monitor password), then Live deploy's Deploy and rotate.
					</div>
				</div>
			} @else {
				<div class="rc-g4">
					<div class="rc-stat">
						<small>Up</small>
						<b>{{ days(d.uptimeSeconds) }}</b>
					</div>
					<div class="rc-stat">
						<small>Data · storage</small>
						<b>{{ size(d.dataBytes) }}</b>
						<small>{{ size(d.storageBytes) }} on disk</small>
					</div>
					<div class="rc-stat">
						<small>Indexes</small>
						<b>{{ size(d.indexBytes) }}</b>
						<small>{{ d.collections }} collections</small>
					</div>
					<div class="rc-stat">
						<small>Operations since start</small>
						<b>{{ ops(d.opcounters) }}</b>
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">Slow queries · values shown as ?</span></div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>When</th>
									<th>Collection</th>
									<th>Shape</th>
									<th>ms</th>
									<th>Read · returned</th>
									<th>Plan</th>
								</tr>
							</thead>
							<tbody>
								@for (q of d.slowQueries; track $index) {
									<tr>
										<td class="rc-mono">{{ q.at }}</td>
										<td class="rc-mono">{{ q.ns }}</td>
										<td class="rc-mono">{{ q.op }} {{ q.shape }}</td>
										<td class="rc-mono">{{ q.millis }}</td>
										<td
											class="rc-mono"
											[class.amber]="q.examined > q.returned * 10 && q.examined > 100"
										>
											{{ q.examined }} · {{ q.returned }}
										</td>
										<td class="rc-mono">{{ q.plan }}</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="6">
											No slow queries recorded: they appear once the profiler is on for the shop's
											database.
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">Index use since the database started</span></div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Collection</th>
									<th>Index</th>
									<th>Uses</th>
								</tr>
							</thead>
							<tbody>
								@for (i of d.indexes; track i.collection + i.index) {
									<tr>
										<td class="rc-mono">{{ i.collection }}</td>
										<td class="rc-mono">{{ i.index }}</td>
										<td
											class="rc-mono"
											[class.amber]="i.ops === 0"
										>
											{{ i.ops === 0 ? 'never used' : i.ops }}
										</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="3">No index figures.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			}
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>The database report could not be read.</b>
					{{ view.error().message }}
				</div>
			</div>
		} @else {
			<rc-loading what="Reading the database report through the observer login…" />
		}
	`,
})
export class DbMonitorScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	private readonly envName = computed(() => this.state.environment());
	protected readonly envLabel = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.envName())?.label ?? this.envName(),
	);
	protected readonly view = injectQuery(() => ({
		queryKey: ['db-report', this.ctx.projectId(), this.ctx.repoId(), this.envName()],
		queryFn: () => this.api.dbReport(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.envName()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId() && !!this.envName(),
		staleTime: 60_000,
	}));
	protected size(bytes: number): string {
		return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
	}
	protected days(s: number): string {
		return s >= 86_400 ? `${Math.floor(s / 86_400)} d` : `${Math.floor(s / 3600)} h`;
	}
	protected ops(counters: Record<string, number>): string {
		return Object.values(counters)
			.reduce((a, b) => a + b, 0)
			.toLocaleString('en-IN');
	}
}
