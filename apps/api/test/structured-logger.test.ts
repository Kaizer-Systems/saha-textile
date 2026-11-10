import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestLogOptions } from '../src/bootstrap';
import { attachRequestContext, currentRequestId, runWithRequestId } from '../src/common/request-context';
import { JsonLogger, MaskingConsoleLogger, createAppLogger, logKind } from '../src/infra/structured-logger';

const EMAIL = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\w*])(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/;

const capture = () => {
	const lines: Array<Record<string, unknown>> = [];
	const logger = new JsonLogger(
		['fatal', 'error', 'warn', 'log'],
		(line) => lines.push(JSON.parse(line)),
		() => new Date(0),
	);
	return { logger, lines };
};

afterEach(() => vi.restoreAllMocks());

describe('JsonLogger', () => {
	it('writes one JSON line with time, level, kind, context and the request id', () => {
		const { logger, lines } = capture();
		runWithRequestId('req-123', () =>
			logger.warn('Search update waits in the queue for 2 product(s)', 'CatalogService'),
		);
		logger.log('started');
		expect(lines).toEqual([
			{
				time: '1970-01-01T00:00:00.000Z',
				level: 'warn',
				kind: 'system',
				context: 'CatalogService',
				reqId: 'req-123',
				msg: 'Search update waits in the queue for 2 product(s)',
			},
			{ time: '1970-01-01T00:00:00.000Z', level: 'info', kind: 'system', msg: 'started' },
		]);
	});

	it('keeps the stack of an error, whether given as text or as the error itself', () => {
		const { logger, lines } = capture();
		logger.error(
			'Checkout failed for riya@gmail.com',
			'Error: x\n    at CheckoutService.price (a.ts:1:1)',
			'CheckoutService',
		);
		logger.error(new Error('boom'), 'MediaWorker');
		logger.fatal({ status: 7 });
		expect(lines[0]).toMatchObject({
			level: 'error',
			kind: 'payment',
			msg: 'Checkout failed for r***@gmail.com',
			stack: expect.stringContaining('CheckoutService.price'),
		});
		expect(lines[1]).toMatchObject({ kind: 'job', msg: 'boom', stack: expect.stringContaining('Error: boom') });
		expect(lines[2]).toMatchObject({ level: 'fatal', msg: '{"status":7}' });
	});

	it('writes only the levels switched on', () => {
		const { logger, lines } = capture();
		logger.debug('hidden');
		logger.verbose('hidden');
		logger.setLogLevels(['debug', 'verbose']);
		logger.debug('shown');
		logger.verbose('shown too');
		logger.log('now hidden');
		expect(lines.map((line) => line['level'])).toEqual(['debug', 'trace']);
	});

	it('never leaves an email or a phone number in a line', () => {
		const { logger, lines } = capture();
		const messages = [
			'Sign-in code sent to priya.das@yahoo.co.in',
			'OTP for +91 98300 12345 failed: rate limited',
			'Customer 9830012345 changed their address',
			'Contact form from someone@example.com saved to Gmail',
			'Webhook body {"email":"a.b@c.com","phone":"9876543210"}',
		];
		for (const message of messages) logger.warn(message, 'AuthService');
		for (const line of lines) {
			expect(JSON.stringify(line)).not.toMatch(EMAIL);
			expect(JSON.stringify(line)).not.toMatch(PHONE);
		}
	});

	it('writes to standard output by default', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		new JsonLogger(['log']).log('to stdout');
		expect(String(write.mock.calls[0]?.[0])).toContain('"msg":"to stdout"');
	});
});

describe('log kinds and the logger choice', () => {
	it.each([
		[undefined, 'system'],
		['OtpService', 'security'],
		['CcavenueGateway', 'payment'],
		['ResilientListing', 'search'],
		['MongoTransactionManager', 'database'],
		['MediaWorker', 'job'],
		['ReleaseSteps', 'deploy'],
		['RouterExplorer', 'request'],
		['Bootstrap', 'system'],
	])('%s is %s', (context, kind) => {
		expect(logKind(context)).toBe(kind);
	});

	it('uses JSON in production, pretty lines elsewhere, and is silent in tests', () => {
		expect(createAppLogger({ nodeEnv: 'production', logLevel: 'info' })).toBeInstanceOf(JsonLogger);
		expect(createAppLogger({ nodeEnv: 'development', logLevel: 'info' })).toBeInstanceOf(MaskingConsoleLogger);
		expect(createAppLogger({ nodeEnv: 'development', logLevel: 'info', logFormat: 'json' })).toBeInstanceOf(
			JsonLogger,
		);
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		(createAppLogger({ nodeEnv: 'test', logLevel: 'info', logFormat: 'json' }) as JsonLogger).error('quiet');
		expect(write).not.toHaveBeenCalled();
	});

	it('masks and names the request in pretty lines too', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const logger = new MaskingConsoleLogger('Test');
		runWithRequestId('req-9', () => logger.log('code sent to riya@gmail.com'));
		logger.log('no request');
		const out = write.mock.calls.map((call) => String(call[0])).join('');
		expect(out).toContain('code sent to r***@gmail.com [req req-9]');
		expect(out).toContain('no request');
		expect(out).not.toContain('riya@gmail.com');
	});
});

describe('request context', () => {
	it('carries the request id through the rest of the request', () => {
		let hook: ((request: { id: string }, reply: unknown, done: () => void) => void) | undefined;
		attachRequestContext({ addHook: ((_name: string, fn: typeof hook) => (hook = fn)) as never });
		let seen: string | undefined;
		hook?.({ id: 'req-77' }, {}, () => {
			seen = currentRequestId();
		});
		expect(seen).toBe('req-77');
		expect(currentRequestId()).toBeUndefined();
	});
});

describe('request log options', () => {
	it('names levels, stamps ISO time, marks the kind, and masks the address', () => {
		const options = requestLogOptions({ nodeEnv: 'production', logLevel: 'info' });
		expect(options.level).toBe('info');
		expect(requestLogOptions({ nodeEnv: 'test', logLevel: 'info' }).level).toBe('silent');
		expect(options.timestamp()).toMatch(/^,"time":"\d{4}-\d\d-\d\dT/);
		expect(options.formatters.level('warn')).toEqual({ level: 'warn' });
		expect(options.mixin()).toEqual({ kind: 'request' });
		expect(
			options.serializers.req({
				method: 'GET',
				url: '/auth/verify?token=abc&email=r@x.com',
				hostname: 'api',
				ip: '1.2.3.4',
			}),
		).toEqual({
			method: 'GET',
			url: '/auth/verify?token=[masked]&email=r***@x.com',
			hostname: 'api',
			remoteAddress: '1.2.3.4',
		});
		expect(options.serializers.req({}).url).toBe('');
	});
});
