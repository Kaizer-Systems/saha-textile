import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { InvoicesService } from './invoices.service';

/** Tax invoices issued at dispatch (accounts brief D1). */
@Module({
	imports: [LedgerModule, OrdersSetupModule],
	providers: [InvoicesService],
	exports: [InvoicesService],
})
export class InvoicingModule {}
