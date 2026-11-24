import { NotFoundException } from '@nestjs/common';
import type { Mailbox, MailboxAccess } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminInboxController } from '../src/mailboxes/admin-inbox.controller';
import { MailboxSettingsService } from '../src/mailboxes/mailbox-settings.service';
import { MailboxBookkeeping } from '../src/mailboxes/mailbox-support';
import { SavedRepliesService } from '../src/mailboxes/saved-replies.service';

/** An instance holding only the parts this test reads. */
const withParts = <T extends object>(type: { prototype: T }, parts: object): T =>
	Object.assign(Object.create(type.prototype), parts) as T;

const care: Mailbox = {
	id: 'care',
	address: 'care@shop.test',
	status: 'connected',
	connectedBy: 'admin',
	connectedAt: '2026-11-09T10:00:00.000Z',
	lastSyncAt: null,
	sendAs: [],
	grantedScopes: [],
	revocation: null,
};
const rows = [
	{ mailboxId: 'care', adminUserId: 'boss', rights: ['read', 'send', 'settings'] } as unknown as MailboxAccess,
];
const books = () =>
	new MailboxBookkeeping(
		{ save: async (box: Mailbox) => box } as never,
		{ append: async () => undefined } as never,
		{ findById: async () => null } as never,
	);
const alias = (address: string, signature: string, isPrimary = false) => ({
	address,
	displayName: 'Care',
	signature,
	isPrimary,
});

function settings(sendAs: unknown[][]) {
	const listSendAs = vi.fn();
	for (const list of sendAs) listSendAs.mockResolvedValueOnce(list);
	const gmail = {
		featuresMissing: () => [],
		listFilters: async () => [],
		getVacation: async () => ({ enabled: false }),
		listSendAs,
		updateSignature: async () => undefined,
	};
	return new MailboxSettingsService(
		gmail as never,
		{ findById: async () => care, save: async (box: Mailbox) => box } as never,
		{ listForAdminUser: async () => rows } as never,
		{ get: async () => 'refresh-token' } as never,
		books(),
	);
}

describe('mailbox settings and saved replies: the last cases', () => {
	it('reads the signature of the first address when none is marked main, and of the mailbox when Gmail lists none', async () => {
		const first = await settings([[alias('sales@shop.test', '<p>Sales</p>')]]).read('boss', 'care');
		expect(first.signature).toEqual({ address: 'sales@shop.test', html: '<p>Sales</p>', editable: true });
		const none = await settings([[]]).read('boss', 'care');
		expect(none.signature).toEqual({ address: 'care@shop.test', html: '', editable: true });
	});

	it('shows an empty signature when Gmail no longer lists the address just saved', async () => {
		const svc = settings([[alias('care@shop.test', '', true)], [alias('other@shop.test', '<p>x</p>', true)]]);
		expect(await svc.saveSignature('boss', 'care', '<p>Thanks</p>')).toEqual({
			address: 'care@shop.test',
			html: '',
			editable: true,
		});
	});

	it('answers "not found" when a saved reply went while it was being deleted', async () => {
		const svc = new SavedRepliesService(
			{
				findById: async () => ({ id: 'sr_1', scope: 'personal', ownerAdminUserId: 'boss' }),
				delete: async () => false,
			} as never,
			{ listForAdminUser: async () => rows } as never,
			books(),
		);
		await expect(svc.remove('boss', 'care', 'sr_1')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('asks Gmail for the first page of drafts when the page token is empty', async () => {
		const listDrafts = vi.fn(async () => ({ drafts: [] }));
		const controller = withParts(AdminInboxController, {
			inbox: { listDrafts },
		});
		await controller.drafts('care', '', { userId: 'boss' } as never);
		await controller.drafts('care', 'next-page', { userId: 'boss' } as never);
		expect(listDrafts.mock.calls).toEqual([
			['boss', 'care', undefined],
			['boss', 'care', 'next-page'],
		]);
	});
});
