import { describe, expect, it } from 'vitest';

import { MailboxAccessRevoked } from '../src/ports/mailbox.port';
import {
	ACTION_RIGHT,
	FOLDER_LABELS,
	labelChange,
	legacyMailboxRights,
	mailboxRights,
	onDomain,
	replySubject,
	withNeededRights,
} from '../src/mailbox/mailbox-rules';

describe('mailbox rules', () => {
	const access = [
		{ mailboxId: 'm1', adminUserId: 'riya', rights: legacyMailboxRights(true) },
		{ mailboxId: 'm1', adminUserId: 'arup', rights: legacyMailboxRights(false) },
	];

	it('gives each admin user only the rights they were given, mailbox by mailbox', () => {
		expect([...mailboxRights(access, 'riya', 'm1')]).toEqual(['read', 'send', 'organise', 'bin']);
		expect([...mailboxRights(access, 'arup', 'm1')]).toEqual(['read']);
		expect(mailboxRights(access, 'arup', 'm2').size).toBe(0);
		expect(mailboxRights(access, 'owner', 'm1').size).toBe(0);
	});

	it('adds what each right needs, once, in a fixed order', () => {
		expect(withNeededRights(['delete_forever'])).toEqual(['read', 'bin', 'delete_forever']);
		expect(withNeededRights(['settings', 'send', 'send'])).toEqual(['read', 'send', 'settings']);
		expect(ACTION_RIGHT.trash).toBe('bin');
		expect(ACTION_RIGHT.archive).toBe('organise');
	});

	it('maps folders, actions and reply subjects', () => {
		expect(FOLDER_LABELS.all).toBeNull();
		expect(labelChange('mark_read')).toEqual({ add: [], remove: ['UNREAD'] });
		expect(labelChange('mark_unread')).toEqual({ add: ['UNREAD'], remove: [] });
		expect(labelChange('archive')).toEqual({ add: [], remove: ['INBOX'] });
		expect(labelChange('move_to_inbox')).toEqual({ add: ['INBOX'], remove: [] });
		expect(labelChange('spam')).toEqual({ add: ['SPAM'], remove: ['INBOX'] });
		expect(labelChange('not_spam')).toEqual({ add: ['INBOX'], remove: ['SPAM'] });
		expect(replySubject(' Blouse ')).toBe('Re: Blouse');
		expect(replySubject('RE: Blouse')).toBe('RE: Blouse');
	});

	it('keeps mailboxes on the shop domain', () => {
		expect(onDomain('wecare@SahaTextile.com', 'sahatextile.com')).toBe(true);
		expect(onDomain('someone@gmail.com', 'sahatextile.com')).toBe(false);
		expect(onDomain('broken', 'sahatextile.com')).toBe(false);
	});

	it('names a revoked mailbox', () => {
		expect(new MailboxAccessRevoked('wecare@shop.test')).toMatchObject({ name: 'MailboxAccessRevoked' });
	});
});
