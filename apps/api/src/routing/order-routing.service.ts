import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { OrderRoutingSettings, type OrderRoutingSettingsWrite } from '@saha-textile/contracts';
import type { SiteSettingsRepository } from '@saha-textile/core-domain';

import { SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

/** Settings › Order routing (accounts brief M2, D14): read with the defaults, saved over the copy read. */
@Injectable()
export class OrderRoutingService {
	constructor(@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository) {}

	async get(): Promise<OrderRoutingSettings> {
		return OrderRoutingSettings.parse((await this.settings.get('orders.routing')) ?? {});
	}

	async save(write: OrderRoutingSettingsWrite, by: string | null): Promise<OrderRoutingSettings> {
		const current = await this.get();
		if ((write.expectedUpdatedAt ?? null) !== current.updatedAt) throw new ConflictException('routing_changed');
		const { expectedUpdatedAt, ...rest } = write;
		void expectedUpdatedAt;
		const next = OrderRoutingSettings.parse({ ...rest, updatedAt: new Date().toISOString(), updatedBy: by });
		await this.settings.set('orders.routing', next);
		return next;
	}
}
