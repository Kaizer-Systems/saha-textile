import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { BusinessOpenOrder, BusinessReceiptWrite, LedgerEntry } from '@saha-textile/contracts';
import {
	allocateReceipt,
	checkReceiptSplit,
	type AdminOrderRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { ADMIN_ORDER_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { BusinessesService } from '../orders-setup/businesses.service';
import { AdminOrdersService, type Actor } from './admin-orders.service';

/**
 * Recording a receipt on a business's customer account (brief bz06): it settles the oldest open
 * orders first unless staff split it by hand, and the receipt, its RC number and every order's share
 * are written in one transaction. What is left over stays on the account.
 */
@Injectable()
export class BusinessReceiptsService {
	constructor(
		private readonly businesses: BusinessesService,
		private readonly orders: AdminOrdersService,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orderRepo: AdminOrderRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	/** The business's orders on account that still owe money, oldest first (the "Settles" table). */
	async openOrders(businessId: string): Promise<BusinessOpenOrder[]> {
		await this.businesses.get(businessId);
		return (await this.orderRepo.listOpenOnAccount(businessId)).map((row) => ({
			orderId: row.orderId,
			orderNumber: row.orderNumber,
			placedAt: row.placedAt,
			dueOn: row.dueOn,
			dueINR: row.dueINR,
		}));
	}

	async record(businessId: string, input: BusinessReceiptWrite, actor: Actor): Promise<LedgerEntry> {
		const open = await this.orderRepo.listOpenOnAccount(businessId);
		const allocations = input.allocations.length
			? input.allocations
			: allocateReceipt(open, input.amountINR).allocations;
		const refusal = checkReceiptSplit(open, allocations, input.amountINR);
		if (refusal) {
			throw new BadRequestException(
				codedRefusal(`receipt_${refusal}`, 'That split does not fit the open orders', 'allocations'),
			);
		}
		return this.transactions.withTransaction(async (context) => {
			const entry = await this.businesses.recordReceipt(businessId, input, actor.id, context);
			for (const share of allocations) {
				await this.orders.settleFromReceipt(
					share.orderId,
					{
						amountINR: share.amountINR,
						receiptNumber: entry.documentNumber,
						reference: input.reference,
						receivedOn: input.receivedOn,
					},
					actor,
					context,
				);
			}
			return entry;
		});
	}
}
