import { describe, expect, it, vi } from 'vitest';

import { GmailMailbox, buildOutgoing, toInboxDraft } from '../src/index.js';

/** Drafts and Undo Send in the Gmail adapter (C2, C4). */

type Call = { method: string; url: string; body: unknown };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const credentials = { address: 'care@shop.test', refreshToken: 'refresh' };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const rawOf = (call: Call | undefined) =>
	Buffer.from((call?.body as { message: { raw: string } }).message.raw, 'base64url').toString('utf8');

const make = (routes: Array<[string, RegExp, (call: Call) => Response]>) => {
	const calls: Call[] = [];
	const gmail = new GmailMailbox({
		clientId: 'client',
		clientSecret: 'secret',
		redirectUri: 'https://api.test/cb',
		domain: 'shop.test',
		now: () => 1_000_000,
		sleep: vi.fn(async () => undefined),
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('token')) return json({ access_token: 'access', expires_in: 3600 });
			const call = {
				method: init?.method ?? 'GET',
				url,
				body: init?.body ? JSON.parse(String(init.body)) : null,
			};
			calls.push(call);
			const route = routes.find(([method, pattern]) => method === call.method && pattern.test(url));
			return route ? route[2](call) : new Response('', { status: 500 });
		}) as typeof fetch,
	});
	return { gmail, calls };
};

const mail = {
	from: 'care@shop.test',
	to: [],
	cc: [],
	subject: 'Hello',
	text: 'Typed so far',
	signatureHtml: '',
	attachments: [],
};

const draftMessage = (headers: Array<{ name: string; value: string }>) => ({
	id: 'msg1',
	threadId: 't1',
	labelIds: ['DRAFT'],
	internalDate: '1700000000000',
	payload: {
		mimeType: 'multipart/mixed',
		headers,
		parts: [
			{ mimeType: 'text/plain', body: { data: b64('Typed so far') } },
			{
				mimeType: 'application/pdf',
				filename: 'size-chart.pdf',
				body: { attachmentId: 'att1', size: 4 },
			},
		],
	},
});

describe('draft headers', () => {
	it('writes what the compose box chose, and drops anything that is not a Gmail id', () => {
		const raw = buildOutgoing({
			...mail,
			draftHints: { quoteMessageId: 'abc123', forwardFrom: { threadId: 't1', messageId: 'm_2-x' } },
		});
		expect(raw).toContain('X-Saha-Textile-Quote: abc123\r\n');
		expect(raw).toContain('X-Saha-Textile-Forward: t1/m_2-x\r\n');
		expect(raw).not.toMatch(/^To:/m);
		const hostile = buildOutgoing({
			...mail,
			draftHints: { quoteMessageId: 'a\r\nBcc: evil@x.test', forwardFrom: { threadId: 't1', messageId: 'x y' } },
		});
		expect(hostile).not.toContain('X-Saha-Textile');
		expect(hostile).not.toContain('evil@x.test');
	});

	it('gives a sent message our own Message-ID and never the draft hints', () => {
		const raw = buildOutgoing({ ...mail, to: ['a@x.test'], messageId: 'outbox-1@shop.test' });
		expect(raw).toContain('Message-ID: <outbox-1@shop.test>\r\n');
		expect(raw).not.toContain('X-Saha-Textile');
	});

	it('reads a draft back as it was left', () => {
		const draft = toInboxDraft(
			'd1',
			draftMessage([
				{ name: 'From', value: 'care@shop.test' },
				{ name: 'To', value: 'a@x.test' },
				{ name: 'Subject', value: 'Hello' },
				{ name: 'In-Reply-To', value: '<q1@x>' },
				{ name: 'X-Saha-Textile-Quote', value: 'q1' },
				{ name: 'X-Saha-Textile-Forward', value: 't1/q1' },
			]) as never,
		);
		expect(draft).toMatchObject({
			draftId: 'd1',
			version: 'msg1',
			threadId: 't1',
			to: 'a@x.test',
			text: 'Typed so far',
			inReplyTo: '<q1@x>',
			quoteMessageId: 'q1',
			forwardAttachmentsFrom: { threadId: 't1', messageId: 'q1' },
		});
		expect(draft.attachments.map((file) => file.filename)).toEqual(['size-chart.pdf']);
		const plain = toInboxDraft('d2', draftMessage([{ name: 'Subject', value: 'x' }]) as never);
		expect(plain).toMatchObject({ inReplyTo: null, quoteMessageId: null, forwardAttachmentsFrom: null });
	});
});

describe('Gmail drafts', () => {
	it('creates a draft in the conversation and answers its id and version', async () => {
		const { gmail, calls } = make([
			['POST', /\/drafts$/, () => json({ id: 'd1', message: { id: 'v1', threadId: 't1' } })],
		]);
		expect(await gmail.createDraft(credentials, { ...mail, threadId: 't1' })).toEqual({
			draftId: 'd1',
			version: 'v1',
			threadId: 't1',
		});
		expect((calls[0]?.body as { message: { threadId: string } }).message.threadId).toBe('t1');
		expect(rawOf(calls[0])).toContain('Subject: Hello');
	});

	it('keeps the files already in a draft by copying them from Gmail', async () => {
		const { gmail, calls } = make([
			['GET', /\/drafts\/d1\?format=full/, () => json({ id: 'd1', message: draftMessage([]) })],
			['GET', /\/messages\/msg1\/attachments\/att1/, () => json({ data: b64('%PDF') })],
			['PUT', /\/drafts\/d1$/, () => json({ id: 'd1', message: { id: 'v2', threadId: 't1' } })],
		]);
		expect(await gmail.updateDraft(credentials, 'd1', mail, true)).toMatchObject({ version: 'v2' });
		const raw = rawOf(calls.find((call) => call.method === 'PUT'));
		expect(raw).toContain('size-chart.pdf');
	});

	it('answers null for a draft deleted elsewhere', async () => {
		const { gmail } = make([
			['GET', /\/drafts\/gone/, () => new Response('', { status: 404 })],
			['PUT', /\/drafts\/gone/, () => new Response('', { status: 404 })],
			['POST', /\/drafts\/send/, () => new Response('', { status: 404 })],
		]);
		expect(await gmail.getDraft(credentials, 'gone')).toBeNull();
		expect(await gmail.updateDraft(credentials, 'gone', mail, true)).toBeNull();
		expect(await gmail.updateDraft(credentials, 'gone', mail, false)).toBeNull();
		expect(await gmail.sendDraft(credentials, 'gone')).toBeNull();
	});

	it('sends a draft, and finds a sent message again by its Message-ID', async () => {
		const { gmail, calls } = make([
			['POST', /\/drafts\/send/, () => json({ id: 's1', threadId: 't1', labelIds: ['SENT'] })],
			['GET', /\/messages\?/, () => json({ messages: [{ id: 's1', threadId: 't1' }] })],
		]);
		expect(await gmail.sendDraft(credentials, 'd1')).toEqual({ id: 's1', threadId: 't1' });
		expect(calls[0]?.body).toEqual({ id: 'd1' });
		expect(await gmail.findByMessageId(credentials, '<outbox-1@shop.test>')).toEqual({ id: 's1', threadId: 't1' });
		expect(decodeURIComponent(calls[1]?.url ?? '')).toContain('q=rfc822msgid:outbox-1@shop.test');
	});

	it('lists drafts with their recipient and subject', async () => {
		const { gmail } = make([
			['GET', /\/drafts\?/, () => json({ drafts: [{ id: 'd1' }, { id: 'gone' }], nextPageToken: 'n2' })],
			[
				'GET',
				/\/drafts\/d1\?format=metadata/,
				() =>
					json({
						id: 'd1',
						message: {
							...draftMessage([
								{ name: 'To', value: 'a@x.test' },
								{ name: 'Subject', value: 'Hi' },
							]),
							snippet: 'Typed',
						},
					}),
			],
			['GET', /\/drafts\/gone\?/, () => new Response('', { status: 404 })],
		]);
		const page = await gmail.listDrafts(credentials, undefined);
		expect(page.nextPageToken).toBe('n2');
		expect(page.drafts).toEqual([
			{
				draftId: 'd1',
				threadId: 't1',
				to: 'a@x.test',
				subject: 'Hi',
				snippet: 'Typed',
				date: expect.any(String),
			},
		]);
	});

	it('deletes a draft, quietly when it is already gone', async () => {
		const { gmail, calls } = make([
			['DELETE', /\/drafts\/d1/, () => new Response(null, { status: 204 })],
			['DELETE', /\/drafts\/gone/, () => new Response('', { status: 404 })],
		]);
		await gmail.deleteDraft(credentials, 'd1');
		await gmail.deleteDraft(credentials, 'gone');
		expect(calls.map((call) => call.method)).toEqual(['DELETE', 'DELETE']);
	});
});

describe('drafts inside a conversation', () => {
	const message = (id: string, labelIds: string[]) => ({
		id,
		threadId: 't1',
		labelIds,
		internalDate: '1700000000000',
		snippet: id,
		payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: `${id}@x.test` }], body: { data: b64(id) } },
	});

	it('leaves a reply being written out of the conversation and its list line', async () => {
		const { toInboxThread, toThreadSummary } = await import('../src/index.js');
		const thread = { id: 't1', messages: [message('m1', ['INBOX']), message('d1', ['DRAFT'])] };
		expect(toInboxThread(thread as never).messages.map((entry) => entry.id)).toEqual(['m1']);
		const row = toThreadSummary(thread as never);
		expect(row).toMatchObject({ snippet: 'm1', messageCount: 1 });
		expect(row.labelIds).toContain('DRAFT');
		const onlyDraft = { id: 't2', messages: [message('d2', ['DRAFT'])] };
		expect(toInboxThread(onlyDraft as never).messages).toHaveLength(1);
	});
});

describe('formatted writing (C1)', () => {
	const bodiesOf = (raw: string) =>
		[...raw.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
			Buffer.from((m[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8'),
		);

	it('keeps the editor formatting and drops everything else, on the server', async () => {
		const { cleanComposedHtml } = await import('../src/index.js');
		const clean = cleanComposedHtml(
			'<p onclick="steal()" style="color:red"><strong>Hi</strong> <em>there</em> <u>u</u> <s>s</s></p>' +
				'<script>alert(1)</script><img src="https://x.test/p.png"><iframe src="https://x.test"></iframe>' +
				'<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote>' +
				'<a href="javascript:alert(1)">bad</a> <a href="https://shop.test/o/1" target="_blank">order</a>' +
				' <a href="mailto:care@shop.test">mail</a><h1>big</h1><form><input></form>',
		);
		expect(clean).toContain('<strong>Hi</strong> <em>there</em> <u>u</u> <s>s</s>');
		expect(clean).toContain('<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote>');
		expect(clean).toContain('<a href="https://shop.test/o/1">order</a>');
		expect(clean).toContain('<a href="mailto:care@shop.test">mail</a>');
		expect(clean).not.toMatch(/onclick|style=|<script|alert\(1\)<\/script>|<img|<iframe|javascript:|<h1|<form|<input|target=/);
	});

	it('writes the text part from the cleaned formatting, with the signature after it', () => {
		const raw = buildOutgoing({
			...mail,
			to: ['a@x.test'],
			bcc: ['hidden@x.test'],
			text: 'ignored when formatting is given',
			html: '<p><strong>Your order</strong> ships today.</p><script>x()</script>',
			signatureHtml: '<b>Team</b>',
		});
		const [text, html] = bodiesOf(raw);
		expect(text?.trim()).toBe('Your order ships today.');
		expect(html).toContain('<div dir="auto"><p><strong>Your order</strong> ships today.</p></div>');
		expect(html).toContain('<div class="gmail_signature"><b>Team</b></div>');
		expect(html).not.toContain('<script');
		// Bcc stays in the envelope Gmail reads; it is never part of the visible text.
		expect(raw).toContain('Bcc: hidden@x.test');
		expect(text).not.toContain('hidden@x.test');
	});

	it('falls back to the plain text when the formatting cleans away to nothing', () => {
		const raw = buildOutgoing({ ...mail, to: ['a@x.test'], text: 'Plain words', html: '<script>x()</script>' });
		expect(bodiesOf(raw)[0]?.trim()).toBe('Plain words');
	});
});
