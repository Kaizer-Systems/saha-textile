import { afterEach, describe, expect, it, vi } from 'vitest';

import { draftFromGmail, editorText, keptDraft, mailboxKey } from './inbox-drafts';
import { filterForm, filterMatch } from './mailbox-settings-form';

import type { InboxDraft, MailboxFilter } from '@saha-textile/contracts';

const saved = (over: Partial<InboxDraft> = {}): InboxDraft => ({
	draftId: 'dr_1',
	version: '1',
	threadId: null,
	from: '',
	to: '',
	cc: '',
	bcc: '',
	subject: '',
	text: '',
	html: null,
	attachments: [],
	date: '2026-11-24T09:00:00.000Z',
	inReplyTo: null,
	quoteMessageId: null,
	forwardAttachmentsFrom: null,
	...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('inbox draft edges', () => {
	it('reads an empty editor as no text', () => {
		expect(editorText('')).toBe('');
	});

	it('reopens a Gmail draft with no sender as a new message, keeping its formatted text', () => {
		const draft = draftFromGmail(saved({ html: '<p>Namaskar</p>', text: 'Namaskar' }));
		expect([draft.mode, draft.from, draft.html]).toEqual(['new', '', '<p>Namaskar</p>']);
	});

	it('names a mailbox by its whole address when there is no @', () => {
		expect(mailboxKey('orders@sahatextile.com')).toBe('orders');
		expect(mailboxKey('orders')).toBe('orders');
	});

	it('reopens a kept draft that never said its kind as a new message', () => {
		const store = new Map([['k', JSON.stringify({ body: 'Hello', from: 'orders@sahatextile.com' })]]);
		const storage = { getItem: (key: string) => store.get(key) ?? null } as unknown as Storage;
		expect(keptDraft('k', null, storage)?.mode).toBe('new');
	});

	it('keeps nothing where the browser has no session store', () => {
		vi.stubGlobal('sessionStorage', undefined);
		expect(keptDraft('k', null)).toBeNull();
	});
});

describe('a filter with nothing set', () => {
	it('opens in the form with empty boxes and reads as matching nothing', () => {
		const empty = {
			id: 'f1',
			criteria: {},
			addLabelIds: [],
			removeLabelIds: [],
			forwardTo: null,
		} as unknown as MailboxFilter;
		expect(filterForm(empty)).toMatchObject({ from: '', to: '', subject: '', query: '', labelId: '' });
		expect(filterMatch(empty)).toBe('');
	});
});
