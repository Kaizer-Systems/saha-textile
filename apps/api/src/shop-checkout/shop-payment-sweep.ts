import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

import { ShopPaymentsService } from './shop-payments.service';

export const SHOP_PAYMENT_SWEEP_MS = 60_000;

/**
 * Every minute: asks the gateways again about shop payments still pending (spaced out per attempt, so
 * the gateways' rate limits hold), and lets go of holds whose 15 minutes ran out (OD1). CCAvenue sends
 * a return that can be lost or late, so this is what settles a payment whose return never arrived.
 * Two API copies may both run it; every step is safe to repeat.
 */
@Injectable()
export class ShopPaymentSweep implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('ShopPaymentSweep');
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(private readonly payments: ShopPaymentsService) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.tick(), SHOP_PAYMENT_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	private async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			await this.payments.sweep();
		} catch (error) {
			this.logger.warn(`Sweep failed: ${error instanceof Error ? error.message : 'unknown'}`);
		} finally {
			this.running = false;
		}
	}
}
