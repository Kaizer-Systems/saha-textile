import { describe, expect, it, vi } from 'vitest';

import { GMAIL_BATCH, GmailApiError, GmailMailbox } from '../src/index.js';

type Call = { url: string; init: RequestInit };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gone = () => new Response('', { status: 404 });

/** A fake Google: answers by URL, records every call (as in gmail.test.ts). */
const make = (routes: Array<[RegExp, (call: Call) => Response]>) => {
	const calls: Call[] = [];
	const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		const route = routes.find(([pattern]) => pattern.test(call.url));
		return route ? route[1](call) : new Response('', { status: 500 });
	});
	const gmail = new GmailMailbox({
		clientId: 'client',
		clientSecret: 'secret',
		redirectUri: 'https://api.test/admin/mailboxes/oauth/callback',
		domain: 'shop.test',
		fetch: fetchImpl as unknown as typeof fetch,
		now: () => 1_000_000,
	});
	return { gmail, calls };
};
const token = () => json({ access_token: 'access', expires_in: 3600 });
const credentials = { address: 'care@shop.test', refreshToken: 'refresh' };
const body = (call: Call | undefined) => JSON.parse(String(call?.init.body ?? '{}'));
const query = (call: Call | undefined) => Object.fromEntries(new URL(call?.url ?? 'https://x.test').searchParams);

describe('listing ids', () => {
	it('lists conversation ids a page at a time, with a label or a folder and its search words', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[
				/\/threads\?/,
				(call) =>
					call.url.includes('pageToken') ? json({}) : json({ threads: [{ id: 't1' }], nextPageToken: 'n' }),
			],
		]);
		expect(
			await gmail.listThreadIds(credentials, { folder: 'inbox', label: 'Label_1', query: 'invoice' }, undefined),
		).toEqual({
			ids: ['t1'],
			nextPageToken: 'n',
		});
		expect(query(calls.at(-1))).toEqual({ maxResults: '500', labelIds: 'Label_1', q: 'invoice' });
		expect(await gmail.listThreadIds(credentials, { folder: 'trash' }, 'n')).toEqual({
			ids: [],
			nextPageToken: null,
		});
		expect(query(calls.at(-1))).toMatchObject({ labelIds: 'TRASH', includeSpamTrash: 'true', pageToken: 'n' });
	});

	it('lists the bin’s message ids, and finds a message by its Message-ID', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[
				/\/messages\?labelIds=TRASH/,
				(call) =>
					call.url.includes('pageToken') ? json({}) : json({ messages: [{ id: 'm1' }], nextPageToken: 'p' }),
			],
			[/rfc822msgid%3Afound/, () => json({ messages: [{ id: 'm2', threadId: 't2' }] })],
			[/rfc822msgid%3Amissing/, () => json({})],
		]);
		expect(await gmail.listBinMessageIds(credentials, undefined)).toEqual({ ids: ['m1'], nextPageToken: 'p' });
		expect(await gmail.listBinMessageIds(credentials, 'p')).toEqual({ ids: [], nextPageToken: null });
		expect(await gmail.findByMessageId(credentials, '<found@shop.test>')).toEqual({ id: 'm2', threadId: 't2' });
		expect(await gmail.findByMessageId(credentials, ' missing ')).toBeNull();
		expect(query(calls.at(-1))).toMatchObject({ includeSpamTrash: 'true', maxResults: '1' });
	});
});

describe('labels', () => {
	const labelRoutes = (historyId?: string): Array<[RegExp, (call: Call) => Response]> => [
		[/token/, token],
		[/\/profile/, () => json({ emailAddress: 'care@shop.test', ...(historyId ? { historyId } : {}) })],
		[
			/\/labels$/,
			() =>
				json({
					labels: [
						{ id: 'Label_2', name: 'Suppliers', type: 'user' },
						{ id: 'Label_1', name: 'Orders', type: 'user', labelListVisibility: 'labelShow' },
						{ id: 'Label_9', name: 'Hidden', type: 'user', labelListVisibility: 'labelHide' },
						{ id: 'CATEGORY_SOCIAL', name: 'CATEGORY_SOCIAL', type: 'system' },
						{ id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES', type: 'system' },
						{ id: 'INBOX', name: 'INBOX', type: 'system' },
					],
				}),
		],
		[
			/\/labels\/CATEGORY_SOCIAL/,
			() => json({ id: 'CATEGORY_SOCIAL', name: 'CATEGORY_SOCIAL', type: 'system', threadsTotal: 3 }),
		],
		[
			/\/labels\/CATEGORY_UPDATES/,
			() => json({ id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES', type: 'system' }),
		],
		[
			/\/labels\/Label_(\d)$/,
			(call) =>
				json({
					id: call.url.slice(-7),
					name: call.url.endsWith('1') ? 'Orders' : 'Suppliers',
					type: 'user',
					threadsUnread: 1,
					threadsTotal: 2,
				}),
		],
	];

	it('lists the visible labels and the categories in use, sorted, and reuses them while nothing changed', async () => {
		const { gmail, calls } = make(labelRoutes('h1'));
		const labels = await gmail.listLabels(credentials);
		expect(labels.map((label) => [label.name, label.kind])).toEqual([
			['CATEGORY_SOCIAL', 'category'],
			['Orders', 'label'],
			['Suppliers', 'label'],
		]);
		const asked = calls.length;
		expect(await gmail.listLabels(credentials)).toEqual(labels);
		expect(calls.length).toBe(asked + 1);
	});

	it('asks again every time when Gmail gives no history id', async () => {
		const { gmail, calls } = make(labelRoutes());
		await gmail.listLabels(credentials);
		const asked = calls.length;
		await gmail.listLabels(credentials);
		expect(calls.length).toBeGreaterThan(asked + 1);
	});

	it('keeps the label lists of at most 200 mailboxes, forgetting the oldest', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/profile/, () => json({ emailAddress: 'x@shop.test', historyId: 'h' })],
			[/\/labels$/, () => json({ labels: [] })],
		]);
		const mailbox = (n: number) => ({ address: `m${n}@shop.test`, refreshToken: `r${n}` });
		for (let n = 0; n <= 200; n += 1) await gmail.listLabels(mailbox(n));
		const before = calls.filter((call) => call.url.endsWith('/labels')).length;
		await gmail.listLabels(mailbox(200));
		await gmail.listLabels(mailbox(0));
		expect(calls.filter((call) => call.url.endsWith('/labels')).length).toBe(before + 1);
	});

	it('creates, renames and deletes a label, and reads the bin’s counts', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/labels\/gone/, gone],
			[/\/labels\/TRASH/, () => json({ id: 'TRASH', type: 'system', threadsTotal: 4, messagesTotal: 9 })],
			[/\/labels\/Label_1/, (call) => json({ id: 'Label_1', name: body(call).name, type: 'user' })],
			[/\/labels$/, (call) => json({ id: 'Label_3', name: body(call).name, type: 'user' })],
		]);
		expect(await gmail.createLabel(credentials, 'Returns')).toMatchObject({
			id: 'Label_3',
			name: 'Returns',
			kind: 'label',
		});
		expect(body(calls.at(-1))).toEqual({
			name: 'Returns',
			labelListVisibility: 'labelShow',
			messageListVisibility: 'show',
		});
		expect(await gmail.renameLabel(credentials, 'Label_1', 'Orders/Paid')).toMatchObject({ name: 'Orders/Paid' });
		expect(await gmail.renameLabel(credentials, 'gone', 'x')).toBeNull();
		await gmail.deleteLabel(credentials, 'gone');
		expect(calls.at(-1)?.init.method).toBe('DELETE');
		expect(await gmail.binCount(credentials)).toEqual({ threads: 4, messages: 9 });
	});
});

describe('changing many messages', () => {
	const ids = Array.from({ length: GMAIL_BATCH + 1 }, (_, n) => `m${n}`);

	it('changes and deletes in Gmail’s batches of 1,000', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/batchModify|batchDelete/, () => json({})],
		]);
		await gmail.modifyMessages(credentials, ids, { add: ['Label_1'], remove: ['INBOX'] });
		const modify = calls.filter((call) => call.url.endsWith('/messages/batchModify'));
		expect(modify.map((call) => body(call).ids.length)).toEqual([GMAIL_BATCH, 1]);
		expect(body(modify[0])).toMatchObject({ addLabelIds: ['Label_1'], removeLabelIds: ['INBOX'] });
		await gmail.deleteMessagesForever(credentials, ids);
		expect(calls.filter((call) => call.url.endsWith('/messages/batchDelete'))).toHaveLength(2);
	});

	it('reads each message’s labels in a conversation, deletes one for ever, and says when it is gone', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/threads\/gone/, gone],
			[
				/\/threads\/t1\?format=minimal/,
				() => json({ messages: [{ id: 'm1', labelIds: ['INBOX'] }, { id: 'm2' }] }),
			],
			[/\/threads\/t1$/, () => json({})],
		]);
		expect(await gmail.threadMessageLabels(credentials, 't1')).toEqual([
			{ id: 'm1', labelIds: ['INBOX'] },
			{ id: 'm2', labelIds: [] },
		]);
		expect(await gmail.threadMessageLabels(credentials, 'gone')).toBeNull();
		await gmail.deleteThreadForever(credentials, 't1');
		expect(calls.at(-1)?.init.method).toBe('DELETE');
	});
});

describe('drafts list', () => {
	it('lists drafts a page at a time and leaves out one deleted meanwhile', async () => {
		const draft = (id: string) =>
			json({
				id,
				message: { id: `${id}m`, threadId: `${id}t`, payload: { headers: [{ name: 'Subject', value: id }] } },
			});
		const { gmail, calls } = make([
			[/token/, token],
			[
				/\/drafts\?maxResults/,
				(call) =>
					call.url.includes('pageToken')
						? json({})
						: json({ drafts: [{ id: 'd1' }, { id: 'gone' }], nextPageToken: 'n' }),
			],
			[/\/drafts\/gone/, gone],
			[/\/drafts\/d1\?format=metadata/, () => draft('d1')],
		]);
		const page = await gmail.listDrafts(credentials, undefined);
		expect(page.drafts).toHaveLength(1);
		expect(page.nextPageToken).toBe('n');
		expect(await gmail.listDrafts(credentials, 'n')).toEqual({ drafts: [], nextPageToken: null });
		expect(query(calls.find((call) => call.url.includes('pageToken=n')))).toMatchObject({ pageToken: 'n' });
	});
});

describe('filters, vacation answers and withdrawing access', () => {
	it('reads a filter matching on to and Gmail search words', async () => {
		const { gmail } = make([
			[/token/, token],
			[
				/\/settings\/filters/,
				() =>
					json({
						filter: [
							{ id: 'f3', criteria: { to: 'orders@shop.test', query: 'has:attachment' }, action: {} },
						],
					}),
			],
		]);
		expect((await gmail.listFilters(credentials))[0]?.criteria).toEqual({
			to: 'orders@shop.test',
			query: 'has:attachment',
		});
	});

	it('sends a vacation answer’s start and end as Gmail’s milliseconds, and leaves them out when open', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/settings\/vacation/, (call) => json({ ...body(call) })],
		]);
		const vacation = {
			enabled: true,
			subject: 'Away',
			message: 'Back Monday.',
			contactsOnly: false,
			domainOnly: false,
			startTime: '2026-12-01T00:00:00.000Z',
			endTime: '2026-12-08T00:00:00.000Z',
		};
		await gmail.updateVacation(credentials, vacation);
		expect(body(calls.at(-1))).toMatchObject({
			startTime: String(Date.parse(vacation.startTime)),
			endTime: String(Date.parse(vacation.endTime)),
		});
		await gmail.updateVacation(credentials, { ...vacation, startTime: null, endTime: null });
		expect(body(calls.at(-1))).not.toHaveProperty('startTime');
		expect(body(calls.at(-1))).not.toHaveProperty('endTime');
	});

	it('reports a withdrawal Google did not confirm', async () => {
		const { gmail } = make([[/\/revoke/, () => new Response('', { status: 503 })]]);
		await expect(gmail.revoke(credentials)).rejects.toEqual(
			new GmailApiError('Google did not confirm the withdrawal', 503),
		);
	});
});

describe('sign-in and drafts at their edges', () => {
	const mail = {
		from: 'care@shop.test',
		to: [],
		cc: [],
		subject: 'Hello',
		text: 'Typed',
		signatureHtml: '',
		attachments: [],
	};
	const grant = () =>
		json({
			access_token: 'a1',
			expires_in: 3600,
			refresh_token: 'r1',
			scope: 'https://mail.google.com/ https://www.googleapis.com/auth/gmail.modify',
		});

	it('keeps the scopes Google lists, and refuses another domain even when the withdrawal fails', async () => {
		const ok = make([
			[/oauth2\.googleapis\.com\/token/, grant],
			[/\/profile$/, () => json({ emailAddress: 'care@shop.test' })],
		]);
		expect((await ok.gmail.completeSignIn('code')).scopes).toEqual([
			'https://mail.google.com/',
			'https://www.googleapis.com/auth/gmail.modify',
		]);
		const other = make([
			[/oauth2\.googleapis\.com\/token/, grant],
			[/\/profile$/, () => json({ emailAddress: 'me@gmail.com' })],
			[/\/revoke/, () => new Response('', { status: 503 })],
		]);
		await expect(other.gmail.completeSignIn('code')).rejects.toMatchObject({ status: 403 });
	});

	it('starts a draft outside any conversation, and skips a kept file that is gone from Gmail', async () => {
		const { gmail, calls } = make([
			[/token/, token],
			[/\/drafts$/, () => json({ id: 'd2', message: { id: 'v1' } })],
			[
				/\/drafts\/d2\?format=full/,
				() =>
					json({
						id: 'd2',
						message: {
							id: 'v1',
							threadId: '',
							payload: {
								mimeType: 'multipart/mixed',
								headers: [],
								parts: [
									{
										mimeType: 'application/pdf',
										filename: 'gone.pdf',
										body: { attachmentId: 'a1', size: 4 },
									},
								],
							},
						},
					}),
			],
			[/\/attachments\/a1/, gone],
			[/\/drafts\/d2$/, () => json({ id: 'd2', message: { id: 'v2', threadId: 't9' } })],
		]);
		expect(await gmail.createDraft(credentials, mail)).toEqual({ draftId: 'd2', version: 'v1', threadId: null });
		expect(body(calls.at(-1)).message).not.toHaveProperty('threadId');
		const draft = await gmail.getDraft(credentials, 'd2');
		expect(draft).toMatchObject({ threadId: null, html: null });
		expect(await gmail.updateDraft(credentials, 'd2', { ...mail, threadId: 't9' }, true)).toMatchObject({
			threadId: 't9',
		});
		const put = calls.find((call) => call.init.method === 'PUT');
		expect(body(put).message.threadId).toBe('t9');
		expect(Buffer.from(body(put).message.raw, 'base64url').toString('utf8')).not.toContain('gone.pdf');
	});

	it('lists a draft with no conversation and no snippet', async () => {
		const { gmail } = make([
			[/token/, token],
			[/\/drafts\?maxResults/, () => json({ drafts: [{ id: 'd3' }] })],
			[
				/\/drafts\/d3\?format=metadata/,
				() => json({ id: 'd3', message: { id: 'v1', threadId: '', payload: { headers: [] } } }),
			],
		]);
		expect((await gmail.listDrafts(credentials, undefined)).drafts[0]).toMatchObject({
			threadId: null,
			snippet: '',
		});
	});
});

describe('message text at its edges', () => {
	it('shows an inline picture whose size Gmail did not give', async () => {
		const { inlinePictureParts } = await import('../src/index.js');
		const message = {
			id: 'm1',
			threadId: 't1',
			labelIds: [],
			snippet: '',
			internalDate: '0',
			payload: {
				mimeType: 'multipart/related',
				parts: [
					{
						mimeType: 'image/png',
						headers: [{ name: 'Content-ID', value: '<logo>' }],
						body: { attachmentId: 'a1' },
					},
				],
			},
		};
		expect(inlinePictureParts(message)).toEqual([{ cid: 'logo', attachmentId: 'a1', mimeType: 'image/png' }]);
	});

	it('uses the typed text when the formatted writing holds no words', async () => {
		const { buildOutgoing } = await import('../src/index.js');
		const raw = buildOutgoing({
			from: 'care@shop.test',
			to: ['a@x.test'],
			cc: [],
			subject: 'Hello',
			text: 'Typed words',
			html: '<p><br></p>',
			signatureHtml: '',
			attachments: [],
		});
		const texts = [...raw.matchAll(/Content-Type: text\/plain[^]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
			Buffer.from((m[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8'),
		);
		expect(texts.some((text) => text.includes('Typed words'))).toBe(true);
	});

	it('keeps a reply line with nothing but blank lines after it as part of the message', async () => {
		const { splitTextQuote } = await import('../src/index.js');
		const split = splitTextQuote('Thanks\nOn Mon, 23 Nov 2026, Rina wrote:\n\n\n');
		expect(split.main).toContain('Thanks');
	});
});
