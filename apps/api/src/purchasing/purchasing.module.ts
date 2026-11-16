import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MediaModule } from '../media/media.module';
import { InventorySettingsService } from './inventory-settings.service';
import { OpeningStockService } from './opening-stock.service';
import { PurchaseEntriesController, PurchaseItemsController } from './purchase-entries.controller';
import { PurchaseEntriesService } from './purchase-entries.service';
import { PurchaseEntryBuilder } from './purchase-entry-builder';
import { PurchaseItemsService } from './purchase-items.service';
import { PurchaseOrderDocument } from './purchase-order-document';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasingSupport } from './purchasing-support';
import { StockApprovalsService } from './stock-approvals.service';
import { StockCountsService } from './stock-counts.service';
import { StockReportsService } from './stock-reports.service';
import { StockWriter } from './stock-writer';
import {
	InventorySettingsController,
	OpeningStockController,
	StockController,
	StockCountsController,
	StockReportsController,
} from './stock.controller';
import { StockService } from './stock.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * Purchases and stock (brief revision 2, accepted 2026-11-15): suppliers, purchase orders,
 * purchase entries, payments, returns and debit notes, stock with holds and approvals, counts,
 * opening stock, reorder and reports. Admin only.
 */
@Module({
	imports: [AuthModule, MailboxesModule, MediaModule],
	controllers: [
		SuppliersController,
		PurchaseItemsController,
		PurchaseEntriesController,
		PurchaseOrdersController,
		PurchaseReturnsController,
		StockController,
		StockCountsController,
		OpeningStockController,
		StockReportsController,
		InventorySettingsController,
	],
	providers: [
		PurchasingSupport,
		SuppliersService,
		PurchaseItemsService,
		PurchaseEntryBuilder,
		PurchaseEntriesService,
		PurchaseOrderDocument,
		PurchaseOrdersService,
		PurchaseReturnsService,
		StockWriter,
		StockService,
		StockCountsService,
		StockApprovalsService,
		OpeningStockService,
		StockReportsService,
		InventorySettingsService,
	],
})
export class PurchasingModule {}
