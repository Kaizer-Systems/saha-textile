import { createHash, createHmac, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
	CONTACT_MIN_ELAPSED_MS,
	normalisePhone,
	type ContactMessage,
	type ContactMessageParsed,
} from '@saha-textile/contracts';
import { languageName, PRIMARY_LOCALE } from '@saha-textile/core-domain/languages';
import type {
	ContactMessageRepository,
	MailboxPort,
	MailboxRepository,
	MailboxTokenStore,
	SiteSettingsRepository,
} from '@saha-textile/core-domain';
import { MailboxAccessRevoked } from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	CONTACT_MESSAGE_REPOSITORY,
	MAILBOX_PORT,
	MAILBOX_REPOSITORY,
	MAILBOX_TOKEN_STORE,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';

/** A repeat of the same message from the same address within a day is not stored again. */
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How often waiting messages are tried again. */
export const CONTACT_SWEEP_MS = 5 * 60 * 1000;
/** Messages older than this stop being retried and stay `failed` for staff to see. */
export const CONTACT_RETRY_FOR_MS = 72 * 60 * 60 * 1000;
const SWEEP_BATCH = 20;


/**
 * Contact Us (owner log § stores, Contact Us and Gmail mailboxes). A message is stored first, so
 * none is lost while Gmail is unreachable or no mailbox is chosen, then placed in the chosen
 * mailbox with Gmail import: it arrives in that Inbox unread, from the customer, Reply-To the
 * customer. Built-in spam checks only: a hidden field, time on the form, stored rate limits, a
 * link limit (in the contract) and a repeat check.
 */
@Injectable()
export class ContactMessagesService implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger(ContactMessagesService.name);
	private timer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(CONTACT_MESSAGE_REPOSITORY) private readonly messages: ContactMessageRepository,
		@Inject(MAILBOX_PORT) private readonly gmail: MailboxPort,
		@Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
		@Inject(MAILBOX_TOKEN_STORE) private readonly tokens: MailboxTokenStore,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.sweep(), CONTACT_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/**
	 * Takes a message. A bot (hidden field filled, or the form sent within three seconds) and a
	 * repeat get the same answer as a real message, so neither learns anything from it.
	 */
	async submit(body: ContactMessageParsed, ip: string, now = new Date()): Promise<void> {
		if (body.website || body.elapsedMs < CONTACT_MIN_ELAPSED_MS) return;
		const contentHash = createHash('sha256').update(`${body.email}\n${body.message}`).digest('hex');
		const since = new Date(now.getTime() - REPEAT_WINDOW_MS).toISOString();
		if (await this.messages.findRecentByHash(contentHash, since)) return;
		const saved = await this.messages.save({
			id: `contact_${randomUUID()}`,
			name: body.name,
			email: body.email,
			phone: body.phone ? normalisePhone(body.phone) : null,
			subject: body.subject,
			message: body.message,
			// A language the shop no longer offers is answered in English.
			locale: this.config.locales.includes(body.locale) ? body.locale : PRIMARY_LOCALE,
			status: 'queued',
			ipHash: this.hashIp(ip),
			contentHash,
			mailboxId: null,
			gmailMessageId: null,
			attempts: 0,
			lastError: null,
			createdAt: now.toISOString(),
			deliveredAt: null,
		});
		// Delivery runs after the answer; the sweep picks it up again if this attempt fails.
		void this.deliver(saved).catch((error: unknown) =>
			this.logger.warn(`Contact delivery failed: ${String(error)}`),
		);
	}

	/** Tries every waiting message that is still within its retry window. */
	async sweep(now = new Date()): Promise<number> {
		const pending = await this.messages.listPending(SWEEP_BATCH);
		let delivered = 0;
		for (const message of pending) {
			if (now.getTime() - new Date(message.createdAt).getTime() > CONTACT_RETRY_FOR_MS) continue;
			if ((await this.deliver(message)).status === 'delivered') delivered += 1;
		}
		return delivered;
	}

	/** One attempt. Without a chosen, connected mailbox the message simply keeps waiting. */
	async deliver(message: ContactMessage): Promise<ContactMessage> {
		const mailboxId = (await this.settings.get('mailboxes.contact'))?.mailboxId ?? null;
		const mailbox = mailboxId ? await this.mailboxes.findById(mailboxId) : null;
		const refreshToken = mailbox?.status === 'connected' ? await this.tokens.get(mailbox.id) : null;
		if (!mailbox || !refreshToken) {
			return this.messages.save({ ...message, lastError: 'No connected Contact Us mailbox is chosen.' });
		}
		try {
			const imported = await this.gmail.importMessage(
				{ address: mailbox.address, refreshToken },
				{
					fromName: message.name,
					fromAddress: message.email,
					to: mailbox.address,
					replyTo: message.email,
					subject: `Contact Us: ${message.subject}`,
					text: this.body(message),
				},
			);
			return this.messages.save({
				...message,
				status: 'delivered',
				mailboxId: mailbox.id,
				gmailMessageId: imported.id,
				attempts: message.attempts + 1,
				lastError: null,
				deliveredAt: new Date().toISOString(),
			});
		} catch (error) {
			if (error instanceof MailboxAccessRevoked)
				await this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
			const status = (error as { status?: unknown }).status;
			return this.messages.save({
				...message,
				status: 'failed',
				mailboxId: mailbox.id,
				attempts: message.attempts + 1,
				lastError:
					error instanceof MailboxAccessRevoked
						? 'Mailbox needs reconnecting.'
						: `Gmail ${String(status ?? 'error')}`,
			});
		}
	}

	/** What staff read: the customer's details, the language to reply in, then the message. */
	private body(message: ContactMessage): string {
		return [
			`Name: ${message.name}`,
			`Email: ${message.email}`,
			...(message.phone ? [`Phone: ${message.phone}`] : []),
			`Reply in: ${languageName(message.locale)}`,
			'',
			message.message,
			'',
			'—',
			'Sent from the Contact Us page of the Saha Textile shop.',
		].join('\n');
	}

	/** The connection address, never stored raw: keyed with the mailbox key when there is one. */
	private hashIp(ip: string): string {
		const key = this.config.mail.tokenKey;
		return key
			? createHmac('sha256', Buffer.from(key, 'base64')).update(`contact-ip:${ip}`).digest('hex')
			: createHash('sha256').update(`contact-ip:${ip}`).digest('hex');
	}
}
