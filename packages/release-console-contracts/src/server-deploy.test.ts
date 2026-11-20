import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	type DeployRun,
	SERVER_LANE,
	serverLane,
	serverTargetOf,
	DEPLOY_SECRETS,
	DEPLOY_VARIABLES,
} from './server-deploy.js';

const workflow = readFileSync(join(process.cwd(), '../../.github/workflows/deploy.yml'), 'utf8');

const step = (name: string, conclusion: string | null = 'success', status = 'completed') => ({
	name,
	status,
	conclusion,
	startedAt: '2026-11-20T10:00:00Z',
	completedAt: conclusion ? '2026-11-20T10:00:30Z' : null,
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

describe('server deploys', () => {
	it('maps a server environment to its GitHub environment by name; a dev server has none yet', () => {
		expect(serverTargetOf('production')).toBe('production');
		expect(serverTargetOf('Staging')).toBe('staging');
		expect(serverTargetOf('dev-server')).toBeNull();
	});

	it('names only jobs, steps and settings deploy.yml really has', () => {
		for (const row of SERVER_LANE) {
			for (const s of row.steps) expect(workflow, s).toContain(`- name: ${s}\n`);
		}
		expect(workflow).toContain('name: Images for this commit');
		expect(workflow).toContain('name: Image digests');
		expect(workflow).toContain('name: Deploy to ${{ inputs.environment }}');
		expect(workflow).toContain('name: Publish\n');
		for (const v of DEPLOY_VARIABLES) expect(workflow).toContain(`vars.${v}`);
		for (const s of DEPLOY_SECRETS) expect(workflow).toContain(`secrets.${s}`);
	});

	it('draws the lane from a run, with the approval wait in its place', () => {
		expect(serverLane(null).every((r) => r.cls === 'wait')).toBe(true);
		const waiting = serverLane(
			run({
				waiting: [7],
				jobs: [
					{ ...step('Images for this commit'), steps: [] },
					{ ...step('Image digests'), steps: [] },
					{ ...step('Deploy to staging', null, 'waiting'), steps: [] },
				],
			}),
		);
		const by = Object.fromEntries(waiting.map((r) => [r.key, r]));
		expect(by['checks']?.cls).toBe('skip');
		expect(by['checks']?.time).toBe('images already published');
		expect(by['images']).toMatchObject({ cls: 'ok', time: '30s' });
		expect(by['approval']).toMatchObject({ cls: 'run', time: 'waiting for you' });
		expect(by['release']?.cls).toBe('wait');
	});

	it('marks a failed step red and the rest not reached once the run ends', () => {
		const lane = serverLane(
			run({
				status: 'completed',
				conclusion: 'failure',
				jobs: [
					{ ...step('Images for this commit'), steps: [] },
					{ ...step('Image digests'), steps: [] },
					{
						...step('Deploy to production', 'failure'),
						steps: [
							step('Check this environment is set up', 'failure'),
							step('Install the Infisical CLI', 'skipped'),
						],
					},
				],
			}),
		);
		const by = Object.fromEntries(lane.map((r) => [r.key, r]));
		expect(by['approval']?.cls).toBe('ok');
		expect(by['release']?.cls).toBe('red');
		expect(by['health']).toMatchObject({ cls: 'skip', time: 'not reached' });
	});
});
