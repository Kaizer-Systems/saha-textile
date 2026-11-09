import { describe, expect, it } from 'vitest';

import { MailboxAccessRevoked } from '../src/ports/mailbox.port';
import { FOLDER_LABELS, labelChange, mailboxRight, onDomain, replySubject } from '../src/mailbox/mailbox-rules';

describe('mailbox rules', () => {
	const access = [
		{ mailboxId: 'm1', adminUserId: 'riya', canSend: true },
		{ mailboxId: 'm1', adminUserId: 'arup', canSend: false },
	];

	it('gives each admin user only the right they were given, mailbox by mailbox', () => {
		expect(mailboxRight(access, 'riya', 'm1')).toBe('send');
		expect(mailboxRight(access, 'arup', 'm1')).toBe('read');
		expect(mailboxRight(access, 'arup', 'm2')).toBe('none');
		expect(mailboxRight(access, 'owner', 'm1')).toBe('none');
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
