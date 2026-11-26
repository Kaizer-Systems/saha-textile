import { createHash, randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { NotificationCategory, NotificationChannel } from '@saha-textile/contracts';
import type {
	MessageOutboxRepository,
	NotificationMessage,
	NotificationPort,
	NotificationResult,
} from '@saha-textile/core-domain';

/**
 * Stands in for MSG91 on a server deployed without `MSG91_AUTH_KEY` on purpose (`--allow-blank`;
 * owner, 2026-11-21: a staging or production server may come up for browsing before the key
 * exists).
 *
 * Every send fails and is recorded as failed in the message outbox, so nothing claims that a code
 * or an email went out. The console adapter is never used on a server: it answers "sent" while
 * nothing leaves, and a shopper would wait for a code that never comes. Like that adapter, this
 * one never logs the destination or the message's variables (codes and tokens travel there).
 */
export class UnavailableNotificationAdapter implements NotificationPort {
	static readonly REASON = 'MSG91_AUTH_KEY is not set on this server, so no message can be sent.';

	private readonly logger = new Logger('Notifications');

	constructor(
		private readonly outbox: Pick<MessageOutboxRepository, 'append' | 'findByIdempotencyKey'>,
		private readonly now: () => Date = () => new Date(),
	) {}

	async send(message: NotificationMessage): Promise<NotificationResult> {
		if (message.idempotencyKey) {
			const prior = await this.outbox.findByIdempotencyKey(message.idempotencyKey);
			if (prior)
				return { status: prior.status, providerMessageId: prior.providerMessageId, outboxEntryId: prior.id };
		}
		const outboxEntryId = `outbox_${randomUUID()}`;
		await this.outbox.append({
			id: outboxEntryId,
			channel: message.channel,
			category: message.category,
			templateKey: message.templateKey,
			destinationHash: createHash('sha256').update(message.destination).digest('hex'),
			userId: message.userId ?? null,
			status: 'failed',
			providerMessageId: null,
			errorMessage: UnavailableNotificationAdapter.REASON,
			attempts: 0,
			createdAt: this.now().toISOString(),
			sentAt: null,
			idempotencyKey: message.idempotencyKey ?? null,
		} as Parameters<MessageOutboxRepository['append']>[0]);
		this.logger.warn(
			`Not sent: ${message.channel}/${message.category} template=${message.templateKey}. ${UnavailableNotificationAdapter.REASON}`,
		);
		return { status: 'failed', providerMessageId: null, outboxEntryId };
	}

	/** No channel can deliver anything here, so pre-flight checks say so. */
	async isChannelEnabled(_channel: NotificationChannel, _category: NotificationCategory): Promise<boolean> {
		return false;
	}
}
