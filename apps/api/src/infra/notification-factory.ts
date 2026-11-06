import { Logger } from '@nestjs/common';
import { Msg91NotificationAdapter } from '@saha-textile/adapters-notifications-msg91';
import type {
	ConsentRepository,
	MessageOutboxRepository,
	NotificationPort,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { ConsoleNotificationAdapter } from './console-notification.adapter';

export interface NotificationStores {
	settings: NotificationSettingsRepository;
	templates: NotificationTemplateRepository;
	outbox: MessageOutboxRepository;
	consent: ConsentRepository;
}

/** One choice of provider, so the API and the worker can never disagree about how mail leaves. */
export function buildNotificationPort(config: AppConfig, stores: NotificationStores): NotificationPort {
	const wantMsg91 = config.notifications.provider === 'msg91';
	const authKey = config.notifications.msg91AuthKey;
	if (wantMsg91 && authKey) {
		return new Msg91NotificationAdapter({
			config: {
				authKey,
				senderId: config.notifications.msg91SenderId,
				emailFrom: config.notifications.msg91EmailFrom,
				emailDomain: config.notifications.msg91EmailDomain,
				whatsappNumber: config.notifications.msg91WhatsappNumber,
			},
			...stores,
		});
	}
	if (wantMsg91 && !authKey) {
		Logger.warn(
			'NOTIFICATION_PROVIDER=msg91 but MSG91_AUTH_KEY is empty — falling back to console adapter',
			'Notifications',
		);
	}
	return new ConsoleNotificationAdapter();
}
