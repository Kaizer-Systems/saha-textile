import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { codedRefusal, staleSaveRefusal } from '../src/common/coded-refusal';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

/** What the filter actually puts on the wire. */
function render(exception: unknown): { status: number; error: Record<string, unknown> } {
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
			getRequest: () => ({ id: 'req_test', method: 'POST', url: '/admin/fx/settings' }),
			getResponse: () => reply,
		}),
	} as unknown as ArgumentsHost;
	new HttpExceptionFilter().catch(exception, host);
	return { status: sent.status, error: sent.body.error as Record<string, unknown> };
}

describe('coded refusals reach the admin (shipping rules brief: stale saves, super admin only)', () => {
	it('keeps the status and carries the stable code in issues', () => {
		const forbidden = render(
			new ForbiddenException(codedRefusal('super_admin_only', 'Only a super admin can change the markup')),
		);
		expect(forbidden.status).toBe(403);
		expect(forbidden.error.issues).toEqual([
			{ path: ['request'], message: 'Only a super admin can change the markup', code: 'super_admin_only' },
		]);

		const conflict = render(
			new ConflictException(codedRefusal('stale_revision', 'Someone else saved this first', 'revision')),
		);
		expect(conflict.status).toBe(409);
		expect(conflict.error.issues).toMatchObject([{ path: ['revision'], code: 'stale_revision' }]);

		const missing = render(
			new NotFoundException(codedRefusal('unknown_category', 'Category not found', 'categoryId')),
		);
		expect(missing.status).toBe(404);
		expect(missing.error.issues).toMatchObject([{ code: 'unknown_category' }]);
	});

	it('names who saved first and when on a stale save, and keeps only plain values', () => {
		const clash = render(
			staleSaveRefusal(
				'Someone else saved this first',
				{ by: 'adm_2', byName: 'Manager', at: '2026-11-19T19:28:00.000Z' },
				'adm_1',
			),
		);
		expect(clash.status).toBe(409);
		expect(clash.error.issues).toEqual([
			{
				path: ['revision'],
				message: 'Someone else saved this first',
				code: 'stale_revision',
				params: { changedAt: '2026-11-19T19:28:00.000Z', changedBy: 'Manager' },
			},
		]);

		const self = render(
			staleSaveRefusal('Someone else saved this first', { by: 'adm_1', byName: 'Moulik', at: null }, 'adm_1'),
		);
		expect(self.error.issues).toMatchObject([{ params: { changedBy: 'Moulik', changedByYou: 1 } }]);

		const unknown = render(
			staleSaveRefusal('Someone else saved this first', { by: null, byName: null, at: null }, 'adm_1'),
		);
		expect((unknown.error.issues as Array<Record<string, unknown>>)[0]).not.toHaveProperty('params');

		// Only short strings and finite numbers pass; anything else a body carries is dropped.
		const odd = render(
			new ConflictException({
				issues: [
					{
						path: 'revision',
						message: 'x',
						code: 'stale_revision',
						params: { nested: { a: 1 }, list: [1], long: 'x'.repeat(121), ok: 'yes', n: Number.NaN },
					},
				],
			}),
		);
		expect(odd.error.issues).toMatchObject([{ params: { ok: 'yes' } }]);
		expect((odd.error.issues as Array<{ params: Record<string, unknown> }>)[0]?.params).toEqual({ ok: 'yes' });
	});

	it('is why a bare top-level code was not enough: the filter drops it', () => {
		const lost = render(new ForbiddenException({ code: 'super_admin_only', message: 'Only a super admin' }));
		expect(lost.error.code).toBe('forbidden');
		expect(JSON.stringify(lost.error)).not.toContain('super_admin_only');
	});
});
