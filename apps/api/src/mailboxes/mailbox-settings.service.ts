import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Mailbox,
	MailboxFilter,
	MailboxFilterWrite,
	MailboxSettings,
	MailboxSignature,
	MailboxVacation,
	MailboxVacationWrite,
} from '@saha-textile/contracts';
import {
	type MailboxAccessRepository,
	type MailboxCredentials,
	type MailboxPort,
	type MailboxRepository,
	type MailboxTokenStore,
	mailboxRights,
} from '@saha-textile/core-domain';

import { MAILBOX_ACCESS_REPOSITORY, MAILBOX_PORT, MAILBOX_REPOSITORY, MAILBOX_TOKEN_STORE } from '../infra/tokens';
import { MailboxBookkeeping, needsReconnect } from './mailbox-support';

/** The audit action for every Gmail settings change made here. */
export const SETTINGS_CHANGED = 'mailbox.settings_changed';

/** A signature with pictures is changed in Gmail: the compose box's cleaning would drop them. */
const HAS_PICTURES = /<img\b/i;

interface Opened {
	mailbox: Mailbox;
	credentials: MailboxCredentials;
}

/**
 * A mailbox's Gmail settings (G1), for people with its Settings right: filters (list, add, delete;
 * Gmail cannot edit one, so a change adds the new filter and then deletes the old), the vacation
 * reply, and the main address's signature. Forwarding filters are shown and never made here:
 * forwarding stays in Gmail and Workspace (owner's request, 19 Nov).
 */
@Injectable()
export class MailboxSettingsService {
	constructor(
		@Inject(MAILBOX_PORT) private readonly gmail: MailboxPort,
		@Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
		@Inject(MAILBOX_ACCESS_REPOSITORY) private readonly access: MailboxAccessRepository,
		@Inject(MAILBOX_TOKEN_STORE) private readonly tokens: MailboxTokenStore,
		private readonly books: MailboxBookkeeping,
	) {}

	async read(adminUserId: string, mailboxId: string): Promise<MailboxSettings> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId);
		const [filters, vacation, sendAs] = await this.books.guard(mailbox, () =>
			Promise.all([
				this.gmail.listFilters(credentials),
				this.gmail.getVacation(credentials),
				this.gmail.listSendAs(credentials),
			]),
		);
		const main = sendAs.find((entry) => entry.isPrimary) ?? sendAs[0];
		const html = main?.signature ?? '';
		const signature: MailboxSignature = {
			address: main?.address ?? mailbox.address,
			html,
			editable: !HAS_PICTURES.test(html),
		};
		return { filters, vacation, signature };
	}

	/**
	 * Adds a filter. With `replaces` it is a change: the new filter goes in first and the old one is
	 * deleted only after, so a refused change leaves the old filter working.
	 */
	async addFilter(adminUserId: string, mailboxId: string, write: MailboxFilterWrite): Promise<MailboxFilter> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId);
		if (write.replaces) {
			const current = await this.books.guard(mailbox, () => this.gmail.listFilters(credentials));
			const old = current.find((filter) => filter.id === write.replaces);
			if (!old) throw new NotFoundException({ code: 'filter_gone' });
			if (old.forwardTo) throw new ForbiddenException({ code: 'forwarding_filter' });
		}
		const created = await this.books.guard(mailbox, () => this.gmail.createFilter(credentials, write));
		if (write.replaces) {
			const replaced = write.replaces;
			await this.books.guard(mailbox, () => this.gmail.deleteFilter(credentials, replaced));
		}
		await this.audit(adminUserId, mailboxId, write.replaces ? 'filter_changed' : 'filter_added', {
			filterId: created.id,
			...(write.replaces ? { replaced: write.replaces } : {}),
		});
		return created;
	}

	async deleteFilter(adminUserId: string, mailboxId: string, filterId: string): Promise<void> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId);
		const current = await this.books.guard(mailbox, () => this.gmail.listFilters(credentials));
		const filter = current.find((entry) => entry.id === filterId);
		if (!filter) throw new NotFoundException({ code: 'filter_gone' });
		if (filter.forwardTo) throw new ForbiddenException({ code: 'forwarding_filter' });
		await this.books.guard(mailbox, () => this.gmail.deleteFilter(credentials, filterId));
		await this.audit(adminUserId, mailboxId, 'filter_deleted', { filterId });
	}

	async saveVacation(adminUserId: string, mailboxId: string, write: MailboxVacationWrite): Promise<MailboxVacation> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId);
		const saved = await this.books.guard(mailbox, () => this.gmail.updateVacation(credentials, write));
		await this.audit(adminUserId, mailboxId, 'vacation', { enabled: saved.enabled });
		return saved;
	}

	/** The main address's signature; the compose box shows the new one straight away. */
	async saveSignature(adminUserId: string, mailboxId: string, html: string): Promise<MailboxSignature> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId);
		const sendAs = await this.books.guard(mailbox, () => this.gmail.listSendAs(credentials));
		const main = sendAs.find((entry) => entry.isPrimary) ?? sendAs[0];
		if (!main) throw new NotFoundException('Mailbox address not found');
		if (HAS_PICTURES.test(main.signature)) throw new ConflictException({ code: 'signature_has_pictures' });
		await this.books.guard(mailbox, () => this.gmail.updateSignature(credentials, main.address, html));
		const fresh = await this.books.guard(mailbox, () => this.gmail.listSendAs(credentials));
		await this.mailboxes.save({ ...mailbox, sendAs: fresh });
		await this.audit(adminUserId, mailboxId, 'signature', { address: main.address });
		const now = fresh.find((entry) => entry.address === main.address);
		return { address: main.address, html: now?.signature ?? '', editable: true };
	}

	/** The Settings right in this mailbox, and Google's permission for settings. */
	private async open(adminUserId: string, mailboxId: string): Promise<Opened> {
		const rights = mailboxRights(await this.access.listForAdminUser(adminUserId), adminUserId, mailboxId);
		if (!rights.size) throw new NotFoundException('Mailbox not found');
		if (!rights.has('settings')) throw new ForbiddenException({ code: 'mailbox_right_missing', right: 'settings' });
		const mailbox = await this.mailboxes.findById(mailboxId);
		if (!mailbox) throw new NotFoundException('Mailbox not found');
		if (mailbox.status !== 'connected') throw needsReconnect(mailbox.address);
		if (this.gmail.featuresMissing(mailbox.grantedScopes).includes('settings')) {
			throw new ConflictException({ code: 'mailbox_reconnect_for_feature', feature: 'settings' });
		}
		const refreshToken = await this.tokens.get(mailbox.id);
		if (!refreshToken) {
			await this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
			throw needsReconnect(mailbox.address);
		}
		return { mailbox, credentials: { address: mailbox.address, refreshToken } };
	}

	private audit(adminUserId: string, mailboxId: string, what: string, details: Record<string, unknown>) {
		return this.books.record(adminUserId, SETTINGS_CHANGED, mailboxId, { what, ...details });
	}
}
