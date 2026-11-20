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
	BLANK_TOGETHER,
	NEVER_BLANK_PATTERN,
	neverBlankReason,
	startServerDeploySchema,
} from './server-deploy.js';

const workflow = readFileSync(join(process.cwd(), '../../.github/workflows/deploy.yml'), 'utf8');
/** Names tagged `may-deploy-blank` in the release's required list (Infisical chat's file). */
const mayDeployBlank = readFileSync(join(process.cwd(), '../../docker/production/required-secrets.txt'), 'utf8')
	.split('\n')
	.map((line) => line.trim().split(/\s+/))
	.filter(([name, ...tags]) => name && !name.startsWith('#') && tags.includes('may-deploy-blank'))
	.map(([name]) => name);

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
	it('maps a server environment to its GitHub environment by name, a dev server included', () => {
		expect(serverTargetOf('production')).toBe('production');
		expect(serverTargetOf('Staging')).toBe('staging');
		expect(serverTargetOf('dev-server')).toBe('development');
		expect(serverTargetOf('qa')).toBeNull();
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
	it('never lets the database, Redis, search or API start-up values deploy blank (screen 12)', () => {
		expect(neverBlankReason('MONGODB_PASSWORD')).toBe('the database will not start');
		expect(neverBlankReason('REDIS_PASSWORD')).toBe('Redis will not start');
		expect(neverBlankReason('MEILISEARCH_HOST')).toBe('search will not start');
		expect(neverBlankReason('JWT_ACCESS_SECRET')).toBe('the API will not start');
		expect(neverBlankReason('PORTAL_X')).toBeNull();
		expect(neverBlankReason('MSG91_AUTH_KEY')).toBeNull();
		expect(neverBlankReason('CCAVENUE_WORKING_KEY')).toBeNull();
		const ok = startServerDeploySchema.safeParse({ pin: '482913', allowBlank: ['MSG91_AUTH_KEY'] });
		expect(ok.success).toBe(true);
		expect(startServerDeploySchema.safeParse({ pin: '482913', allowBlank: ['MONGODB_PASSWORD'] }).success).toBe(
			false,
		);
		expect(startServerDeploySchema.safeParse({ pin: '482913', allowBlank: ['msg;id'] }).success).toBe(false);
	});

	it('deploy.yml takes allow_blank and checks the same never-blank rule', () => {
		expect(workflow).toContain('      allow_blank:\n');
		expect(workflow).toContain(`NEVER_BLANK: '${NEVER_BLANK_PATTERN}'`);
		expect(workflow).toContain('flags+=(--allow-blank "$name")');
		expect(workflow).toContain('if ($i == "may-deploy-blank") found = 1');
	});

	it('keeps the Spaces keys that go together in step with required-secrets.txt (no drift)', () => {
		const spaces = mayDeployBlank.filter((n) => n.startsWith('SPACES_')).sort();
		expect([...BLANK_TOGETHER[0]].sort()).toEqual(spaces);
		for (const group of BLANK_TOGETHER) for (const n of group) expect(mayDeployBlank).toContain(n);
	});
});
