import { ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AuthRefusalReason } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SessionRefusal } from '../src/auth/session-refusal';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

/** Captures what the filter actually put on the wire. */
function render(exception: unknown): { status: number; body: Record<string, unknown> } {
	const sent: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
	const reply = {
		status(code: number) {
			sent.status = code;
			return this;
		},
		header() {
			return this;
		},
		send(body: Record<string, unknown>) {
			sent.body = body;
			return this;
		},
	};
	const host = {
		switchToHttp: () => ({
			getRequest: () => ({ id: 'req_test', method: 'GET', url: '/probe' }),
			getResponse: () => reply,
		}),
	} as unknown as ArgumentsHost;

	new HttpExceptionFilter().catch(exception, host);
	return sent;
}

const errorOf = (exception: unknown) => render(exception).body.error as Record<string, unknown>;

describe('session refusal reasons on the error envelope', () => {
	it('publishes the reason for a session-bound refusal', () => {
		const error = errorOf(new SessionRefusal('session_expired', 'Invalid or expired session'));

		expect(error.code).toBe('unauthorized');
		expect(error.reason).toBe('session_expired');
	});

	it('keeps the client-safe message rather than the refusal description', () => {
		const error = errorOf(new SessionRefusal('session_revoked', 'Session is no longer valid'));

		// The reason is the machine-readable half; the prose stays generic exactly as before,
		// so nothing about the session's internals reaches the page.
		expect(error.message).toBe('Authentication is required.');
		expect(JSON.stringify(error)).not.toContain('no longer valid');
	});

	it('carries every reason the contract allows, and nothing outside it', () => {
		for (const reason of AuthRefusalReason.options) {
			expect(errorOf(new SessionRefusal(reason, 'probe')).reason).toBe(reason);
		}
	});

	/**
	 * The security property this whole mechanism exists to preserve. A credential endpoint
	 * raises a plain `UnauthorizedException`; if a reason could attach to one of those, then
	 * "PIN locked" would become distinguishable from "wrong PIN" to an unauthenticated
	 * caller, which confirms a guessed account exists.
	 */
	it('never attaches a reason to a plain 401, whatever its message says', () => {
		for (const message of [
			'Invalid credentials',
			'PIN is temporarily locked; sign in with your password',
			'PIN use is suspended; sign in with your password to re-enable it',
			'Account not found',
			'session_expired',
		]) {
			const error = errorOf(new UnauthorizedException(message));
			expect(error.code).toBe('unauthorized');
			expect(error.reason).toBeUndefined();
			expect(Object.keys(error)).not.toContain('reason');
		}
	});

	it('never attaches a reason to other statuses', () => {
		expect(errorOf(new ForbiddenException('Insufficient role')).reason).toBeUndefined();
		expect(errorOf(new HttpException('nope', HttpStatus.CONFLICT)).reason).toBeUndefined();
		expect(errorOf(new Error('boom')).reason).toBeUndefined();
	});

	it('does not let a hand-rolled payload smuggle a reason in', () => {
		// Only the exception TYPE grants a reason. An exception whose body merely happens to
		// contain the word must not be trusted, or any handler could mint one.
		const smuggled = new UnauthorizedException({ reason: 'session_expired', message: 'nope' });

		expect(errorOf(smuggled).reason).toBeUndefined();
	});

	it('logs the real cause for a 500 without putting it on the wire', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const error = errorOf(new Error('driver exploded with connection string'));

		expect(error.message).toBe('Something went wrong.');
		expect(JSON.stringify(error)).not.toContain('connection string');
		spy.mockRestore();
	});
});
