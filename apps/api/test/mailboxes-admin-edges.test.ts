import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Mailbox, MailboxAccess } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MailboxSignInState } from '../src/mailboxes/mailbox-support';
import { MailboxesAdminService, PEOPLE_PAGE_SIZE } from '../src/mailboxes/mailboxes-admin.service';

const KEY = Buffer.alloc(32, 9).toString('base64');
const config = { mail: { tokenKey: KEY, adminUrl: 'https://admin.test/', domain: 'shop.test' }, locales: ['en', 'bn'] };

const mailbox = (id: string, over: Partial<Mailbox> = {}): Mailbox => ({
	id,
	address: `${id}@shop.test`,
	status: 'connected',
	connectedBy: 'admin',
	connectedAt: '2026-11-09T10:00:00.000Z',
	lastSyncAt: null,
	sendAs: [],
	grantedScopes: [],
	revocation: null,
	...over,
});

interface User {
	id: string;
	displayName?: string | null;
	email?: string | null;
	username?: string | null;
	status?: string;
}

function setup(options: { users?: User[]; pages?: User[][]; superAdmins?: string[]; consume?: boolean } = {}) {
	const boxes = new Map<string, Mailbox>();
	const access = new Map<string, MailboxAccess[]>();
	const tokens = new Map<string, string>();
	const users = options.users ?? [];
	const pages = options.pages ?? [users];
	const superAdmins = new Set(options.superAdmins ?? []);
	const gmail = {
		featuresMissing: vi.fn(() => ['labels']),
		revoke: vi.fn(async () => undefined),
		listSendAs: vi.fn(async () => []),
	};
	const record = vi.fn(async () => undefined);
	const service = new MailboxesAdminService(
		gmail as never,
		{
			list: async () => [...boxes.values()],
			findById: async (id: string) => boxes.get(id) ?? null,
			save: async (row: Mailbox) => (boxes.set(row.id, row), row),
		} as never,
		{
			listForMailbox: async (id: string) => access.get(id) ?? [],
			version: async () => 3,
			replaceForMailbox: async (id: string, entries: MailboxAccess[], version: number) =>
				version === 3 ? (access.set(id, entries), 4) : null,
		} as never,
		{
			get: async (id: string) => tokens.get(id) ?? null,
			remove: async (id: string) => void tokens.delete(id),
		} as never,
		{ get: async () => null, set: async () => undefined } as never,
		{
			findById: async (id: string) => users.find((user) => user.id === id) ?? null,
			list: vi.fn(async ({ page }: { page: number }) => ({
				items: pages[page - 1] ?? [],
				// A directory may say there is more and then hand back an empty page.
				meta: { hasNext: page < pages.length || (pages[page - 1] ?? []).length === 0 },
			})),
		} as never,
		{ findByKey: async () => ({ id: 'role_admin' }) } as never,
		{ findActive: async (id: string) => (superAdmins.has(id) ? { id: 'as_1' } : null) } as never,
		{
			create: async (row: unknown) => row,
			consume: async () => (options.consume === false ? null : { stateHash: 'h' }),
		} as never,
		config as never,
		{ record, guard: async (_box: Mailbox, work: () => Promise<unknown>) => work() } as never,
	);
	return { service, boxes, access, tokens, gmail, record };
}

describe('Settings › Mailboxes: the remaining cases', () => {
	it('lets only active super admins manage mailboxes', async () => {
		const { service } = setup({
			users: [
				{ id: 'adm_boss', status: 'active' },
				{ id: 'adm_off', status: 'disabled' },
			],
			superAdmins: ['adm_boss', 'adm_off'],
		});
		await expect(service.requireSuperAdmin('adm_boss')).resolves.toBeUndefined();
		await expect(service.requireSuperAdmin('adm_off')).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.requireSuperAdmin('adm_none')).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('asks a disconnected mailbox for nothing new', async () => {
		const { service, boxes, gmail } = setup();
		boxes.set('care', mailbox('care', { status: 'disconnected' }));
		boxes.set('orders', mailbox('orders'));
		const { rows } = await service.list();
		expect(rows.map((row) => [row.mailbox.id, row.needsReconnectFor])).toEqual([
			['care', []],
			['orders', ['labels']],
		]);
		expect(gmail.featuresMissing).toHaveBeenCalledTimes(1);
	});

	it('sends a used or stale sign-in back as expired, and a sign-in by someone no longer a super admin as not allowed', async () => {
		const state = new MailboxSignInState(KEY).issue('adm_gone').state;
		const replayed = setup({ consume: false });
		expect(await replayed.service.completeSignIn({ code: 'c', state })).toBe(
			'https://admin.test/setting/mailboxes?error=expired',
		);
		const demoted = setup({ users: [{ id: 'adm_gone', status: 'active' }] });
		expect(await demoted.service.completeSignIn({ code: 'c', state })).toBe(
			'https://admin.test/setting/mailboxes?error=not_allowed',
		);
	});

	it('lists who may open a mailbox by name, email, username or id, sorted by name', async () => {
		const { service, boxes, access } = setup({
			users: [
				{ id: 'u_riya', displayName: 'Riya', status: 'active' },
				{ id: 'u_mail', displayName: '', email: 'anil@shop.test', status: 'active' },
				{ id: 'u_user', displayName: '', email: null, username: 'bina', status: 'disabled' },
			],
		});
		boxes.set('care', mailbox('care'));
		access.set('care', [
			{ mailboxId: 'care', adminUserId: 'u_riya', rights: ['read'] },
			{ mailboxId: 'care', adminUserId: 'u_mail', rights: ['read'] },
			{ mailboxId: 'care', adminUserId: 'u_user', rights: ['read'] },
			{ mailboxId: 'care', adminUserId: 'u_gone', rights: ['read'] },
		] as MailboxAccess[]);
		const list = await service.getAccess('care');
		expect(list.entries.map((entry) => [entry.name, entry.email, entry.active])).toEqual([
			['anil@shop.test', 'anil@shop.test', true],
			['bina', '', false],
			['Riya', '', true],
			['u_gone', '', false],
		]);
	});

	it('finds people across every directory page by name, email or username, and lists everyone without a search', async () => {
		const { service } = setup({
			pages: [
				[
					{ id: 'u_1', displayName: 'Riya Sen', email: 'riya@shop.test', status: 'active' },
					{ id: 'u_2', displayName: null, email: null, username: 'bina', status: 'active' },
				],
				[{ id: 'u_3', displayName: null, email: null, username: null, status: 'disabled' }],
				[],
			],
		});
		const found = await service.people({ q: 'BINA', page: 1 } as never);
		expect(found.items).toEqual([{ adminUserId: 'u_2', name: 'bina', email: '', active: true }]);
		const everyone = await service.people({ q: '', page: 1 } as never);
		expect(everyone).toMatchObject({ total: 3, page: 1, pageSize: PEOPLE_PAGE_SIZE });
		expect(everyone.items.map((item) => item.name)).toEqual(['bina', 'Riya Sen', 'u_3']);
		const single = setup({ users: [{ id: 'u_9', displayName: 'Zoya', status: 'active' }] });
		expect((await single.service.people({ q: '', page: 1 } as never)).total).toBe(1);
	});

	it('saves an access list counting who was added and removed, and refuses one saved meanwhile', async () => {
		const { service, boxes, access, record } = setup({
			users: [
				{ id: 'u_a', displayName: 'A', status: 'active' },
				{ id: 'u_b', displayName: 'B', status: 'active' },
			],
		});
		boxes.set('care', mailbox('care'));
		access.set('care', [{ mailboxId: 'care', adminUserId: 'u_a', rights: ['read'] }] as MailboxAccess[]);
		await service.setAccess(
			'care',
			{ version: 3, entries: [{ adminUserId: 'u_b', rights: ['read', 'send'] }] } as never,
			'adm_1',
		);
		expect(record).toHaveBeenCalledWith(
			'adm_1',
			'mailbox.access_changed',
			'care',
			expect.objectContaining({ added: 1, removed: 1, send: 1 }),
		);
		await expect(
			service.setAccess(
				'care',
				{ version: 1, entries: [{ adminUserId: 'u_a', rights: ['read'] }] } as never,
				null,
			),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('tries a failed withdrawal again only for a disconnected mailbox, and keeps the token while Google refuses', async () => {
		const { service, boxes, tokens, gmail } = setup();
		boxes.set('live', mailbox('live'));
		boxes.set('done', mailbox('done', { status: 'disconnected', revocation: 'done' }));
		boxes.set('failed', mailbox('failed', { status: 'disconnected', revocation: 'failed' }));
		await expect(service.retryRevocation('live', null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.retryRevocation('done', null)).rejects.toBeInstanceOf(BadRequestException);
		tokens.set('failed', 'r1');
		gmail.revoke.mockRejectedValueOnce(new Error('google down'));
		expect((await service.retryRevocation('failed', 'adm_1')).revocation).toBe('failed');
		expect(tokens.get('failed')).toBe('r1');
		expect((await service.retryRevocation('failed', 'adm_1')).revocation).toBe('done');
		expect(tokens.has('failed')).toBe(false);
	});

	it('refuses to refresh the aliases of a disconnected mailbox', async () => {
		const { service, boxes } = setup();
		boxes.set('care', mailbox('care', { status: 'disconnected' }));
		await expect(service.refreshSendAs('care')).rejects.toBeInstanceOf(BadRequestException);
	});
});
