import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpsTokenGuard, opsTokenFrom } from './ops-token.guard';
import { OpsService } from './ops.service';

const TOKEN = 'a'.repeat(64);
const context = (authorization?: string, ip = '10.0.0.1') =>
	({
		switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {}, ip }) }),
	}) as never;

describe('operations address', () => {
	afterEach(() => {
		delete process.env['OPS_TOKEN'];
	});

	it('is off without a key, refuses a wrong key, and lets the right key through', () => {
		expect(() => new OpsTokenGuard().canActivate(context(`Bearer ${TOKEN}`))).toThrow(NotFoundException);
		process.env['OPS_TOKEN'] = TOKEN;
		const guard = new OpsTokenGuard();
		expect(() => guard.canActivate(context('Bearer wrong'))).toThrow(UnauthorizedException);
		expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
		expect(guard.canActivate(context(`Bearer ${TOKEN}`))).toBe(true);
	});

	it('takes only a 64-hex key, and answers at most 60 a minute per address', () => {
		expect(() => opsTokenFrom({ OPS_TOKEN: 'short' } as never)).toThrow(/64 hex/);
		expect(opsTokenFrom({ OPS_TOKEN: '' } as never)).toBeNull();
		process.env['OPS_TOKEN'] = TOKEN;
		const guard = new OpsTokenGuard();
		for (let i = 0; i < 60; i++) guard.canActivate(context(`Bearer ${TOKEN}`, '10.0.0.9'));
		expect(() => guard.canActivate(context(`Bearer ${TOKEN}`, '10.0.0.9'))).toThrow(HttpException);
		expect(guard.canActivate(context(`Bearer ${TOKEN}`, '10.0.0.10'))).toBe(true);
	});

	it('summarises messages per channel without any destination, and reads queue counts', async () => {
		const totals: Record<string, number> = {
			'sms:': 5,
			'sms:sent': 3,
			'sms:delivered': 0,
			'sms:failed': 1,
			'sms:queued': 0,
		};
		const list = vi.fn(async (f: { channel?: string; status?: string; pageSize: number }) => ({
			items:
				f.pageSize === 20
					? [
							{
								id: 'm1',
								channel: 'sms',
								category: 'transactional',
								templateKey: 'sign-in-code',
								destinationHash: 'hash',
								status: 'sent',
								createdAt: '2026-11-21T00:00:00.000Z',
							},
						]
					: [],
			total: f.channel ? (totals[`${f.channel}:${f.status ?? ''}`] ?? 0) : 1,
			page: 1,
			pageSize: f.pageSize,
		}));
		const queues = {
			counts: vi.fn(async () => [
				{ queue: 'saha-textile-media', waiting: 1, active: 0, delayed: 0, failed: 0, completed: 9 },
			]),
		};
		const ops = new OpsService(queues, { list } as never);
		const m = await ops.messages(24, new Date('2026-11-21T01:00:00Z'));
		expect(m.channels).toEqual([
			{ channel: 'sms', total: 5, sent: 3, delivered: 0, failed: 1, queued: 0, suppressed: 1 },
		]);
		expect(m.recent).toEqual([
			{
				at: '2026-11-21T00:00:00.000Z',
				channel: 'sms',
				category: 'transactional',
				template: 'sign-in-code',
				status: 'sent',
			},
		]);
		expect(JSON.stringify(m)).not.toContain('hash');
		expect((await ops.jobs()).queues[0]?.queue).toBe('saha-textile-media');
	});
});
