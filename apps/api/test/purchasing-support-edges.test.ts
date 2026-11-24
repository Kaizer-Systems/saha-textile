import { ConflictException } from '@nestjs/common';
import { StaleVersionError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingSupport, refuseAll, shortWhen } from '../src/purchasing/purchasing-support';

interface Parts {
	stepRules?: Record<string, string | null>;
	admins?: Record<string, unknown>;
	failingAdmin?: boolean;
	held?: string[];
	roles?: Record<string, { label: string }>;
	assets?: unknown[];
	audit?: unknown[];
}

function build(parts: Parts = {}) {
	const admins = {
		findById: vi.fn(async (id: string) => {
			if (parts.failingAdmin) throw new Error('db down');
			return parts.admins?.[id] ?? null;
		}),
	};
	const support = new PurchasingSupport(
		{
			get: async () => ({
				stepRules: parts.stepRules ?? {},
				business: { legalName: '', gstin: null, addressLines: [] },
			}),
		} as never,
		admins as never,
		{ append: vi.fn(), list: async () => ({ items: parts.audit ?? [] }) } as never,
		{
			findManyByIds: async (ids: string[]) =>
				(parts.assets ?? []).filter((asset) => ids.includes((asset as { id: string }).id)),
		} as never,
		{ getUrl: (key: string) => `https://cdn.test/${key}` } as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({}) } as never,
		{ findById: async (id: string) => parts.roles?.[id] ?? null } as never,
		{ listActiveForUser: async () => (parts.held ?? []).map((roleId) => ({ roleId })) } as never,
	);
	return { support, admins };
}

const asset = (over: Record<string, unknown> = {}) => ({
	id: 'img_1',
	slug: 'peacock',
	displayName: null,
	visibility: 'public',
	width: 100,
	height: 100,
	text: { alt: {} },
	dominantColor: null,
	thumbHash: null,
	originalStorageKey: null,
	derivatives: [
		{ role: 'card', storageKey: 'card/img_1.webp', width: 100, height: 100, format: 'webp', versionId: null },
	],
	versions: [],
	...over,
});

describe('purchasing support: refusals and times', () => {
	it('refuses with "refused" when no problem is named, and without a line', () => {
		expect(refuseAll([]).getResponse()).toEqual({ message: 'refused', issues: [] });
		expect(refuseAll([{ code: 'x', detail: 'X' }]).getResponse()).toMatchObject({
			issues: [{ path: ['x'], message: 'X', code: 'x' }],
		});
	});

	it('says nothing for a time it can’t read', () => {
		expect(shortWhen('not a time')).toBe('');
	});
});

describe('purchasing support: who may do a step (P1)', () => {
	it('lets anyone when the step has no role, the super admin and holders of the role', async () => {
		expect(await build().support.stepRoleProblem('adm_1', 'post')).toBeNull();
		const rules = { postRoleId: 'role_1' };
		expect(
			await build({ stepRules: rules, admins: { adm_1: { role: 'admin' } } }).support.stepRoleProblem(
				'adm_1',
				'post',
			),
		).toBeNull();
		expect(await build({ stepRules: rules, held: ['role_1'] }).support.stepRoleProblem('adm_2', 'post')).toBeNull();
	});

	it('names the role someone lacks, or says the chosen role is gone; a failing lookup is not the super admin', async () => {
		const rules = { checkRoleId: 'role_1' };
		expect(
			await build({
				stepRules: rules,
				roles: { role_1: { label: 'Store keeper' } },
				failingAdmin: true,
			}).support.stepRoleProblem('adm_2', 'check'),
		).toEqual({
			code: 'step_role',
			detail: 'Only people with the role Store keeper may check goods (Settings › Purchases and stock).',
		});
		expect(await build({ stepRules: rules }).support.stepRoleProblem(null, 'check')).toEqual({
			code: 'step_role',
			detail: 'The role chosen to check goods no longer exists. The super admin must choose again in Settings › Purchases and stock.',
		});
	});
});

describe('purchasing support: role names', () => {
	it('names the roles it finds, skipping empty ids and roles deleted since', async () => {
		const { support } = build({ roles: { role_1: { label: 'Store keeper' } } });
		expect(await support.roleLabels(['role_1', null, 'role_gone', 'role_1'])).toEqual({ role_1: 'Store keeper' });
	});
});

describe('purchasing support: names', () => {
	it('falls back from display name to username to the email’s name to "Someone", and caches for five minutes', async () => {
		const { support, admins } = build({
			admins: {
				a: { displayName: '  ', username: 'rina' },
				b: { displayName: null, username: '', email: 'raju@saha-textile.test' },
				c: { displayName: null, username: '', email: null },
			},
		});
		const names = await support.names(['a', 'b', 'c', 'd', null, undefined, 'a']);
		expect([...names.entries()]).toEqual([
			['a', 'rina'],
			['b', 'raju'],
			['c', 'Someone'],
			['d', 'Someone'],
		]);
		await support.names(['a']);
		expect(admins.findById).toHaveBeenCalledTimes(4);
		expect(await support.nameOf(null)).toBe('Someone');
		expect(await support.nameOf('a')).toBe('rina');
	});

	it('reads "Someone" when the people lookup fails', async () => {
		expect(await build({ failingAdmin: true }).support.nameOf('a')).toBe('Someone');
	});
});

describe('purchasing support: pictures and files', () => {
	it('answers no thumbnails for no ids, and only the card pictures that can be shown', async () => {
		const { support } = build({
			assets: [
				asset(),
				asset({ id: 'img_2', visibility: 'private' }),
				asset({
					id: 'img_3',
					derivatives: [
						{ role: 'zoom', storageKey: 'z', width: 1, height: 1, format: 'webp', versionId: null },
					],
				}),
			],
		});
		expect(await support.thumbnails([null, undefined])).toEqual(new Map());
		expect(await support.thumbnails(['img_1', 'img_2', 'img_3', 'img_1'])).toEqual(
			new Map([['img_1', 'https://cdn.test/card/img_1.webp']]),
		);
	});

	it('names an attachment by its display name or slug, linking the original or its thumbnail', async () => {
		const { support } = build({
			assets: [
				asset({ id: 'bill_1', displayName: 'Bill BW-1.pdf', originalStorageKey: 'originals/bill_1.pdf' }),
				asset({ id: 'img_1' }),
			],
		});
		expect(await support.attachment(null)).toBeNull();
		expect(await support.attachment('gone')).toBeNull();
		expect(await support.attachment('bill_1')).toEqual({
			assetId: 'bill_1',
			name: 'Bill BW-1.pdf',
			url: 'https://cdn.test/originals/bill_1.pdf',
		});
		expect(await support.attachment('img_1')).toEqual({
			assetId: 'img_1',
			name: 'peacock',
			url: 'https://cdn.test/card/img_1.webp',
		});
	});
});

describe('purchasing support: activity and stale saves', () => {
	it('reads a document’s activity oldest first, naming people and the system', async () => {
		const { support } = build({
			admins: { adm_1: { displayName: 'Rina' } },
			audit: [
				{
					id: 'a2',
					createdAt: '2026-11-24T06:00:00.000Z',
					actorUserId: null,
					action: 'purchase.order.auto_close',
					metadata: {},
				},
				{
					id: 'a1',
					createdAt: '2026-11-24T05:00:00.000Z',
					actorUserId: 'adm_1',
					action: 'purchase.order.create',
					metadata: { text: 'Rina made it.' },
				},
			],
		});
		expect(await support.activity('purchase_order', ['po_1'])).toEqual([
			{
				id: 'a1',
				at: '2026-11-24T05:00:00.000Z',
				actorName: 'Rina',
				action: 'purchase.order.create',
				text: 'Rina made it.',
			},
			{
				id: 'a2',
				at: '2026-11-24T06:00:00.000Z',
				actorName: 'System',
				action: 'purchase.order.auto_close',
				text: 'purchase.order.auto_close',
			},
		]);
	});

	it('says who changed it and when, or only who when the time is unreadable; other errors pass', async () => {
		const { support } = build({ admins: { adm_2: { displayName: 'Raju' } } });
		const timed = await support.staleConflict(
			new StaleVersionError('x', 'x_1', {
				version: 2,
				updatedAt: '2026-11-24T10:32:00.000Z',
				updatedBy: 'adm_2',
			}),
		);
		expect(timed.getResponse()).toMatchObject({
			issues: [{ message: 'Changed by Raju at 4:02 pm on 24 Nov. Reload to see it.' }],
		});
		const untimed = await support.staleConflict(
			new StaleVersionError('x', 'x_1', { version: 2, updatedAt: '', updatedBy: null }),
		);
		expect(untimed.getResponse()).toMatchObject({ issues: [{ message: 'Changed by Someone. Reload to see it.' }] });
		await expect(
			support.guardStale(async () =>
				Promise.reject(new StaleVersionError('x', 'x_1', { version: 2, updatedAt: '', updatedBy: null })),
			),
		).rejects.toBeInstanceOf(ConflictException);
		await expect(support.guardStale(async () => Promise.reject(new Error('disk full')))).rejects.toThrow(
			'disk full',
		);
	});
});
