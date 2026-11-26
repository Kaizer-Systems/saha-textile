import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { PaymentRequestRepository, TransactionManagerPort } from '@saha-textile/core-domain';

import { PAYMENT_REQUEST_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { AdminOrdersService } from './admin-orders.service';

export const REQUEST_SWEEP_MS = 5 * 60_000;
const BATCH = 50;
const SYSTEM = { id: null, name: 'System' };

/**
 * Payment requests that ran out (brief pl05, ol03): every few minutes an active request past its
 * expiry is marked expired and its order's payment status is worked out again, so the order shows
 * "Link expired, unpaid" under Needs attention until staff send a new one. Reads already treat an
 * out-of-date request as inactive; this keeps the stored state and the list filter in step.
 */
@Injectable()
export class PaymentRequestSweep implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('PaymentRequestSweep');
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private readonly orders: AdminOrdersService,
		@Inject(PAYMENT_REQUEST_REPOSITORY) private readonly requests: PaymentRequestRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.sweep(), REQUEST_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** One pass; returns how many requests it marked expired. A failure on one order never stops the rest. */
	async sweep(now = new Date()): Promise<number> {
		let marked = 0;
		try {
			const expired = await this.requests.listExpired(now, BATCH);
			for (const request of expired) {
				try {
					await this.transactions.withTransaction(async (context) => {
						await this.requests.save({ ...request, status: 'expired' }, context);
						const order = await this.orders.get(request.orderId);
						await this.orders.settle(order, order.revision, SYSTEM, now.toISOString(), context, {
							kind: 'paymentRequest',
							detail: { number: request.number, expired: true },
						});
					});
					marked += 1;
				} catch (error) {
					this.logger.warn(
						`Request ${request.number} could not be marked expired: ${error instanceof Error ? error.message : 'unknown'}`,
					);
				}
			}
		} catch (error) {
			this.logger.warn(
				`Expired requests could not be read: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
		return marked;
	}
}
