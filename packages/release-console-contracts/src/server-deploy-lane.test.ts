import { describe, expect, it } from 'vitest';

import { type DeployRun, deployFailureOf, releaseTagTime, serverLane } from './server-deploy.js';

const part = (name: string, conclusion: string | null = 'success', status = 'completed') => ({
	name,
	status,
	conclusion,
	startedAt: '2026-11-20T10:00:00Z',
	completedAt: conclusion ? '2026-11-20T10:01:05Z' : null,
});
const job = (
	name: string,
	conclusion: string | null = 'success',
	status = 'completed',
	steps = [] as ReturnType<typeof part>[],
) => ({
	...part(name, conclusion, status),
	steps,
});
const run = (over: Partial<DeployRun> = {}): DeployRun => ({
	id: 1,
	url: 'https://github.com/x/y/actions/runs/1',
	branch: 'staging',
	commit: 'abc1234',
	status: 'in_progress',
	conclusion: null,
	createdAt: '2026-11-20T10:00:00Z',
	waiting: [],
	jobs: [],
	...over,
});
const rows = (lane: ReturnType<typeof serverLane>) => Object.fromEntries(lane.map((row) => [row.key, row]));

describe('the deploy lane in its other states', () => {
	it('a run that ended before approval: publishing counts for the images, cancelled and skipped rows say so', () => {
		const by = rows(
			serverLane(
				run({
					status: 'completed',
					conclusion: 'cancelled',
					jobs: [
						job('Publish / CI'),
						job('Publish / Production stack proof', 'skipped'),
						job('Images for this commit', 'failure'),
						job('Publish / Publish images'),
						job('Image digests', 'cancelled'),
					],
				}),
			),
		);
		expect(by['checks']).toMatchObject({ cls: 'ok', time: '1m 5s' });
		expect(by['proof']).toMatchObject({ cls: 'skip', time: 'skipped' });
		// The lookup before CI failed, but this run published the images itself; only the digests were cancelled.
		expect(by['images']).toMatchObject({ cls: 'red', time: 'cancelled' });
		expect(by['approval']).toMatchObject({ cls: 'skip', time: 'not reached' });
	});

	it('a run still going: running, waiting and queued rows', () => {
		const by = rows(
			serverLane(
				run({
					jobs: [
						job('Publish / CI', null, 'in_progress'),
						job('Deploy to staging', null, 'queued', [part('Install the Infisical CLI', null, 'queued')]),
					],
				}),
			),
		);
		expect(by['checks']).toMatchObject({ cls: 'run', time: 'running…' });
		expect(by['proof']).toMatchObject({ cls: 'wait', time: '' });
		expect(by['approval']).toMatchObject({ cls: 'wait', time: '' });
		expect(by['release']).toMatchObject({ cls: 'wait', time: '' });
	});

	it('a finished step with no times shows no time', () => {
		const untimed = { ...job('Publish / CI'), startedAt: null, completedAt: null };
		const by = rows(serverLane(run({ status: 'completed', conclusion: 'success', jobs: [untimed] })));
		expect(by['checks']).toMatchObject({ cls: 'ok', time: '' });
	});
});

describe('reading a failed deploy', () => {
	it('names the refused values up to the end of the sentence, and a failed release step with its message', () => {
		expect(
			deployFailureOf([
				'FAILED: This release changes secrets the database, Redis or search already run with: redis-password and mongo-app-password. Nothing changed.',
			]),
		).toMatchObject({ kind: 'refused-secrets', names: ['redis-password', 'mongo-app-password'] });
		expect(deployFailureOf(['✗ indexes: a unique index met duplicate rows: customers.email (412 ms)'])).toEqual({
			kind: 'release-step',
			step: 'indexes',
			message: 'a unique index met duplicate rows: customers.email',
			names: [],
		});
	});

	it('reads a release tag’s time, and nothing from another tag', () => {
		expect(releaseTagTime('staging-20261123-142210-08ac015c')).toBe('2026-11-23T14:22:10Z');
		expect(releaseTagTime('v1.2.3')).toBeNull();
	});
});
