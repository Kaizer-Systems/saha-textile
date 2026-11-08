import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Customer, ShopEvent } from '@saha-textile/contracts';
import {
	type ConsentRepository,
	type CustomerRepository,
	type NotificationPort,
	formatIst,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CONSENT_REPOSITORY, CUSTOMER_REPOSITORY, NOTIFICATION_PORT } from '../infra/tokens';

/** The marketing email template the event message goes out on, registered with MSG91. */
export const EVENT_TEMPLATE_KEY = 'shop_event_announcement';
const PAGE = 200;

/**
 * Sends an event's customer message (owner log § launch and sale events).
 *
 * Email only for now: SMS and WhatsApp need pre-approved templates, an open item for the MSG91
 * discussion (API roadmap, Chunk I). The notification port checks marketing consent and the
 * kill-switches itself; this class only finds who to ask about and counts who agreed.
 */
@Injectable()
export class EventMessenger {
	private readonly logger = new Logger('EventMessenger');

	constructor(
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Optional() @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository | null = null,
		@Optional() @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort | null = null,
	) {}

	/** Active customers with an email whose saved consent includes marketing. */
	private async *recipients(): AsyncGenerator<Customer & { email: string }> {
		if (!this.consents) return;
		for (let page = 1; ; page += 1) {
			const { items, meta } = await this.customers.list({ page, pageSize: PAGE, status: 'active' });
			for (const customer of items) {
				if (!customer.email) continue;
				const latest = await this.consents.findLatestForUser(customer.id);
				if (latest?.categories.marketing === true) yield customer as Customer & { email: string };
			}
			if (!items.length || page * PAGE >= meta.total) return;
		}
	}

	async count(): Promise<number> {
		let total = 0;
		for await (const _ of this.recipients()) total += 1;
		return total;
	}

	private variables(event: ShopEvent, locale: string): Record<string, string> {
		const pick = (values: Readonly<Record<string, string>>) => values[locale]?.trim() || values['en']?.trim() || '';
		return {
			title: pick(event.title),
			message: pick(event.message),
			when: event.startsAt ? formatIst(event.startsAt, locale) : '',
			ends: event.endsAt ? formatIst(event.endsAt, locale) : '',
			// A shop path: the MSG91 template puts the site's address in front of it.
			link: `${locale === 'en' ? '' : `/${locale}`}${event.linkHref ?? '/'}`,
		};
	}

	/** Sends to every customer who agreed, each in their own language. Returns how many it asked. */
	async announce(event: ShopEvent): Promise<number> {
		if (!this.notifications) return 0;
		let sent = 0;
		for await (const customer of this.recipients()) {
			const locale =
				customer.preferredLocale && this.config.locales.includes(customer.preferredLocale)
					? customer.preferredLocale
					: 'en';
			try {
				await this.notifications.send({
					channel: 'email',
					category: 'marketing',
					templateKey: EVENT_TEMPLATE_KEY,
					destination: customer.email,
					userId: customer.id,
					variables: this.variables(event, locale),
					idempotencyKey: `event:${event.id}:${customer.id}`,
				});
				sent += 1;
			} catch (error) {
				this.logger.warn(
					`Event message not sent to one customer: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}
		return sent;
	}

	/** "Send me a test": the message to the signed-in admin, in every language. */
	async test(event: ShopEvent, email: string): Promise<void> {
		if (!this.notifications) return;
		for (const locale of this.config.locales) {
			await this.notifications.send({
				channel: 'email',
				category: 'transactional',
				templateKey: EVENT_TEMPLATE_KEY,
				destination: email,
				variables: this.variables(event, locale),
			});
		}
	}
}
