import type { SearchOutboxRepository } from '@saha-textile/core-domain';

/**
 * One dependency `/health/ready` reports.
 *
 * `required` decides whether a failure answers 503. Search is reported but not required: the
 * shop lists from Mongo when it is down, so pulling the API out of service would turn a degraded
 * shop into a dead one. A search that is down reads `degraded`, and a deploy accepts that.
 */
export interface ReadinessProbe {
	name: string;
	required: boolean;
	check(): Promise<{ up: boolean; detail: string }>;
}

/** Waiting search changes and the last nightly check, added to the search line. */
async function queueSummary(outbox: Pick<SearchOutboxRepository, 'stats' | 'lastCheck'> | null): Promise<string> {
	if (!outbox) return '';
	try {
		const [stats, check] = await Promise.all([outbox.stats(), outbox.lastCheck()]);
		const failing = stats.failing ? `, ${stats.failing} failing` : '';
		const last = check ? `last check ${check.checkedAt.toISOString()}` : 'no check yet';
		return `; ${stats.waiting} changes waiting${failing}; ${last}`;
	} catch {
		return '; change queue unreadable';
	}
}

export function readinessProbes(
	queue: { isReachable(): Promise<boolean> },
	search: { indexStatus(): Promise<{ up: boolean; detail: string }> },
	outbox: Pick<SearchOutboxRepository, 'stats' | 'lastCheck'> | null = null,
): ReadinessProbe[] {
	return [
		{
			name: 'redis',
			required: true,
			check: async () => {
				const up = await queue.isReachable();
				return { up, detail: up ? 'connected' : 'unreachable' };
			},
		},
		{
			name: 'search',
			required: false,
			check: async () => {
				const [status, summary] = await Promise.all([search.indexStatus(), queueSummary(outbox)]);
				return { up: status.up, detail: `${status.detail}${summary}` };
			},
		},
	];
}
