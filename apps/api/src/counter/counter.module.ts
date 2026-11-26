import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { CashModule } from '../cash/cash.module';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { ReturnsModule } from '../returns/returns.module';
import { CounterController } from './counter.controller';
import { CounterDeskService } from './counter-desk.service';
import { CounterExchangeService } from './counter-exchange.service';
import { CounterSummaryService } from './counter-summary.service';
import { CounterSalesService } from './counter-sales.service';

/** Counter mode (accounts brief P1–P4). */
@Module({
	imports: [
		AccountsTemplatesModule,
		AdminOrdersModule,
		CashModule,
		DocumentsModule,
		InvoicingModule,
		LedgerModule,
		LocationsModule,
		OrdersSetupModule,
		ReturnsModule,
	],
	controllers: [CounterController],
	providers: [CounterSalesService, CounterDeskService, CounterExchangeService, CounterSummaryService],
})
export class CounterModule {}
