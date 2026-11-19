import { HttpException } from '@nestjs/common';
import type { ContactMessage, Mailbox, MailboxAccess } from '@saha-textile/contracts';
import {
	type MailboxPort,
	MailboxAccessRevoked,
	type OutboxItem,
	type StoredSavedReply,
} from '@saha-textile/core-domain';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { UnavailableMailboxAdapter, UnavailableMailboxTokenStore } from '../src/infra/unavailable-mailbox.adapter';
import { AdminInboxController } from '../src/mailboxes/admin-inbox.controller';
import { AdminMailboxesController } from '../src/mailboxes/admin-mailboxes.controller';
import {
	CONTACT_RETRY_FOR_MS,
	CONTACT_SWEEP_MS,
	ContactMessagesService,
} from '../src/mailboxes/contact-messages.service';
import { ContactMessagesController } from '../src/mailboxes/contact-messages.controller';
import { InboxService } from '../src/mailboxes/inbox.service';
import { MailboxBookkeeping, MailboxSignInState, STATE_TTL_MS } from '../src/mailboxes/mailbox-support';
import { MailboxesAdminService } from '../src/mailboxes/mailboxes-admin.service';
import { SAVED_REPLY_CHANGED, SavedRepliesService } from '../src/mailboxes/saved-replies.service';
import { LanguageStore } from '../src/languages/language-store';

const KEY = Buffer.alloc(32, 9).toString('base64');
const mailConfig = (overrides: Record<string, unknown> = {}) =>
	({
		mail: { tokenKey: KEY, adminUrl: 'https://admin.test/', domain: 'shop.test', ...overrides },
		locales: ['en', 'bn'],
	}) as never;

const mailbox = (id: string, overrides: Partial<Mailbox> = {}): Mailbox => ({
	id,
	address: `${id}@shop.test`,
	status: 'connected',
	connectedBy: 'admin',
	connectedAt: '2026-11-09T10:00:00.000Z',
	lastSyncAt: null,
	sendAs: [
		{ address: `${id}@shop.test`, displayName: 'Care', signature: '<b>Team</b>', isPrimary: true },
		{ address: `orders@shop.test`, displayName: 'Orders', signature: '', isPrimary: false },
	],
	grantedScopes: [],
	revocation: null,
	...overrides,
});

/** In-memory stand-ins for the repositories, with the same contracts as the Mongo ones. */
const world = () => {
	const boxes = new Map<string, Mailbox>();
	const rows: MailboxAccess[] = [];
	const tokenMap = new Map<string, string>();
	const settingMap = new Map<string, unknown>();
	const contacts = new Map<string, ContactMessage>();
	const versions = new Map<string, number>();
	const states = new Set<string>();
	const outboxRows = new Map<string, OutboxItem>();
	const superAdmins = new Set<string>(['admin_1', 'admin', 'u1']);
	const audit: Array<{
		action: string;
		entityId: string | null;
		actorUserId?: string | null;
		metadata?: Record<string, unknown>;
		createdAt?: string;
	}> = [];
	return {
		boxes,
		rows,
		tokenMap,
		settingMap,
		contacts,
		audit,
		mailboxes: {
			list: async () => [...boxes.values()].sort((a, b) => a.address.localeCompare(b.address)),
			findById: async (id: string) => boxes.get(id) ?? null,
			findByAddress: async (address: string) =>
				[...boxes.values()].find((box) => box.address === address) ?? null,
			save: async (box: Mailbox) => {
				boxes.set(box.id, box);
				return box;
			},
		},
		versions,
		access: {
			listForMailbox: async (id: string) => rows.filter((row) => row.mailboxId === id),
			listForAdminUser: async (id: string) => rows.filter((row) => row.adminUserId === id),
			version: async (id: string) => versions.get(id) ?? 0,
			replaceForMailbox: async (id: string, entries: readonly MailboxAccess[], expected?: number) => {
				const current = versions.get(id) ?? 0;
				if (expected !== undefined && expected !== current) return null;
				for (let index = rows.length - 1; index >= 0; index--)
					if (rows[index]?.mailboxId === id) rows.splice(index, 1);
				rows.push(...entries);
				versions.set(id, current + 1);
				return current + 1;
			},
		},
		outboxRows,
		outbox: {
			create: async (item: OutboxItem) => {
				outboxRows.set(item.id, { ...item });
				return item;
			},
			findById: async (id: string) => (outboxRows.has(id) ? { ...outboxRows.get(id)! } : null),
			claimDue: async (now: string, limit: number) => {
				const due = [...outboxRows.values()]
					.filter((row) => row.status === 'queued' && row.sendAt <= now)
					.slice(0, limit);
				for (const row of due) Object.assign(row, { status: 'sending', claimedAt: now });
				return due.map((row) => ({ ...row }));
			},
			cancel: async (id: string) => {
				const row = outboxRows.get(id);
				if (row?.status !== 'queued') return null;
				row.status = 'cancelled';
				return { ...row };
			},
			markSent: async (id: string, sent: { id: string; threadId: string }) => {
				Object.assign(outboxRows.get(id)!, { status: 'sent', sentMessageId: sent.id, threadId: sent.threadId });
			},
			setStatus: async (id: string, status: OutboxItem['status'], attemptsDelta = 0) => {
				const row = outboxRows.get(id)!;
				row.status = status;
				row.attempts += attemptsDelta;
			},
			listByStatus: async (status: OutboxItem['status'], limit: number) =>
				[...outboxRows.values()]
					.filter((row) => row.status === status)
					.slice(0, limit)
					.map((row) => ({ ...row })),
			findActiveForDraft: async (mailboxId: string, draftId: string) =>
				[...outboxRows.values()].find(
					(row) =>
						row.mailboxId === mailboxId &&
						row.draftId === draftId &&
						(row.status === 'queued' || row.status === 'sending'),
				) ?? null,
		},
		states,
		signInStates: {
			create: async (state: { stateHash: string }) => {
				states.add(state.stateHash);
				return state as never;
			},
			consume: async (hash: string) => (states.delete(hash) ? ({ stateHash: hash } as never) : null),
		},
		roles: { findByKey: async (key: string) => (key === 'administrator' ? ({ id: 'role_admin' } as never) : null) },
		assignments: {
			findActive: async (userId: string, roleId: string) =>
				roleId === 'role_admin' && superAdmins.has(userId) ? ({ userId } as never) : null,
		},
		superAdmins,
		tokens: {
			put: async (id: string, token: string) => void tokenMap.set(id, token),
			get: async (id: string) => tokenMap.get(id) ?? null,
			remove: async (id: string) => void tokenMap.delete(id),
		},
		settings: {
			get: async (key: string) => (settingMap.get(key) ?? null) as never,
			set: async (key: string, value: unknown) => void settingMap.set(key, value),
		},
		adminUsers: {
			findById: async (id: string) =>
				id.startsWith('u') || id.startsWith('admin')
					? ({ id, displayName: id === 'u_riya' ? 'Riya' : undefined, status: 'active' } as never)
					: null,
		},
		contactRepo: {
			save: async (message: ContactMessage) => {
				contacts.set(message.id, message);
				return message;
			},
			findById: async (id: string) => contacts.get(id) ?? null,
			findRecentByHash: async (hash: string, since: string) =>
				[...contacts.values()].find((message) => message.contentHash === hash && message.createdAt >= since) ??
				null,
			listPending: async (limit: number) =>
				[...contacts.values()]
					.filter((message) => message.status === 'queued' || message.status === 'failed')
					.slice(0, limit),
		},
		auditLog: {
			append: async (entry: { action: string; entityId: string | null }) => void audit.push(entry),
			list: async (query: { action?: string; entityId?: string; from?: string }) => ({
				items: audit
					.filter(
						(entry) =>
							entry.action === query.action &&
							entry.entityId === query.entityId &&
							(entry.createdAt ?? '') >= (query.from ?? ''),
					)
					.reverse(),
			}),
		},
	};
};

const gmailStub = (overrides: Partial<Record<keyof MailboxPort, unknown>> = {}) =>
	({
		signInUrl: vi.fn((state: string) => `https://accounts.test/?state=${state}`),
		completeSignIn: vi.fn(async () => ({ address: 'care@shop.test', refreshToken: 'r1', scopes: [] })),
		revoke: vi.fn(async () => undefined),
		featuresMissing: vi.fn(() => []),
		listThreads: vi.fn(async () => ({ threads: [], nextPageToken: null })),
		getThread: vi.fn(async () => ({ id: 't1', subject: 'S', messages: [], unread: false })),
		getAttachment: vi.fn(async () => ({ data: new Uint8Array([1, 2]) })),
		send: vi.fn(async () => ({ id: 'm1', threadId: 't1' })),
		createDraft: vi.fn(async () => ({ draftId: 'd1', version: 'v1', threadId: null })),
		updateDraft: vi.fn(async () => ({ draftId: 'd1', version: 'v2', threadId: null })),
		getDraft: vi.fn(async () => null),
		listDrafts: vi.fn(async () => ({ drafts: [], nextPageToken: null })),
		deleteDraft: vi.fn(async () => undefined),
		sendDraft: vi.fn(async () => ({ id: 'sent1', threadId: 't9' })),
		findByMessageId: vi.fn(async () => null),
		modifyThread: vi.fn(async () => undefined),
		trashThread: vi.fn(async () => undefined),
		importMessage: vi.fn(async () => ({ id: 'g1' })),
		unreadCount: vi.fn(async () => 3),
		listSendAs: vi.fn(async () => [
			{ address: 'care@shop.test', displayName: 'Care', signature: '', isPrimary: true },
		]),
		...overrides,
	}) as unknown as MailboxPort & { [K in keyof MailboxPort]: Mock };

const books = (w: ReturnType<typeof world>, withAudit = true) =>
	new MailboxBookkeeping(w.mailboxes as never, withAudit ? (w.auditLog as never) : null, w.adminUsers as never);

describe('MailboxSignInState', () => {
	const state = new MailboxSignInState(KEY);

	it('names the admin who started the sign-in, until it expires', () => {
		const issued = state.issue('admin_1', 1_000);
		expect(state.verify(issued.state, 1_001)).toEqual({ adminUserId: 'admin_1', nonce: issued.nonce });
		expect(state.verify(issued.state, 1_000 + STATE_TTL_MS + 1)).toBeNull();
	});

	it('refuses a forged, altered or malformed state', () => {
		const [payload, signature] = state.issue('admin_1').state.split('.');
		expect(state.verify(`${payload}.${signature?.slice(1)}x`)).toBeNull();
		expect(state.verify(`${payload}x.${signature}`)).toBeNull();
		expect(state.verify('nothing')).toBeNull();
		expect(
			new MailboxSignInState(Buffer.alloc(32, 1).toString('base64')).verify(state.issue('a').state),
		).toBeNull();
		const other = new MailboxSignInState(KEY);
		// A signed body that is not JSON, or lacks its fields.
		const forge = (body: string) => {
			const encoded = Buffer.from(body).toString('base64url');
			const sig = (other as unknown as { sign(p: string): string }).sign(encoded);
			return `${encoded}.${sig}`;
		};
		expect(other.verify(forge('not json'))).toBeNull();
		expect(other.verify(forge('{"u":1,"e":9999999999999}'))).toBeNull();
	});
});

describe('MailboxBookkeeping.guard', () => {
	it('marks a mailbox Google withdrew and answers 409', async () => {
		const w = world();
		const box = mailbox('care');
		await expect(
			books(w).guard(box, async () => {
				throw new MailboxAccessRevoked(box.address);
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(w.boxes.get('care')?.status).toBe('needs_reconnect');
	});

	it('answers 429 for a busy Gmail, 502 for anything else, and passes HTTP errors through', async () => {
		const guard = books(world()).guard.bind(books(world()));
		await expect(guard(mailbox('a'), async () => Promise.reject({ status: 429 }))).rejects.toMatchObject({
			status: 429,
		});
		await expect(guard(mailbox('a'), async () => Promise.reject(new Error('x')))).rejects.toMatchObject({
			status: 502,
		});
		await expect(
			guard(mailbox('a'), async () => Promise.reject(new HttpException('no', 418))),
		).rejects.toMatchObject({
			status: 418,
		});
	});

	it('writes nothing to the audit trail when there is none', async () => {
		await expect(books(world(), false).record('a', 'x', null, {})).resolves.toBeUndefined();
	});
});

describe('MailboxesAdminService', () => {
	let w: ReturnType<typeof world>;
	let gmail: ReturnType<typeof gmailStub>;
	let service: MailboxesAdminService;
	const make = (config = mailConfig()) =>
		new MailboxesAdminService(
			gmail,
			w.mailboxes as never,
			w.access as never,
			w.tokens as never,
			w.settings as never,
			w.adminUsers as never,
			w.roles as never,
			w.assignments as never,
			w.signInStates as never,
			config,
			books(w),
		);
	const callbackState = async () =>
		new URL((await service.connectUrl('admin_1')).url).searchParams.get('state') ?? '';

	beforeEach(() => {
		w = world();
		gmail = gmailStub();
		service = make();
	});

	it('connects a mailbox: stores the token, reads its aliases and returns to the Mailboxes tab', async () => {
		const url = await service.completeSignIn({ code: 'code', state: await callbackState() });
		expect(url).toBe('https://admin.test/setting/mailboxes?connected=care%40shop.test');
		const saved = [...w.boxes.values()][0];
		expect(saved).toMatchObject({ address: 'care@shop.test', status: 'connected', connectedBy: 'admin_1' });
		expect(saved?.sendAs).toHaveLength(1);
		expect(w.tokenMap.get(saved?.id ?? '')).toBe('r1');
		expect(w.audit.map((entry) => entry.action)).toEqual(['mailbox.connected']);
	});

	it('reconnects the same address in place, keeping its aliases if Gmail cannot list them', async () => {
		await w.mailboxes.save(mailbox('care', { status: 'needs_reconnect' }));
		gmail.listSendAs.mockRejectedValueOnce(new Error('down'));
		await service.completeSignIn({ code: 'code', state: await callbackState() });
		expect(w.boxes.size).toBe(1);
		expect(w.boxes.get('care')).toMatchObject({ status: 'connected', sendAs: [] });
		expect(w.audit.map((entry) => entry.action)).toEqual(['mailbox.reconnected']);
	});

	it('returns with a reason when the state is bad, the admin cancelled, or Google refused', async () => {
		expect(await service.completeSignIn({ code: 'c', state: 'forged' })).toContain('error=expired');
		expect(await service.completeSignIn({ state: await callbackState(), error: 'access_denied' })).toContain(
			'error=cancelled',
		);
		expect(await service.completeSignIn({ state: await callbackState() })).toContain('error=cancelled');
		gmail.completeSignIn.mockRejectedValueOnce({ status: 403 });
		expect(await service.completeSignIn({ code: 'c', state: await callbackState() })).toContain(
			'error=not_on_domain',
		);
		gmail.completeSignIn.mockRejectedValueOnce(new Error('boom'));
		expect(await service.completeSignIn({ code: 'c', state: await callbackState() })).toContain('error=failed');
	});

	it('says it is not set up without a key or an admin address', async () => {
		expect(make(mailConfig({ tokenKey: undefined })).configured).toBe(false);
		await expect(make(mailConfig({ adminUrl: undefined })).connectUrl('a')).rejects.toThrow('not set up');
		expect(service.configured).toBe(true);
	});

	it('lists mailboxes with reader and sender counts and the Contact Us mailbox', async () => {
		await w.mailboxes.save(mailbox('care'));
		await w.mailboxes.save(mailbox('orders'));
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'u1', rights: ['read', 'send', 'organise', 'bin'] },
			{ mailboxId: 'care', adminUserId: 'u2', rights: ['read'] },
		]);
		await w.settings.set('mailboxes.contact', { mailboxId: 'care' });
		const list = await service.list();
		expect(list).toMatchObject({ configured: true, domain: 'shop.test' });
		expect(list.rows.map((row) => [row.mailbox.id, row.readers, row.senders, row.contactTarget])).toEqual([
			['care', 2, 1, true],
			['orders', 0, 0, false],
		]);
		w.settingMap.clear();
		expect((await service.list()).rows.every((row) => !row.contactTarget)).toBe(true);
	});

	it('replaces the access list, refusing people who are not admin users', async () => {
		await w.mailboxes.save(mailbox('care'));
		const saved = await service.setAccess(
			'care',
			{ version: 0, entries: [{ adminUserId: 'u1', rights: ['send'] }] },
			'admin',
		);
		expect(saved).toEqual({
			version: 1,
			entries: [{ adminUserId: 'u1', rights: ['read', 'send'], name: 'u1', email: '', active: true }],
		});
		expect((await service.getAccess('care')).entries).toHaveLength(1);
		await expect(
			service.setAccess('care', { version: 1, entries: [{ adminUserId: 'ghost', rights: ['read'] }] }, 'admin'),
		).rejects.toMatchObject({ status: 400 });
		await expect(service.getAccess('missing')).rejects.toMatchObject({ status: 404 });
	});

	it('chooses the Contact Us mailbox, only a connected one, or none', async () => {
		await w.mailboxes.save(mailbox('care'));
		await w.mailboxes.save(mailbox('old', { status: 'disconnected' }));
		expect(await service.setContactTarget('care', 'admin')).toEqual({ mailboxId: 'care' });
		expect(w.settingMap.get('mailboxes.contact')).toEqual({ mailboxId: 'care' });
		await expect(service.setContactTarget('old', 'admin')).rejects.toMatchObject({ status: 400 });
		expect(await service.setContactTarget(null, 'admin')).toEqual({ mailboxId: null });
	});

	it('disconnects: withdraws at Google, forgets the token, keeps who may open it', async () => {
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'u1', rights: ['read', 'send', 'organise', 'bin'] },
		]);
		const saved = await service.disconnect('care', 'admin');
		expect(saved).toMatchObject({ status: 'disconnected', sendAs: [], revocation: 'done' });
		expect(w.tokenMap.has('care')).toBe(false);
		expect(w.rows).toHaveLength(1);
		await w.mailboxes.save(mailbox('notoken'));
		await service.disconnect('notoken', 'admin');
		expect(gmail.revoke).toHaveBeenCalledTimes(1);
	});

	it('re-reads aliases, or marks the mailbox when its token is gone', async () => {
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		expect((await service.refreshSendAs('care')).sendAs).toHaveLength(1);
		await w.mailboxes.save(mailbox('lost'));
		expect((await service.refreshSendAs('lost')).status).toBe('needs_reconnect');
	});
});

describe('InboxService', () => {
	let w: ReturnType<typeof world>;
	let gmail: ReturnType<typeof gmailStub>;
	let inbox: InboxService;

	beforeEach(async () => {
		w = world();
		gmail = gmailStub();
		inbox = new InboxService(
			gmail,
			w.mailboxes as never,
			w.access as never,
			w.tokens as never,
			books(w),
			w.outbox as never,
		);
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'sender', rights: ['read', 'send', 'organise', 'bin'] },
			{ mailboxId: 'care', adminUserId: 'reader', rights: ['read'] },
		]);
	});

	it('lists only the mailboxes a person may open, with live unread counts', async () => {
		await w.mailboxes.save(mailbox('off', { status: 'disconnected' }));
		await w.mailboxes.save(mailbox('lost'));
		await w.access.replaceForMailbox('off', [{ mailboxId: 'off', adminUserId: 'reader', rights: ['read'] }]);
		await w.access.replaceForMailbox('lost', [{ mailboxId: 'lost', adminUserId: 'reader', rights: ['read'] }]);
		await w.access.replaceForMailbox('gone', [{ mailboxId: 'gone', adminUserId: 'reader', rights: ['read'] }]);
		const summary = await inbox.summary('reader');
		expect(summary.map((row) => [row.address, row.status, row.unread, row.sendAs.length])).toEqual([
			['care@shop.test', 'connected', 3, 0],
			['lost@shop.test', 'needs_reconnect', null, 0],
			['off@shop.test', 'disconnected', null, 0],
		]);
		expect(w.boxes.get('care')?.lastSyncAt).not.toBeNull();
		expect((await inbox.summary('sender'))[0]?.sendAs).toHaveLength(2);
		expect(await inbox.summary('nobody')).toEqual([]);
	});

	it('shows an unreachable mailbox with an unknown count, and one Google withdrew as needing reconnection', async () => {
		gmail.unreadCount.mockRejectedValueOnce(new Error('timeout'));
		expect((await inbox.summary('reader'))[0]).toMatchObject({ status: 'connected', unread: null });
		gmail.unreadCount.mockRejectedValueOnce(new MailboxAccessRevoked('care@shop.test'));
		expect((await inbox.summary('reader'))[0]).toMatchObject({ status: 'needs_reconnect', unread: null });
	});

	it('reads folders, conversations and attachments for anyone with access', async () => {
		expect(await inbox.threads('reader', 'care', { folder: 'inbox' })).toEqual({
			threads: [],
			nextPageToken: null,
		});
		expect(gmail.listThreads).toHaveBeenCalledWith(
			{ address: 'care@shop.test', refreshToken: 'r1' },
			'inbox',
			undefined,
			undefined,
			undefined,
		);
		expect((await inbox.thread('reader', 'care', 't1')).id).toBe('t1');
		expect(await inbox.attachment('reader', 'care', 'm1', 'a1')).toEqual(new Uint8Array([1, 2]));
		gmail.getThread.mockResolvedValueOnce(null);
		await expect(inbox.thread('reader', 'care', 'gone')).rejects.toMatchObject({ status: 404 });
		gmail.getAttachment.mockResolvedValueOnce(null);
		await expect(inbox.attachment('reader', 'care', 'm1', 'gone')).rejects.toMatchObject({ status: 404 });
	});

	it('hides a mailbox from people without access, and refuses sending to readers', async () => {
		await expect(inbox.threads('stranger', 'care', { folder: 'inbox' })).rejects.toMatchObject({ status: 404 });
		const request = {
			from: 'care@shop.test',
			to: ['a@x.test'],
			cc: [],
			bcc: [],
			sendAnyway: false,
			subject: 'Hi',
			body: 'x',
			attachments: [],
		};
		await expect(inbox.send('reader', 'care', request)).rejects.toMatchObject({ status: 403 });
		await w.access.replaceForMailbox('ghost', [{ mailboxId: 'ghost', adminUserId: 'reader', rights: ['read'] }]);
		await expect(inbox.threads('reader', 'ghost', { folder: 'inbox' })).rejects.toMatchObject({ status: 404 });
	});

	it('answers 409 for a mailbox that needs reconnecting or has lost its token', async () => {
		await w.mailboxes.save(mailbox('care', { status: 'needs_reconnect' }));
		await expect(inbox.threads('reader', 'care', { folder: 'inbox' })).rejects.toMatchObject({ status: 409 });
		await w.mailboxes.save(mailbox('care'));
		w.tokenMap.clear();
		await expect(inbox.threads('reader', 'care', { folder: 'inbox' })).rejects.toMatchObject({ status: 409 });
		expect(w.boxes.get('care')?.status).toBe('needs_reconnect');
	});

	it('sends from an allowed address with its name and signature, and audits it', async () => {
		const request = {
			from: 'Orders@shop.test',
			to: ['a@x.test'],
			cc: ['b@x.test'],
			bcc: [],
			sendAnyway: false,
			subject: 'Re: Hi',
			body: 'Thanks',
			threadId: 't1',
			inReplyTo: '<id@x>',
			attachments: [{ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.from('hello').toString('base64') }],
		};
		expect(await inbox.send('sender', 'care', request)).toEqual({ id: 'm1', threadId: 't1' });
		const mail = gmail.send.mock.calls[0]?.[1];
		expect(mail).toMatchObject({ from: 'orders@shop.test', fromName: 'Orders', signatureHtml: '', threadId: 't1' });
		expect(Buffer.from(mail.attachments[0].data).toString()).toBe('hello');
		expect(w.audit.at(-1)).toMatchObject({ action: 'mailbox.message_sent', entityId: 'care' });
	});

	it('refuses an address the mailbox cannot send as, and attachments over the limit', async () => {
		const base = {
			to: ['a@x.test'],
			cc: [],
			bcc: [],
			sendAnyway: false,
			subject: 'Hi',
			body: 'x',
			attachments: [],
		};
		await expect(inbox.send('sender', 'care', { ...base, from: 'evil@x.test' })).rejects.toMatchObject({
			status: 400,
		});
		const big = Buffer.alloc(11 * 1024 * 1024).toString('base64');
		await expect(
			inbox.send('sender', 'care', {
				...base,
				from: 'care@shop.test',
				attachments: [{ filename: 'big.bin', mimeType: 'application/octet-stream', data: big }],
			}),
		).rejects.toMatchObject({ status: 413 });
	});

	it('lets readers mark read and unread, and only senders archive, move, trash and restore', async () => {
		await inbox.modify('reader', 'care', 't1', { action: 'mark_read' });
		expect(gmail.modifyThread).toHaveBeenLastCalledWith(expect.anything(), 't1', { add: [], remove: ['UNREAD'] });
		await expect(inbox.modify('reader', 'care', 't1', { action: 'archive' })).rejects.toMatchObject({
			status: 403,
		});
		await inbox.modify('sender', 'care', 't1', { action: 'trash' });
		await inbox.modify('sender', 'care', 't1', { action: 'untrash' });
		expect(gmail.trashThread.mock.calls.map((call) => call[2])).toEqual([false, true]);
	});
});

describe('InboxService after the review (brief revision 2)', () => {
	let w: ReturnType<typeof world>;
	let gmail: ReturnType<typeof gmailStub>;
	let inbox: InboxService;

	const message = (id: string, overrides: Record<string, unknown> = {}) => ({
		id,
		from: '"Priya Banerjee" <priya@x.test>',
		to: 'care@shop.test',
		cc: '',
		replyTo: '',
		subject: 'Blouse',
		date: '2026-11-09T17:15:00.000Z',
		html: `<p>${id}</p>`,
		quoteHtml: '<blockquote>older</blockquote>',
		unread: false,
		text: `text ${id}`,
		hasRemoteImages: false,
		attachments: [],
		messageId: `<${id}@x>`,
		references: '<root@x>',
		contactForm: null,
		sentBy: null,
		...overrides,
	});

	beforeEach(async () => {
		w = world();
		gmail = gmailStub();
		inbox = new InboxService(
			gmail,
			w.mailboxes as never,
			w.access as never,
			w.tokens as never,
			books(w),
			w.outbox as never,
		);
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'u_riya', rights: ['read', 'send', 'organise', 'bin'] },
			{ mailboxId: 'care', adminUserId: 'reader', rights: ['read'] },
		]);
	});

	it('writes "last checked" at most every five minutes (T2)', async () => {
		const recent = new Date(Date.now() - 60_000).toISOString();
		await w.mailboxes.save(mailbox('care', { lastSyncAt: recent }));
		await inbox.summary('reader');
		expect(w.boxes.get('care')?.lastSyncAt).toBe(recent);
		await w.mailboxes.save(mailbox('care', { lastSyncAt: '2026-01-01T00:00:00.000Z' }));
		await inbox.summary('reader');
		expect(w.boxes.get('care')?.lastSyncAt).not.toBe('2026-01-01T00:00:00.000Z');
	});

	it('names the admin user who sent a message, in the conversation and on its list line (E8)', async () => {
		w.audit.push(
			{
				action: 'mailbox.message_sent',
				entityId: 'care',
				actorUserId: 'u_riya',
				metadata: { gmailMessageId: 'm2', threadId: 't1' },
				createdAt: '2026-11-09T18:00:00.000Z',
			},
			{
				action: 'mailbox.message_sent',
				entityId: 'care',
				actorUserId: 'u_nameless',
				metadata: { gmailMessageId: 'm9', threadId: 't9' },
				createdAt: '2026-11-09T18:00:00.000Z',
			},
			{
				action: 'mailbox.message_sent',
				entityId: 'care',
				actorUserId: null,
				metadata: {},
				createdAt: '2026-11-09T18:00:00.000Z',
			},
		);
		gmail.getThread.mockResolvedValueOnce({
			id: 't1',
			subject: 'Blouse',
			unread: false,
			messages: [message('m1'), message('m2', { date: '2026-11-09T18:00:01.000Z' })],
		});
		const thread = await inbox.thread('reader', 'care', 't1');
		expect(thread.messages.map((entry) => entry.sentBy)).toEqual([null, 'Riya']);

		gmail.listThreads.mockResolvedValueOnce({
			threads: [
				{ id: 't1', date: '2026-11-09T18:00:01.000Z', lastReplyBy: null },
				{ id: 't9', date: '2026-11-09T18:00:01.000Z', lastReplyBy: null },
			],
			nextPageToken: null,
		});
		const page = await inbox.threads('reader', 'care', { folder: 'inbox' });
		expect(page.threads.map((entry) => entry.lastReplyBy)).toEqual(['Riya', null]);

		gmail.getThread.mockResolvedValueOnce({ id: 't0', subject: '', unread: false, messages: [] });
		expect((await inbox.thread('reader', 'care', 't0')).messages).toEqual([]);
		const quiet = new InboxService(
			gmail,
			w.mailboxes as never,
			w.access as never,
			w.tokens as never,
			books(w, false),
			w.outbox as never,
		);
		gmail.listThreads.mockResolvedValueOnce({
			threads: [{ id: 't1', date: '2026-11-09T18:00:01.000Z' }],
			nextPageToken: null,
		});
		expect((await quiet.threads('reader', 'care', { folder: 'inbox' })).threads[0]?.lastReplyBy).toBeNull();
	});

	it("reads a sender's name from their username or email when they have no display name", async () => {
		const users = {
			findById: async (id: string) =>
				({ u1: { username: 'arup' }, u2: { email: 'mitali@shop.test' }, u3: {} })[id] ??
				Promise.reject(new Error('down')),
		};
		const named = new MailboxBookkeeping(w.mailboxes as never, w.auditLog as never, users as never);
		const sent = (actorUserId: string, gmailMessageId: string) => ({
			action: 'mailbox.message_sent',
			entityId: 'care',
			actorUserId,
			metadata: { gmailMessageId, threadId: 't1' },
			createdAt: '2026-11-09T18:00:00.000Z',
		});
		w.audit.push(sent('u1', 'a'), sent('u2', 'b'), sent('u3', 'c'), sent('u4', 'd'), sent('u1', 'e'));
		expect((await named.sentFromAdmin('care', '2026-11-01T00:00:00.000Z')).map((row) => row.sentBy)).toEqual([
			'arup',
			'mitali',
			'arup',
		]);
		const nobody = new MailboxBookkeeping(w.mailboxes as never, w.auditLog as never);
		expect(await nobody.sentFromAdmin('care', '2026-11-01T00:00:00.000Z')).toEqual([]);
	});

	it('quotes the answered message from Gmail and carries its References on (E3, E4)', async () => {
		gmail.getThread.mockResolvedValueOnce({
			id: 't1',
			subject: 'Blouse',
			unread: false,
			messages: [message('m1')],
		});
		await inbox.send('u_riya', 'care', {
			from: 'care@shop.test',
			to: ['priya@x.test'],
			cc: [],
			bcc: [],
			sendAnyway: false,
			subject: 'Re: Blouse',
			body: 'Yes',
			threadId: 't1',
			inReplyTo: '<m1@x>',
			quoteMessageId: 'm1',
			attachments: [],
		});
		expect(gmail.send.mock.calls[0]?.[1]).toMatchObject({
			references: '<root@x>',
			quote: {
				attribution: 'On 9 Nov 2026, 22:45, Priya Banerjee wrote:',
				html: '<p>m1</p><blockquote>older</blockquote>',
				text: 'text m1',
			},
		});
		expect(w.audit.at(-1)).toMatchObject({ metadata: { gmailMessageId: 'm1', threadId: 't1' } });
		gmail.getThread.mockResolvedValueOnce(null);
		await expect(
			inbox.send('u_riya', 'care', {
				from: 'care@shop.test',
				to: ['priya@x.test'],
				cc: [],
				bcc: [],
				sendAnyway: false,
				subject: 'Re: Blouse',
				body: 'Yes',
				threadId: 'gone',
				attachments: [],
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it('copies the original attachments into a forward, within 25 MB (E5)', async () => {
		const withFiles = {
			id: 't1',
			subject: 'Bill',
			unread: false,
			messages: [
				message('m1', {
					attachments: [{ id: 'a1', filename: 'bill.pdf', mimeType: 'application/pdf', size: 2 }],
				}),
			],
		};
		const forward = {
			from: 'care@shop.test',
			to: ['accounts@shop.test'],
			cc: [],
			bcc: [],
			sendAnyway: false,
			subject: 'Fwd: Bill',
			body: 'See below',
			forwardAttachmentsFrom: { threadId: 't1', messageId: 'm1' },
			attachments: [],
		};
		gmail.getThread.mockResolvedValueOnce(withFiles);
		await inbox.send('u_riya', 'care', forward);
		const mail = gmail.send.mock.calls.at(-1)?.[1];
		expect(mail.attachments.map((file: { filename: string }) => file.filename)).toEqual(['bill.pdf']);
		expect(mail.threadId).toBeUndefined();

		gmail.getThread.mockResolvedValueOnce(withFiles);
		gmail.getAttachment.mockResolvedValueOnce({ data: new Uint8Array(26 * 1024 * 1024) });
		await expect(inbox.send('u_riya', 'care', forward)).rejects.toMatchObject({ status: 413 });
		gmail.getThread.mockResolvedValueOnce(withFiles);
		gmail.getAttachment.mockResolvedValueOnce(null);
		await expect(inbox.send('u_riya', 'care', forward)).rejects.toMatchObject({ status: 404 });
		gmail.getThread.mockResolvedValueOnce(null);
		await expect(inbox.send('u_riya', 'care', forward)).rejects.toMatchObject({ status: 404 });
	});

	it('stops offering an alias Gmail no longer lets the mailbox send as', async () => {
		const request = {
			from: 'orders@shop.test',
			to: ['a@x.test'],
			cc: [],
			bcc: [],
			sendAnyway: false,
			subject: 'Hi',
			body: 'x',
			attachments: [],
		};
		gmail.send.mockRejectedValueOnce(Object.assign(new Error('Gmail POST failed'), { status: 400 }));
		await expect(inbox.send('u_riya', 'care', request)).rejects.toMatchObject({ status: 400 });
		expect(w.boxes.get('care')?.sendAs.map((entry) => entry.address)).toEqual(['care@shop.test']);

		await w.mailboxes.save(mailbox('care'));
		gmail.send.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
		gmail.listSendAs.mockResolvedValueOnce(mailbox('care').sendAs);
		await expect(inbox.send('u_riya', 'care', request)).rejects.toMatchObject({ status: 502 });
		gmail.send.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
		gmail.listSendAs.mockRejectedValueOnce(new Error('down'));
		await expect(inbox.send('u_riya', 'care', request)).rejects.toMatchObject({ status: 502 });
		gmail.send.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }));
		await expect(inbox.send('u_riya', 'care', request)).rejects.toMatchObject({ status: 429 });
		expect(w.boxes.get('care')?.sendAs).toHaveLength(2);
	});

	it("reports spam and takes it back with Gmail's own label, for senders only (E12)", async () => {
		await inbox.modify('u_riya', 'care', 't1', { action: 'spam' });
		expect(gmail.modifyThread).toHaveBeenLastCalledWith(expect.anything(), 't1', {
			add: ['SPAM'],
			remove: ['INBOX'],
		});
		await inbox.modify('u_riya', 'care', 't1', { action: 'not_spam' });
		expect(gmail.modifyThread).toHaveBeenLastCalledWith(expect.anything(), 't1', {
			add: ['INBOX'],
			remove: ['SPAM'],
		});
		await expect(inbox.modify('reader', 'care', 't1', { action: 'spam' })).rejects.toMatchObject({ status: 403 });
	});
});

describe('ContactMessagesService', () => {
	let w: ReturnType<typeof world>;
	let gmail: ReturnType<typeof gmailStub>;
	let contact: ContactMessagesService;
	const form = (overrides: Record<string, unknown> = {}) =>
		({
			name: 'Rina Das',
			email: 'rina@x.test',
			phone: '98366 63137',
			subject: 'Blouse size',
			message: 'Do you stitch blouses?',
			locale: 'bn',
			website: '',
			elapsedMs: 9_000,
			...overrides,
		}) as never;
	const make = (config = mailConfig()) =>
		new ContactMessagesService(
			w.contactRepo as never,
			gmail,
			w.mailboxes as never,
			w.tokens as never,
			w.settings as never,
			config,
			LanguageStore.fixed(['en', 'bn']),
		);
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(async () => {
		w = world();
		gmail = gmailStub();
		contact = make();
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		await w.settings.set('mailboxes.contact', { mailboxId: 'care' });
	});

	it('stores a message and places it in the chosen mailbox, from and Reply-To the customer', async () => {
		await contact.submit(form(), '10.0.0.1');
		await flush();
		const [saved] = [...w.contacts.values()];
		expect(saved).toMatchObject({
			status: 'delivered',
			phone: '+919836663137',
			mailboxId: 'care',
			gmailMessageId: 'g1',
			attempts: 1,
		});
		expect(saved?.ipHash).not.toContain('10.0.0.1');
		const [, mail] = gmail.importMessage.mock.calls[0] ?? [];
		expect(mail).toMatchObject({
			fromName: 'Rina Das',
			fromAddress: 'rina@x.test',
			to: 'care@shop.test',
			replyTo: 'rina@x.test',
			subject: 'Contact Us: Blouse size',
		});
		expect(mail.text).toContain('Reply in: বাংলা');
		expect(mail.text).toContain('Phone: +919836663137');
	});

	it('answers a language the shop no longer offers in English', async () => {
		contact = make();
		const save = vi.spyOn(w.contactRepo, 'save');
		await contact.submit(form({ locale: 'hi' }), '203.0.113.9');
		expect(save.mock.calls[0]?.[0].locale).toBe('en');
	});

	it('drops bots silently and skips a repeat within a day', async () => {
		await contact.submit(form({ website: 'spam.test' }), '1.1.1.1');
		await contact.submit(form({ elapsedMs: 800 }), '1.1.1.1');
		expect(w.contacts.size).toBe(0);
		await contact.submit(form({ phone: '' }), '1.1.1.1');
		await contact.submit(form(), '1.1.1.1');
		await flush();
		expect(w.contacts.size).toBe(1);
		expect([...w.contacts.values()][0]?.phone).toBeNull();
	});

	it('keeps a message waiting when no connected mailbox is chosen, then delivers on the sweep', async () => {
		w.settingMap.clear();
		await contact.submit(form({ locale: 'en' }), '1.1.1.1');
		await flush();
		const [waiting] = [...w.contacts.values()];
		expect(waiting).toMatchObject({ status: 'queued', lastError: 'No connected Contact Us mailbox is chosen.' });
		await w.settings.set('mailboxes.contact', { mailboxId: 'care' });
		expect(await contact.sweep()).toBe(1);
		expect([...w.contacts.values()][0]?.status).toBe('delivered');
		expect(gmail.importMessage.mock.calls[0]?.[1].text).toContain('Reply in: English');
	});

	it('records a failed attempt, marks a withdrawn mailbox, and stops retrying after three days', async () => {
		gmail.importMessage.mockRejectedValueOnce({ status: 503 });
		await contact.submit(form(), '1.1.1.1');
		await flush();
		expect([...w.contacts.values()][0]).toMatchObject({ status: 'failed', lastError: 'Gmail 503', attempts: 1 });
		gmail.importMessage.mockRejectedValueOnce(new MailboxAccessRevoked('care@shop.test'));
		expect(await contact.sweep()).toBe(0);
		expect([...w.contacts.values()][0]).toMatchObject({ lastError: 'Mailbox needs reconnecting.', attempts: 2 });
		expect(w.boxes.get('care')?.status).toBe('needs_reconnect');
		await w.mailboxes.save(mailbox('care'));
		gmail.importMessage.mockRejectedValueOnce(new Error('odd'));
		await contact.sweep();
		expect([...w.contacts.values()][0]?.lastError).toBe('Gmail error');
		const late = new Date(Date.now() + CONTACT_RETRY_FOR_MS + 60_000);
		expect(await contact.sweep(late)).toBe(0);
	});

	it('logs a delivery that throws outside Gmail, and hashes the address without a key', async () => {
		const broken = make(mailConfig({ tokenKey: undefined }));
		vi.spyOn(w.settings, 'get').mockRejectedValueOnce(new Error('db down'));
		await broken.submit(form(), '2.2.2.2');
		await flush();
		expect([...w.contacts.values()][0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
	});

	describe('the retry timer', () => {
		afterEach(() => {
			vi.useRealTimers();
			vi.unstubAllEnvs();
		});

		it('sweeps every five minutes outside tests, and stops on shutdown', () => {
			vi.useFakeTimers();
			vi.stubEnv('VITEST', '');
			const sweep = vi.spyOn(contact, 'sweep').mockResolvedValue(0);
			contact.onApplicationBootstrap();
			vi.advanceTimersByTime(CONTACT_SWEEP_MS);
			expect(sweep).toHaveBeenCalledTimes(1);
			contact.onApplicationShutdown();
			vi.advanceTimersByTime(CONTACT_SWEEP_MS);
			expect(sweep).toHaveBeenCalledTimes(1);
		});

		it('does not start under tests or the documentation build', () => {
			contact.onApplicationBootstrap();
			contact.onApplicationShutdown();
			vi.stubEnv('VITEST', '');
			vi.stubEnv('SAHA_TEXTILE_DOCUMENTATION_BUILD', '1');
			const sweep = vi.spyOn(contact, 'sweep');
			contact.onApplicationBootstrap();
			expect(sweep).not.toHaveBeenCalled();
		});
	});
});

describe('mailbox controllers', () => {
	const principal = { userId: 'u1' } as never;

	it('passes the signed-in admin through, and refuses without one', async () => {
		const service = {
			list: vi.fn(async () => ({ rows: [] })),
			connectUrl: vi.fn(async () => ({ url: 'https://accounts.test' })),
			requireSuperAdmin: vi.fn(async () => undefined),
			retryRevocation: vi.fn(async () => mailbox('care')),
			completeSignIn: vi.fn(async () => 'https://admin.test/setting/mailboxes'),
			setContactTarget: vi.fn(async () => ({ mailboxId: null })),
			getAccess: vi.fn(async () => []),
			setAccess: vi.fn(async () => []),
			refreshSendAs: vi.fn(async () => mailbox('care')),
			disconnect: vi.fn(async () => mailbox('care')),
		};
		const controller = new AdminMailboxesController(service as never);
		await controller.list(principal);
		expect(await controller.connect(principal)).toEqual({ url: 'https://accounts.test' });
		await expect(controller.connect(undefined)).rejects.toThrow();
		expect(await controller.callback({ state: 's' })).toEqual({
			url: 'https://admin.test/setting/mailboxes',
			statusCode: 302,
		});
		await expect(controller.contactTarget({ mailboxId: null }, undefined)).rejects.toThrow();
		await controller.contactTarget({ mailboxId: 'care' }, principal);
		expect(service.setContactTarget).toHaveBeenLastCalledWith('care', 'u1');
		await controller.getAccess('care', principal);
		await controller.setAccess('care', { version: 0, entries: [] }, principal);
		expect(service.setAccess).toHaveBeenCalledWith('care', { version: 0, entries: [] }, 'u1');
		await controller.refresh('care', principal);
		await controller.disconnect('care', principal);
		await controller.withdrawAgain('care', principal);
		expect(service.requireSuperAdmin).toHaveBeenCalledTimes(8);
	});

	it('serves the Inbox as the signed-in admin, attachments always as downloads', async () => {
		const service = {
			summary: vi.fn(async () => []),
			threads: vi.fn(async () => ({ threads: [], nextPageToken: null })),
			thread: vi.fn(async () => ({})),
			attachment: vi.fn(async () => new Uint8Array([1])),
			send: vi.fn(async () => ({ id: 'm', threadId: 't' })),
			queueSend: vi.fn(async () => ({ outboxId: 'o', draftId: 'd', sendAt: '' })),
			modify: vi.fn(async () => undefined),
		};
		const controller = new AdminInboxController(service as never, {} as never);
		await controller.summary(principal);
		expect(() => controller.summary(undefined)).toThrow();
		await controller.threads('care', { folder: 'inbox' }, principal);
		await controller.thread('care', 't1', principal);
		const headers: Record<string, string> = {};
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return reply;
			},
			send: vi.fn(async () => undefined),
		};
		await controller.attachment('care', 'm1', 'a1', 'bad<name>.pdf', principal, reply as never);
		expect(headers['Content-Disposition']).toBe('attachment; filename="bad_name_.pdf"');
		expect(headers['X-Content-Type-Options']).toBe('nosniff');
		await controller.attachment('care', 'm1', 'a1', undefined, principal, reply as never);
		expect(headers['Content-Disposition']).toBe('attachment; filename="attachment"');
		await controller.attachment('care', 'm1', 'a1', '<>', principal, reply as never);
		expect(headers['Content-Disposition']).toBe('attachment; filename="_"');
		await controller.attachment('care', 'm1', 'a1', '', principal, reply as never);
		expect(headers['Content-Disposition']).toBe('attachment; filename="attachment"');
		await controller.send(
			'care',
			{
				from: 'care@shop.test',
				to: [],
				cc: [],
				bcc: [],
				sendAnyway: false,
				subject: 's',
				body: '',
				attachments: [],
				keepDraftAttachments: false,
			},
			principal,
		);
		// The Inbox's Send waits for Undo; the immediate send is for purchase orders only.
		expect(service.queueSend).toHaveBeenCalledTimes(1);
		expect(service.send).not.toHaveBeenCalled();
		expect(await controller.modify('care', 't1', { action: 'mark_read' }, principal)).toEqual({ ok: true });
	});

	it('rate-limits Contact Us by sender and address before taking the message', async () => {
		const contact = { submit: vi.fn(async () => undefined) };
		const limits = { enforce: vi.fn(async () => undefined) };
		const controller = new ContactMessagesController(contact as never, limits as never);
		const body = { email: 'rina@x.test' } as never;
		expect(await controller.send(body, { ip: '1.1.1.1' } as never)).toEqual({ accepted: true });
		expect(limits.enforce).toHaveBeenCalledWith('contact_message', { identifier: 'rina@x.test', ip: '1.1.1.1' });
		expect(contact.submit).toHaveBeenCalledWith(body, '1.1.1.1');
	});
});

describe('unconfigured Gmail', () => {
	it('answers "not set up" for every mailbox call, and stores no tokens', async () => {
		const adapter = new UnavailableMailboxAdapter();
		expect(() => adapter.signInUrl()).toThrow('Gmail is not set up');
		await expect(adapter.unreadCount()).rejects.toMatchObject({ status: 503 });
		const tokens = new UnavailableMailboxTokenStore();
		await expect(tokens.put()).rejects.toMatchObject({ status: 503 });
		expect(await tokens.get()).toBeNull();
		await expect(tokens.remove()).resolves.toBeUndefined();
	});
});

describe('Drafts and Undo Send (C2, C4)', () => {
	let w: ReturnType<typeof world>;
	let gmail: ReturnType<typeof gmailStub>;
	let inbox: InboxService;
	const request = {
		from: 'care@shop.test',
		to: ['a@x.test'],
		cc: [],
		bcc: ['hidden@x.test'],
		sendAnyway: false,
		keepDraftAttachments: false,
		subject: 'Hello',
		body: 'Thanks',
		attachments: [],
	};
	const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
	const draft = (version: string) => ({
		draftId: 'd1',
		version,
		threadId: null,
		from: 'care@shop.test',
		to: 'a@x.test',
		cc: '',
		bcc: '',
		subject: 'Hello',
		text: 'Thanks',
		attachments: [],
		date: '2026-11-19T10:00:00.000Z',
		inReplyTo: null,
		quoteMessageId: null,
		forwardAttachmentsFrom: null,
	});

	beforeEach(async () => {
		w = world();
		gmail = gmailStub();
		inbox = new InboxService(
			gmail,
			w.mailboxes as never,
			w.access as never,
			w.tokens as never,
			books(w),
			w.outbox as never,
		);
		await w.mailboxes.save(mailbox('care'));
		await w.tokens.put('care', 'r1');
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'u_riya', rights: ['read', 'send'] },
			{ mailboxId: 'care', adminUserId: 'u_other', rights: ['read', 'send'] },
			{ mailboxId: 'care', adminUserId: 'reader', rights: ['read'] },
		]);
	});

	it('queues a send as a Gmail draft with its own Message-ID, and sends nothing yet', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		expect(gmail.send).not.toHaveBeenCalled();
		expect(gmail.sendDraft).not.toHaveBeenCalled();
		const mail = gmail.createDraft.mock.calls[0]?.[1];
		expect(mail.messageId).toMatch(/^outbox-[0-9a-f-]+@shop\.test$/);
		expect(mail.signatureHtml).toBe('<b>Team</b>');
		const waited = Date.parse(queued.sendAt) - Date.now();
		expect(waited).toBeGreaterThan(9_000);
		expect(waited).toBeLessThanOrEqual(10_000);
		expect(await inbox.dispatchDue()).toBe(0);
		expect(gmail.sendDraft).not.toHaveBeenCalled();
	});

	it('sends after the wait, once, and records who sent it', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		expect(await inbox.dispatchDue(later(11))).toBe(1);
		expect(await inbox.dispatchDue(later(13))).toBe(0);
		expect(gmail.sendDraft).toHaveBeenCalledTimes(1);
		expect(await inbox.outboxStatus('u_riya', 'care', queued.outboxId)).toMatchObject({
			status: 'sent',
			sentMessageId: 'sent1',
		});
		const sent = w.audit.at(-1);
		expect(sent).toMatchObject({ action: 'mailbox.message_sent', actorUserId: 'u_riya', entityId: 'care' });
		expect(JSON.stringify(sent)).not.toContain('a@x.test');
		expect(JSON.stringify(sent)).not.toContain('Thanks');
	});

	it('Undo keeps the message in Drafts; too late answers 409', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		expect(await inbox.cancelSend('u_riya', 'care', queued.outboxId)).toEqual({ draftId: 'd1' });
		expect(await inbox.dispatchDue(later(11))).toBe(0);
		expect(gmail.sendDraft).not.toHaveBeenCalled();
		const second = await inbox.queueSend('u_riya', 'care', request);
		await inbox.dispatchDue(later(11));
		await expect(inbox.cancelSend('u_riya', 'care', second.outboxId)).rejects.toMatchObject({ status: 409 });
	});

	it('lets only the writer see or undo a queued message', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		await expect(inbox.cancelSend('u_other', 'care', queued.outboxId)).rejects.toMatchObject({ status: 404 });
		await expect(inbox.outboxStatus('u_other', 'care', queued.outboxId)).rejects.toMatchObject({ status: 404 });
		await expect(inbox.cancelSend('reader', 'care', queued.outboxId)).rejects.toMatchObject({ status: 403 });
		await expect(inbox.cancelSend('u_riya', 'other', queued.outboxId)).rejects.toMatchObject({ status: 404 });
	});

	it('sends nothing when the Send right was removed during the wait', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		await w.access.replaceForMailbox('care', [{ mailboxId: 'care', adminUserId: 'u_riya', rights: ['read'] }]);
		await inbox.dispatchDue(later(11));
		expect(gmail.sendDraft).not.toHaveBeenCalled();
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('failed');
	});

	it('never resends blindly after an unanswered send: Sent is checked first', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		gmail.sendDraft.mockRejectedValueOnce(Object.assign(new Error('socket'), { status: 503 }));
		await inbox.dispatchDue(later(11));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('uncertain');
		// It went after all: found in Sent by its Message-ID, never sent a second time.
		gmail.findByMessageId.mockResolvedValueOnce({ id: 'found1', threadId: 't9' });
		await inbox.dispatchDue(later(13));
		expect(gmail.sendDraft).toHaveBeenCalledTimes(1);
		expect(w.outboxRows.get(queued.outboxId)).toMatchObject({ status: 'sent', sentMessageId: 'found1' });
	});

	it('tries again only when the draft is still there, three times in all', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		gmail.sendDraft.mockRejectedValue(Object.assign(new Error('socket'), { status: 503 }));
		gmail.getDraft.mockResolvedValue(draft('v1'));
		for (let round = 0; round < 8; round += 1) await inbox.dispatchDue(later(11 + round * 2));
		expect(gmail.sendDraft).toHaveBeenCalledTimes(3);
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('failed');
	});

	it('calls a send gone only when neither Sent nor Drafts has it after a minute', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		gmail.sendDraft.mockResolvedValueOnce(null);
		await inbox.dispatchDue(later(11));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('uncertain');
		await inbox.dispatchDue(later(20));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('uncertain');
		await inbox.dispatchDue(later(90));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('gone');
	});

	it('retries a busy Gmail safely, and looks up a send interrupted by a restart', async () => {
		const queued = await inbox.queueSend('u_riya', 'care', request);
		gmail.sendDraft.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }));
		await inbox.dispatchDue(later(11));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('queued');
		await inbox.dispatchDue(later(13));
		expect(w.outboxRows.get(queued.outboxId)?.status).toBe('sent');

		const stuck = await inbox.queueSend('u_riya', 'care', request);
		Object.assign(w.outboxRows.get(stuck.outboxId)!, { status: 'sending', claimedAt: later(11).toISOString() });
		await inbox.dispatchDue(later(60));
		expect(w.outboxRows.get(stuck.outboxId)?.status).toBe('sending');
		gmail.findByMessageId.mockResolvedValueOnce({ id: 'found2', threadId: 't9' });
		await inbox.dispatchDue(later(200));
		expect(w.outboxRows.get(stuck.outboxId)?.status).toBe('sent');
	});

	it('sends the draft it was written in, and never queues one draft twice', async () => {
		await inbox.queueSend('u_riya', 'care', { ...request, draftId: 'd1', keepDraftAttachments: true });
		expect(gmail.updateDraft.mock.calls[0]?.slice(2)).toEqual([expect.anything(), true]);
		expect(gmail.createDraft).not.toHaveBeenCalled();
		await expect(inbox.queueSend('u_riya', 'care', { ...request, draftId: 'd1' })).rejects.toMatchObject({
			status: 409,
		});
		await expect(
			inbox.saveDraft('u_riya', 'care', 'd1', { ...request, keepAttachments: false }),
		).rejects.toMatchObject({ status: 409 });
		await expect(inbox.deleteDraft('u_riya', 'care', 'd1')).rejects.toMatchObject({ status: 409 });
	});

	it('refuses to send a deleted draft whose saved files would be lost', async () => {
		gmail.updateDraft.mockResolvedValueOnce(null);
		await expect(
			inbox.queueSend('u_riya', 'care', { ...request, draftId: 'gone', keepDraftAttachments: true }),
		).rejects.toMatchObject({ status: 404 });
		gmail.updateDraft.mockResolvedValueOnce(null);
		await inbox.queueSend('u_riya', 'care', { ...request, draftId: 'gone' });
		expect(gmail.createDraft).toHaveBeenCalledTimes(1);
	});

	it('saves a draft as typed text only: no signature or quote, hints kept to reopen it', async () => {
		gmail.getThread.mockResolvedValue({
			id: 't1',
			subject: 'S',
			unread: false,
			messages: [
				{
					id: 'q1',
					messageId: '<q1@x>',
					references: '<r@x>',
					html: '<p>old</p>',
					quoteHtml: '',
					text: 'old',
					from: 'a',
					date: '2026-11-19T09:00:00.000Z',
					attachments: [],
				},
			],
		});
		const saved = await inbox.saveDraft('u_riya', 'care', null, {
			...request,
			to: [],
			subject: '',
			threadId: 't1',
			inReplyTo: '<q1@x>',
			quoteMessageId: 'q1',
			forwardAttachmentsFrom: { threadId: 't1', messageId: 'q1' },
			keepAttachments: false,
		});
		expect(saved).toMatchObject({ draftId: 'd1', version: 'v1' });
		const mail = gmail.createDraft.mock.calls[0]?.[1];
		expect(mail).toMatchObject({ signatureHtml: '', quote: undefined, references: '<r@x>' });
		expect(mail.draftHints).toEqual({ quoteMessageId: 'q1', forwardFrom: { threadId: 't1', messageId: 'q1' } });
		expect(gmail.getAttachment).not.toHaveBeenCalled();
	});

	it('answers 412 when someone saved the draft since, and 404 when it is gone', async () => {
		gmail.getDraft.mockResolvedValueOnce(draft('v5'));
		await expect(
			inbox.saveDraft('u_riya', 'care', 'd1', { ...request, version: 'v1', keepAttachments: true }),
		).rejects.toMatchObject({ status: 412 });
		gmail.getDraft.mockResolvedValueOnce(draft('v5'));
		expect(
			await inbox.saveDraft('u_riya', 'care', 'd1', { ...request, version: 'v5', keepAttachments: true }),
		).toMatchObject({ draftId: 'd1', version: 'v2' });
		expect(gmail.updateDraft.mock.calls[0]?.[3]).toBe(true);
		gmail.getDraft.mockResolvedValueOnce(null);
		await expect(
			inbox.saveDraft('u_riya', 'care', 'd1', { ...request, version: 'v5', keepAttachments: true }),
		).rejects.toMatchObject({ status: 404 });
	});

	it('needs the Send right for drafts, and audits a discard', async () => {
		await expect(inbox.listDrafts('reader', 'care')).rejects.toMatchObject({ status: 403 });
		await expect(inbox.getDraft('u_riya', 'care', 'nope')).rejects.toMatchObject({ status: 404 });
		gmail.getDraft.mockResolvedValueOnce(draft('v1'));
		expect(await inbox.getDraft('u_riya', 'care', 'd1')).toMatchObject({ draftId: 'd1' });
		expect(await inbox.listDrafts('u_riya', 'care')).toEqual({ drafts: [], nextPageToken: null });
		await inbox.deleteDraft('u_riya', 'care', 'd1');
		expect(gmail.deleteDraft).toHaveBeenCalledWith(expect.anything(), 'd1');
		expect(w.audit.at(-1)).toMatchObject({ action: 'mailbox.draft_deleted', actorUserId: 'u_riya' });
	});
});

describe('Saved replies (C3)', () => {
	const store = () => {
		const rows = new Map<string, StoredSavedReply>();
		return {
			rows,
			listShared: async (mailboxId: string) =>
				[...rows.values()].filter((row) => row.scope === 'shared' && row.mailboxId === mailboxId),
			listPersonal: async (adminUserId: string) =>
				[...rows.values()].filter((row) => row.scope === 'personal' && row.ownerAdminUserId === adminUserId),
			findById: async (id: string) => rows.get(id) ?? null,
			create: async (reply: StoredSavedReply) => {
				rows.set(reply.id, reply);
				return reply;
			},
			update: async (id: string, change: Partial<StoredSavedReply>) => {
				const row = rows.get(id);
				if (!row) return null;
				Object.assign(row, change);
				return row;
			},
			delete: async (id: string) => rows.delete(id),
		};
	};
	let w: ReturnType<typeof world>;
	let replies: ReturnType<typeof store>;
	let service: SavedRepliesService;
	const write = { title: 'Where is my order', body: 'Your order ships in 3 days.' };

	beforeEach(async () => {
		w = world();
		replies = store();
		service = new SavedRepliesService(replies as never, w.access as never, books(w));
		await w.access.replaceForMailbox('care', [
			{ mailboxId: 'care', adminUserId: 'boss', rights: ['read', 'send', 'settings'] },
			{ mailboxId: 'care', adminUserId: 'riya', rights: ['read', 'send'] },
			{ mailboxId: 'care', adminUserId: 'reader', rights: ['read'] },
		]);
		await w.access.replaceForMailbox('orders', [
			{ mailboxId: 'orders', adminUserId: 'boss', rights: ['read', 'send', 'settings'] },
		]);
	});

	it('lets everyone who may send use shared replies, and only the Settings right change them', async () => {
		const shared = await service.create('boss', 'care', { ...write, scope: 'shared' });
		expect(shared).toMatchObject({ scope: 'shared', editable: true });
		const seen = await service.list('riya', 'care');
		expect(seen).toMatchObject({ canEditShared: false, personal: [] });
		expect(seen.shared).toEqual([expect.objectContaining({ id: shared.id, editable: false })]);
		await expect(service.create('riya', 'care', { ...write, scope: 'shared' })).rejects.toMatchObject({
			status: 403,
		});
		await expect(service.update('riya', 'care', shared.id, write)).rejects.toMatchObject({ status: 403 });
		await expect(service.remove('riya', 'care', shared.id)).rejects.toMatchObject({ status: 403 });
		expect(await service.update('boss', 'care', shared.id, { ...write, title: 'Delivery time' })).toMatchObject({
			title: 'Delivery time',
		});
	});

	it('keeps shared replies to their own mailbox', async () => {
		const shared = await service.create('boss', 'care', { ...write, scope: 'shared' });
		expect((await service.list('boss', 'orders')).shared).toEqual([]);
		await expect(service.update('boss', 'orders', shared.id, write)).rejects.toMatchObject({ status: 404 });
	});

	it('gives each person their own personal replies, in any mailbox they send from', async () => {
		const own = await service.create('riya', 'care', { ...write, scope: 'personal' });
		expect((await service.list('riya', 'care')).personal).toEqual([
			expect.objectContaining({ id: own.id, editable: true }),
		]);
		expect((await service.list('boss', 'care')).personal).toEqual([]);
		await expect(service.update('boss', 'care', own.id, write)).rejects.toMatchObject({ status: 404 });
		await expect(service.remove('boss', 'care', own.id)).rejects.toMatchObject({ status: 404 });
		await service.remove('riya', 'care', own.id);
		expect(replies.rows.size).toBe(0);
		await expect(service.remove('riya', 'care', own.id)).rejects.toMatchObject({ status: 404 });
	});

	it('needs the Send right in the mailbox named, and hides mailboxes not given', async () => {
		await expect(service.list('reader', 'care')).rejects.toMatchObject({ status: 403 });
		await expect(service.list('riya', 'orders')).rejects.toMatchObject({ status: 404 });
	});

	it('stops at 100 per mailbox or person, and audits changes without their text', async () => {
		for (let index = 0; index < 100; index += 1) {
			await service.create('riya', 'care', { ...write, scope: 'personal' });
		}
		await expect(service.create('riya', 'care', { ...write, scope: 'personal' })).rejects.toMatchObject({
			status: 409,
		});
		expect(await service.create('riya', 'care', { ...write, scope: 'personal' }).catch(() => null)).toBeNull();
		const entry = w.audit.find((row) => row.action === SAVED_REPLY_CHANGED);
		expect(entry).toMatchObject({ actorUserId: 'riya', entityId: 'care' });
		expect(JSON.stringify(entry)).not.toContain('ships in 3 days');
		replies.update = async () => null;
		const first = [...replies.rows.values()][0];
		await expect(service.update('riya', 'care', first?.id ?? '', write)).rejects.toMatchObject({ status: 404 });
	});

	it('serves the routes as the signed-in admin', async () => {
		const saved = {
			list: vi.fn(async () => ({})),
			create: vi.fn(async () => ({})),
			update: vi.fn(async () => ({})),
			remove: vi.fn(async () => undefined),
		};
		const controller = new AdminInboxController({} as never, saved as never);
		const principal = { userId: 'riya' } as never;
		await controller.listSavedReplies('care', principal);
		await controller.createSavedReply('care', { ...write, scope: 'personal' }, principal);
		await controller.updateSavedReply('care', 'srp_1', write, principal);
		await controller.deleteSavedReply('care', 'srp_1', principal);
		expect(saved.list).toHaveBeenCalledWith('riya', 'care');
		expect(saved.remove).toHaveBeenCalledWith('riya', 'care', 'srp_1');
	});
});
