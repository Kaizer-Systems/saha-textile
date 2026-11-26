import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationCategory } from '@saha-textile/contracts';
import type {
	CommunicationSendGate,
	NotificationMessage,
	NotificationPort,
	NotificationResult,
} from '@saha-textile/core-domain';

/**
 * Development/test implementation of `NotificationPort`.
 *
 * Used when `NOTIFICATION_PROVIDER=console`, or when provider is `msg91` but
 * `MSG91_AUTH_KEY` is unset on this computer (factory falls back here with a warn). Never on a
 * server: there the factory uses `UnavailableNotificationAdapter`, which refuses every message.
 *
 * It logs that a message WOULD be sent, with the destination hashed and the variables
 * omitted entirely: OTP codes and reset tokens travel in `variables`, and the one thing
 * this must never do is put them in a log file.
 */
@Injectable()
export class ConsoleNotificationAdapter implements NotificationPort {
	private readonly logger = new Logger('Notifications');

	/** Settings › Communications; absent in tests that build the adapter bare. */
	constructor(private readonly gate: Pick<CommunicationSendGate, 'allows'> | null = null) {}

	async send(message: NotificationMessage): Promise<NotificationResult> {
		const destinationHash = createHash('sha256').update(message.destination).digest('hex').slice(0, 12);
		if (this.gate && !(await this.gate.allows(message.templateKey, message.channel))) {
			this.logger.log(
				`[console] ${message.channel}/${message.category} template=${message.templateKey} switched off in Settings › Communications`,
			);
			return {
				status: 'suppressed_use_disabled',
				providerMessageId: null,
				outboxEntryId: `outbox_${randomUUID()}`,
			};
		}
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
	 * Always enabled in this adapter. Kill-switches are enforced by
	 * `Msg91NotificationAdapter` when the live provider is wired.
	 */
	async isChannelEnabled(_channel: NotificationChannel, _category: NotificationCategory): Promise<boolean> {
		return true;
	}
}
