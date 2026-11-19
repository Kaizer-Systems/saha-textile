import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import type {
	AdminMailboxRow,
	InboxBinSummary,
	InboxBulkRequest,
	InboxBulkResult,
	InboxEmptyBinResult,
	InboxFolder,
	InboxLabel,
	InboxMailboxSummary,
	InboxModifyRequest,
	InboxSendRequest,
	InboxThread,
	InboxThreadPage,
	Mailbox,
	MailboxAccessList,
	MailboxPeoplePage,
	MailboxRight,
} from '@saha-textile/contracts';

/** What Settings › Mailboxes reads in one call. */
export interface MailboxesOverview {
	configured: boolean;
	domain: string;
	rows: AdminMailboxRow[];
}

export const MAILBOXES_KEY = ['mailboxes'] as const;
export const INBOX_KEY = ['inbox'] as const;
/** How often the Inbox asks for unread counts: new mail shows within a minute, with no Gmail push. */
export const INBOX_REFRESH_MS = 60_000;
/** Inbox reads explain their own failures in the page, with Try again (review T3). */
const quiet = () => new HttpContext().set(QUIET_ERRORS, true);

/** Gmail mailboxes: Settings › Mailboxes (super admin) and the Inbox (everyone given access). */
@Injectable({ providedIn: 'root' })
export class MailboxGateway {
	private readonly http = inject(HttpClient);
	private readonly admin = (path = '') => `${runtimeConfig.apiUrl}/admin/mailboxes${path}`;
	private readonly inbox = (path = '') => `${runtimeConfig.apiUrl}/admin/inbox${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	overview(): Observable<MailboxesOverview> {
		return this.http.get<MailboxesOverview>(this.admin());
	}

	connect(): Observable<{ url: string }> {
		return this.http.post<{ url: string }>(this.admin('/connect'), {});
	}

	/** Everyone on the mailbox's list, named by the server, with the list's version. */
	access(mailboxId: string): Observable<MailboxAccessList> {
		return this.http.get<MailboxAccessList>(this.admin(`/${this.id(mailboxId)}/access`));
	}

	/**
	 * Saves the whole list from the version it was read at. A 409 means someone saved first; the
	 * popup explains it itself, so the global error toast stays quiet.
	 */
	saveAccess(
		mailboxId: string,
		version: number,
		entries: { adminUserId: string; rights: MailboxRight[] }[],
	): Observable<MailboxAccessList> {
		return this.http.put<MailboxAccessList>(
			this.admin(`/${this.id(mailboxId)}/access`),
			{ version, entries },
			{ context: quiet() },
		);
	}

	/** Admin users to add, searched across the whole directory on the server. */
	people(q: string, page: number): Observable<MailboxPeoplePage> {
		const params = new HttpParams().set('q', q).set('page', String(page));
		return this.http.get<MailboxPeoplePage>(this.admin('/people'), { params });
	}

	/** Asks Google again to withdraw a disconnected mailbox's access. */
	withdrawAgain(mailboxId: string): Observable<Mailbox> {
		return this.http.post<Mailbox>(this.admin(`/${this.id(mailboxId)}/withdraw-again`), {});
	}

	setContactTarget(mailboxId: string | null): Observable<{ mailboxId: string | null }> {
		return this.http.put<{ mailboxId: string | null }>(this.admin('/contact-target'), { mailboxId });
	}

	refresh(mailboxId: string): Observable<Mailbox> {
		return this.http.post<Mailbox>(this.admin(`/${this.id(mailboxId)}/refresh`), {});
	}

	disconnect(mailboxId: string): Observable<Mailbox> {
		return this.http.post<Mailbox>(this.admin(`/${this.id(mailboxId)}/disconnect`), {});
	}

	summary(): Observable<InboxMailboxSummary[]> {
		return this.http.get<InboxMailboxSummary[]>(this.inbox(), { context: quiet() });
	}

	threads(
		mailboxId: string,
		folder: InboxFolder,
		q?: string,
		pageToken?: string,
		label?: string,
	): Observable<InboxThreadPage> {
		let params = new HttpParams().set('folder', folder);
		if (label) params = params.set('label', label);
		if (q) params = params.set('q', q);
		if (pageToken) params = params.set('pageToken', pageToken);
		return this.http.get<InboxThreadPage>(this.inbox(`/${this.id(mailboxId)}/threads`), {
			params,
			context: quiet(),
		});
	}

	thread(mailboxId: string, threadId: string): Observable<InboxThread> {
		return this.http.get<InboxThread>(this.inbox(`/${this.id(mailboxId)}/threads/${this.id(threadId)}`), {
			context: quiet(),
		});
	}

	/** An attachment's download address; the API always answers it as a download. */
	attachmentUrl(mailboxId: string, messageId: string, attachmentId: string, filename: string): string {
		return this.inbox(
			`/${this.id(mailboxId)}/messages/${this.id(messageId)}/attachments/${this.id(attachmentId)}?name=${this.id(filename)}`,
		);
	}

	/** Quiet: the compose box says why a send failed, and keeps the text. */
	send(mailboxId: string, body: InboxSendRequest): Observable<{ id: string; threadId: string }> {
		return this.http.post<{ id: string; threadId: string }>(this.inbox(`/${this.id(mailboxId)}/send`), body, {
			context: quiet(),
		});
	}

	modify(
		mailboxId: string,
		threadId: string,
		action: InboxModifyRequest['action'],
		labelId?: string,
	): Observable<{ ok: boolean }> {
		return this.http.post<{ ok: boolean }>(
			this.inbox(`/${this.id(mailboxId)}/threads/${this.id(threadId)}/modify`),
			labelId ? { action, labelId } : { action },
		);
	}

	/** Marks exactly these messages; quiet, because a failure is retried the next time they show. */
	markMessages(mailboxId: string, messageIds: readonly string[], read: boolean): Observable<{ ok: boolean }> {
		return this.http.post<{ ok: boolean }>(
			this.inbox(`/${this.id(mailboxId)}/messages/read`),
			{ messageIds, read },
			{ context: quiet() },
		);
	}

	labels(mailboxId: string): Observable<InboxLabel[]> {
		return this.http.get<InboxLabel[]>(this.inbox(`/${this.id(mailboxId)}/labels`), { context: quiet() });
	}

	createLabel(mailboxId: string, name: string): Observable<InboxLabel> {
		return this.http.post<InboxLabel>(this.inbox(`/${this.id(mailboxId)}/labels`), { name });
	}

	renameLabel(mailboxId: string, labelId: string, name: string): Observable<InboxLabel> {
		return this.http.patch<InboxLabel>(this.inbox(`/${this.id(mailboxId)}/labels/${this.id(labelId)}`), { name });
	}

	deleteLabel(mailboxId: string, labelId: string): Observable<{ ok: boolean }> {
		return this.http.delete<{ ok: boolean }>(this.inbox(`/${this.id(mailboxId)}/labels/${this.id(labelId)}`));
	}

	/** Quiet: the Inbox reports what was done and what failed itself. */
	bulk(mailboxId: string, body: InboxBulkRequest): Observable<InboxBulkResult> {
		return this.http.post<InboxBulkResult>(this.inbox(`/${this.id(mailboxId)}/bulk`), body, { context: quiet() });
	}

	binSummary(mailboxId: string): Observable<InboxBinSummary> {
		return this.http.get<InboxBinSummary>(this.inbox(`/${this.id(mailboxId)}/bin`));
	}

	emptyBin(mailboxId: string): Observable<InboxEmptyBinResult> {
		return this.http.post<InboxEmptyBinResult>(this.inbox(`/${this.id(mailboxId)}/bin/empty`), {});
	}
}

/** Settings › Mailboxes. */
export function injectMailboxesQuery() {
	const gateway = inject(MailboxGateway);
	return injectQuery(() => ({ queryKey: MAILBOXES_KEY, queryFn: () => firstValueFrom(gateway.overview()) }));
}

/** The mailboxes I may open, with unread counts, asked again every minute. */
export function injectInboxSummaryQuery(enabled: () => boolean = () => true) {
	const gateway = inject(MailboxGateway);
	return injectQuery(() => ({
		queryKey: INBOX_KEY,
		queryFn: () => firstValueFrom(gateway.summary()),
		refetchInterval: INBOX_REFRESH_MS,
		retry: 1,
		enabled: enabled(),
	}));
}
