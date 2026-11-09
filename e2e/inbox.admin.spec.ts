import type { Page, Route } from '@playwright/test';

import { ADMIN, expect, test } from './support';

/**
 * The admin Inbox, with Gmail answered by the test: Gmail cannot be reached from a test run, and
 * the API's own Gmail calls are covered by its unit tests. Everything the admin does on the page
 * (address, folding, reply, the collision check, the send request) runs for real.
 */

const now = Date.now();
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
const message = (id: string, fields: Record<string, unknown>) => ({
	id,
	to: 'wecare@shop.test',
	cc: '',
	replyTo: '',
	subject: 'Blouse alteration',
	html: `<p>${id} body</p>`,
	quoteHtml: '',
	unread: false,
	text: `${id} body`,
	hasRemoteImages: false,
	attachments: [],
	messageId: `<${id}@mail.test>`,
	references: '',
	contactForm: null,
	sentBy: null,
	...fields,
});
const priya = 'Priya Banerjee <priya@example.test>';
const shop = 'Saha Textile <wecare@shop.test>';

const mailboxes = [
	{
		mailboxId: 'mbx-wecare',
		address: 'wecare@shop.test',
		status: 'connected',
		canSend: true,
		unread: 1,
		sendAs: [
			{
				address: 'wecare@shop.test',
				displayName: 'Saha Textile',
				signature: '<p>Saha Textile, Barasat</p>',
				isPrimary: true,
			},
		],
	},
];

function conversation(extra: ReturnType<typeof message>[] = []) {
	return {
		id: 't1',
		subject: 'Blouse alteration',
		unread: false,
		messages: [
			message('m1', { from: priya, date: at(50) }),
			message('m2', { from: shop, date: at(40), sentBy: 'Riya' }),
			message('m3', {
				from: priya,
				date: at(2),
				html: '<p>Perfect, thank you so much!</p>',
				quoteHtml: '<blockquote>m2 body</blockquote>',
				text: 'Perfect, thank you so much!',
			}),
			...extra,
		],
	};
}

const row = {
	id: 't1',
	from: priya,
	subject: 'Blouse alteration',
	snippet: 'Perfect, thank you so much!',
	to: 'wecare@shop.test',
	date: at(2),
	unread: false,
	messageCount: 3,
	participants: ['Priya Banerjee', 'Saha Textile'],
	fromContactForm: false,
	lastReplyBy: 'Riya',
};

/** Answers the Inbox API; `arrived` adds a colleague's reply once the reply box is open. */
async function gmail(page: Page, options: { arrived?: boolean } = {}) {
	const sent: unknown[] = [];
	let threadReads = 0;
	await page.route(/\/admin\/inbox(\/|\?|$)/, async (route: Route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace(/^.*\/admin\/inbox/, '');
		if (path === '' || path === '/') return route.fulfill({ json: mailboxes });
		if (path.endsWith('/threads')) return route.fulfill({ json: { threads: [row], nextPageToken: null } });
		if (path.endsWith('/threads/t1')) {
			threadReads++;
			const late = options.arrived && threadReads > 1;
			return route.fulfill({
				json: conversation(
					late
						? [
								message('m4', {
									from: shop,
									date: at(0.03),
									sentBy: 'Arup',
									html: '<p>See you Saturday</p>',
								}),
							]
						: [],
				),
			});
		}
		if (path.endsWith('/modify')) return route.fulfill({ json: { ok: true } });
		if (path.endsWith('/send')) {
			sent.push(route.request().postDataJSON());
			return route.fulfill({ json: { id: 's1', threadId: 't1' } });
		}
		return route.fulfill({ status: 404, json: {} });
	});
	return sent;
}

test.describe('the admin Inbox', () => {
	test('lists conversations by who is in them and opens one at its own address', async ({ page }) => {
		await gmail(page);
		await page.goto(`${ADMIN}/inbox`);
		await expect(page).toHaveURL(/\/inbox\/wecare\/inbox$/);
		const listRow = page.locator('.inbox-list li a').first();
		await expect(listRow).toContainText('Priya Banerjee, Saha Textile');
		await expect(listRow).toContainText('Last reply by Riya');

		await listRow.click();
		await expect(page).toHaveURL(/\/inbox\/wecare\/inbox\/t1$/);
		await expect(page.locator('#inbox_subject')).toHaveText('Blouse alteration');
		// Older read messages fold to one line; the newest stays open with its quote folded.
		await expect(page.locator('#inbox_open_all')).toBeVisible();
		await expect(page.locator('iframe.inbox-frame')).toHaveCount(1);
		await page.locator('#inbox_open_all').click();
		await expect(page.locator('iframe.inbox-frame')).toHaveCount(3);
		await expect(page.getByText('Sent from the admin by Riya')).toBeVisible();

		// Back closes the conversation instead of leaving the Inbox.
		await page.goBack();
		await expect(page).toHaveURL(/\/inbox\/wecare\/inbox$/);
	});

	test('replies under the conversation, checks addresses, and quotes the answered message', async ({ page }) => {
		const sent = await gmail(page);
		await page.goto(`${ADMIN}/inbox/wecare/inbox/t1`);
		await page.locator('#inbox_reply_btn').click();
		await expect(page).toHaveURL(/draft=reply/);
		await expect(page.locator('#inbox_to')).toHaveValue('priya@example.test');
		await expect(page.getByText("Priya Banerjee's message is quoted below")).toBeVisible();

		await page.locator('#inbox_to').fill('priya@example.test, priya@example');
		await expect(page.locator('#inbox_to_problem')).toContainText('priya@example');
		await page.locator('#inbox_to').fill('priya@example.test');
		await page.locator('#inbox_body').fill('Your blouse is ready for pickup.');
		await page.locator('#inbox_send_btn').click();

		await expect.poll(() => sent.length).toBe(1);
		expect(sent[0]).toMatchObject({
			from: 'wecare@shop.test',
			to: ['priya@example.test'],
			threadId: 't1',
			inReplyTo: '<m3@mail.test>',
			quoteMessageId: 'm3',
			body: 'Your blouse is ready for pickup.',
		});
		await expect(page).not.toHaveURL(/draft=/);
	});

	test('stops a reply when a colleague answered meanwhile, then sends on request', async ({ page }) => {
		const sent = await gmail(page, { arrived: true });
		await page.goto(`${ADMIN}/inbox/wecare/inbox/t1`);
		await page.locator('#inbox_reply_btn').click();
		await page.locator('#inbox_body').fill('We have kept it for you.');
		await page.locator('#inbox_send_btn').click();
		await expect(page.getByRole('alert').filter({ hasText: 'Arup has replied' })).toBeVisible();
		expect(sent).toHaveLength(0);
		await page.getByRole('button', { name: 'Send anyway' }).click();
		await expect.poll(() => sent.length).toBe(1);
	});
});
