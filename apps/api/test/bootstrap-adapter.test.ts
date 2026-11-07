import { describe, expect, it, vi } from 'vitest';

const adapters = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('node:fs', async (original) => ({
	...(await original<object>()),
	readFileSync: (path: string) => `contents of ${path}`,
}));
vi.mock('@nestjs/platform-fastify', async (original) => ({
	...(await original<object>()),
	FastifyAdapter: class {
		constructor(options: Record<string, unknown>) {
			adapters.push(options);
		}
	},
}));

import { buildAdapter } from '../src/bootstrap';

const config = (tls: Record<string, unknown>, trustProxy = false) =>
	({ tls, trustProxy, nodeEnv: 'test', logLevel: 'info' }) as never;

describe('buildAdapter', () => {
	it('serves TLS when both files are set', () => {
		buildAdapter(config({ certFile: 'cert.pem', keyFile: 'key.pem' }));
		expect(adapters.at(-1)?.['https']).toEqual({ key: 'contents of key.pem', cert: 'contents of cert.pem' });
	});

	it('honours a request id only from a trusted proxy', () => {
		buildAdapter(config({}, true));
		const trusted = adapters.at(-1) as { genReqId: (request: unknown) => string; https?: unknown };
		expect(trusted.https).toBeUndefined();
		expect(trusted.genReqId({ headers: { 'x-request-id': '9b2e4f7a-1c3d-4e5f-8a9b-0c1d2e3f4a5b' } })).toBe(
			'9b2e4f7a-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
		);
		buildAdapter(config({}, false));
		const direct = adapters.at(-1) as { genReqId: (request: unknown) => string };
		expect(direct.genReqId({ headers: { 'x-request-id': '9b2e4f7a-1c3d-4e5f-8a9b-0c1d2e3f4a5b' } })).not.toBe(
			'9b2e4f7a-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
		);
	});
});
