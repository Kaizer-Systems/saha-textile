import { MAX_SEND_ATTACHMENT_BYTES } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	MAX_ATTACHMENT_BYTES,
	type Draft,
	addresses,
	draftFor,
	draftProblem,
	frameDocument,
	primaryAddress,
	readAsBase64,
	sendRequest,
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
	...fields,
});
const thread = (...messages: InboxMessage[]): InboxThread => ({ id: 't1', subject: 'Order', messages, unread: false });

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
	const draft: Draft = { mode: 'new', from: 'care@shop.test', to: 'a@example.com', cc: '', subject: 'Hi', body: '' };
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
				mode: 'reply',
				from: 'care@shop.test',
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
