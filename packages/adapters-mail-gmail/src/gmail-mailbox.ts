import type {
	InboxFolder,
	InboxThread,
	InboxThreadPage,
	InboxThreadSummary,
	MailboxSendAs,
} from '@saha-textile/contracts';
import {
	FOLDER_LABELS,
	MailboxAccessRevoked,
	onDomain,
	type ImportedMail,
	type MailboxCredentials,
	type MailboxGrant,
	type MailboxPort,
	type OutgoingMail,
} from '@saha-textile/core-domain';
import { z } from 'zod';

import { GmailThread, inlinePictureParts, toInboxThread, toThreadSummary } from './gmail-message.js';
import { buildImport, buildOutgoing, toRaw } from './mime.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Read, send, label and trash; never permanent delete or settings changes. */
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
/**
 * Conversations per page. Each line costs one metadata read (10 quota units) and Gmail allows
 * 250 units per mailbox per second, so 20 keeps a page inside one second's allowance.
 */
const PAGE_SIZE = 20;
/** Refresh an access token this long before Google says it expires. */
const EARLY_MS = 60_000;
/** Gmail reads in flight at once, across all mailboxes; more queue. */
const MAX_PARALLEL = 8;
/** Waits before retrying a call Gmail refused as too fast. */
const RETRY_WAITS_MS = [500, 1500];
/** Remembered list pages and conversation lines, oldest forgotten first. */
const MAX_PAGES = 200;
const MAX_SUMMARIES = 5_000;
/** Pictures fetched to show inside one conversation; more stay as attachments. */
const MAX_INLINE_PICTURES = 10;

const TokenResponse = z.object({
	access_token: z.string(),
	expires_in: z.number(),
	refresh_token: z.string().optional(),
});
const Profile = z.object({ emailAddress: z.string(), historyId: z.string().optional() });
const ThreadList = z.object({
	threads: z.array(z.object({ id: z.string(), historyId: z.string().optional() })).default([]),
	nextPageToken: z.string().optional(),
});
const Attachment = z.object({ data: z.string() });
const SentMessage = z.object({ id: z.string(), threadId: z.string() });
const Label = z.object({ threadsUnread: z.number().default(0) });
const SendAsList = z.object({
	sendAs: z
		.array(
			z.object({
				sendAsEmail: z.string(),
				displayName: z.string().default(''),
				signature: z.string().default(''),
				isPrimary: z.boolean().default(false),
				verificationStatus: z.string().optional(),
			}),
		)
		.default([]),
});

export interface GmailMailboxConfig {
	clientId: string;
	clientSecret: string;
	/** The API's OAuth callback address, as registered on the Google Cloud client. */
	redirectUri: string;
	/** The shop's Google Workspace domain; sign-ins from any other address are refused. */
	domain: string;
	fetch?: typeof fetch;
	now?: () => number;
	/** Waits between retries; tests pass one that does not wait. */
	sleep?: (ms: number) => Promise<void>;
}

/** A map that forgets its oldest entry past `max`, so memory stays bounded. */
class Recent<V> {
	private readonly entries = new Map<string, V>();
	constructor(private readonly max: number) {}

	get(key: string): V | undefined {
		const value = this.entries.get(key);
		if (value !== undefined) {
			this.entries.delete(key);
			this.entries.set(key, value);
		}
		return value;
	}

	set(key: string, value: V): void {
		this.entries.delete(key);
		this.entries.set(key, value);
		if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
	}
}

/** At most `max` jobs at once; the rest wait their turn. */
class Limiter {
	private running = 0;
	private readonly queue: (() => void)[] = [];
	constructor(private readonly max: number) {}

	async run<T>(job: () => Promise<T>): Promise<T> {
		if (this.running >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
		this.running++;
		try {
			return await job();
		} finally {
			this.running--;
			this.queue.shift()?.();
		}
	}
}

/** A Gmail call failed for a reason other than a withdrawn grant. Carries the status only. */
export class GmailApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = 'GmailApiError';
	}
}

/**
 * Gmail implementation of `MailboxPort`, over Google's REST API with plain `fetch` (no Google
 * SDK). The client secret and refresh tokens stay inside this class: errors carry an HTTP status
 * and never a token, a body or an address with a token in it. Access tokens live only in memory.
 */
export class GmailMailbox implements MailboxPort {
	private readonly fetchImpl: typeof fetch;
	private readonly now: () => number;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
	private readonly limiter = new Limiter(MAX_PARALLEL);
	/**
	 * The last answer for each mailbox, folder, search and page, with the mailbox's history id at
	 * the time. Gmail moves that id on every change, so an unchanged id means an unchanged page.
	 */
	private readonly pages = new Recent<{ historyId: string; page: InboxThreadPage }>(MAX_PAGES);
	/** Each conversation's list line, with the conversation's own history id. */
	private readonly summaries = new Recent<{ historyId: string; summary: InboxThreadSummary }>(MAX_SUMMARIES);

	constructor(private readonly config: GmailMailboxConfig) {
		this.fetchImpl = config.fetch ?? fetch;
		this.now = config.now ?? Date.now;
		this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	signInUrl(state: string): string {
		const params = new URLSearchParams({
			client_id: this.config.clientId,
			redirect_uri: this.config.redirectUri,
			response_type: 'code',
			scope: SCOPE,
			access_type: 'offline',
			// Always ask, so Google always returns a refresh token, even on a reconnect.
			prompt: 'consent select_account',
			hd: this.config.domain,
			include_granted_scopes: 'false',
			state,
		});
		return `${AUTH}?${params.toString()}`;
	}

	async completeSignIn(code: string): Promise<MailboxGrant> {
		const grant = TokenResponse.parse(
			await this.form(TOKEN, {
				code,
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				redirect_uri: this.config.redirectUri,
				grant_type: 'authorization_code',
			}),
		);
		if (!grant.refresh_token) throw new GmailApiError('Google returned no refresh token', 400);
		const profile = Profile.parse(await this.call(grant.access_token, 'GET', '/profile'));
		const address = profile.emailAddress.toLowerCase();
		if (!onDomain(address, this.config.domain)) {
			await this.revokeToken(grant.refresh_token);
			throw new GmailApiError(`Only ${this.config.domain} mailboxes can be connected`, 403);
		}
		this.tokens.set(grant.refresh_token, {
			token: grant.access_token,
			expiresAt: this.now() + grant.expires_in * 1000 - EARLY_MS,
		});
		return { address, refreshToken: grant.refresh_token };
	}

	async revoke(credentials: MailboxCredentials): Promise<void> {
		this.tokens.delete(credentials.refreshToken);
		await this.revokeToken(credentials.refreshToken);
	}

	/**
	 * One page of a folder. Gmail is first asked only whether anything changed (1 quota unit); an
	 * unchanged mailbox answers from memory. Otherwise the list comes back with each
	 * conversation's history id, and only conversations that changed are read again.
	 */
	async listThreads(
		credentials: MailboxCredentials,
		folder: InboxFolder,
		query: string | undefined,
		pageToken: string | undefined,
	): Promise<InboxThreadPage> {
		const key = [credentials.address, folder, query ?? '', pageToken ?? ''].join('\u0000');
		const profile = Profile.parse(await this.authorised(credentials, 'GET', '/profile'));
		const cached = this.pages.get(key);
		if (cached && profile.historyId && cached.historyId === profile.historyId) return cached.page;

		const label = FOLDER_LABELS[folder];
		const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
		if (label) params.set('labelIds', label);
		if (query) params.set('q', query);
		if (pageToken) params.set('pageToken', pageToken);
		if (folder === 'spam' || folder === 'trash') params.set('includeSpamTrash', 'true');
		const list = ThreadList.parse(await this.authorised(credentials, 'GET', `/threads?${params.toString()}`));
		const metadata = new URLSearchParams({ format: 'metadata' });
		for (const name of ['From', 'To', 'Subject', 'Date', 'Message-ID']) metadata.append('metadataHeaders', name);
		const threads = await Promise.all(
			list.threads.map(async ({ id, historyId }) => {
				const lineKey = `${credentials.address}\u0000${id}`;
				const known = this.summaries.get(lineKey);
				if (known && historyId && known.historyId === historyId) return known.summary;
				const summary = toThreadSummary(
					GmailThread.parse(
						await this.authorised(
							credentials,
							'GET',
							`/threads/${encodeURIComponent(id)}?${metadata.toString()}`,
						),
					),
				);
				if (historyId) this.summaries.set(lineKey, { historyId, summary });
				return summary;
			}),
		);
		const page = { threads, nextPageToken: list.nextPageToken ?? null };
		if (profile.historyId) this.pages.set(key, { historyId: profile.historyId, page });
		return page;
	}

	/** A whole conversation, with pictures sent inside its mails (under 1 MB) shown in place. */
	async getThread(credentials: MailboxCredentials, threadId: string): Promise<InboxThread | null> {
		const body = await this.authorised(credentials, 'GET', `/threads/${encodeURIComponent(threadId)}?format=full`, {
			missing: true,
		});
		if (body === null) return null;
		const thread = GmailThread.parse(body);
		const wanted = thread.messages
			.flatMap((message) => inlinePictureParts(message).map((picture) => ({ ...picture, messageId: message.id })))
			.slice(0, MAX_INLINE_PICTURES);
		const inline = new Map<string, string>();
		await Promise.all(
			wanted.map(async (picture) => {
				// A picture that cannot be read stays an attachment; the message still opens.
				const file = await this.getAttachment(credentials, picture.messageId, picture.attachmentId).catch(
					() => null,
				);
				if (file)
					inline.set(
						picture.cid,
						`data:${picture.mimeType};base64,${Buffer.from(file.data).toString('base64')}`,
					);
			}),
		);
		return toInboxThread(thread, inline);
	}

	async getAttachment(
		credentials: MailboxCredentials,
		messageId: string,
		attachmentId: string,
	): Promise<{ data: Uint8Array } | null> {
		const body = await this.authorised(
			credentials,
			'GET',
			`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
			{ missing: true },
		);
		if (body === null) return null;
		return { data: new Uint8Array(Buffer.from(Attachment.parse(body).data, 'base64url')) };
	}

	async send(credentials: MailboxCredentials, mail: OutgoingMail): Promise<{ id: string; threadId: string }> {
		const raw = toRaw(buildOutgoing(mail, new Date(this.now())));
		return SentMessage.parse(
			await this.authorised(credentials, 'POST', '/messages/send', {
				json: { raw, ...(mail.threadId ? { threadId: mail.threadId } : {}) },
			}),
		);
	}

	async modifyThread(
		credentials: MailboxCredentials,
		threadId: string,
		change: { add: readonly string[]; remove: readonly string[] },
	): Promise<void> {
		await this.authorised(credentials, 'POST', `/threads/${encodeURIComponent(threadId)}/modify`, {
			json: { addLabelIds: change.add, removeLabelIds: change.remove },
		});
	}

	async trashThread(credentials: MailboxCredentials, threadId: string, restore: boolean): Promise<void> {
		await this.authorised(
			credentials,
			'POST',
			`/threads/${encodeURIComponent(threadId)}/${restore ? 'untrash' : 'trash'}`,
		);
	}

	async importMessage(credentials: MailboxCredentials, mail: ImportedMail): Promise<{ id: string }> {
		const raw = toRaw(buildImport(mail, new Date(this.now())));
		const body = await this.authorised(credentials, 'POST', '/messages/import?neverMarkSpam=true', {
			json: { raw, labelIds: ['INBOX', 'UNREAD'] },
		});
		return { id: z.object({ id: z.string() }).parse(body).id };
	}

	async unreadCount(credentials: MailboxCredentials): Promise<number> {
		return Label.parse(await this.authorised(credentials, 'GET', '/labels/INBOX')).threadsUnread;
	}

	async listSendAs(credentials: MailboxCredentials): Promise<MailboxSendAs[]> {
		const list = SendAsList.parse(await this.authorised(credentials, 'GET', '/settings/sendAs'));
		// An alias still waiting for its verification email cannot send yet.
		return list.sendAs
			.filter((entry) => entry.isPrimary || entry.verificationStatus === 'accepted')
			.map((entry) => ({
				address: entry.sendAsEmail.toLowerCase(),
				displayName: entry.displayName,
				signature: entry.signature,
				isPrimary: entry.isPrimary,
			}));
	}

	/** A fresh access token for the mailbox, from memory or from its refresh token. */
	private async accessToken(credentials: MailboxCredentials): Promise<string> {
		const cached = this.tokens.get(credentials.refreshToken);
		if (cached && cached.expiresAt > this.now()) return cached.token;
		const response = await this.fetchImpl(TOKEN, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				refresh_token: credentials.refreshToken,
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				grant_type: 'refresh_token',
			}),
		});
		// `invalid_grant`: the mailbox's owner or an admin withdrew access, or the password changed.
		if (response.status === 400 || response.status === 401) throw new MailboxAccessRevoked(credentials.address);
		if (!response.ok) throw new GmailApiError('Google token refresh failed', response.status);
		const token = TokenResponse.parse(await response.json());
		this.tokens.set(credentials.refreshToken, {
			token: token.access_token,
			expiresAt: this.now() + token.expires_in * 1000 - EARLY_MS,
		});
		return token.access_token;
	}

	/** A Gmail call as the mailbox; a 401 drops the cached token and is retried once. */
	private async authorised(
		credentials: MailboxCredentials,
		method: 'GET' | 'POST',
		path: string,
		options: { json?: unknown; missing?: boolean } = {},
	): Promise<unknown> {
		const first = await this.call(await this.accessToken(credentials), method, path, options);
		if (first !== UNAUTHORISED) return first;
		this.tokens.delete(credentials.refreshToken);
		const second = await this.call(await this.accessToken(credentials), method, path, options);
		if (second === UNAUTHORISED) throw new MailboxAccessRevoked(credentials.address);
		return second;
	}

	/**
	 * One Gmail call, at most eight at a time. "Too many requests" (429, or 403 with a rate-limit
	 * reason) waits and tries again twice before giving up.
	 */
	private async call(
		accessToken: string,
		method: 'GET' | 'POST',
		path: string,
		options: { json?: unknown; missing?: boolean } = {},
	): Promise<unknown> {
		let response: Response;
		for (let attempt = 0; ; attempt++) {
			response = await this.limiter.run(() =>
				this.fetchImpl(`${API}${path}`, {
					method,
					headers: {
						Authorization: `Bearer ${accessToken}`,
						...(options.json === undefined ? {} : { 'Content-Type': 'application/json' }),
					},
					...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
				}),
			);
			const wait = RETRY_WAITS_MS[attempt];
			if (wait === undefined || !(await tooFast(response))) break;
			await this.sleep(wait);
		}
		if (response.status === 401) return UNAUTHORISED;
		if (response.status === 404 && options.missing) return null;
		if (!response.ok) throw new GmailApiError(`Gmail ${method} failed`, response.status);
		const text = await response.text();
		return text ? JSON.parse(text) : {};
	}

	private async form(url: string, fields: Record<string, string>): Promise<unknown> {
		const response = await this.fetchImpl(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields),
		});
		if (!response.ok) throw new GmailApiError('Google sign-in failed', response.status);
		return response.json();
	}

	private async revokeToken(token: string): Promise<void> {
		// Google answers 400 for a token that is already invalid: the outcome wanted either way.
		await this.fetchImpl(REVOKE, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token }),
		});
	}
}

const UNAUTHORISED = Symbol('unauthorised');

/** Gmail's "slow down": 429, or 403 whose reason is a rate limit (not a refused permission). */
async function tooFast(response: Response): Promise<boolean> {
	if (response.status === 429) return true;
	if (response.status !== 403) return false;
	const body = await response.clone().text();
	return /rateLimitExceeded|userRateLimitExceeded/.test(body);
}
