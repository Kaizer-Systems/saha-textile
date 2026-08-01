import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationCategory } from '@saha-textile/contracts';
import type { NotificationPort, NotificationMessage, NotificationResult } from '@saha-textile/core-domain';

/**
 * Development/test implementation of `NotificationPort`.
 *
 * MSG91 is the locked primary provider, but the owner rule is that real providers are
 * wired only once approved credentials and templates exist — ports and stubs come first.
 * This adapter satisfies the port so the auth flows are complete and testable without
 * sending anything.
 *
 * It logs that a message WOULD be sent, with the destination hashed and the variables
 * omitted entirely: OTP codes and reset tokens travel in `variables`, and the one thing
 * this must never do is put them in a log file.
 */
@Injectable()
export class ConsoleNotificationAdapter implements NotificationPort {
	private readonly logger = new Logger('Notifications');

	async send(message: NotificationMessage): Promise<NotificationResult> {
		const destinationHash = createHash('sha256').update(message.destination).digest('hex').slice(0, 12);
		this.logger.log(
			`[console] ${message.channel}/${message.category} template=${message.templateKey} to=sha256:${destinationHash} (payload withheld)`,
		);

		return {
			status: 'sent',
			providerMessageId: `console_${randomUUID()}`,
			outboxEntryId: `outbox_${randomUUID()}`,
		};
	}

	/**
	 * Always enabled in this adapter. The real kill-switch reads
	 * `notificationChannelSettings` and short-circuits before any provider call — that
	 * lands with the MSG91 adapter in Chunk I.
	 */
	async isChannelEnabled(_channel: NotificationChannel, _category: NotificationCategory): Promise<boolean> {
		return true;
	}
}
