import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorResponse } from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { resolveClientIp, resolveRequestId } from '../src/common/request-context';
import { loadConfig } from '../src/config/app-config';

const config = (overrides: NodeJS.ProcessEnv = {}) =>
	loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ...overrides });

describe('resolveRequestId', () => {
	it('generates a fresh id when the proxy chain is not trusted', () => {
		expect(resolveRequestId('client-supplied-id-1234', false, 'generated')).toBe('generated');
	});

	it('honours a well-formed inbound id from a trusted proxy', () => {
		expect(resolveRequestId('edge-01HXYZ_abc-123', true, 'generated')).toBe('edge-01HXYZ_abc-123');
	});

	it('rejects malformed or hostile ids even when trusted', () => {
		for (const value of [
			'short',
			'has spaces in it',
			'inject\nnewline-into-logs',
			'x'.repeat(200),
			42,
			undefined,
		]) {
			expect(resolveRequestId(value, true, 'generated')).toBe('generated');
		}
	});

	it('takes the first value when the header is repeated', () => {
		expect(resolveRequestId(['first-value-1234', 'second-value'], true, 'generated')).toBe('first-value-1234');
	});
});

describe('resolveClientIp', () => {
	const request = (headers: Record<string, string | string[]>, ip = '10.0.0.1') =>
		({ headers, ip }) as unknown as FastifyRequest;

	it('ignores the client-IP header when the proxy chain is not trusted', () => {
		// Otherwise anyone could spoof an address and walk through the rate limiter.
		const spoofed = request({ 'cf-connecting-ip': '203.0.113.9' });
		expect(resolveClientIp(spoofed, config({ CLIENT_IP_HEADER: 'cf-connecting-ip' }))).toBe('10.0.0.1');
	});

	it('reads the configured header when the proxy chain is trusted', () => {
		const proxied = request({ 'cf-connecting-ip': '203.0.113.9' });
		expect(resolveClientIp(proxied, config({ TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'cf-connecting-ip' }))).toBe(
			'203.0.113.9',
		);
	});

	it('takes the left-most address from a comma-joined chain', () => {
		const chained = request({ 'cf-connecting-ip': '203.0.113.9, 70.41.3.18' });
		expect(resolveClientIp(chained, config({ TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'cf-connecting-ip' }))).toBe(
			'203.0.113.9',
		);
	});

	it('falls back to the socket address when the header is absent or blank', () => {
		const trusted = config({ TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'cf-connecting-ip' });
		expect(resolveClientIp(request({}), trusted)).toBe('10.0.0.1');
		expect(resolveClientIp(request({ 'cf-connecting-ip': '   ' }), trusted)).toBe('10.0.0.1');
	});
});

describe('HttpExceptionFilter', () => {
	const invoke = (exception: unknown) => {
		const send = vi.fn();
		const header = vi.fn().mockReturnValue({ send });
		const status = vi.fn().mockReturnValue({ header, send });
		const reply = { status } as unknown as FastifyReply;
		const request = { id: 'req_test_123', method: 'GET', url: '/catalog/products' } as unknown as FastifyRequest;

		const host = {
			switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
		} as never;

		new HttpExceptionFilter().catch(exception, host);

		const body = (send.mock.calls[0]?.[0] ?? header.mock.results[0]?.value?.send?.mock?.calls?.[0]?.[0]) as unknown;
		return { status: status.mock.calls[0]?.[0] as number, body };
	};

	it('maps a status onto the stable error envelope', () => {
		const { status, body } = invoke(new HttpException('Product not found: x', HttpStatus.NOT_FOUND));
		const parsed = ApiErrorResponse.parse(body);
		expect(status).toBe(404);
		expect(parsed.error.code).toBe('not_found');
		expect(parsed.error.requestId).toBe('req_test_123');
		expect(parsed.error.issues).toEqual([]);
	});

	it('never leaks the exception message to the client', () => {
		// The thrown text can name an internal id, a query, or a provider payload.
		const { body } = invoke(new HttpException('Product not found: prod_secret_internal_id', HttpStatus.NOT_FOUND));
		const parsed = ApiErrorResponse.parse(body);
		expect(parsed.error.message).toBe('The requested resource was not found.');
		expect(JSON.stringify(parsed)).not.toContain('prod_secret_internal_id');
	});

	it('never leaks an unexpected crash', () => {
		const { status, body } = invoke(new Error('MongoServerError: E11000 duplicate key on users.$email_1'));
		const parsed = ApiErrorResponse.parse(body);
		expect(status).toBe(500);
		expect(parsed.error.code).toBe('internal');
		expect(parsed.error.message).toBe('Something went wrong.');
		expect(JSON.stringify(parsed)).not.toContain('MongoServerError');
		expect(JSON.stringify(parsed)).not.toContain('E11000');
	});

	it('passes validation issues through — they describe the caller’s own input', () => {
		const { status, body } = invoke(
			new HttpException(
				{
					message: 'Validation failed',
					issues: [{ path: 'variations.0.priceINR', message: 'must be non-negative' }],
				},
				HttpStatus.BAD_REQUEST,
			),
		);
		const parsed = ApiErrorResponse.parse(body);
		expect(status).toBe(400);
		expect(parsed.error.code).toBe('validation_failed');
		expect(parsed.error.issues).toEqual([
			{ path: ['variations', '0', 'priceINR'], message: 'must be non-negative' },
		]);
	});

	it('maps rate limiting to its own code', () => {
		const { body } = invoke(new HttpException('too many', HttpStatus.TOO_MANY_REQUESTS));
		expect(ApiErrorResponse.parse(body).error.code).toBe('rate_limited');
	});
});
