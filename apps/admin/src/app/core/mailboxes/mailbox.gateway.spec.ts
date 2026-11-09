import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { INBOX_REFRESH_MS, MailboxGateway, injectInboxSummaryQuery, injectMailboxesQuery } from './mailbox.gateway';

interface Options {
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
	refetchInterval?: number;
}
const captured = vi.hoisted(() => ({ options: [] as Array<() => Options> }));
vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => Options) => {
		captured.options.push(options);
		return {};
	},
}));
vi.mock('@core/config/runtime-config', () => ({ runtimeConfig: { apiUrl: 'https://api.test' } }));

const setup = () => {
	const http = {
		get: vi.fn((..._args: unknown[]) => of('read')),
		post: vi.fn((..._args: unknown[]) => of('posted')),
		put: vi.fn((..._args: unknown[]) => of('put')),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { gateway: TestBed.inject(MailboxGateway), http };
};

describe('MailboxGateway', () => {
	it('calls the Settings › Mailboxes routes', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.overview());
		await firstValueFrom(gateway.connect());
		await firstValueFrom(gateway.access('a b'));
		await firstValueFrom(gateway.saveAccess('m1', [{ adminUserId: 'u1', canSend: true }]));
		await firstValueFrom(gateway.setContactTarget(null));
		await firstValueFrom(gateway.refresh('m1'));
		await firstValueFrom(gateway.disconnect('m1'));
		expect(http.get.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/mailboxes',
			'https://api.test/admin/mailboxes/a%20b/access',
		]);
		expect(http.post.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/mailboxes/connect',
			'https://api.test/admin/mailboxes/m1/refresh',
			'https://api.test/admin/mailboxes/m1/disconnect',
		]);
		expect(http.put.mock.calls).toEqual([
			['https://api.test/admin/mailboxes/m1/access', { entries: [{ adminUserId: 'u1', canSend: true }] }],
			['https://api.test/admin/mailboxes/contact-target', { mailboxId: null }],
		]);
	});

	it('calls the Inbox routes, with search and page only when given', async () => {
		const { gateway, http } = setup();
		await firstValueFrom(gateway.summary());
		await firstValueFrom(gateway.threads('m1', 'inbox'));
		await firstValueFrom(gateway.threads('m1', 'all', 'from:rina', 'p2'));
		await firstValueFrom(gateway.thread('m1', 't/1'));
		await firstValueFrom(gateway.send('m1', { from: 'a@shop.test' } as never));
		await firstValueFrom(gateway.modify('m1', 't1', 'archive'));
		const params = http.get.mock.calls.map((call) =>
			(call[1] as { params?: HttpParams } | undefined)?.params?.toString(),
		);
		expect(params).toEqual([undefined, 'folder=inbox', 'folder=all&q=from:rina&pageToken=p2', undefined]);
		expect(http.get.mock.calls[3]?.[0]).toBe('https://api.test/admin/inbox/m1/threads/t%2F1');
		expect(http.post.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/inbox/m1/send',
			'https://api.test/admin/inbox/m1/threads/t1/modify',
		]);
		expect(gateway.attachmentUrl('m1', 'msg', 'att', 'bill 1.pdf')).toBe(
			'https://api.test/admin/inbox/m1/messages/msg/attachments/att?name=bill%201.pdf',
		);
	});

	it('reads the overview and the unread counts through their queries, the counts every minute', async () => {
		const { gateway } = setup();
		vi.spyOn(gateway, 'overview').mockReturnValue(of({ configured: true, domain: 'shop.test', rows: [] }));
		vi.spyOn(gateway, 'summary').mockReturnValue(of([]));
		captured.options = [];
		TestBed.runInInjectionContext(() => {
			injectMailboxesQuery();
			injectInboxSummaryQuery();
			injectInboxSummaryQuery(() => false);
		});
		const [overview, summary, disabled] = captured.options.map((options) => options());
		expect(await overview?.queryFn()).toMatchObject({ domain: 'shop.test' });
		expect(await summary?.queryFn()).toEqual([]);
		expect(summary?.refetchInterval).toBe(INBOX_REFRESH_MS);
		expect(summary?.enabled).toBe(true);
		expect(disabled?.enabled).toBe(false);
	});
});
