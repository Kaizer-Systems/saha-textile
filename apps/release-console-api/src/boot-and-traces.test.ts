import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalStackController } from './local-stack/local-stack.controller.js';
import { TracesController, TracingController } from './local/traces.controller.js';
import { HelperErrorFilter } from './runner/helper-error.filter.js';
import { HelperError, RunnerClient } from './runner/runner-client.js';

import type { ArgumentsHost } from '@nestjs/common';

/** The Nest app main.ts starts, answered locally. */
const nest = vi.hoisted(() => ({
	app: {
		enableCors: vi.fn(),
		enableShutdownHooks: vi.fn(),
		listen: vi.fn(async () => undefined),
	},
	logs: [] as string[],
}));
vi.mock('@nestjs/core', async (original) => ({
	...(await original<typeof import('@nestjs/core')>()),
	NestFactory: { create: vi.fn(async () => nest.app) },
}));
vi.mock('@nestjs/common', async (original) => {
	const real = await original<typeof import('@nestjs/common')>();
	class Logger extends real.Logger {
		override log(message: unknown) {
			nest.logs.push(String(message));
		}
	}
	return { ...real, Logger };
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('the Mac helper’s refusals', () => {
	it('reach the browser with their own status, or 503 when the status is not an error', () => {
		const sent: unknown[] = [];
		const reply = {
			status(code: number) {
				sent.push(code);
				return reply;
			},
			send(body: unknown) {
				sent.push(body);
			},
		};
		const host = { switchToHttp: () => ({ getResponse: () => reply }) } as unknown as ArgumentsHost;
		const filter = new HelperErrorFilter();
		filter.catch(new HelperError('Not found here.', 404), host);
		filter.catch(new HelperError('Helper down.', 0), host);
		expect(sent).toEqual([
			404,
			{ statusCode: 404, message: 'Not found here.' },
			503,
			{ statusCode: 0, message: 'Helper down.' },
		]);
	});
});

describe('the local stack controller', () => {
	it('reads services and readiness for the repository asked for, and refuses a bad name', async () => {
		const stack = {
			services: vi.fn(async (repo?: string) => ({ repo })),
			readiness: vi.fn(async (repo?: string) => ({ repo })),
		};
		const c = new LocalStackController(stack as never);
		expect(await c.services({ repo: 'shop' })).toEqual({ repo: 'shop' });
		expect(await c.readiness({})).toEqual({ repo: undefined });
		expect(() => c.services({ repo: 'Shop!' })).toThrow();
	});
});

/** One request's trace as the local store keeps it: an API span and a slow database span. */
const trace = (id: string, service: string, error = false, start = 1_700_000_000_000_000) => ({
	traceID: id,
	processes: { p1: { serviceName: service }, p2: { serviceName: 'mongodb' } },
	spans: [
		{
			traceID: id,
			spanID: `${id}-a`,
			operationName: 'GET /products',
			references: [],
			startTime: start,
			duration: 900_000,
			processID: 'p1',
			tags: error
				? [
						{ key: 'error', value: 'true' },
						{ key: 'http.response.status_code', value: 500 },
					]
				: [],
		},
		{
			traceID: id,
			spanID: `${id}-b`,
			operationName: 'find products',
			references: [{ refType: 'CHILD_OF', spanID: `${id}-a` }],
			startTime: start + 10_000,
			duration: 800_000,
			processID: 'p2',
			tags: [],
		},
	],
});

function helper(answers: Record<string, unknown>) {
	return vi.spyOn(RunnerClient.prototype, 'call').mockImplementation(async (_method: string, path: string) => {
		const key = Object.keys(answers).find((k) => path.startsWith(k));
		if (!key) throw new HelperError(`no answer for ${path}`, 404);
		const answer = answers[key];
		if (answer instanceof Error) throw answer;
		return answer as never;
	});
}

describe('traces on this Mac', () => {
	it('lists the slowest and the failed requests of the shop’s own services, with the map between them', async () => {
		helper({
			'/traces/services': { data: ['saha-textile-api', 'mongodb', 7] },
			'/traces/search?service=saha-textile-api': {
				data: [
					trace('aaaaaaaa', 'saha-textile-api'),
					trace('bbbbbbbb', 'saha-textile-api', true, 1_700_000_100_000_000),
					trace('cccccccc', 'saha-textile-api', true, 1_700_000_200_000_000),
					trace('aaaaaaaa', 'saha-textile-api'),
					{ spans: [] },
				],
			},
		});
		const c = new TracesController();
		const slowest = await c.list({});
		expect(slowest.state).toBe('ok');
		expect(slowest.traces).toHaveLength(3);
		expect(slowest.services).toEqual(['saha-textile-api', 'mongodb']);
		const errors = await c.list({ view: 'errors' });
		expect(errors.traces.map((t) => t.id)).toEqual(['cccccccc', 'bbbbbbbb']);
		await expect(c.list({ view: 'fastest' })).rejects.toThrow();
	});

	it('reads other services when none is the shop’s, says when tracing is off, and survives odd answers', async () => {
		helper({
			'/traces/services': { data: ['other-app'] },
			'/traces/search?service=other-app': { data: 'not a list' },
		});
		expect((await new TracesController().list({})).traces).toEqual([]);
		vi.restoreAllMocks();
		helper({ '/traces/services': { off: true, message: 'VictoriaTraces is off.' } });
		expect(await new TracesController().list({})).toMatchObject({
			state: 'off',
			message: 'VictoriaTraces is off.',
		});
		vi.restoreAllMocks();
		helper({ '/traces/services': { off: true } });
		expect((await new TracesController().list({})).message).toBe('');
		vi.restoreAllMocks();
		helper({ '/traces/services': {} });
		expect((await new TracesController().list({})).services).toEqual([]);
	});

	it('opens one trace with its Diagnose, and refuses a bad id, a stopped store or an unknown trace', async () => {
		helper({
			'/traces/trace?id=aaaaaaaa': { data: [trace('aaaaaaaa', 'saha-textile-api')] },
			'/traces/trace?id=cccccccc': { off: true },
			'/traces/trace?id=dddddddd': { off: true, message: 'Store stopped.' },
			'/traces/trace?id=eeeeeeee': { data: [] },
			'/traces/trace?id=ffffffff': { data: 'nothing' },
			'/traces/search?service=saha-textile-api': {
				data: [trace('aaaaaaaa', 'saha-textile-api'), trace('99999999', 'saha-textile-api')],
			},
		});
		const c = new TracesController();
		const one = await c.one('aaaaaaaa');
		expect(one.id).toBe('aaaaaaaa');
		expect(Array.isArray(one.diagnose)).toBe(true);
		await expect(c.one('not-hex')).rejects.toThrow('Not a trace id.');
		await expect(c.one('cccccccc')).rejects.toThrow('VictoriaTraces is not answering.');
		await expect(c.one('dddddddd')).rejects.toThrow('Store stopped.');
		await expect(c.one('eeeeeeee')).rejects.toThrow('No trace with that id');
		await expect(c.one('ffffffff')).rejects.toThrow('No trace with that id');
		vi.restoreAllMocks();
		helper({
			'/traces/trace?id=aaaaaaaa': { data: [trace('aaaaaaaa', 'saha-textile-api')] },
			'/traces/search': new HelperError('search down', 503),
		});
		expect((await new TracesController().one('aaaaaaaa')).id).toBe('aaaaaaaa');
	});

	it('reads the tracing switch, counting each app’s traces when the store runs', async () => {
		const raw = {
			docker: true,
			store: true,
			address: true,
			addressSince: '2026-11-24T00:00:00Z',
			stack: ['saha-textile-api'],
			outside: { api: { startedAt: null, vite: false }, storefront: null },
		};
		helper({
			'/tracing/state': raw,
			'/traces/search?service=saha-textile-api': { data: [1, 2] },
			'/traces/search?service=saha-textile-worker': { data: 'none' },
			'/traces/search?service=saha-textile-storefront': new HelperError('down', 503),
		});
		expect(await new TracingController().read()).toBeTruthy();
		vi.restoreAllMocks();
		helper({ '/tracing/state': { ...raw, store: false } });
		expect(await new TracingController().read()).toBeTruthy();
		vi.restoreAllMocks();
		helper({ '/tracing/state': { docker: 'yes' } });
		await expect(new TracingController().read()).rejects.toThrow('in a shape the console does not know');
	});
});

describe('the console API’s start', () => {
	it('listens on the Mac’s own address by default, and where the environment says otherwise', async () => {
		vi.resetModules();
		await import('./main.js');
		await vi.waitFor(() => expect(nest.app.listen).toHaveBeenCalledWith({ port: 4410, host: '127.0.0.1' }));
		expect(nest.app.enableCors).toHaveBeenCalledWith(
			expect.objectContaining({ origin: ['http://localhost:4400'] }),
		);
		expect(nest.logs.at(-1)).toBe('Release Console API on 127.0.0.1:4410');
		vi.stubEnv('CONSOLE_ORIGIN', 'http://console.example.test');
		vi.stubEnv('CONSOLE_API_PORT', '4999');
		vi.stubEnv('CONSOLE_HOST', '0.0.0.0');
		vi.stubEnv('CONSOLE_APP_DIR', '/app');
		vi.resetModules();
		await import('./main.js');
		await vi.waitFor(() => expect(nest.app.listen).toHaveBeenCalledWith({ port: 4999, host: '0.0.0.0' }));
		expect(nest.logs.at(-1)).toBe('Release Console app and API on 0.0.0.0:4999');
	});
});
