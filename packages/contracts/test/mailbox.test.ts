import { describe, expect, it } from 'vitest';

import {
	CONTACT_MIN_ELAPSED_MS,
	ContactMessageRequest,
	InboxListQuery,
	InboxSendRequest,
	MailboxAccessWrite,
	MailboxOAuthCallbackQuery,
} from '../src/mailbox';

const message = {
	name: 'Ananya',
	email: ' Ananya@Example.com ',
	subject: 'Blouse stitching',
	message: 'Is stitching possible before the 20th?',
	elapsedMs: 5_000,
};

describe('ContactMessageRequest', () => {
	it('cleans a good message and fills the defaults', () => {
		expect(ContactMessageRequest.parse(message)).toMatchObject({
			email: 'ananya@example.com',
			phone: '',
			locale: 'en',
			website: '',
		});
		expect(CONTACT_MIN_ELAPSED_MS).toBe(3_000);
	});

	it('refuses short fields, a bad email and more than three links', () => {
		expect(ContactMessageRequest.safeParse({ ...message, name: 'A' }).success).toBe(false);
		expect(ContactMessageRequest.safeParse({ ...message, email: 'nope' }).success).toBe(false);
		expect(ContactMessageRequest.safeParse({ ...message, message: 'short' }).success).toBe(false);
		const links = 'see https://a.test www.b.test http://c.test https://d.test please';
		expect(ContactMessageRequest.safeParse({ ...message, message: links }).success).toBe(false);
		expect(
			ContactMessageRequest.safeParse({ ...message, message: 'see https://a.test and www.b.test' }).success,
		).toBe(true);
	});
});

describe('mailbox requests', () => {
	it('lists each admin user once in an access list', () => {
		expect(MailboxAccessWrite.safeParse({ entries: [{ adminUserId: 'a', canSend: true }] }).success).toBe(true);
		expect(
			MailboxAccessWrite.safeParse({
				entries: [
					{ adminUserId: 'a', canSend: true },
					{ adminUserId: 'a', canSend: false },
				],
			}).success,
		).toBe(false);
	});

	it('reads the inbox folder, a send and the sign-in answer', () => {
		expect(InboxListQuery.parse({})).toEqual({ folder: 'inbox' });
		expect(
			InboxSendRequest.parse({ from: 'wecare@shop.test', to: ['a@b.test'], subject: ' Re: hi ', body: 'Thanks' }),
		).toMatchObject({ subject: 'Re: hi', cc: [], attachments: [] });
		expect(MailboxOAuthCallbackQuery.safeParse({ state: 's', code: 'c' }).success).toBe(true);
		expect(MailboxOAuthCallbackQuery.safeParse({ code: 'c' }).success).toBe(false);
	});
});
