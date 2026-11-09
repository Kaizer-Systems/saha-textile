import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import type { AdminMailboxRow, Mailbox, MailboxAccess, MailboxAccessWrite } from '@saha-textile/contracts';
import type {
	AdminUserRepository,
	MailboxAccessRepository,
	MailboxPort,
	MailboxRepository,
	MailboxTokenStore,
	SiteSettingsRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	ADMIN_USER_REPOSITORY,
	MAILBOX_ACCESS_REPOSITORY,
	MAILBOX_PORT,
	MAILBOX_REPOSITORY,
	MAILBOX_TOKEN_STORE,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';
import { MailboxBookkeeping, MailboxSignInState } from './mailbox-support';

/** Why a sign-in came back without a mailbox, as the admin screen shows it. */
export type ConnectFailure = 'cancelled' | 'expired' | 'not_on_domain' | 'failed';

/**
 * Settings › Mailboxes (super admin, `mailbox.manage`): connect a Gmail mailbox through Google's
 * own sign-in, choose who may open it, choose where Contact Us messages go, and disconnect.
 */
@Injectable()
export class MailboxesAdminService {
	private readonly state: MailboxSignInState | null;

	constructor(
		@Inject(MAILBOX_PORT) private readonly gmail: MailboxPort,
		@Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
		@Inject(MAILBOX_ACCESS_REPOSITORY) private readonly access: MailboxAccessRepository,
		@Inject(MAILBOX_TOKEN_STORE) private readonly tokens: MailboxTokenStore,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(ADMIN_USER_REPOSITORY) private readonly adminUsers: AdminUserRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		private readonly books: MailboxBookkeeping,
	) {
		this.state = config.mail.tokenKey ? new MailboxSignInState(config.mail.tokenKey) : null;
	}

	/** Whether Gmail is set up on this server at all; the screen says so when it is not. */
	get configured(): boolean {
		return this.state !== null && Boolean(this.config.mail.adminUrl);
	}

	async list(): Promise<{ configured: boolean; domain: string; rows: AdminMailboxRow[] }> {
		const [mailboxes, contact] = await Promise.all([this.mailboxes.list(), this.contactMailboxId()]);
		const rows = await Promise.all(
			mailboxes.map(async (mailbox) => {
				const entries = await this.access.listForMailbox(mailbox.id);
				return {
					mailbox,
					readers: entries.length,
					senders: entries.filter((entry) => entry.canSend).length,
					contactTarget: mailbox.id === contact,
				};
			}),
		);
		return { configured: this.configured, domain: this.config.mail.domain, rows };
	}

	/** Google's sign-in address; the `state` names the admin who asked. */
	connectUrl(adminUserId: string): { url: string } {
		return { url: this.gmail.signInUrl(this.requireState().issue(adminUserId)) };
	}

	/**
	 * Google's answer. Always ends in the admin's Mailboxes tab, with the connected address or
	 * a reason it failed; never shows Google's error text.
	 */
	async completeSignIn(query: { code?: string; state: string; error?: string }): Promise<string> {
		const back = (params: Record<string, string>) =>
			`${this.config.mail.adminUrl?.replace(/\/$/, '')}/setting/mailboxes?${new URLSearchParams(params).toString()}`;
		const adminUserId = this.requireState().verify(query.state);
		if (!adminUserId) return back({ error: 'expired' satisfies ConnectFailure });
		if (query.error || !query.code) return back({ error: 'cancelled' satisfies ConnectFailure });
		let grant: { address: string; refreshToken: string };
		try {
			grant = await this.gmail.completeSignIn(query.code);
		} catch (error) {
			const failure: ConnectFailure = (error as { status?: unknown }).status === 403 ? 'not_on_domain' : 'failed';
			return back({ error: failure });
		}
		const existing = await this.mailboxes.findByAddress(grant.address);
		const id = existing?.id ?? `mbx_${randomUUID()}`;
		const now = new Date().toISOString();
		await this.mailboxes.save({
			id,
			address: grant.address,
			status: 'connected',
			connectedBy: adminUserId,
			connectedAt: now,
			lastSyncAt: now,
			sendAs: existing?.sendAs ?? [],
		});
		await this.tokens.put(id, grant.refreshToken);
		const sendAs = await this.gmail
			.listSendAs({ address: grant.address, refreshToken: grant.refreshToken })
			.catch(() => []);
		const saved = await this.mailboxes.save({ ...((await this.mailboxes.findById(id)) as Mailbox), sendAs });
		await this.books.record(adminUserId, existing ? 'mailbox.reconnected' : 'mailbox.connected', id, {
			address: saved.address,
		});
		return back({ connected: saved.address });
	}

	async getAccess(mailboxId: string): Promise<MailboxAccess[]> {
		await this.require(mailboxId);
		return this.access.listForMailbox(mailboxId);
	}

	/** The whole list for one mailbox. Every person on it must be an existing admin user. */
	async setAccess(mailboxId: string, write: MailboxAccessWrite, actor: string | null): Promise<MailboxAccess[]> {
		await this.require(mailboxId);
		const unknown: string[] = [];
		for (const entry of write.entries) {
			if (!(await this.adminUsers.findById(entry.adminUserId))) unknown.push(entry.adminUserId);
		}
		if (unknown.length) throw new BadRequestException({ code: 'unknown_admin_users', ids: unknown });
		const entries = write.entries.map((entry) => ({ mailboxId, ...entry }));
		await this.access.replaceForMailbox(mailboxId, entries);
		await this.books.record(actor, 'mailbox.access_changed', mailboxId, {
			readers: entries.length,
			senders: entries.filter((entry) => entry.canSend).length,
		});
		return this.access.listForMailbox(mailboxId);
	}

	/** Where Contact Us messages go; null stops delivery (messages wait in the database). */
	async setContactTarget(mailboxId: string | null, actor: string | null): Promise<{ mailboxId: string | null }> {
		if (mailboxId) {
			const mailbox = await this.require(mailboxId);
			if (mailbox.status !== 'connected') throw new BadRequestException({ code: 'mailbox_not_connected' });
		}
		await this.settings.set('mailboxes.contact', { mailboxId });
		await this.books.record(actor, 'mailbox.contact_target_changed', mailboxId, {});
		return { mailboxId };
	}

	/** Withdraws the grant at Google and forgets the token. Who may open it is kept for a reconnect. */
	async disconnect(mailboxId: string, actor: string | null): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		const refreshToken = await this.tokens.get(mailboxId);
		if (refreshToken) await this.gmail.revoke({ address: mailbox.address, refreshToken }).catch(() => undefined);
		await this.tokens.remove(mailboxId);
		const saved = await this.mailboxes.save({ ...mailbox, status: 'disconnected', sendAs: [] });
		await this.books.record(actor, 'mailbox.disconnected', mailboxId, { address: mailbox.address });
		return saved;
	}

	/** Re-reads the aliases after someone adds or verifies one in Gmail. */
	async refreshSendAs(mailboxId: string): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		const refreshToken = await this.tokens.get(mailboxId);
		if (!refreshToken) return this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
		const sendAs = await this.books.guard(mailbox, () =>
			this.gmail.listSendAs({ address: mailbox.address, refreshToken }),
		);
		return this.mailboxes.save({ ...mailbox, sendAs, lastSyncAt: new Date().toISOString() });
	}

	private async contactMailboxId(): Promise<string | null> {
		return (await this.settings.get('mailboxes.contact'))?.mailboxId ?? null;
	}

	private requireState(): MailboxSignInState {
		if (!this.state || !this.config.mail.adminUrl) throw new ServiceUnavailableException('Gmail is not set up.');
		return this.state;
	}

	private async require(mailboxId: string): Promise<Mailbox> {
		const mailbox = await this.mailboxes.findById(mailboxId);
		if (!mailbox) throw new NotFoundException('Mailbox not found');
		return mailbox;
	}
}
