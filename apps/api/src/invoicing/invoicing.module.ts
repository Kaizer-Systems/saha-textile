import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { AccountsInvoicesController, InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/** Tax invoices issued at dispatch (accounts brief D1). */
@Module({
	imports: [LedgerModule, OrdersSetupModule, DocumentsModule],
	controllers: [InvoicesController, AccountsInvoicesController],
	providers: [InvoicesService],
	exports: [InvoicesService],
})
export class InvoicingModule {}
