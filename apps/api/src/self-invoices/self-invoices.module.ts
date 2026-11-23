import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import {
	PaymentVouchersController,
	PurchasePaymentVouchersController,
	SelfInvoicesController,
} from './self-invoices.controller';
import { SelfInvoicesService } from './self-invoices.service';

/** Self-invoices and payment vouchers (accounts brief D, decision D5). */
@Module({
	imports: [
		AccountsTemplatesModule,
		DocumentsModule,
		LedgerModule,
		LocationsModule,
		OrdersSetupModule,
		PurchasingModule,
	],
	controllers: [SelfInvoicesController, PaymentVouchersController, PurchasePaymentVouchersController],
	providers: [SelfInvoicesService],
})
export class SelfInvoicesModule {}
