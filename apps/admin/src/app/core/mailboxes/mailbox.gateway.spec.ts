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
		delete: vi.fn((..._args: unknown[]) => of(null)),
		patch: vi.fn((..._args: unknown[]) => of('patched')),
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
		await firstValueFrom(gateway.saveAccess('m1', 3, [{ adminUserId: 'u1', rights: ['read', 'send'] }]));
		await firstValueFrom(gateway.setContactTarget(null));
		await firstValueFrom(gateway.refresh('m1'));
		await firstValueFrom(gateway.disconnect('m1'));
		await firstValueFrom(gateway.people('riya', 2));
		await firstValueFrom(gateway.withdrawAgain('m1'));
		expect(http.get.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/mailboxes',
			'https://api.test/admin/mailboxes/a%20b/access',
			'https://api.test/admin/mailboxes/people',
		]);
		expect(String((http.get.mock.calls[2]?.[1] as { params?: unknown } | undefined)?.params)).toBe('q=riya&page=2');
		expect(http.post.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/mailboxes/connect',
			'https://api.test/admin/mailboxes/m1/refresh',
			'https://api.test/admin/mailboxes/m1/disconnect',
			'https://api.test/admin/mailboxes/m1/withdraw-again',
		]);
		expect(http.put.mock.calls.map((call) => [call[0], call[1]])).toEqual([
			[
				'https://api.test/admin/mailboxes/m1/access',
				{ version: 3, entries: [{ adminUserId: 'u1', rights: ['read', 'send'] }] },
			],
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

	it('calls the drafts and Undo Send routes (C2, C4)', async () => {
		const { gateway, http } = setup();
		const write = { from: 'a@shop.test', to: [], cc: [], bcc: [], subject: '', body: 'x' } as never;
		await firstValueFrom(gateway.outboxStatus('m1', 'o/1'));
		await firstValueFrom(gateway.drafts('m1'));
		await firstValueFrom(gateway.drafts('m1', 'next'));
		await firstValueFrom(gateway.draft('m1', 'd1'));
		await firstValueFrom(gateway.cancelSend('m1', 'o1'));
		await firstValueFrom(gateway.saveDraft('m1', null, write));
		await firstValueFrom(gateway.saveDraft('m1', 'd1', write));
		await firstValueFrom(gateway.deleteDraft('m1', 'd1'));
		expect(http.get.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/inbox/m1/outbox/o%2F1',
			'https://api.test/admin/inbox/m1/drafts',
			'https://api.test/admin/inbox/m1/drafts',
			'https://api.test/admin/inbox/m1/drafts/d1',
		]);
		expect(String((http.get.mock.calls[1]?.[1] as { params?: unknown }).params)).toBe('');
		expect(String((http.get.mock.calls[2]?.[1] as { params?: unknown }).params)).toBe('pageToken=next');
		expect(http.post.mock.calls.map((call) => call[0])).toEqual([
			'https://api.test/admin/inbox/m1/outbox/o1/cancel',
			'https://api.test/admin/inbox/m1/drafts',
		]);
		expect(http.put.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/drafts/d1');
		expect(http.delete.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/drafts/d1');
	});

	it('calls the saved-reply routes (C3)', async () => {
		const { gateway, http } = setup();
		const write = { title: 't', body: 'b' };
		await firstValueFrom(gateway.savedReplies('m1'));
		await firstValueFrom(gateway.createSavedReply('m1', { ...write, scope: 'personal' }));
		await firstValueFrom(gateway.updateSavedReply('m1', 'r/1', write));
		await firstValueFrom(gateway.deleteSavedReply('m1', 'r1'));
		expect(http.get.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/saved-replies');
		expect(http.post.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/saved-replies');
		expect(http.patch.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/saved-replies/r%2F1');
		expect(http.delete.mock.calls[0]?.[0]).toBe('https://api.test/admin/inbox/m1/saved-replies/r1');
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
