import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';

import type { Repository } from '@saha-textile/release-console-contracts';

/** One kv row: the latest pipeline run of a repository, from its source-code vendor. */
@Component({
	selector: 'rc-repo-ci',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { style: 'display: contents' },
	template: `
		<div>
			<span>CI</span>
			<em
				[class.ok]="state() === 'passing'"
				[class.red]="state() === 'failed'"
				[class.amber]="state() === 'running'"
			>
				{{ state() }}
			</em>
		</div>
	`,
})
export class RepoCi {
	private readonly api = inject(ConsoleApi);
	readonly projectId = input.required<string>();
	readonly repo = input.required<Repository>();
	private readonly runs = injectQuery(() => ({
		queryKey: ['runs', this.projectId(), this.repo().id],
		queryFn: () => this.api.runs(this.projectId(), this.repo().id),
		staleTime: 60_000,
	}));
	protected readonly state = computed(() => {
		const a = this.runs.data();
		if (!a) return this.runs.isError() ? 'unknown' : 'reading…';
		if (a.state !== 'ok') return 'not connected';
		const latest = a.data[0];
		if (!latest) return 'no runs';
		if (latest.status !== 'completed') return 'running';
		return latest.conclusion === 'success'
			? 'passing'
			: latest.conclusion === 'failure'
				? 'failed'
				: (latest.conclusion ?? 'unknown');
	});
}
