import { Logger } from '@nestjs/common';
import { Msg91NotificationAdapter } from '@saha-textile/adapters-notifications-msg91';
import { COMMUNICATION_USES } from '@saha-textile/contracts';
import {
	CommunicationSendGate,
	communicationGroupForTemplate,
	type CommunicationSwitchRepository,
	type ConsentRepository,
	type MessageOutboxRepository,
	type NotificationPort,
	type NotificationSettingsRepository,
	type NotificationTemplateRepository,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { isStrictDeployment } from '../config/deployment-hardening';
import { ConsoleNotificationAdapter } from './console-notification.adapter';
import { UnavailableNotificationAdapter } from './unavailable-notification.adapter';

export interface NotificationStores {
	settings: NotificationSettingsRepository;
	templates: NotificationTemplateRepository;
	outbox: MessageOutboxRepository;
	consent: ConsentRepository;
	/** Settings › Communications switches; every sender obeys them. */
	switches: CommunicationSwitchRepository;
}

/** Each email's From address: the sender of its template's group on Settings › Communications. */
export const emailSenderFor =
	(senders: AppConfig['notifications']['msg91EmailFrom']) =>
	(templateKey: string): string =>
		senders[communicationGroupForTemplate(templateKey, COMMUNICATION_USES)];

/** One choice of provider, so the API and the worker can never disagree about how mail leaves. */
export function buildNotificationPort(config: AppConfig, stores: NotificationStores): NotificationPort {
	const gate = new CommunicationSendGate(COMMUNICATION_USES, stores.switches);
	const wantMsg91 = config.notifications.provider === 'msg91';
	const authKey = config.notifications.msg91AuthKey;
	if (wantMsg91 && authKey) {
		return new Msg91NotificationAdapter({
			config: {
				authKey,
				senderId: config.notifications.msg91SenderId,
				emailFromFor: emailSenderFor(config.notifications.msg91EmailFrom),
				emailDomain: config.notifications.msg91EmailDomain,
				whatsappNumber: config.notifications.msg91WhatsappNumber,
			},
			settings: stores.settings,
			templates: stores.templates,
			outbox: stores.outbox,
			consent: stores.consent,
			gate,
		});
	}
	if (wantMsg91 && !authKey && isStrictDeployment(config)) {
		// Only reachable when the release left the key blank on purpose (RELEASE_ALLOWED_BLANK):
		// deployment hardening refuses to start otherwise. Refuse every message, never "send" one.
		Logger.warn(
			'MSG91_AUTH_KEY was deployed blank on purpose: every message is refused and recorded as failed until it is set.',
			'Notifications',
		);
		return new UnavailableNotificationAdapter(stores.outbox);
	}
	if (wantMsg91 && !authKey) {
		Logger.warn(
			'NOTIFICATION_PROVIDER=msg91 but MSG91_AUTH_KEY is empty — falling back to console adapter',
			'Notifications',
		);
	}
	return new ConsoleNotificationAdapter(gate);
}
