/**
 * One dependency `/health/ready` reports.
 *
 * `required` decides whether a failure answers 503. Search is reported but not required: the
 * shop lists from Mongo when it is down, so pulling the API out of service would turn a degraded
 * shop into a dead one. A deploy still waits for every dependency to be up.
 */
export interface ReadinessProbe {
	name: string;
	required: boolean;
	check(): Promise<{ up: boolean; detail: string }>;
}

export function readinessProbes(
	queue: { isReachable(): Promise<boolean> },
	search: { indexStatus(): Promise<{ up: boolean; detail: string }> },
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
		{ name: 'search', required: false, check: () => search.indexStatus() },
	];
}
