/**
 * Read-only counts of the background job queues, for the API's operations address (`/ops`) that the
 * Release Console reads (brief 26gq3NbcbBESea6abRtsa3, screen 8). Counts only: never a job's data.
 */
export interface QueueCounts {
	queue: string;
	waiting: number;
	active: number;
	delayed: number;
	failed: number;
	completed: number;
}

export interface QueueStatsPort {
	counts(): Promise<QueueCounts[]>;
}
