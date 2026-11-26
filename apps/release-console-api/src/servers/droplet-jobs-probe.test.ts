import { describe, expect, it, vi } from 'vitest';

import { DropletJobs } from './droplet-jobs.js';

import type { ProjectsService } from '../projects/projects.service.js';
import type { RunnerClient } from '../runner/runner-client.js';
import type { ConsoleStore } from '../store/console-store.js';

/** A socket that never connects: its idle timer is the only thing that answers. */
vi.mock('node:net', () => ({
	Socket: class {
		destroy = vi.fn();
		once = vi.fn();
		connect = vi.fn();
		setTimeout(_ms: number, onTimeout: () => void): void {
			queueMicrotask(onTimeout);
		}
	},
}));

describe('the outside port check', () => {
	it('counts a port that never answers as closed', async () => {
		const jobs = new DropletJobs({} as ProjectsService, {} as ConsoleStore, {} as RunnerClient);
		await expect(jobs.deps.probe('203.0.113.9', 22)).resolves.toBe(false);
	});
});
