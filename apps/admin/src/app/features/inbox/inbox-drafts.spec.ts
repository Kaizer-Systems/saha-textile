import { MAX_SEND_ATTACHMENT_BYTES } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	MAX_ATTACHMENT_BYTES,
	type Draft,
	addressProblems,
	addresses,
	answeredMessage,
	draftFor,
	draftFromGmail,
	draftKey,
	draftProblem,
	draftWrite,
	editorText,
	firstWords,
	forgetDraft,
	frameDocument,
	gmailDraftKey,
	gmailLink,
	hasContent,
	isFolded,
	isRunnable,
	keepDraft,
	keptDraft,
	listDateFormat,
	mailboxKey,
	minutesSince,
	newDraft,
	primaryAddress,
	readAsBase64,
	sendRequest,
	textAsEditorHtml,
	withPictures,
} from './inbox-drafts';

import type { InboxMessage, InboxThread, MailboxSendAs } from '@saha-textile/contracts';

const sendAs: MailboxSendAs[] = [
	{ address: 'help@shop.test', displayName: 'Help', signature: '', isPrimary: false },
	{ address: 'care@shop.test', displayName: 'Care', signature: '', isPrimary: true },
];

const message = (fields: Partial<InboxMessage>): InboxMessage => ({
	id: 'm',
	from: 'Rahul <rahul@example.com>',
	to: 'care@shop.test',
	cc: '',
	replyTo: '',
	subject: 'Order',
	date: '2026-11-09T10:00:00.000Z',
	html: '<p>Hi</p>',
	text: 'Hi',
	hasRemoteImages: false,
	attachments: [],
	messageId: '<a@example.com>',
	quoteHtml: '',
	unread: false,
	references: '',
	contactForm: null,
	sentBy: null,
	labelIds: [],
	starred: false,
	large: false,
	...fields,
});
const thread = (...messages: InboxMessage[]): InboxThread => ({
	id: 't1',
	subject: 'Order',
	messages,
	unread: false,
	labelIds: [],
});

describe('addresses', () => {
	it('pulls bare, lower-case, unique addresses out of a header', () => {
		expect(addresses('Ananya <Ananya@Example.com>, rahul@example.com; "x" <rahul@example.com>')).toEqual([
			'ananya@example.com',
			'rahul@example.com',
		]);
		expect(addresses('nobody here')).toEqual([]);
	});
});

describe('primaryAddress', () => {
	it('prefers the main address, then the first one, then the mailbox itself', () => {
		expect(primaryAddress(sendAs, 'box@shop.test')).toBe('care@shop.test');
		expect(primaryAddress([sendAs[0] as MailboxSendAs], 'box@shop.test')).toBe('help@shop.test');
		expect(primaryAddress([], 'box@shop.test')).toBe('box@shop.test');
	});
});

describe('draftFor', () => {
	it('answers the customer from the alias they wrote to, in the same conversation', () => {
		const draft = draftFor('reply', thread(message({ to: 'Help <help@shop.test>' })), sendAs, 'care@shop.test');
		expect(draft).toMatchObject({
			mode: 'reply',
			from: 'help@shop.test',
			to: 'rahul@example.com',
			cc: '',
			subject: 'Re: Order',
			threadId: 't1',
			inReplyTo: '<a@example.com>',
		});
	});

	it('answers a Contact Us message to its Reply-To, though the shop sent it', () => {
		const contact = message({
			from: 'Website <care@shop.test>',
			replyTo: 'Ananya <ananya@example.com>',
			messageId: '',
		});
		const draft = draftFor('reply', thread(contact), sendAs, 'care@shop.test');
		expect(draft.to).toBe('ananya@example.com');
		expect(draft.from).toBe('care@shop.test');
		expect(draft.inReplyTo).toBeUndefined();
	});

	it('answers the last customer message when the shop wrote last, and keeps an existing Re:', () => {
		const ours = message({ id: 'm2', from: 'care@shop.test', to: 'rahul@example.com', subject: 'RE: Order' });
		const draft = draftFor(
			'reply',
			{ ...thread(message({}), ours), subject: 'RE: Order' },
			sendAs,
			'care@shop.test',
		);
		expect(draft.to).toBe('rahul@example.com');
		expect(draft.subject).toBe('RE: Order');
	});

	it("writes to the people the shop wrote to when every message is the shop's own", () => {
		const ours = message({ from: 'care@shop.test', to: 'mitali@example.com, help@shop.test' });
		expect(draftFor('reply', thread(ours), sendAs, 'care@shop.test').to).toBe('mitali@example.com');
	});

	it("sends from the main address when the customer wrote to none of the shop's addresses", () => {
		const bcc = message({ to: 'list@example.com' });
		expect(draftFor('reply', thread(bcc), sendAs, 'care@shop.test').from).toBe('care@shop.test');
	});

	it('copies everyone else on Reply all, never the shop itself', () => {
		const many = message({
			to: 'care@shop.test, ria@example.com',
			cc: 'help@shop.test, arup@example.com, rahul@example.com',
		});
		const draft = draftFor('reply_all', thread(many), sendAs, 'care@shop.test');
		expect(draft.to).toBe('rahul@example.com');
		expect(draft.cc).toBe('ria@example.com, arup@example.com');
	});

	it('forwards with the original quoted and nobody filled in', () => {
		const draft = draftFor('forward', thread(message({})), sendAs, 'care@shop.test');
		expect(draft).toMatchObject({ mode: 'forward', to: '', cc: '', subject: 'Fwd: Order' });
		expect(draft.body).toContain('---------- Forwarded message ----------');
		expect(draft.body).toContain('From: Rahul <rahul@example.com>');
		expect(draft.threadId).toBeUndefined();
	});
});

describe('draftProblem', () => {
	const draft: Draft = { ...newDraft('care@shop.test'), to: 'a@example.com', subject: 'Hi' };
	const file = (size: number) => new File([new Uint8Array(size)], 'f.bin');

	it('asks for an address and a subject, and keeps to the attachment limits', () => {
		expect(draftProblem({ ...draft, to: 'nobody' }, [])).toBe('inbox_need_recipient');
		expect(draftProblem({ ...draft, subject: '  ' }, [])).toBe('inbox_need_subject');
		expect(
			draftProblem(
				draft,
				Array.from({ length: 11 }, () => file(1)),
			),
		).toBe('inbox_too_many_files');
		expect(draftProblem(draft, [file(MAX_ATTACHMENT_BYTES), file(1)])).toBe('inbox_files_too_big');
		expect(draftProblem(draft, [file(10)])).toBeNull();
	});

	it('keeps the same 10 MB limit as the API', () => {
		expect(MAX_ATTACHMENT_BYTES).toBe(MAX_SEND_ATTACHMENT_BYTES);
	});
});

describe('sendRequest', () => {
	it('splits the addresses, trims the subject and reads the files as base64', async () => {
		const body = await sendRequest(
			{
				...newDraft('care@shop.test'),
				mode: 'reply',
				to: 'Rahul <rahul@example.com>',
				cc: 'ria@example.com',
				subject: ' Re: Order ',
				body: 'Thanks',
				threadId: 't1',
				inReplyTo: '<a@example.com>',
			},
			[new File(['hello'], 'note.txt', { type: 'text/plain' }), new File(['x'], 'blob')],
		);
		expect(body).toEqual({
			from: 'care@shop.test',
			to: ['rahul@example.com'],
			cc: ['ria@example.com'],
			bcc: [],
			sendAnyway: false,
			keepDraftAttachments: false,
			subject: 'Re: Order',
			body: 'Thanks',
			threadId: 't1',
			inReplyTo: '<a@example.com>',
			attachments: [
				{ filename: 'note.txt', mimeType: 'text/plain', data: 'aGVsbG8=' },
				{ filename: 'blob', mimeType: 'application/octet-stream', data: 'eA==' },
			],
		});
	});

	it('fails when a file cannot be read', async () => {
		const original = globalThis.FileReader;
		class Broken {
			error = new Error('unreadable');
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				queueMicrotask(() => this.onerror?.());
			}
		}
		vi.stubGlobal('FileReader', Broken);
		await expect(readAsBase64(new File(['x'], 'x'))).rejects.toThrow('unreadable');
		vi.stubGlobal('FileReader', original);
	});
});

describe('the message frame', () => {
	it('keeps remote pictures off until asked for', () => {
		const html = '<img data-remote-src="https://cdn.example.com/a.png" alt="a">';
		const hidden = frameDocument(html, false);
		expect(hidden).toContain('img-src data: cid:;');
		expect(hidden).toContain('data-remote-src=');
		const shown = frameDocument(html, true);
		expect(shown).toContain('img-src data: cid: https:;');
		expect(shown).toContain('<img src="https://cdn.example.com/a.png"');
		expect(withPictures(html)).toBe('<img src="https://cdn.example.com/a.png" alt="a">');
	});

	it('allows no scripts and opens links in a new tab', () => {
		const doc = frameDocument('<p>Hi</p>', false);
		expect(doc).toContain("default-src 'none'");
		expect(doc).toContain('<base target="_blank">');
		expect(doc).toContain('<body><p>Hi</p></body>');
	});
});

describe('review revision 2 helpers', () => {
	it('starts an empty message, and quotes or forwards from a conversation (E3, E5, E9)', () => {
		expect(newDraft('care@shop.test')).toEqual({
			mode: 'new',
			from: 'care@shop.test',
			to: '',
			cc: '',
			bcc: '',
			subject: '',
			body: '',
			includeQuote: false,
			includeAttachments: false,
			knownIds: [],
		});
		// Reply all never fills Bcc (C1), and a reply sends what it had seen for the API's check (C5).
		const replyAll = draftFor('reply_all', thread(message({ id: 'm1' })), sendAs, 'care@shop.test');
		expect(replyAll.bcc).toBe('');
		const files = [{ id: 'a1', filename: 'bill.pdf', mimeType: 'application/pdf', size: 2 }];
		const withFiles = thread(message({ id: 'm1', attachments: files }), message({ id: 'm2' }));
		const reply = draftFor('reply', withFiles, sendAs, 'care@shop.test');
		expect(reply).toMatchObject({ quoteMessageId: 'm2', includeQuote: true, knownIds: ['m1', 'm2'] });
		const forward = draftFor(
			'forward',
			thread(message({ id: 'm1', attachments: files })),
			sendAs,
			'care@shop.test',
		);
		expect(forward).toMatchObject({
			forwardFrom: { threadId: 't1', messageId: 'm1', count: 1 },
			includeAttachments: true,
			includeQuote: false,
		});
		expect(draftFor('forward', thread(message({})), sendAs, 'care@shop.test').forwardFrom).toBeUndefined();
	});

	it('finds the message a reply answers, or none in an empty conversation', () => {
		expect(answeredMessage(thread(message({ id: 'm1' })), sendAs, 'care@shop.test')?.id).toBe('m1');
		expect(answeredMessage(thread(), sendAs, 'care@shop.test')).toBeNull();
	});

	it('names the To and Cc entries that are not addresses (T9)', () => {
		expect(addressProblems('a@x.test, Rahul <r@x.test>; bad, c@x, ')).toEqual(['bad', 'c@x']);
		expect(addressProblems('')).toEqual([]);
		expect(draftProblem({ ...newDraft('c@x.test'), to: 'a@x.test, nope', subject: 'S' }, [])).toBe(
			'inbox_check_addresses',
		);
		expect(draftProblem({ ...newDraft('c@x.test'), to: 'a@x.test', cc: 'nope', subject: 'S' }, [])).toBe(
			'inbox_check_addresses',
		);
	});

	it('marks files that can run programs (T10)', () => {
		expect(isRunnable('verify.EXE')).toBe(true);
		expect(isRunnable('setup.apk ')).toBe(true);
		expect(isRunnable('bill.pdf')).toBe(false);
	});

	it('writes list dates as time today, day this year, and day and year before (U7)', () => {
		const now = new Date('2026-11-10T12:00:00');
		expect(listDateFormat('2026-11-10T08:00:00', now)).toBe('HH:mm');
		expect(listDateFormat('2026-03-01T08:00:00', now)).toBe('d MMM');
		expect(listDateFormat('2025-03-01T08:00:00', now)).toBe('d MMM y');
		expect(listDateFormat(new Date().toISOString())).toBe('HH:mm');
		expect(minutesSince('2026-11-10T11:57:30', now)).toBe(2);
		expect(minutesSince('2026-11-10T13:00:00', now)).toBe(0);
		expect(minutesSince(new Date().toISOString())).toBe(0);
	});

	it('folds read messages except the newest, unless opened (E2)', () => {
		const all = [message({ id: 'a' }), message({ id: 'b', unread: true }), message({ id: 'c' })];
		const [a, b, c] = all as [InboxMessage, InboxMessage, InboxMessage];
		expect(isFolded(a, all, new Set(), false)).toBe(true);
		expect(isFolded(b, all, new Set(), false)).toBe(false);
		expect(isFolded(c, all, new Set(), false)).toBe(false);
		expect(isFolded(a, all, new Set(['a']), false)).toBe(false);
		expect(isFolded(a, all, new Set(), true)).toBe(false);
	});

	it('shortens a folded line, links to Gmail, and names a mailbox by its address', () => {
		expect(firstWords('  Hello\n there  ')).toBe('Hello there');
		expect(firstWords('abcdefghij', 6)).toBe('abcde…');
		expect(gmailLink('care@shop.test', 't 1')).toBe(
			'https://mail.google.com/mail/?authuser=care%40shop.test#all/t%201',
		);
		expect(mailboxKey('wecare@shop.test')).toBe('wecare');
		expect(mailboxKey('')).toBe('');
	});

	it('keeps an unsent draft in this tab per conversation, and forgets it (T6)', () => {
		const memory = new Map<string, string>();
		const storage = {
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value),
			removeItem: (key: string) => void memory.delete(key),
		} as unknown as Storage;
		const key = draftKey('mbx', 't1', 'reply');
		expect(key).toBe('inbox.draft.mbx:t1:reply');
		expect(draftKey('mbx', null, 'new')).toBe('inbox.draft.mbx:new:new');
		const draft = { ...newDraft('care@shop.test'), mode: 'reply' as const, body: 'Kept' };
		keepDraft(key, draft, storage);
		expect(keptDraft(key, 'reply', storage)).toEqual(draft);
		expect(keptDraft(key, 'forward', storage)).toBeNull();
		memory.set('bad', '{');
		expect(keptDraft('bad', 'reply', storage)).toBeNull();
		memory.set('odd', '"text"');
		expect(keptDraft('odd', 'reply', storage)).toBeNull();
		memory.set('partial', JSON.stringify({ mode: 'reply', body: 'x', from: 'a@x.test' }));
		expect(keptDraft('partial', 'reply', storage)).toMatchObject({ body: 'x', knownIds: [] });
		forgetDraft(key, storage);
		expect(keptDraft(key, 'reply', storage)).toBeNull();

		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			},
			removeItem: () => {
				throw new Error('blocked');
			},
		} as unknown as Storage;
		expect(() => keepDraft(key, draft, broken)).not.toThrow();
		expect(keptDraft(key, 'reply', broken)).toBeNull();
		expect(() => forgetDraft(key, broken)).not.toThrow();
		expect(keptDraft(key, 'reply', null)).toBeNull();

		keepDraft('inbox.draft.session', draft);
		expect(keptDraft('inbox.draft.session', 'reply')).toEqual(draft);
		forgetDraft('inbox.draft.session');
		expect(keptDraft('inbox.draft.session', 'reply')).toBeNull();
	});

	it('works without session storage at all', () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
		Object.defineProperty(globalThis, 'sessionStorage', {
			configurable: true,
			get: () => {
				throw new Error('denied');
			},
		});
		try {
			expect(keptDraft('k', 'new')).toBeNull();
		} finally {
			if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
		}
	});

	it("asks the API to quote the answered message and copy a forward's attachments", async () => {
		const reply = {
			...newDraft('care@shop.test'),
			mode: 'reply' as const,
			to: 'a@x.test',
			subject: 'Re',
			quoteMessageId: 'm1',
			includeQuote: true,
		};
		expect(await sendRequest(reply, [])).toMatchObject({ quoteMessageId: 'm1' });
		expect(await sendRequest({ ...reply, includeQuote: false }, [])).not.toHaveProperty('quoteMessageId');
		const forward = {
			...newDraft('care@shop.test'),
			mode: 'forward' as const,
			to: 'a@x.test',
			subject: 'Fwd',
			forwardFrom: { threadId: 't1', messageId: 'm1', count: 2 },
			includeAttachments: true,
		};
		expect(await sendRequest(forward, [])).toMatchObject({
			forwardAttachmentsFrom: { threadId: 't1', messageId: 'm1' },
		});
		expect(await sendRequest({ ...forward, includeAttachments: false }, [])).not.toHaveProperty(
			'forwardAttachmentsFrom',
		);
	});
});

describe('Gmail drafts in the compose box (C2)', () => {
	const saved = {
		draftId: 'd1',
		version: 'v3',
		threadId: 't1',
		from: 'Care <care@shop.test>',
		to: 'Ananya <ananya@example.com>',
		cc: '',
		bcc: 'boss@shop.test',
		subject: 'Re: Saree',
		text: 'Yes',
		attachments: [{ id: 'a1', filename: 'chart.pdf', mimeType: 'application/pdf', size: 4 }],
		date: '2026-11-19T10:40:00.000Z',
		inReplyTo: '<m1@x>',
		quoteMessageId: 'm1',
		forwardAttachmentsFrom: null,
	};

	it('reopens a saved reply as a reply, with its files kept in Gmail', () => {
		expect(draftFromGmail(saved as never)).toMatchObject({
			mode: 'reply',
			from: 'care@shop.test',
			to: 'ananya@example.com',
			bcc: 'boss@shop.test',
			threadId: 't1',
			inReplyTo: '<m1@x>',
			includeQuote: true,
			gmailDraftId: 'd1',
			version: 'v3',
			savedFiles: [{ name: 'chart.pdf', size: 4 }],
		});
		const forward = {
			...saved,
			inReplyTo: null,
			threadId: null,
			forwardAttachmentsFrom: { threadId: 't1', messageId: 'm1' },
		};
		expect(draftFromGmail(forward as never)).toMatchObject({ mode: 'forward', includeAttachments: true });
		expect(draftFromGmail({ ...saved, inReplyTo: null, threadId: null } as never).mode).toBe('new');
	});

	it('saves with the version seen, or over it when asked, keeping the saved files', async () => {
		const draft = draftFromGmail(saved as never);
		const body = await draftWrite(draft, []);
		expect(body).toMatchObject({ version: 'v3', keepAttachments: true, to: ['ananya@example.com'] });
		expect(body).not.toHaveProperty('sendAnyway');
		expect(body).not.toHaveProperty('draftId');
		expect(await draftWrite(draft, [], true)).not.toHaveProperty('version');
		expect((await sendRequest(draft, [])).draftId).toBe('d1');
	});

	it('counts files already in the draft towards the limits', () => {
		const draft = { ...draftFromGmail(saved as never), savedFiles: [{ name: 'big.zip', size: 10 * 1024 * 1024 }] };
		expect(draftProblem(draft, [new File(['x'], 'x.txt')])).toBe('inbox_files_too_big');
		const many = { ...draft, savedFiles: Array.from({ length: 10 }, (_, i) => ({ name: `${i}`, size: 1 })) };
		expect(draftProblem(many, [new File(['x'], 'x.txt')])).toBe('inbox_too_many_files');
	});

	it('saves nothing for an untouched draft, and finds kept copies of reopened ones', () => {
		expect(hasContent(newDraft('care@shop.test'))).toBe(false);
		expect(hasContent({ ...newDraft('care@shop.test'), to: 'a@x.test' })).toBe(true);
		const key = gmailDraftKey('mbx', 'd1');
		keepDraft(key, draftFromGmail(saved as never));
		expect(keptDraft(key, null)?.gmailDraftId).toBe('d1');
	});
});

describe('formatting helpers (C1)', () => {
	it('turns plain text into editor paragraphs, escaped', () => {
		expect(textAsEditorHtml('Hi <you> & me\nline two\n\nNext')).toBe(
			'<p>Hi &lt;you&gt; &amp; me<br>line two</p><p>Next</p>',
		);
	});

	it('reads the words back line by line', () => {
		expect(editorText('<p><strong>Hi</strong> &amp; bye</p><ul><li>one</li><li>two</li></ul><p>a<br>b</p>')).toBe(
			'Hi & bye\none\ntwo\na\nb',
		);
		expect(editorText('<p></p><p></p><p></p><p>x</p>')).toBe('x');
	});

	it('sends and saves the formatting with the words', async () => {
		const draft = {
			...newDraft('care@shop.test'),
			to: 'a@x.test',
			subject: 'S',
			body: 'Hi',
			html: '<p><em>Hi</em></p>',
		};
		expect((await sendRequest(draft, [])).html).toBe('<p><em>Hi</em></p>');
		expect((await draftWrite(draft, [])).html).toBe('<p><em>Hi</em></p>');
		expect(await sendRequest({ ...draft, html: undefined }, [])).not.toHaveProperty('html');
	});
});
