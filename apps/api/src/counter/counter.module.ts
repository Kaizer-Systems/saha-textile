import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { CashModule } from '../cash/cash.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { CounterController } from './counter.controller';
import { CounterSalesService } from './counter-sales.service';

/** Counter mode (accounts brief P1–P4). */
@Module({
	imports: [AccountsTemplatesModule, AdminOrdersModule, CashModule, InvoicingModule, LedgerModule, OrdersSetupModule],
	controllers: [CounterController],
	providers: [CounterSalesService],
})
export class CounterModule {}
