import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import type { BusinessOpenOrder, BusinessReceiptWrite, LedgerEntry } from '@saha-textile/contracts';
import {
	allocateReceipt,
	checkReceiptSplit,
	type AdminOrderRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { ADMIN_ORDER_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { BooksPostingService } from '../ledger/books-posting';
import { BusinessesService } from '../orders-setup/businesses.service';
import { AdminOrdersService, type Actor } from './admin-orders.service';
import { OrderNoticesService } from './order-notices.service';

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
		private readonly books: BooksPostingService,
		@Optional() @Inject(OrderNoticesService) private readonly notices: OrderNoticesService | null = null,
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
		const business = await this.businesses.get(businessId);
		const entry = await this.transactions.withTransaction(async (context) => {
			const entry = await this.businesses.recordReceipt(businessId, input, actor.id, context);
			// The money in the books, in this same transaction (Postings and Convert brief P1).
			await this.books.businessReceipt(
				{ id: entry.documentId, number: entry.documentNumber, businessName: business.legalName },
				input,
				context,
				actor.id,
			);
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
		// The receipt email goes once the receipt is saved, never for one that was rolled back.
		if (this.notices) {
			const numbers = new Map(open.map((row) => [row.orderId, row.orderNumber]));
			await this.notices.sendBusinessReceipt(
				business,
				entry,
				input,
				// checkReceiptSplit took only open orders, so each share has its order's number.
				allocations.map((share) => String(numbers.get(share.orderId))),
				await this.businesses.receivableINR(businessId),
			);
		}
		return entry;
	}
}
