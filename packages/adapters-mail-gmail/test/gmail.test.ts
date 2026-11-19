import { MailboxAccessRevoked } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import {
	GmailApiError,
	GmailMailbox,
	buildImport,
	buildOutgoing,
	cleanEmailHtml,
	encodeWord,
	header,
	headerSafe,
	mailbox,
	textAsHtml,
	textToHtml,
	toInboxMessage,
	toInboxThread,
	toRaw,
	toThreadSummary,
} from '../src/index.js';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const decodeRaw = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
/** The decoded base64 MIME bodies of a built message, in order. */
const bodies = (message: string) =>
	[...message.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
		Buffer.from((m[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8'),
	);

describe('MIME headers', () => {
	it('removes line breaks and control characters, so a value cannot add a header', () => {
		expect(headerSafe('Hi\r\nBcc: evil@x.test\u0007 ')).toBe('Hi Bcc: evil@x.test');
	});

	it('encodes non-ASCII text as a UTF-8 word and leaves ASCII alone', () => {
		expect(encodeWord('Order 12')).toBe('Order 12');
		expect(encodeWord('শাড়ি')).toBe(`=?UTF-8?B?${Buffer.from('শাড়ি').toString('base64')}?=`);
	});

	it('writes a named address, quoting or encoding the name, and a bare one without', () => {
		expect(mailbox('', 'a@x.test')).toBe('a@x.test');
		expect(mailbox('Shop "Care"', 'a@x.test')).toBe(`"Shop 'Care'" <a@x.test>`);
		expect(mailbox('মৌমিতা', 'a@x.test')).toMatch(/^=\?UTF-8\?B\?.+\?= <a@x\.test>$/);
	});

	it('turns text into HTML with the signature underneath, escaping what was typed', () => {
		expect(textToHtml('a < b\nc', '')).toBe('<div dir="auto">a &lt; b<br>c</div>');
		expect(textToHtml('x', '<b>Team</b>')).toContain('<div class="gmail_signature"><b>Team</b></div>');
	});
});

describe('buildOutgoing', () => {
	const mail = {
		from: 'care@shop.test',
		fromName: 'Care',
		to: ['a@x.test', 'b@x.test'],
		cc: ['c@x.test'],
		subject: 'Re: Your order',
		text: 'Thank you',
		signatureHtml: '<i>Team</i>',
		threadId: 't1',
		inReplyTo: 'abc@mail.test',
		attachments: [
			{ filename: 'bill.pdf', mimeType: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
			{ filename: 'রসিদ.pdf', mimeType: 'application/pdf', data: new Uint8Array([4]) },
		],
	};

	it('writes the headers, both bodies, threading and attachments', () => {
		const message = buildOutgoing(mail, new Date('2026-11-09T10:00:00Z'));
		expect(message).toContain('From: "Care" <care@shop.test>');
		expect(message).toContain('To: a@x.test, b@x.test');
		expect(message).toContain('Cc: c@x.test');
		expect(message).toContain('Subject: Re: Your order');
		expect(message).toContain('Date: Mon, 09 Nov 2026 10:00:00 GMT');
		expect(message).toContain('In-Reply-To: <abc@mail.test>');
		expect(message).toContain('References: <abc@mail.test>');
		expect(message).toContain('Content-Disposition: attachment; filename="bill.pdf"');
		expect(message).toContain(`filename*=UTF-8''${encodeURIComponent('রসিদ.pdf')}`);
		const [text, html] = bodies(message);
		expect(text).toBe('Thank you');
		expect(html).toContain('<i>Team</i>');
	});

	it('leaves out Cc and threading for a new message, and keeps an angled Message-ID', () => {
		const message = buildOutgoing({ ...mail, fromName: undefined, cc: [], inReplyTo: undefined, attachments: [] });
		expect(message).toContain('From: care@shop.test');
		expect(message).not.toContain('Cc:');
		expect(message).not.toContain('In-Reply-To');
		expect(buildOutgoing({ ...mail, inReplyTo: '<x@y>' })).toContain('In-Reply-To: <x@y>');
	});
});

describe('buildImport', () => {
	it('writes the customer as sender and Reply-To, with the text body', () => {
		const message = buildImport({
			fromName: 'Rina',
			fromAddress: 'rina@x.test',
			to: 'care@shop.test',
			replyTo: 'rina@x.test',
			subject: 'Contact Us: Blouse size',
			text: 'Hello',
		});
		expect(message).toContain('From: "Rina" <rina@x.test>');
		expect(message).toContain('Reply-To: rina@x.test');
		expect(message).toMatch(/Message-ID: <contact-[\w-]+@saha-textile\.local>/);
		expect(bodies(message)).toEqual(['Hello']);
		expect(decodeRaw(toRaw(message))).toBe(message);
		expect(
			buildImport({
				fromName: '',
				fromAddress: 'a@x.test',
				to: 'b@x.test',
				replyTo: 'a@x.test',
				subject: 'S',
				text: '',
			}),
		).toContain('Content-Transfer-Encoding: base64\r\n\r\n\r\n');
	});
});

describe('cleanEmailHtml', () => {
	it('removes scripts, handlers, forms and style sheets', () => {
		const { html } = cleanEmailHtml(
			'<style>p{}</style><p onclick="x()">Hi<script>alert(1)</script></p><form><input></form><iframe src="x"></iframe>',
		);
		expect(html).toBe('<p>Hi</p>');
	});

	it('opens links in a new tab without a referrer, and drops unsafe schemes', () => {
		const { html } = cleanEmailHtml('<a href="https://x.test">x</a><a href="javascript:alert(1)">y</a>');
		expect(html).toContain('href="https://x.test" target="_blank" rel="noopener noreferrer nofollow"');
		expect(html).not.toContain('javascript');
	});

	it('holds back remote pictures, keeps inline ones and drops cid and sender-made addresses', () => {
		const remote = cleanEmailHtml('<img src="https://t.test/p.gif" alt="a">');
		expect(remote.hasRemoteImages).toBe(true);
		expect(remote.html).toBe('<img alt="a" data-remote-src="https://t.test/p.gif" />');
		const inline = cleanEmailHtml(
			'<img src="data:image/png;base64,AAAA"><img src="cid:logo"><img data-remote-src="https://t.test">',
		);
		expect(inline.hasRemoteImages).toBe(false);
		expect(inline.html).toBe('<img src="data:image/png;base64,AAAA" /><img /><img />');
	});

	it('keeps simple inline styles and drops ones that could load anything', () => {
		const { html } = cleanEmailHtml(
			'<p style="color:#c00;background-image:url(https://t.test/x);font-size:14px">x</p>',
		);
		expect(html).toBe('<p style="color:#c00;font-size:14px">x</p>');
	});

	it('shows plain text exactly as typed', () => {
		expect(textAsHtml('<b> & "x"\nnext')).toBe('&lt;b&gt; &amp; &quot;x&quot;<br>next');
	});
});

describe('Gmail message parsing', () => {
	const message = {
		id: 'm1',
		threadId: 't1',
		labelIds: ['INBOX', 'UNREAD'],
		snippet: 'Hello there',
		internalDate: String(Date.parse('2026-11-09T10:00:00Z')),
		payload: {
			mimeType: 'multipart/mixed',
			headers: [
				{ name: 'From', value: 'Rina <rina@x.test>' },
				{ name: 'To', value: 'care@shop.test' },
				{ name: 'Subject', value: 'Blouse' },
				{ name: 'Message-ID', value: '<id1@x.test>' },
			],
			parts: [
				{
					mimeType: 'multipart/alternative',
					parts: [
						{ mimeType: 'text/plain', body: { data: b64('Hi') } },
						{ mimeType: 'text/html', body: { data: b64('<p>Hi</p><img src="https://t.test/a.png">') } },
					],
				},
				{ mimeType: 'image/jpeg', filename: 'blouse.jpg', body: { attachmentId: 'a1', size: 2048 } },
				{ filename: 'x.bin', body: { attachmentId: 'a2' } },
			],
		},
	};

	it('reads headers case-insensitively', () => {
		expect(header(message.payload, 'from')).toBe('Rina <rina@x.test>');
		expect(header({}, 'From')).toBe('');
	});

	it('turns a message into the inbox shape, with clean HTML and attachments', () => {
		const parsed = toInboxMessage({ ...message, labelIds: message.labelIds });
		expect(parsed).toMatchObject({
			id: 'm1',
			from: 'Rina <rina@x.test>',
			subject: 'Blouse',
			date: '2026-11-09T10:00:00.000Z',
			text: 'Hi',
			hasRemoteImages: true,
			messageId: '<id1@x.test>',
			cc: '',
			replyTo: '',
		});
		expect(parsed.html).toContain('data-remote-src');
		expect(parsed.attachments).toEqual([
			{ id: 'a1', filename: 'blouse.jpg', mimeType: 'image/jpeg', size: 2048 },
			{ id: 'a2', filename: 'x.bin', mimeType: 'application/octet-stream', size: 0 },
		]);
	});

	it('shows a text-only message as escaped HTML, and an empty one as empty', () => {
		const textOnly = toInboxMessage({
			...message,
			payload: { mimeType: 'text/plain', body: { data: b64('a<b') } },
		});
		expect(textOnly.html).toBe('a&lt;b');
		expect(textOnly.hasRemoteImages).toBe(false);
		const empty = toInboxMessage({ ...message, payload: { mimeType: 'text/plain', body: {} } });
		expect(empty.text).toBe('');
	});

	it('summarises a conversation from its first subject and its last message', () => {
		const reply = {
			...message,
			id: 'm2',
			labelIds: ['INBOX'],
			snippet: 'Thanks',
			payload: { headers: [{ name: 'From', value: 'Care <care@shop.test>' }] },
		};
		expect(toThreadSummary({ id: 't1', messages: [message, reply] })).toMatchObject({
			id: 't1',
			from: 'Care <care@shop.test>',
			subject: 'Blouse',
			snippet: 'Thanks',
			unread: true,
			messageCount: 2,
		});
		expect(toThreadSummary({ id: 'empty', messages: [] })).toMatchObject({
			from: '',
			subject: '',
			snippet: '',
			to: '',
			unread: false,
			messageCount: 1,
			date: '1970-01-01T00:00:00.000Z',
		});
	});

	it('turns a whole conversation into messages, oldest first', () => {
		expect(toInboxThread({ id: 't1', messages: [message] })).toMatchObject({
			id: 't1',
			subject: 'Blouse',
			unread: true,
		});
		expect(toInboxThread({ id: 't2', messages: [] })).toEqual({
			id: 't2',
			subject: '',
			messages: [],
			unread: false,
			labelIds: [],
		});
	});
});

type Call = { url: string; init: RequestInit };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake Google: answers by URL, records every call. */
const google = (routes: Array<[RegExp, (call: Call) => Response]>) => {
	const calls: Call[] = [];
	const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		const route = routes.find(([pattern]) => pattern.test(call.url));
		return route ? route[1](call) : new Response('', { status: 500 });
	});
	return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};
const token = () => json({ access_token: 'access', expires_in: 3600 });
const credentials = { address: 'care@shop.test', refreshToken: 'refresh' };
const make = (routes: Array<[RegExp, (call: Call) => Response]>, now = () => 1_000_000) => {
	const fake = google(routes);
	const gmail = new GmailMailbox({
		clientId: 'client',
		clientSecret: 'secret',
		redirectUri: 'https://api.test/admin/mailboxes/oauth/callback',
		domain: 'shop.test',
		fetch: fake.fetchImpl,
		now,
	});
	return { gmail, calls: fake.calls };
};
const body = (call: Call | undefined) => JSON.parse(String(call?.init.body ?? '{}'));

describe('GmailMailbox defaults', () => {
	it('uses the global fetch and clock when none are given', () => {
		const gmail = new GmailMailbox({
			clientId: 'c',
			clientSecret: 's',
			redirectUri: 'https://api.test/cb',
			domain: 'shop.test',
		});
		expect(gmail.signInUrl('s')).toContain('client_id=c');
	});
});

describe('GmailMailbox sign-in', () => {
	it('asks Google for offline access to one Workspace mailbox, with the state', () => {
		const url = new URL(make([]).gmail.signInUrl('state-1'));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: 'client',
			scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic https://mail.google.com/',
			access_type: 'offline',
			prompt: 'consent select_account',
			hd: 'shop.test',
			state: 'state-1',
		});
	});

	it('exchanges the code, reads the address and keeps the access token for later calls', async () => {
		const { gmail, calls } = make([
			[
				/oauth2\.googleapis\.com\/token/,
				() => json({ access_token: 'a1', expires_in: 3600, refresh_token: 'r1' }),
			],
			[/\/profile$/, () => json({ emailAddress: 'Care@Shop.test' })],
			[/\/labels\/INBOX$/, () => json({ threadsUnread: 4 })],
		]);
		expect(await gmail.completeSignIn('code')).toEqual({
			address: 'care@shop.test',
			refreshToken: 'r1',
			// Google listed no scopes in this answer, so only the base one is assumed.
			scopes: ['https://www.googleapis.com/auth/gmail.modify'],
		});
		expect(gmail.featuresMissing(['https://www.googleapis.com/auth/gmail.modify'])).toEqual([
			'delete_forever',
			'settings',
		]);
		expect(gmail.featuresMissing(['https://mail.google.com/'])).toEqual([]);
		expect(String(calls[0]?.init.body)).toContain('grant_type=authorization_code');
		expect(await gmail.unreadCount({ address: 'care@shop.test', refreshToken: 'r1' })).toBe(4);
		expect(calls.filter((call) => call.url.includes('/token'))).toHaveLength(1);
	});

	it('refuses an address outside the shop domain and withdraws its grant', async () => {
		const { gmail, calls } = make([
			[
				/oauth2\.googleapis\.com\/token/,
				() => json({ access_token: 'a1', expires_in: 3600, refresh_token: 'r1' }),
			],
			[/\/profile$/, () => json({ emailAddress: 'me@gmail.com' })],
			[/\/revoke/, () => new Response('', { status: 200 })],
		]);
		await expect(gmail.completeSignIn('code')).rejects.toMatchObject({ status: 403 });
		expect(calls.at(-1)?.url).toContain('/revoke');
	});

	it('fails when Google refuses the code or gives no refresh token', async () => {
		await expect(make([[/token/, () => json({}, 400)]]).gmail.completeSignIn('bad')).rejects.toBeInstanceOf(
			GmailApiError,
		);
		await expect(
			make([[/token/, () => json({ access_token: 'a', expires_in: 1 })]]).gmail.completeSignIn('code'),
		).rejects.toThrow('no refresh token');
	});

	it('withdraws a grant at Google', async () => {
		const { gmail, calls } = make([[/\/revoke/, () => new Response('', { status: 400 })]]);
		await gmail.revoke(credentials);
		expect(String(calls[0]?.init.body)).toBe('token=refresh');
	});
});

describe('GmailMailbox reading', () => {
	const metadata = (id: string) =>
		json({
			id,
			messages: [
				{
					id: `${id}m`,
					threadId: id,
					labelIds: ['UNREAD'],
					payload: { headers: [{ name: 'Subject', value: id }] },
				},
			],
		});

	it('lists a folder a page at a time, with each line from its metadata', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/profile/, () => json({ emailAddress: 'care@shop.test', historyId: '7' })],
			[/\/threads\?/, () => json({ threads: [{ id: 't1' }, { id: 't2' }], nextPageToken: 'next' })],
			[/\/threads\/t\d\?format=metadata/, (call) => metadata(call.url.includes('/t1?') ? 't1' : 't2')],
		]);
		const page = await gmail.listThreads(credentials, 'inbox', 'from:rina', 'p2');
		expect(page.nextPageToken).toBe('next');
		expect(page.threads.map((thread) => thread.subject)).toEqual(['t1', 't2']);
		const list = new URL(calls.find((call) => call.url.includes('/threads?'))?.url ?? '');
		expect(Object.fromEntries(list.searchParams)).toEqual({
			maxResults: '20',
			labelIds: 'INBOX',
			q: 'from:rina',
			pageToken: 'p2',
		});
		expect(calls.find((call) => call.url.includes('format=metadata'))?.url).toContain('metadataHeaders=Subject');
		expect(calls.filter((call) => call.url.includes('/token'))).toHaveLength(1);
	});

	it('reads All Mail without a label, and Spam and Trash including themselves', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/profile/, () => json({ emailAddress: 'care@shop.test' })],
			[/\/threads\?/, () => json({})],
		]);
		expect(await gmail.listThreads(credentials, 'all', undefined, undefined)).toEqual({
			threads: [],
			nextPageToken: null,
			estimate: null,
		});
		await gmail.listThreads(credentials, 'trash', undefined, undefined);
		const [all, trash] = calls
			.filter((call) => call.url.includes('/threads?'))
			.map((call) => new URL(call.url).searchParams);
		expect(all?.has('labelIds')).toBe(false);
		expect(trash?.get('labelIds')).toBe('TRASH');
		expect(trash?.get('includeSpamTrash')).toBe('true');
	});

	it('reads a whole conversation, or nothing when Gmail no longer has it', async () => {
		const { gmail } = make([
			[/token/, token],
			[/\/threads\/t1\?format=full/, () => json({ id: 't1', messages: [] })],
			[/\/threads\/gone/, () => new Response('', { status: 404 })],
		]);
		expect(await gmail.getThread(credentials, 't1')).toMatchObject({ id: 't1' });
		expect(await gmail.getThread(credentials, 'gone')).toBeNull();
	});

	it("fetches an attachment's bytes, or nothing when it is gone", async () => {
		const { gmail } = make([
			[/token/, token],
			[/attachments\/a1/, () => json({ data: Buffer.from([7, 8]).toString('base64url') })],
			[/attachments\/a2/, () => new Response('', { status: 404 })],
		]);
		expect(await gmail.getAttachment(credentials, 'm1', 'a1')).toEqual({ data: new Uint8Array([7, 8]) });
		expect(await gmail.getAttachment(credentials, 'm1', 'a2')).toBeNull();
	});

	it('lists the addresses the mailbox can send as, leaving out unverified aliases', async () => {
		const { gmail } = make([
			[/token/, token],
			[
				/settings\/sendAs/,
				() =>
					json({
						sendAs: [
							{
								sendAsEmail: 'Care@shop.test',
								displayName: 'Care',
								signature: '<b>T</b>',
								isPrimary: true,
							},
							{ sendAsEmail: 'orders@shop.test', verificationStatus: 'accepted' },
							{ sendAsEmail: 'new@shop.test', verificationStatus: 'pending' },
						],
					}),
			],
		]);
		expect(await gmail.listSendAs(credentials)).toEqual([
			{ address: 'care@shop.test', displayName: 'Care', signature: '<b>T</b>', isPrimary: true },
			{ address: 'orders@shop.test', displayName: '', signature: '', isPrimary: false },
		]);
	});
});

describe('GmailMailbox changing mail', () => {
	it('sends a reply in its conversation, and a new message without one', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/messages\/send/, () => json({ id: 'm9', threadId: 't1' })],
		]);
		const mail = {
			from: 'care@shop.test',
			to: ['a@x.test'],
			cc: [],
			subject: 'Hi',
			text: 'x',
			signatureHtml: '',
			attachments: [],
		};
		expect(await gmail.send(credentials, { ...mail, threadId: 't1' })).toEqual({ id: 'm9', threadId: 't1' });
		await gmail.send(credentials, mail);
		const [reply, fresh] = calls.filter((call) => call.url.includes('/send')).map(body);
		expect(reply.threadId).toBe('t1');
		expect(decodeRaw(reply.raw)).toContain('Subject: Hi');
		expect(fresh.threadId).toBeUndefined();
	});

	it('changes labels, trashes and restores a conversation', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/threads\/t1\//, () => new Response('', { status: 200 })],
		]);
		await gmail.modifyThread(credentials, 't1', { add: ['INBOX'], remove: ['UNREAD'] });
		await gmail.trashThread(credentials, 't1', false);
		await gmail.trashThread(credentials, 't1', true);
		const paths = calls
			.filter((call) => call.url.includes('/threads/'))
			.map((call) => new URL(call.url).pathname.split('/').at(-1));
		expect(paths).toEqual(['modify', 'trash', 'untrash']);
		expect(body(calls.find((call) => call.url.endsWith('/modify')))).toEqual({
			addLabelIds: ['INBOX'],
			removeLabelIds: ['UNREAD'],
		});
	});

	it('places a Contact Us message in the Inbox, unread, never as spam', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/messages\/import/, () => json({ id: 'imp1' })],
		]);
		const mail = {
			fromName: 'Rina',
			fromAddress: 'rina@x.test',
			to: 'care@shop.test',
			replyTo: 'rina@x.test',
			subject: 'S',
			text: 'T',
		};
		expect(await gmail.importMessage(credentials, mail)).toEqual({ id: 'imp1' });
		const call = calls.find((entry) => entry.url.includes('/import'));
		expect(call?.url).toContain('neverMarkSpam=true');
		expect(body(call).labelIds).toEqual(['INBOX', 'UNREAD']);
	});
});

describe('GmailMailbox tokens and failures', () => {
	it('refreshes an access token once it is close to expiring', async () => {
		let now = 1_000_000;
		const { gmail, calls } = make(
			[
				[/token/, token],
				[/labels\/INBOX/, () => json({})],
			],
			() => now,
		);
		expect(await gmail.unreadCount(credentials)).toBe(0);
		now += 3_600_000;
		await gmail.unreadCount(credentials);
		expect(calls.filter((call) => call.url.includes('/token'))).toHaveLength(2);
	});

	it('reports a withdrawn grant when Google refuses the refresh token', async () => {
		const { gmail } = make([[/token/, () => json({ error: 'invalid_grant' }, 400)]]);
		await expect(gmail.unreadCount(credentials)).rejects.toBeInstanceOf(MailboxAccessRevoked);
	});

	it('reports other token failures with their status only', async () => {
		const { gmail } = make([[/token/, () => json({}, 503)]]);
		await expect(gmail.unreadCount(credentials)).rejects.toMatchObject({ status: 503 });
	});

	it('retries once with a new token after a 401, then reports the grant withdrawn', async () => {
		let answers = 0;
		const { gmail } = make([
			[/token/, token],
			[/labels\/INBOX/, () => (answers++ === 0 ? new Response('', { status: 401 }) : json({ threadsUnread: 2 }))],
		]);
		expect(await gmail.unreadCount(credentials)).toBe(2);
		const always = make([
			[/token/, token],
			[/labels\/INBOX/, () => new Response('', { status: 401 })],
		]);
		await expect(always.gmail.unreadCount(credentials)).rejects.toBeInstanceOf(MailboxAccessRevoked);
	});

	it('reports a Gmail failure with its status and no body', async () => {
		const { gmail } = make([
			[/token/, token],
			[/labels\/INBOX/, () => new Response('secret body', { status: 429 })],
		]);
		const error = await gmail.unreadCount(credentials).catch((reason: unknown) => reason);
		expect(error).toMatchObject({ name: 'GmailApiError', status: 429 });
		expect(String(error)).not.toContain('secret');
	});

	it('treats an empty success body as an empty object', async () => {
		const { gmail } = make([
			[/token/, token],
			[/\/threads\/t1\/modify/, () => new Response(null, { status: 204 })],
		]);
		await expect(gmail.modifyThread(credentials, 't1', { add: [], remove: [] })).resolves.toBeUndefined();
	});
});
