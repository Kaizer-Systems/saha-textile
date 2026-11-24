import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { checkHost } from './tls-check.js';

/** A stand-in TLS socket: each test says what the handshake gives, so nothing leaves this machine. */
const next = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'untrusted' | 'bare' | 'timeout' | 'error' }));
vi.mock('node:tls', () => ({
	connect: (_options: unknown, onSecure: () => void) => {
		const socket = Object.assign(new EventEmitter(), {
			authorized: next.mode === 'ok',
			authorizationError: undefined as unknown,
			getPeerCertificate: () =>
				next.mode === 'ok'
					? { issuer: { O: 'Example CA' }, valid_to: 'Jan  1 00:00:00 2027 GMT' }
					: next.mode === 'bare'
						? {}
						: { issuer: { CN: 'Self' } },
			end: vi.fn(),
			destroy: vi.fn(),
		});
		queueMicrotask(() => {
			if (next.mode === 'timeout') socket.emit('timeout');
			else if (next.mode === 'error') socket.emit('error', new Error('ECONNREFUSED'));
			else onSecure();
		});
		return socket;
	},
}));

describe('the direct TLS check', () => {
	it('reads the issuer and expiry, says an untrusted certificate is not ok, and gives up on silence or an error', async () => {
		next.mode = 'ok';
		expect(await checkHost('example.test')).toEqual({
			ok: true,
			issuer: 'Example CA',
			expiresOn: '2027-01-01T00:00:00.000Z',
			error: '',
		});
		next.mode = 'untrusted';
		expect(await checkHost('example.test')).toEqual({ ok: false, issuer: 'Self', expiresOn: null, error: '' });
		next.mode = 'bare';
		expect((await checkHost('example.test')).issuer).toBe('');
		next.mode = 'timeout';
		expect((await checkHost('example.test')).error).toBe('no answer within 8 s');
		next.mode = 'error';
		expect((await checkHost('example.test')).error).toBe('ECONNREFUSED');
	});
});
