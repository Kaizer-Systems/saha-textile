import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerDeployScreen, runTitle, setupGaps } from './server-deploy-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { DeployRun, ServerDeployView } from '@saha-textile/release-console-contracts';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	view: { data: () => unknown; refetch: () => Promise<unknown> };
	blanks: { data: () => unknown; refetch: () => Promise<unknown> };
	reach: { data: () => unknown };
	branches: { data: () => unknown };
	pin: WritableSignal<string>;
	allowed: WritableSignal<string[]>;
	blankQuery: WritableSignal<string>;
	confirmText: WritableSignal<string>;
	cardPin: WritableSignal<string>;
	cardConfirm: WritableSignal<string>;
	pickedBranch: WritableSignal<string>;
	restartDb: WritableSignal<boolean>;
	message: () => string;
	busy: () => boolean;
	blankCount: () => number;
	placeName: () => string;
	offered: () => string[];
	neverShown: () => Array<{ name: string }>;
	effects: () => unknown;
	needsConfirm: () => boolean;
	rotateIds: () => string[];
	rotateRows: () => unknown[];
	running: () => boolean;
	title: () => string;
	progress: () => number;
	colour: () => string;
	events: () => Array<{ job: string; text: string; level: string }>;
	pinReady: () => boolean;
	lane: () => unknown[];
	allReachable(checks: Array<{ ok: boolean | null }>): boolean;
	hasFix(checks: Array<{ fix: string | null }>): boolean;
	recordedTag(d: ServerDeployView): string | null;
	fixOriginPulls(): Promise<void>;
	rollback(): Promise<void>;
	refusedLabel(names: string[]): string;
	rotateAgain(names: string[]): void;
	go(screen: string, tab: string): void;
	allowAll(): void;
	allow(name: string): void;
	unallow(name: string): void;
	picksBranch(target: string | null): boolean;
	refreshBranches(): Promise<void>;
	runs(d: ServerDeployView): unknown[];
	start(e: Event): Promise<void>;
	review(approve: boolean): Promise<void>;
}

const step = (name: string, status: string, conclusion: string | null, at: string | null) => ({
	name,
	status,
	conclusion,
	startedAt: at,
	completedAt: status === 'completed' ? at : null,
});
const run = (over: Partial<DeployRun> = {}): DeployRun =>
	({
		id: 42,
		url: 'https://github.test/run/42',
		branch: 'staging',
		commit: 'abc1234',
		status: 'in_progress',
		conclusion: null,
		createdAt: '2026-11-20T10:00:00Z',
		waiting: [],
		jobs: [
			{
				...step('CI / Checks', 'completed', 'success', '2026-11-20T10:01:00Z'),
				steps: [
					step('Lint', 'completed', 'success', '2026-11-20T10:00:30Z'),
					step('Skipped one', 'completed', 'skipped', '2026-11-20T10:00:40Z'),
					step('Not started', 'queued', null, null),
				],
			},
			{
				...step('Deploy to staging', 'in_progress', null, '2026-11-20T10:02:00Z'),
				steps: [
					step('Release', 'in_progress', null, '2026-11-20T10:02:10Z'),
					step('Health', 'completed', 'failure', '2026-11-20T10:02:20Z'),
				],
			},
			{ ...step('Publish / Publish images', 'completed', 'failure', '2026-11-20T10:01:30Z'), steps: [] },
			{ ...step('Roll back staging', 'completed', 'skipped', '2026-11-20T10:01:40Z'), steps: [] },
			{ ...step('Never ran', 'queued', null, null), steps: [] },
		],
		...over,
	}) as DeployRun;
const view = (over: Partial<ServerDeployView> = {}): ServerDeployView =>
	({
		environment: 'staging',
		target: 'staging',
		branch: 'staging',
		setup: { environmentExists: true, missingVariables: [], missingSecrets: [], workflowOnBranch: true },
		run: run(),
		recent: [],
		failure: null,
		tags: [{ name: 'staging-20261120-100500-abc12345', commit: 'abc1234', at: '2026-11-20T10:05:00Z' }],
		...over,
	}) as ServerDeployView;
const BLANKS = {
	project: 'saha-textile-staging',
	environment: 'staging',
	folders: [
		{
			folder: 'api',
			rows: [
				{ name: 'SMTP_PASS', state: 'empty', optional: false, requiredForRelease: true, mayDeployBlank: true },
				{
					name: 'MSG91_KEY',
					state: 'missing',
					optional: false,
					requiredForRelease: true,
					mayDeployBlank: true,
				},
				{ name: 'MONGODB_PASSWORD', state: 'empty', optional: false, requiredForRelease: true },
				{ name: 'SET_ONE', state: 'set', optional: false, requiredForRelease: true },
			],
		},
	],
};

function make(environment = 'staging', options: { answer?: unknown; ids?: boolean; pending?: string[] } = {}) {
	const api = {
		serverDeploy: vi.fn(async () => options.answer ?? { state: 'ok', data: view() }),
		secrets: vi.fn(async () => BLANKS as unknown),
		rotation: vi.fn(async () => ({ state: { pending: options.pending ?? [] } }) as unknown),
		reachable: vi.fn(async () => ({ checks: [] }) as unknown),
		repositoryBranches: vi.fn(async () => ({ defaultBranch: 'main', current: null, branches: [], note: '' })),
		startServerDeploy: vi.fn(async (..._args: unknown[]) => undefined),
		reviewServerDeploy: vi.fn(async () => undefined),
		fixReachable: vi.fn(async () => undefined),
	};
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => (options.ids === false ? null : 'proj_1'),
					repoId: () => (options.ids === false ? null : 'shop'),
					repo: () => ({
						sourceCode: { repository: 'own/shop' },
						environments: [
							{ name: 'staging', cloudId: 'do1' },
							{ name: 'development', cloudId: 'do1' },
						],
					}),
				},
			},
		],
	});
	TestBed.overrideComponent(ServerDeployScreen, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ServerDeployScreen);
	fixture.componentRef.setInput('environment', environment);
	fixture.detectChanges();
	const c = fixture.componentInstance as unknown as Screen;
	return { c, api, router, fixture };
}
const submit = () => ({ preventDefault: vi.fn() }) as unknown as Event;

afterEach(() => {
	vi.useRealTimers();
});

describe('server deploy: words', () => {
	it('names every setup gap', () => {
		expect(setupGaps(view())).toEqual([]);
		const gaps = setupGaps(
			view({
				setup: {
					environmentExists: false,
					missingVariables: ['A'],
					missingSecrets: null,
					workflowOnBranch: false,
				},
			}),
		);
		expect(gaps).toHaveLength(4);
		expect(gaps.join(' ')).toContain('cannot list');
		expect(
			setupGaps(
				view({
					setup: {
						environmentExists: true,
						missingVariables: null,
						missingSecrets: ['B'],
						workflowOnBranch: true,
					},
				}),
			),
		).toHaveLength(2);
	});

	it('words a run in one word', () => {
		expect(runTitle(null)).toBe('No deploy yet');
		expect(runTitle(run({ waiting: [1] }))).toBe('Waiting for you');
		expect(runTitle(run({ status: 'queued' }))).toBe('Queued');
		expect(runTitle(run())).toBe('Deploying');
		expect(runTitle(run({ status: 'completed', conclusion: 'success' }))).toBe('Live');
		expect(runTitle(run({ status: 'completed', conclusion: 'cancelled' }))).toBe('Cancelled');
		expect(runTitle(run({ status: 'completed', conclusion: 'failure' }))).toBe('Failed');
	});
});

describe('server deploy: the screen', () => {
	it('follows a running deploy: its steps newest first, its progress and colour', async () => {
		const { c } = make();
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		expect(c.running()).toBe(true);
		expect(c.title()).toBe('Deploying');
		expect(c.colour()).toBe('#5ed6ff');
		expect(c.progress()).toBeGreaterThanOrEqual(0);
		const events = c.events();
		expect(events[0]).toMatchObject({ job: 'deploy', text: 'Health: failure', level: 'err' });
		expect(events.map((e) => e.text)).toContain('Release…');
		expect(events.map((e) => e.text)).toContain('Deploy to staging…');
		expect(events.map((e) => e.text)).toContain('Publish / Publish images: failure');
		expect(events.map((e) => e.text)).not.toContain('Skipped one: skipped');
		expect(events.find((e) => e.text === 'Lint: success')?.level).toBe('');
		expect(events.find((e) => e.text === 'CI / Checks: success')?.level).toBe('dim');
		expect(c.lane().length).toBeGreaterThan(0);
	});

	it('colours a live, a failed and a cancelled run, and shows nothing for none', async () => {
		const live = make('staging', {
			answer: { state: 'ok', data: view({ run: run({ status: 'completed', conclusion: 'success' }) }) },
		});
		await vi.waitFor(() => expect(live.c.title()).toBe('Live'));
		expect(live.c.colour()).toBe('#5dffa8');
		await vi.waitFor(() => expect(live.api.reachable).toHaveBeenCalledWith('proj_1', 'shop', 'do1', 'staging'));
		const failed = make('staging', {
			answer: { state: 'ok', data: view({ run: run({ status: 'completed', conclusion: 'failure' }) }) },
		});
		await vi.waitFor(() => expect(failed.c.colour()).toBe('#ff5d5d'));
		const none = make('staging', { answer: { state: 'ok', data: view({ run: null }) } });
		await vi.waitFor(() => expect(none.c.view.data()).toBeTruthy());
		expect(none.c.events()).toEqual([]);
		expect(none.c.running()).toBe(false);
		const refused = make('staging', { answer: { state: 'failed', message: 'down' } });
		await vi.waitFor(() => expect(refused.c.view.data()).toBeTruthy());
		expect(refused.c.title()).toBe('No deploy yet');
		expect(refused.c.needsConfirm()).toBe(false);
	});

	it('lists required blanks, lets /api names stay blank together, and says what stops working', async () => {
		const { c } = make();
		expect(c.placeName()).toBe('staging');
		await vi.waitFor(() => expect(c.blanks.data()).toBeTruthy());
		expect(c.placeName()).toBe('saha-textile-staging · staging');
		expect(c.blankCount()).toBeGreaterThan(0);
		const offered = c.offered();
		expect(offered.length).toBeGreaterThan(0);
		expect(c.neverShown().map((x) => x.name)).toContain('MONGODB_PASSWORD');
		c.blankQuery.set('zzz');
		expect(c.offered()).toEqual([]);
		expect(c.neverShown()).toEqual([]);
		c.blankQuery.set('');
		c.allow(offered[0] as string);
		expect(c.allowed()).toContain(offered[0]);
		c.unallow(offered[0] as string);
		expect(c.allowed()).toEqual([]);
		c.allowAll();
		expect(c.allowed().length).toBe(offered.length);
		expect(c.effects()).toBeTruthy();
	});

	it('asks for the environment typed before a rotation, or before production with blanks allowed', async () => {
		const rotating = make('staging', { pending: ['keyfile'] });
		await vi.waitFor(() => expect(rotating.c.rotateIds()).toEqual(['keyfile']));
		await vi.waitFor(() => expect(rotating.c.view.data()).toBeTruthy());
		expect(rotating.c.rotateRows().length).toBeGreaterThan(0);
		expect(rotating.c.needsConfirm()).toBe(true);
		rotating.c.confirmText.set(' staging ');
		expect(rotating.c.needsConfirm()).toBe(false);
		const production = make('production', { answer: { state: 'ok', data: view({ target: 'production' }) } });
		await vi.waitFor(() => expect(production.c.view.data()).toBeTruthy());
		expect(production.c.needsConfirm()).toBe(false);
		production.c.allowed.set(['SMTP_PASS']);
		expect(production.c.needsConfirm()).toBe(true);
	});

	it('reads the reachable checks, and finds the release tag the newest successful run made', () => {
		const { c } = make();
		expect(c.allReachable([{ ok: true }, { ok: true }])).toBe(true);
		expect(c.allReachable([{ ok: true }, { ok: null }])).toBe(false);
		expect(c.hasFix([{ fix: 'origin-pulls' }])).toBe(true);
		expect(c.hasFix([{ fix: null }])).toBe(false);
		expect(c.recordedTag(view({ run: null }))).toBeNull();
		expect(c.recordedTag(view())).toBeNull();
		const done = view({ run: run({ status: 'completed', conclusion: 'success' }) });
		expect(c.recordedTag(done)).toBe('staging-20261120-100500-abc12345');
		expect(c.recordedTag({ ...done, tags: [] })).toBeNull();
		expect(c.runs(done)).toHaveLength(1);
		expect(c.runs(view({ run: null }))).toEqual([]);
	});

	it('words refused data files, ticks them for a deploy with rotation, and opens another screen', () => {
		const { c, router } = make();
		expect(c.refusedLabel(['redis-password', 'mongo-keyfile', 'other'])).toBe(
			'Redis password, database keyfile, other',
		);
		c.rotateAgain(['mongo-keyfile', 'not-a-file']);
		expect(c.rotateIds()).toEqual(['keyfile']);
		expect(c.message()).toBe('Type staging and your PIN, then Deploy and rotate.');
		c.go('secrets', 'matrix');
		expect(router.navigate).toHaveBeenCalledWith(['/p', 'proj_1', 'r', 'shop', 'secrets'], {
			queryParams: { tab: 'matrix' },
		});
	});

	it('picks a branch only for a development server, and reads branches again on request', async () => {
		const { c, api } = make('development', { answer: { state: 'ok', data: view({ target: 'development' }) } });
		expect(c.picksBranch(null)).toBe(false);
		expect(c.picksBranch('staging')).toBe(false);
		expect(c.picksBranch('development')).toBe(true);
		await vi.waitFor(() => expect(c.branches.data()).toBeTruthy());
		await c.refreshBranches();
		expect(api.repositoryBranches).toHaveBeenLastCalledWith('own/shop', true);
	});

	it('starts a deploy with what was chosen, rotates what waits, and reads the view again shortly after', async () => {
		const { c, api } = make('staging', { pending: ['keyfile'] });
		await vi.waitFor(() => expect(c.rotateIds()).toEqual(['keyfile']));
		vi.useFakeTimers();
		c.pin.set('123456');
		expect(c.pinReady()).toBe(true);
		c.confirmText.set('staging');
		c.pickedBranch.set('feature');
		c.restartDb.set(true);
		c.allowed.set(['SMTP_PASS']);
		await c.start(submit());
		expect(api.startServerDeploy).toHaveBeenCalledWith(
			'proj_1',
			'shop',
			'staging',
			'123456',
			['SMTP_PASS'],
			'staging',
			'feature',
			{
				rotate: true,
				restartDatabase: true,
			},
		);
		expect(c.message()).toContain('Started.');
		const before = api.serverDeploy.mock.calls.length;
		await vi.advanceTimersByTimeAsync(3000);
		vi.useRealTimers();
		await vi.waitFor(() => expect(api.serverDeploy.mock.calls.length).toBeGreaterThan(before));
		api.startServerDeploy.mockRejectedValueOnce(new Error('PIN refused'));
		await c.start(submit());
		expect(c.message()).toBe('PIN refused');
	});

	it('starts a plain deploy with nothing extra, and reviews only a run that exists', async () => {
		const none = make('staging', { answer: { state: 'ok', data: view({ run: null }) } });
		await vi.waitFor(() => expect(none.c.view.data()).toBeTruthy());
		await none.c.review(true);
		expect(none.api.reviewServerDeploy).not.toHaveBeenCalled();
		await none.c.start(submit());
		expect(none.api.startServerDeploy).toHaveBeenCalledWith(
			'proj_1',
			'shop',
			'staging',
			'',
			[],
			undefined,
			undefined,
			{},
		);
		const { c, api } = make();
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		c.pin.set('123456');
		await c.review(true);
		expect(api.reviewServerDeploy).toHaveBeenCalledWith('proj_1', 'shop', 'staging', {
			pin: '123456',
			runId: 42,
			approve: true,
		});
		expect(c.message()).toBe('Approved: the deploy job starts now.');
		await c.review(false);
		expect(c.message()).toBe('Rejected: nothing reaches the server.');
	});

	it('turns origin pulls back on and rolls back, with or without the typed name', async () => {
		const { c, api } = make();
		c.cardPin.set('123456');
		await c.fixOriginPulls();
		expect(api.fixReachable).toHaveBeenCalledWith('proj_1', 'shop', 'do1', 'staging', '123456');
		expect(c.message()).toBe('Origin pulls are on again for every host.');
		await c.rollback();
		expect(api.startServerDeploy).toHaveBeenLastCalledWith(
			'proj_1',
			'shop',
			'staging',
			'123456',
			[],
			undefined,
			undefined,
			{
				action: 'rollback',
			},
		);
		c.cardConfirm.set(' staging ');
		await c.rollback();
		expect(api.startServerDeploy.mock.calls.at(-1)?.[5]).toBe('staging');
	});

	it('asks nothing without a project or repository, and sends empty ids when told to act anyway', async () => {
		const { c, api } = make('staging', { ids: false });
		expect(api.serverDeploy).not.toHaveBeenCalled();
		expect(api.secrets).not.toHaveBeenCalled();
		await c.start(submit());
		expect(api.startServerDeploy).toHaveBeenCalledWith('', '', 'staging', '', [], undefined, undefined, {});
		await c.fixOriginPulls();
		expect(api.fixReachable).toHaveBeenCalledWith('', '', 'do1', 'staging', '');
		await c.rollback();
		expect(c.busy()).toBe(false);
		// Asked anyway (a refresh ignores the switch-off), the view and the blanks go out with empty ids.
		await c.view.refetch();
		await c.blanks.refetch();
		expect(api.serverDeploy).toHaveBeenCalledWith('', '', 'staging');
		expect(api.secrets).toHaveBeenCalledWith({ projectId: '', repositoryId: '', environment: 'staging' });
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		await c.review(true);
		expect(api.reviewServerDeploy).toHaveBeenCalledWith(
			'',
			'',
			'staging',
			expect.objectContaining({ approve: true }),
		);
	});

	it('shows no progress when every row of a finished run was skipped', async () => {
		const { c } = make('staging', {
			answer: { state: 'ok', data: view({ run: run({ status: 'completed', conclusion: 'success', jobs: [] }) }) },
		});
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		expect(c.progress()).toBe(0);
	});
});
