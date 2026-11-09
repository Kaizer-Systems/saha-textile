import { describe, expect, it, vi } from 'vitest';

import {
	GmailMailbox,
	buildOutgoing,
	cleanEmailHtml,
	displayName,
	markMisleadingLinks,
	referencesFor,
	splitTextQuote,
	toInboxMessage,
	toThreadSummary,
} from '../src/index.js';

/** Fixes from the Inbox review (brief revision 2): quotes, links, pictures, threading, Gmail load. */

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
/** The decoded base64 MIME bodies of a built message, in order. */
const bodies = (message: string) =>
	[...message.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
		Buffer.from((m[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8'),
	);

describe('quoted history (E1)', () => {
	it("splits Gmail's quote off, attribution line included", () => {
		const cleaned = cleanEmailHtml(
			'<div dir="ltr">Thank you!</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Priya wrote:</div><blockquote class="gmail_quote">Earlier</blockquote></div>',
		);
		expect(cleaned.html).toBe('<div dir="ltr">Thank you!</div>');
		expect(cleaned.quoteHtml).toContain('On Mon, Priya wrote:');
		expect(cleaned.quoteHtml).toContain('Earlier');
		expect(cleaned.quoteHtml).not.toContain('data-quote');
	});

	it("moves Apple Mail's 'wrote:' line down with its quote", () => {
		const cleaned = cleanEmailHtml(
			'<div>Yes please</div><div>On 9 Nov 2026, at 10:00, Shop wrote:</div><blockquote type="cite">Old text</blockquote>',
		);
		expect(cleaned.html).toBe('<div>Yes please</div>');
		expect(cleaned.quoteHtml).toBe(
			'<div>On 9 Nov 2026, at 10:00, Shop wrote:</div><blockquote>Old text</blockquote>',
		);
	});

	it("splits at Outlook's reply header and closes what the split left open", () => {
		const cleaned = cleanEmailHtml(
			'<div><p>New</p><div id="divRplyFwdMsg"><b>From:</b> Shop</div><p>Old</p></div>',
		);
		expect(cleaned.html).toBe('<div><p>New</p></div>');
		expect(cleaned.quoteHtml).toContain('From:');
		expect(cleaned.quoteHtml).toContain('<p>Old</p>');
	});

	it('keeps a message that is only a quote in view, and ignores a sender-written marker', () => {
		const forward = cleanEmailHtml('<div class="gmail_quote">Forwarded text</div>');
		expect(forward.html).toContain('Forwarded text');
		expect(forward.quoteHtml).toBe('');
		const blankAbove = cleanEmailHtml('<div><br></div><div class="gmail_quote">Forwarded</div>');
		expect(blankAbove.html).toContain('Forwarded');
		expect(blankAbove.quoteHtml).toBe('');
		const sneaky = cleanEmailHtml('<p>Hi</p><div data-quote="1">Not a quote</div>');
		expect(sneaky.html).toContain('Not a quote');
		expect(sneaky.quoteHtml).toBe('');
	});

	it('splits plain-text mail at "On … wrote:", "Original Message" or trailing "> " lines', () => {
		expect(splitTextQuote('Thanks\n\nOn Mon, Shop wrote:\n> Hello\n> there')).toEqual({
			main: 'Thanks',
			quote: 'On Mon, Shop wrote:\n> Hello\n> there',
		});
		expect(splitTextQuote('Fine\n-----Original Message-----\nFrom: Shop')).toEqual({
			main: 'Fine',
			quote: '-----Original Message-----\nFrom: Shop',
		});
		expect(splitTextQuote('Ok\n> a\n\n> b')).toEqual({ main: 'Ok', quote: '> a\n\n> b' });
		expect(splitTextQuote('> all quoted')).toEqual({ main: '> all quoted', quote: '' });
		expect(splitTextQuote('No quote\nOn Monday I wrote:\nnothing')).toEqual({
			main: 'No quote\nOn Monday I wrote:\nnothing',
			quote: '',
		});
	});

	it('splits a plain-text message when it is mapped', () => {
		const message = toInboxMessage({
			id: 'm1',
			threadId: 't1',
			labelIds: [],
			snippet: '',
			internalDate: '0',
			payload: { mimeType: 'text/plain', body: { data: b64('New\n\nOn Mon, A wrote:\n> Old') } },
		});
		expect(message.html).toBe('New');
		expect(message.quoteHtml).toBe('On Mon, A wrote:<br>&gt; Old');
	});
});

describe('misleading links (T11)', () => {
	it('marks a link whose words name another address, and leaves honest links alone', () => {
		const html = markMisleadingLinks(
			'<a href="https://evil.test/login" target="_blank">www.sahatextile.com</a> <a href="https://www.shop.test/a">shop.test</a> <a href="https://x.test">Click here</a> <a href="https://pay.shop.test">shop.test</a>',
		);
		expect(html).toContain(
			'www.sahatextile.com</a><span style="color:#b42318;font-weight:bold"> ⚠ evil.test</span>',
		);
		expect(html.match(/⚠/g)).toHaveLength(1);
	});

	it('marks links inside cleaned mail, and skips addresses it cannot read', () => {
		expect(cleanEmailHtml('<a href="https://evil.test">https://bank.test</a>').html).toContain('⚠ evil.test');
		expect(markMisleadingLinks('<a href="mailto:a@x.test">x.test</a>')).not.toContain('⚠');
		expect(markMisleadingLinks('<a href="https://[bad">x.test</a>')).not.toContain('⚠');
	});
});

describe('pictures inside the mail (E6)', () => {
	const message = {
		id: 'm1',
		threadId: 't1',
		labelIds: ['UNREAD'],
		snippet: '',
		internalDate: '0',
		payload: {
			mimeType: 'multipart/related',
			headers: [
				{ name: 'Message-ID', value: '<contact-1@saha-textile.local>' },
				{ name: 'Reply-To', value: 'ananya@x.test' },
				{ name: 'References', value: '<a@x> <b@x>' },
			],
			parts: [
				{ mimeType: 'text/html', body: { data: b64('<p>Logo <img src="cid:logo1"></p>') } },
				{
					mimeType: 'image/png',
					filename: 'logo.png',
					headers: [{ name: 'Content-ID', value: '<logo1>' }],
					body: { attachmentId: 'a1', size: 100 },
				},
				{
					mimeType: 'application/pdf',
					filename: 'bill.pdf',
					body: { attachmentId: 'a2', size: 200 },
				},
			],
		},
	};

	it('shows a cid picture in place and drops it from the attachments', () => {
		const shown = toInboxMessage(message, new Map([['logo1', 'data:image/png;base64,AAA']]));
		expect(shown.html).toContain('src="data:image/png;base64,AAA"');
		expect(shown.attachments.map((file) => file.filename)).toEqual(['bill.pdf']);
		const without = toInboxMessage(message);
		expect(without.html).not.toContain('cid:');
		expect(without.attachments.map((file) => file.filename)).toEqual(['logo.png', 'bill.pdf']);
	});

	it('reads unread, References and the Contact Us details (E2, E4, E10)', () => {
		const shown = toInboxMessage({
			...message,
			payload: {
				...message.payload,
				parts: [{ mimeType: 'text/plain', body: { data: b64('Hello\nReply in: Bengali') } }],
			},
		});
		expect(shown).toMatchObject({
			unread: true,
			references: '<a@x> <b@x>',
			contactForm: { replyTo: 'ananya@x.test', locale: 'bn' },
			sentBy: null,
		});
		const plain = toInboxMessage({ ...message, labelIds: [], payload: { mimeType: 'text/plain' } });
		expect(plain).toMatchObject({ unread: false, contactForm: null, references: '' });
	});
});

describe('list lines (E7)', () => {
	const from = (name: string, id = '') => ({
		id: `m${name}`,
		threadId: 't1',
		labelIds: [],
		snippet: '',
		internalDate: '1',
		payload: {
			headers: [{ name: 'From', value: name }, ...(id ? [{ name: 'Message-ID', value: id }] : [])],
		},
	});

	it('names everyone in the conversation once, and marks a Contact Us conversation', () => {
		const summary = toThreadSummary({
			id: 't1',
			messages: [
				from('"Priya Banerjee" <priya@x.test>', '<contact-9@saha-textile.local>'),
				from('Saha Textile <wecare@shop.test>'),
				from('"Priya Banerjee" <priya@x.test>'),
			],
		});
		expect(summary.participants).toEqual(['Priya Banerjee', 'Saha Textile']);
		expect(summary.fromContactForm).toBe(true);
		expect(toThreadSummary({ id: 't2', messages: [from('a@x.test')] })).toMatchObject({
			participants: ['a@x.test'],
			fromContactForm: false,
			lastReplyBy: null,
		});
	});

	it('reads a display name, or the address when there is none', () => {
		expect(displayName('"Rahul" <r@x.test>')).toBe('Rahul');
		expect(displayName('<r@x.test>')).toBe('r@x.test');
	});
});

describe('replies (E3, E4)', () => {
	const base = {
		from: 'care@shop.test',
		to: ['a@x.test'],
		cc: [],
		subject: 'Re: Order',
		text: 'Yes',
		signatureHtml: '<i>Team</i>',
		threadId: 't1',
		inReplyTo: 'c@x',
		attachments: [],
	};

	it('carries the whole References chain on, each id once, trimmed when very long', () => {
		expect(referencesFor('<a@x> <b@x> <c@x>', 'c@x')).toBe('<a@x> <b@x> <c@x>');
		expect(referencesFor(undefined, '<z@x>')).toBe('<z@x>');
		const long = Array.from({ length: 30 }, (_, index) => `<m${index}@x>`).join(' ');
		const kept = referencesFor(long, 'last@x').split(' ');
		expect(kept).toHaveLength(20);
		expect(kept[0]).toBe('<m0@x>');
		expect(kept.at(-1)).toBe('<last@x>');
		expect(buildOutgoing({ ...base, references: '<a@x>' })).toContain('References: <a@x> <c@x>');
	});

	it('quotes the answered message under the reply and signature, pictures restored', () => {
		const message = buildOutgoing({
			...base,
			quote: {
				attribution: 'On 9 Nov 2026, Priya <p@x> wrote:',
				html: '<p>Hi <img data-remote-src="https://x.test/a.png"></p>',
				text: 'Hi\nthere',
			},
		});
		const [text, html] = bodies(message);
		expect(text).toBe('Yes\n\nOn 9 Nov 2026, Priya <p@x> wrote:\n> Hi\n> there');
		expect(html).toContain('<div class="gmail_signature"><i>Team</i></div><br><div class="gmail_quote">');
		expect(html).toContain('On 9 Nov 2026, Priya &lt;p@x&gt; wrote:');
		expect(html).toContain('<img src="https://x.test/a.png">');
	});
});

type Call = { url: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: 'access', expires_in: 3600 });
const credentials = { address: 'care@shop.test', refreshToken: 'refresh' };

/** A fake Google that answers by URL and records every call; `sleep` never waits. */
const make = (routes: Array<[RegExp, (call: Call) => Response | Promise<Response>]>) => {
	const calls: Call[] = [];
	const sleep = vi.fn(async () => undefined);
	const gmail = new GmailMailbox({
		clientId: 'client',
		clientSecret: 'secret',
		redirectUri: 'https://api.test/cb',
		domain: 'shop.test',
		now: () => 1_000_000,
		sleep,
		fetch: (async (input: string | URL | Request) => {
			const call = { url: String(input) };
			calls.push(call);
			const route = routes.find(([pattern]) => pattern.test(call.url));
			return route ? route[1](call) : new Response('', { status: 500 });
		}) as typeof fetch,
	});
	return { gmail, calls, sleep };
};
const metadata = (id: string) =>
	json({ id, messages: [{ id: `${id}m`, threadId: id, payload: { headers: [{ name: 'Subject', value: id }] } }] });

describe('Gmail load (T1)', () => {
	it('answers from memory while the mailbox has not changed, and re-reads only changed conversations', async () => {
		let history = '1';
		let t2History = 'a';
		const { gmail, calls } = make([
			[/token/, token],
			[/\/profile/, () => json({ emailAddress: 'care@shop.test', historyId: history })],
			[
				/\/threads\?/,
				() =>
					json({
						threads: [
							{ id: 't1', historyId: 'x' },
							{ id: 't2', historyId: t2History },
						],
					}),
			],
			[/\/threads\/t\d\?format=metadata/, (call) => metadata(call.url.includes('/t1?') ? 't1' : 't2')],
		]);
		const reads = () => calls.filter((call) => call.url.includes('format=metadata')).length;
		const lists = () => calls.filter((call) => call.url.includes('/threads?')).length;

		await gmail.listThreads(credentials, 'inbox', undefined, undefined);
		expect([lists(), reads()]).toEqual([1, 2]);

		const again = await gmail.listThreads(credentials, 'inbox', undefined, undefined);
		expect(again.threads).toHaveLength(2);
		expect([lists(), reads()]).toEqual([1, 2]);

		history = '2';
		t2History = 'b';
		await gmail.listThreads(credentials, 'inbox', undefined, undefined);
		expect([lists(), reads()]).toEqual([2, 3]);
		expect(calls.filter((call) => call.url.includes('format=metadata')).at(-1)?.url).toContain('/t2?');
	});

	it('waits and retries when Gmail says slow down, and gives up after two retries', async () => {
		let busy = 2;
		const { gmail, sleep } = make([
			[/token/, token],
			[/\/labels\/INBOX/, () => (busy-- > 0 ? new Response('', { status: 429 }) : json({ threadsUnread: 4 }))],
		]);
		expect(await gmail.unreadCount(credentials)).toBe(4);
		expect(sleep.mock.calls).toEqual([[500], [1500]]);

		const limited = make([
			[/token/, token],
			[/\/labels\/INBOX/, () => json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403)],
		]);
		await expect(limited.gmail.unreadCount(credentials)).rejects.toMatchObject({ status: 403 });
		expect(limited.sleep).toHaveBeenCalledTimes(2);

		const refused = make([
			[/token/, token],
			[/\/labels\/INBOX/, () => json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403)],
		]);
		await expect(refused.gmail.unreadCount(credentials)).rejects.toMatchObject({ status: 403 });
		expect(refused.sleep).not.toHaveBeenCalled();
	});

	it('keeps at most eight Gmail calls in flight', async () => {
		let running = 0;
		let most = 0;
		const ids = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}` }));
		const { gmail } = make([
			[/token/, token],
			[/\/profile/, () => json({ emailAddress: 'care@shop.test' })],
			[/\/threads\?/, () => json({ threads: ids })],
			[
				/format=metadata/,
				async (call) => {
					running++;
					most = Math.max(most, running);
					await new Promise((resolve) => setTimeout(resolve, 2));
					running--;
					return metadata(/threads\/(t\d+)/.exec(call.url)?.[1] ?? '');
				},
			],
		]);
		const page = await gmail.listThreads(credentials, 'all', undefined, undefined);
		expect(page.threads).toHaveLength(20);
		expect(most).toBe(8);
	});

	it('fetches pictures sent inside a conversation and shows them in place', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[
				/\/threads\/t1\?format=full/,
				() =>
					json({
						id: 't1',
						messages: [
							{
								id: 'm1',
								threadId: 't1',
								payload: {
									parts: [
										{
											mimeType: 'text/html',
											body: { data: b64('<img src="cid:p1"><img src="cid:p2">') },
										},
										{
											mimeType: 'image/png',
											filename: 'p1.png',
											headers: [{ name: 'Content-ID', value: '<p1>' }],
											body: { attachmentId: 'a1', size: 10 },
										},
										{
											mimeType: 'image/png',
											filename: 'p2.png',
											headers: [{ name: 'Content-ID', value: '<p2>' }],
											body: { attachmentId: 'a2', size: 10 },
										},
										{
											mimeType: 'image/png',
											filename: 'big.png',
											headers: [{ name: 'Content-ID', value: '<p3>' }],
											body: { attachmentId: 'a3', size: 5_000_000 },
										},
										{
											mimeType: 'image/png',
											filename: 'kept.png',
											headers: [
												{ name: 'Content-ID', value: '<p4>' },
												{ name: 'Content-Disposition', value: 'attachment; filename=kept.png' },
											],
											body: { attachmentId: 'a4', size: 10 },
										},
									],
								},
							},
						],
					}),
			],
			[/attachments\/a1/, () => json({ data: Buffer.from([1]).toString('base64url') })],
			[/attachments\/a2/, () => new Response('', { status: 500 })],
		]);
		const thread = await gmail.getThread(credentials, 't1');
		const message = thread?.messages[0];
		expect(message?.html).toContain('src="data:image/png;base64,AQ=="');
		expect(message?.attachments.map((file) => file.filename)).toEqual(['p2.png', 'big.png', 'kept.png']);
		expect(calls.filter((call) => call.url.includes('/attachments/'))).toHaveLength(2);
	});
});
