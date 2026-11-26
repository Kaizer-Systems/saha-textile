import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import type {
	AdminMailboxRow,
	Mailbox,
	MailboxAccess,
	MailboxAccessList,
	MailboxAccessWrite,
	MailboxPeoplePage,
	MailboxPeopleQuery,
} from '@saha-textile/contracts';
import {
	SUPER_ADMIN_ROLE_KEY,
	withNeededRights,
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type MailboxAccessRepository,
	type MailboxPort,
	type MailboxRepository,
	type MailboxTokenStore,
	type OAuthStateRepository,
	type RoleRepository,
	type SiteSettingsRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	MAILBOX_ACCESS_REPOSITORY,
	MAILBOX_PORT,
	MAILBOX_REPOSITORY,
	MAILBOX_TOKEN_STORE,
	OAUTH_STATE_REPOSITORY,
	ROLE_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';
import { MailboxBookkeeping, MailboxSignInState } from './mailbox-support';

/** People shown per page when adding someone to an access list. */
export const PEOPLE_PAGE_SIZE = 20;
/** Admin users read per database page while searching; the whole directory is always searched. */
const DIRECTORY_PAGE = 200;

/** Why a sign-in came back without a mailbox, as the admin screen shows it. */
export type ConnectFailure = 'cancelled' | 'expired' | 'not_on_domain' | 'not_allowed' | 'failed';

/**
 * Settings › Mailboxes: connect a Gmail mailbox through Google's own sign-in, choose who may use
 * it and how, choose where Contact Us messages go, and disconnect. Every call needs a super admin
 * (the system Administrator role) as well as `mailbox.manage` (owner log § admin Inbox upgrade,
 * 2026-11-19). Managing a mailbox never lets anyone read it: reading needs a row in its access list.
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
		@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: AdminUserRoleAssignmentRepository,
		@Inject(OAUTH_STATE_REPOSITORY) private readonly signInStates: OAuthStateRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		private readonly books: MailboxBookkeeping,
	) {
		this.state = config.mail.tokenKey ? new MailboxSignInState(config.mail.tokenKey) : null;
	}

	/** Whether Gmail is set up on this server at all; the screen says so when it is not. */
	get configured(): boolean {
		return this.state !== null && Boolean(this.config.mail.adminUrl);
	}

	/** A super admin holds the active system Administrator role. Disabled accounts never count. */
	async isSuperAdmin(adminUserId: string): Promise<boolean> {
		const [user, role] = await Promise.all([
			this.adminUsers.findById(adminUserId),
			this.roles.findByKey(SUPER_ADMIN_ROLE_KEY),
		]);
		if (!user || user.status !== 'active' || !role) return false;
		return Boolean(await this.assignments.findActive(adminUserId, role.id));
	}

	/** Refuses anyone who is not a super admin, whatever permissions their roles carry. */
	async requireSuperAdmin(adminUserId: string): Promise<void> {
		if (!(await this.isSuperAdmin(adminUserId))) throw new ForbiddenException({ code: 'super_admin_only' });
	}

	async list(): Promise<{ configured: boolean; domain: string; rows: AdminMailboxRow[] }> {
		const [mailboxes, contact] = await Promise.all([this.mailboxes.list(), this.contactMailboxId()]);
		const rows = await Promise.all(
			mailboxes.map(async (mailbox): Promise<AdminMailboxRow> => {
				const entries = await this.access.listForMailbox(mailbox.id);
				return {
					mailbox,
					readers: entries.length,
					senders: entries.filter((entry) => entry.rights.includes('send')).length,
					contactTarget: mailbox.id === contact,
					needsReconnectFor:
						mailbox.status === 'disconnected' ? [] : this.gmail.featuresMissing(mailbox.grantedScopes),
				};
			}),
		);
		return { configured: this.configured, domain: this.config.mail.domain, rows };
	}

	/**
	 * Google's sign-in address. The `state` names the admin who asked; its nonce is stored hashed
	 * here so the callback can use it exactly once.
	 */
	async connectUrl(adminUserId: string): Promise<{ url: string }> {
		const issued = this.requireState().issue(adminUserId);
		const now = new Date();
		await this.signInStates.create({
			id: `mbxstate_${randomUUID()}`,
			provider: 'google',
			audience: 'admin',
			stateHash: MailboxSignInState.nonceHash(issued.nonce),
			nonceHash: null,
			codeVerifierHash: null,
			redirectAfterLogin: null,
			guestCartId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now.toISOString(),
			expiresAt: new Date(issued.expiresAt).toISOString(),
			consumedAt: null,
		});
		return { url: this.gmail.signInUrl(issued.state) };
	}

	/**
	 * Google's answer. Always ends in the admin's Mailboxes page, with the connected address or a
	 * reason it failed; never shows Google's error text. The state must be genuine, unused and in
	 * time, and the admin who started the sign-in must still be an active super admin now.
	 */
	async completeSignIn(query: { code?: string; state: string; error?: string }): Promise<string> {
		const back = (params: Record<string, string>) =>
			`${this.config.mail.adminUrl?.replace(/\/$/, '')}/setting/mailboxes?${new URLSearchParams(params).toString()}`;
		const verified = this.requireState().verify(query.state);
		if (!verified) return back({ error: 'expired' satisfies ConnectFailure });
		const unused = await this.signInStates.consume(MailboxSignInState.nonceHash(verified.nonce));
		if (!unused) return back({ error: 'expired' satisfies ConnectFailure });
		if (query.error || !query.code) return back({ error: 'cancelled' satisfies ConnectFailure });
		const adminUserId = verified.adminUserId;
		if (!(await this.isSuperAdmin(adminUserId))) return back({ error: 'not_allowed' satisfies ConnectFailure });
		let grant: { address: string; refreshToken: string; scopes: string[] };
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
			grantedScopes: grant.scopes,
			revocation: null,
		});
		await this.tokens.put(id, grant.refreshToken);
		const sendAs = await this.gmail
			.listSendAs({ address: grant.address, refreshToken: grant.refreshToken })
			.catch(() => []);
		const saved = await this.mailboxes.save({ ...((await this.mailboxes.findById(id)) as Mailbox), sendAs });
		await this.books.record(adminUserId, existing ? 'mailbox.reconnected' : 'mailbox.connected', id, {
			address: saved.address,
			missingFeatures: this.gmail.featuresMissing(grant.scopes),
		});
		return back({ connected: saved.address });
	}

	/**
	 * Everyone on the mailbox's list, named from the server, so a long user directory or one that
	 * failed to load in the browser never drops anybody.
	 */
	async getAccess(mailboxId: string): Promise<MailboxAccessList> {
		await this.require(mailboxId);
		const [entries, version] = await Promise.all([
			this.access.listForMailbox(mailboxId),
			this.access.version(mailboxId),
		]);
		const named = await Promise.all(
			entries.map(async (entry) => {
				const user = await this.adminUsers.findById(entry.adminUserId);
				return {
					adminUserId: entry.adminUserId,
					rights: entry.rights,
					name: user?.displayName || user?.email || user?.username || entry.adminUserId,
					email: user?.email ?? '',
					active: user?.status === 'active',
				};
			}),
		);
		return { version, entries: named.sort((a, b) => a.name.localeCompare(b.name)) };
	}

	/**
	 * Admin users to add to an access list, matched on name, email or username. Every page of the
	 * directory is read, so nobody is missed however many admin users there are.
	 */
	async people(query: MailboxPeopleQuery): Promise<MailboxPeoplePage> {
		const needle = query.q.toLowerCase();
		const everyone: MailboxPeoplePage['items'] = [];
		for (let page = 1; ; page += 1) {
			const batch = await this.adminUsers.list({ page, pageSize: DIRECTORY_PAGE });
			for (const user of batch.items) {
				const name = user.displayName || user.email || user.username || user.id;
				const haystack = [user.displayName, user.email, user.username].filter(Boolean).join(' ').toLowerCase();
				if (!needle || haystack.includes(needle)) {
					everyone.push({
						adminUserId: user.id,
						name,
						email: user.email ?? '',
						active: user.status === 'active',
					});
				}
			}
			if (!batch.meta.hasNext || batch.items.length === 0) break;
		}
		everyone.sort((a, b) => a.name.localeCompare(b.name));
		const start = (query.page - 1) * PEOPLE_PAGE_SIZE;
		return {
			items: everyone.slice(start, start + PEOPLE_PAGE_SIZE),
			total: everyone.length,
			page: query.page,
			pageSize: PEOPLE_PAGE_SIZE,
		};
	}

	/**
	 * The whole list for one mailbox, saved only if nobody saved since the editor loaded it (409
	 * otherwise, and nothing changes). Every person must be an existing admin user. Each right
	 * brings the ones it needs; a removed person loses access on their next request.
	 */
	async setAccess(mailboxId: string, write: MailboxAccessWrite, actor: string | null): Promise<MailboxAccessList> {
		await this.require(mailboxId);
		const unknown: string[] = [];
		for (const entry of write.entries) {
			if (!(await this.adminUsers.findById(entry.adminUserId))) unknown.push(entry.adminUserId);
		}
		if (unknown.length) throw new BadRequestException({ code: 'unknown_admin_users', ids: unknown });
		const entries: MailboxAccess[] = write.entries.map((entry) => ({
			mailboxId,
			adminUserId: entry.adminUserId,
			rights: withNeededRights(entry.rights),
		}));
		const before = await this.access.listForMailbox(mailboxId);
		const version = await this.access.replaceForMailbox(mailboxId, entries, write.version);
		if (version === null) throw new ConflictException({ code: 'mailbox_access_changed' });
		const count = (right: MailboxAccess['rights'][number]) =>
			entries.filter((entry) => entry.rights.includes(right)).length;
		await this.books.record(actor, 'mailbox.access_changed', mailboxId, {
			version,
			people: entries.length,
			added: entries.filter((entry) => !before.some((old) => old.adminUserId === entry.adminUserId)).length,
			removed: before.filter((old) => !entries.some((entry) => entry.adminUserId === old.adminUserId)).length,
			send: count('send'),
			deleteForever: count('delete_forever'),
			labels: count('labels'),
			settings: count('settings'),
		});
		return this.getAccess(mailboxId);
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

	/**
	 * Stops the mailbox here first, so nobody can use it from this moment, then asks Google to
	 * withdraw the grant. When Google confirms, the token is forgotten. When it does not, the
	 * encrypted token is kept only so the withdrawal can be tried again, and the screen says so.
	 * Who may open it is kept for a reconnect.
	 */
	async disconnect(mailboxId: string, actor: string | null): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		await this.mailboxes.save({ ...mailbox, status: 'disconnected', sendAs: [] });
		await this.books.record(actor, 'mailbox.disconnected', mailboxId, { address: mailbox.address });
		return this.withdraw(mailboxId, actor);
	}

	/** Tries the withdrawal at Google again after it failed. */
	async retryRevocation(mailboxId: string, actor: string | null): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		if (mailbox.status !== 'disconnected' || mailbox.revocation !== 'failed') {
			throw new BadRequestException({ code: 'nothing_to_withdraw' });
		}
		return this.withdraw(mailboxId, actor);
	}

	/** Re-reads the aliases after someone adds or verifies one in Gmail. */
	async refreshSendAs(mailboxId: string): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		if (mailbox.status === 'disconnected') throw new BadRequestException({ code: 'mailbox_not_connected' });
		const refreshToken = await this.tokens.get(mailboxId);
		if (!refreshToken) return this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
		const sendAs = await this.books.guard(mailbox, () =>
			this.gmail.listSendAs({ address: mailbox.address, refreshToken }),
		);
		return this.mailboxes.save({ ...mailbox, sendAs, lastSyncAt: new Date().toISOString() });
	}

	private async withdraw(mailboxId: string, actor: string | null): Promise<Mailbox> {
		const mailbox = await this.require(mailboxId);
		const refreshToken = await this.tokens.get(mailboxId);
		let revocation: 'done' | 'failed' = 'done';
		if (refreshToken) {
			try {
				await this.gmail.revoke({ address: mailbox.address, refreshToken });
			} catch {
				revocation = 'failed';
			}
		}
		if (revocation === 'done') await this.tokens.remove(mailboxId);
		const saved = await this.mailboxes.save({ ...mailbox, revocation });
		await this.books.record(actor, 'mailbox.access_withdrawn', mailboxId, { outcome: revocation });
		return saved;
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
