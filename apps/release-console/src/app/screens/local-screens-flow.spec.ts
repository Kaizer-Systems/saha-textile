import { type Type, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { DeployScreen, HealthScreen, ServerScreen, TailScreen, readLogLine, stageLane } from './local-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { Job, JobLine } from '@saha-textile/release-console-contracts';

type Answers = Record<string, unknown>;

/** Builds one local screen against answers for the console API's calls it makes. */
function make<T>(type: Type<T>, answers: Answers, inputs: Record<string, unknown> = {}) {
	const api = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
		get: (target, key: string) => {
			target[key] ??= vi.fn(async () => {
				const answer = answers[key];
				return typeof answer === 'function' ? (answer as () => unknown)() : answer;
			});
			return target[key];
		},
	});
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repo: () => ({ sourceCode: { vendor: 'gitlab', repository: 'own/shop' }, environments: [] }),
				},
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Record<string, unknown>, api, fixture };
}
const call = <R>(c: Record<string, unknown>, name: string, ...args: unknown[]) =>
	(c[name] as (...a: unknown[]) => R).apply(c, args);
const read = <R>(c: Record<string, unknown>, name: string) => (c[name] as () => R)();
const container = (name: string, state: string, status: string) => ({ name, state, status, image: '', ports: [] });

describe('log lines', () => {
	it('reads debug and warning levels, and an edge request line without its method or time', () => {
		expect(readLogLine('2026-11-20T07:01:02Z {"level":"debug","msg":"tick"}').level).toBe('dim');
		expect(readLogLine('2026-11-20T07:01:02Z {"severity":"WARNING","message":"slow"}').level).toBe('warn');
		const notFound = readLogLine('2026-11-20T07:01:03Z {"uri":"/x","status":404}');
		expect(notFound).toMatchObject({ level: 'warn', message: ' /x → 404 · s' });
		expect(readLogLine('2026-11-20T07:01:03Z {"method":"GET","uri":"/x","status":200}').level).toBe('');
	});
});

describe('the pipeline lane', () => {
	const ev = (seq: number, event: Record<string, unknown>): JobLine => ({ seq, stream: 'out', text: '', event });
	it('marks a stage left half-way as running while the run runs, and stopped after', () => {
		const lines = [ev(1, { stage: 'checks', status: 'started' })];
		const running = stageLane({ status: 'running' } as Job, lines, {});
		expect(running.find((s) => s.stage === 'checks')).toMatchObject({ cls: 'run', time: 'running…' });
		const stopped = stageLane({ status: 'stopped' } as Job, lines, {});
		expect(stopped.find((s) => s.stage === 'checks')).toMatchObject({ cls: 'red', time: 'stopped' });
	});
});

describe('Run › Server (this Mac)', () => {
	it('names each chart’s icon, draws the history it read, and sums container figures with gaps', async () => {
		const series = [
			{ name: 'cpu', points: [[1, 12.5]] },
			{ name: 'mem_used', points: [[1, 2048]] },
		];
		const { c, api } = make(ServerScreen, {
			mac: { memory: { used: 1, total: 4 }, disk: { used: 1, total: 2 } },
			docker: { reachable: true, containers: [] },
			history: series,
		});
		expect(call(c, 'chartIcon', 'CPU')).toBe('tabler/cpu');
		expect(call(c, 'chartIcon', 'Memory')).toBe('tabler/device-sd-card');
		expect(call(c, 'chartIcon', 'Network out')).toBe('tabler/upload');
		expect(call(c, 'chartIcon', 'Network in')).toBe('tabler/download');
		await vi.waitFor(() => expect(read<Array<{ values: number[] }>>(c, 'charts')[0]?.values).toEqual([12.5]));
		expect(call(c, 'sum', [{ memoryBytes: 5 }, { cpuPercent: 3 }], 'memoryBytes')).toBe(5);
		(c['minutes'] as WritableSignal<number>).set(1440);
		await vi.waitFor(() => expect(api['history']).toHaveBeenCalledWith('mac', expect.any(Array), 1440));
	});
});

describe('Run › Logs', () => {
	const lines = [
		'2026-11-20T07:01:02Z {"level":"error","message":"Payment failed","context":"Orders","requestId":"0123456789abcdef0123456789abcdef"}',
		'2026-11-20T07:01:03Z {"level":"warn","message":"Slow order","context":"Orders"}',
		'2026-11-20T07:01:04Z {"level":"info","message":"Hello","context":"Shop"}',
	];
	it('opens the first container when none is an API, and filters by errors, words and request', async () => {
		const { c, api } = make(
			TailScreen,
			{ docker: { containers: [container('saha-textile-stack-mongo', 'running', 'Up')] }, logs: { lines } },
			{ mode: 'errors' },
		);
		await vi.waitFor(() => expect((c['container'] as WritableSignal<string>)()).toBe('saha-textile-stack-mongo'));
		await vi.waitFor(() => expect(read<unknown[]>(c, 'lines')).toHaveLength(3));
		expect(read<unknown[]>(c, 'shown')).toHaveLength(2);
		(c['find'] as WritableSignal<string>).set('payment');
		expect(read<unknown[]>(c, 'shown')).toHaveLength(1);
		(c['find'] as WritableSignal<string>).set('');
		(c['request'] as WritableSignal<string>).set('0123456789abcdef0123456789abcdef');
		expect(read<unknown[]>(c, 'shown')).toHaveLength(1);
		expect(api['logs']).toHaveBeenCalledWith('saha-textile-stack-mongo', 300, '');
	});

	it('reads once without following in another mode, and opens the API container first', async () => {
		const { c } = make(
			TailScreen,
			{
				docker: {
					containers: [
						container('saha-textile-stack-mongo', 'running', 'Up'),
						container('saha-textile-stack-api', 'running', 'Up'),
					],
				},
				logs: { lines },
			},
			{ mode: 'request' },
		);
		await vi.waitFor(() => expect((c['container'] as WritableSignal<string>)()).toBe('saha-textile-stack-api'));
		await vi.waitFor(() => expect(read<unknown[]>(c, 'shown')).toHaveLength(3));
	});
});

describe('Watch › Health (this Mac)', () => {
	const ok = { status: 200, body: { status: 'ok' } };
	it('sends Docker trouble when Docker does not answer', async () => {
		const { c } = make(HealthScreen, { docker: { reachable: false, containers: [] }, shopHealth: null });
		await vi.waitFor(() => expect(read(c, 'trouble')).toBe('docker'));
		expect(call(c, 'logo', 'Docker')).toBe('logos/docker-icon');
		expect(call(c, 'logo', 'mongo')).toBeTruthy();
	});

	it('says the stack is down when it has no containers, one has stopped, or its API answers badly', async () => {
		const empty = make(HealthScreen, {
			docker: { reachable: true, version: '27', containers: [] },
			shopHealth: null,
		});
		await vi.waitFor(() => expect(read(empty.c, 'trouble')).toBe('stack-down'));
		const stopped = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [container('saha-textile-stack-api', 'exited', 'Exited (1)')],
			},
			shopHealth: null,
		});
		await vi.waitFor(() => expect(read(stopped.c, 'trouble')).toBe('stack-down'));
		const failing = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [container('saha-textile-stack-api', 'running', 'Up')],
			},
			shopHealth: { dev: null, stack: { status: 500, body: 'down' }, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read(failing.c, 'trouble')).toBe('stack-down'));
		const noAnswer = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [container('saha-textile-stack-api', 'running', 'Up')],
			},
			shopHealth: { dev: null, stack: null, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read(noAnswer.c, 'trouble')).toBe('stack-down'));
		const noStatus = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [container('saha-textile-stack-api', 'running', 'Up')],
			},
			shopHealth: { dev: null, stack: { body: {} }, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read(noStatus.c, 'trouble')).toBe('stack-down'));
		expect(read<Array<{ state: string }>>(noStatus.c, 'tiles').map((t) => t.state)).toContain('not running');
		const healthy = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [container('saha-textile-stack-api', 'running', 'Up')],
			},
			shopHealth: { dev: ok, stack: ok, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read<unknown[]>(healthy.c, 'tiles').length).toBeGreaterThan(2));
		expect(read(healthy.c, 'trouble')).toBeNull();
	});

	it('colours each container and API tile by what it says', async () => {
		const { c } = make(HealthScreen, {
			docker: {
				reachable: true,
				version: '27',
				containers: [
					container('saha-textile-stack-api', 'running', 'Up (healthy)'),
					container('saha-textile-stack-mongo', 'running', 'Up (unhealthy)'),
					container('saha-textile-stack-redis', 'running', 'Up (health: starting)'),
					container('saha-textile-stack-meili', 'exited', 'Exited'),
				],
			},
			shopHealth: { dev: { status: 200, body: { status: 'degraded' } }, stack: { body: null }, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read<unknown[]>(c, 'tiles')).toHaveLength(7));
		const tiles = read<Array<{ name: string; state: string; cls: string }>>(c, 'tiles');
		expect(tiles.map((t) => t.cls)).toEqual(['g', 'g', 'r', 'a', 'r', 'a', 'r']);
		expect(tiles[6]?.state).toBe('answered undefined');
	});
});

describe('Run › Live deploy (this computer)', () => {
	const ev = (seq: number, event: Record<string, unknown>, stream: 'out' | 'err' = 'out'): JobLine => ({
		seq,
		stream,
		text: `line ${seq}`,
		event,
	});
	const job = (lines: JobLine[], over: Partial<Job> = {}): Job =>
		({
			id: 'j1',
			kind: 'pipeline',
			label: 'Local pipeline (only checks)',
			status: 'running',
			startedAt: '2026-11-20T10:00:00Z',
			lines,
			...over,
		}) as Job;

	it('names each system’s logo', () => {
		const { c } = make(DeployScreen, { jobs: [], helper: null, docker: null, shopHealth: null });
		expect(call(c, 'systemLogo', 'Mac helper')).toBe('simple-icons/apple');
		expect(call(c, 'systemLogo', 'Shop API · stack')).toBeTruthy();
		expect(call(c, 'systemLogo', 'Dev servers')).toBe('logos/nodejs-icon');
		expect(call(c, 'systemLogo', 'Mongo')).toBe('logos/docker-icon');
	});

	it('adds only a running job’s new lines, reads its plan from its label, and words its events', async () => {
		const first = job([ev(1, { stage: 'checks', status: 'started', time: '2026-11-20T10:00:01Z' })]);
		const second = job([
			ev(1, { stage: 'checks', status: 'started' }),
			ev(2, { step: 'Lint', time: '2026-11-20T10:00:02Z' }),
			ev(3, { note: 'halfway' }, 'err'),
		]);
		const third = job([]);
		const answers = [first, second, third];
		const { c } = make(DeployScreen, {
			jobs: [{ id: 'j1', status: 'running' }],
			job: () => answers.shift() ?? third,
			helper: { reachable: true, devServers: { storefront: true, admin: false } },
			docker: null,
			shopHealth: null,
		});
		await vi.waitFor(() => expect(read<unknown[]>(c, 'events')).toHaveLength(3));
		expect(read<Array<{ text: string }>>(c, 'events').map((e) => e.text)).toEqual(['started', 'Lint', 'halfway']);
		expect(read(c, 'busyServers')).toBe('storefront');
		expect(read<Array<{ cls: string }>>(c, 'laneView').filter((s) => s.cls !== 'skip')).toHaveLength(1);
		expect(read(c, 'progress')).toBe(0);
		expect(read(c, 'reactorColour')).toBe('#5ed6ff');
	});

	it('words finished stages with their reason and time, and colours a passed and a failed run', async () => {
		const passed = make(DeployScreen, {
			jobs: [{ id: 'j2', status: 'passed' }],
			job: job(
				[
					ev(1, { stage: 'proof', status: 'passed', seconds: 61.4 }),
					ev(2, { stage: 'checks', status: 'failed', reason: 'lint' }),
				],
				{ id: 'j2', status: 'passed', label: 'Local pipeline (from proof)' },
			),
			helper: null,
			docker: null,
			shopHealth: null,
		});
		await vi.waitFor(() => expect(read<unknown[]>(passed.c, 'events')).toHaveLength(2));
		expect(read<Array<{ text: string; level: string }>>(passed.c, 'events')).toEqual([
			expect.objectContaining({ text: 'passed in 61s', level: 'ok' }),
			expect.objectContaining({ text: 'failed · lint', level: 'err' }),
		]);
		expect(read(passed.c, 'reactorColour')).toBe('#5dffa8');
		const failed = make(DeployScreen, {
			jobs: [{ id: 'j3', status: 'failed' }],
			job: job([], { id: 'j3', status: 'failed', kind: 'stack', label: 'Start the stack' }),
			helper: null,
			docker: null,
			shopHealth: null,
		});
		await vi.waitFor(() => expect(read(failed.c, 'reactorColour')).toBe('#ff5d5d'));
	});
});

describe('Run › Live deploy: systems and actions', () => {
	const job = (over: Partial<Job> = {}): Job =>
		({
			id: 'j1',
			kind: 'pipeline',
			label: 'Local pipeline',
			status: 'running',
			startedAt: '',
			lines: [],
			...over,
		}) as Job;
	const stack = (state: string) => ({ name: 'saha-textile-stack-api', state, status: 'Up', image: '', ports: [] });

	it('words each system: helper, Docker, the stack, both shop APIs and busy dev servers', async () => {
		const { c } = make(DeployScreen, {
			jobs: [],
			helper: { reachable: true, devServers: { storefront: true } },
			docker: { reachable: true, version: '27', containers: [stack('running')] },
			shopHealth: {
				dev: { status: 503, body: 'down' },
				stack: { status: 200, body: { status: 'degraded' } },
				stackPort: 4000,
			},
		});
		await vi.waitFor(() => expect(read<unknown[]>(c, 'systems')[0]).toEqual(['Mac helper', 'answering', 'ok']));
		await vi.waitFor(() => expect(read<string[][]>(c, 'systems').map((r) => r[2])).toContain('amber'));
		const rows = read<string[][]>(c, 'systems');
		expect(rows.find((r) => r[0] === 'Stack containers')).toEqual(['Stack containers', '1 running of 1', 'ok']);
		expect(rows.find((r) => r[0] === 'Dev servers')?.[2]).toBe('amber');
		expect(rows.map((r) => r[1])).toEqual(expect.arrayContaining(['answered 503', 'degraded']));
		const quiet = make(DeployScreen, {
			jobs: [],
			helper: { reachable: false, devServers: {} },
			docker: { reachable: true, version: '27', containers: [stack('exited')] },
			shopHealth: { dev: { body: {} }, stack: { status: 200, body: {} }, stackPort: 4000 },
		});
		await vi.waitFor(() => expect(read<string[][]>(quiet.c, 'systems')[0]?.[1]).toBe('not answering'));
		await vi.waitFor(() => expect(read<string[][]>(quiet.c, 'systems').map((r) => r[1])).toContain('ok'));
		const quietRows = read<string[][]>(quiet.c, 'systems');
		expect(quietRows.find((r) => r[0] === 'Stack containers')?.[2]).toBe('amber');
		expect(quietRows.find((r) => r[0] === 'Dev servers')).toEqual(['Dev servers', 'none running', 'ok']);
		(quiet.c['plan'] as WritableSignal<object>).set({ only: 'nowhere' });
		expect(read(quiet.c, 'progress')).toBe(0);
	});

	it('picks up the first lines of a job that started with none', async () => {
		const answers = [job(), job({ lines: [{ seq: 1, stream: 'out', text: 'x', event: { note: 'first' } }] })];
		const { c } = make(DeployScreen, {
			jobs: [{ id: 'j1', status: 'running' }],
			job: () => answers.shift() ?? job(),
			helper: null,
			docker: null,
			shopHealth: null,
		});
		// The job is read again every two seconds.
		await vi.waitFor(() => expect(read<unknown[]>(c, 'events')).toHaveLength(1), { timeout: 5000 });
	});

	it('starts the pipeline with the PIN and a chosen branch, runs stack actions and stops the open job', async () => {
		const { c, api } = make(DeployScreen, {
			jobs: [{ id: 'j1', status: 'running' }],
			job: job(),
			runLocal: job({ id: 'j9', label: 'Local pipeline', status: 'running' }),
			stopJob: job({ status: 'stopping' }),
			helper: null,
			docker: null,
			shopHealth: null,
		});
		const form = document.createElement('form');
		const pin = Object.assign(document.createElement('input'), { type: 'password', value: '123456' });
		form.append(pin);
		(c['chosenBranch'] as WritableSignal<string>).set('feature');
		await call(c, 'start', { preventDefault: vi.fn(), target: form });
		expect(api['runLocal']).toHaveBeenCalledWith('pipeline', '123456', { from: 'proof', branch: 'feature' });
		expect(pin.value).toBe('');
		expect(read(c, 'message')).toBe('Local pipeline: running.');
		(c['chosenBranch'] as WritableSignal<string>).set('');
		await call(c, 'start', { preventDefault: vi.fn(), target: document.createElement('form') });
		expect(api['runLocal']).toHaveBeenLastCalledWith('pipeline', '', { from: 'proof' });
		await call(c, 'stackAction', 'stack-up', '123456');
		expect(api['runLocal']).toHaveBeenLastCalledWith('stack-up', '123456');
		await call(c, 'stop', '123456');
		expect(api['stopJob']).toHaveBeenCalledWith('j9', '123456');
		api['runLocal']?.mockRejectedValueOnce(new Error('PIN refused'));
		await call(c, 'stackAction', 'stack-up', '000000');
		expect(read(c, 'message')).toBe('PIN refused');
	});
});
