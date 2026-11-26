import { Module } from '@nestjs/common';

import { AdminOrdersModule } from '../admin-orders/admin-orders.module';
import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { CancelAndRefundController, RefundVouchersController } from './refund-vouchers.controller';
import { RefundVouchersService } from './refund-vouchers.service';
import { CreditNotesController, ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/** Returns, credit notes and debit notes (accounts brief B), and refund vouchers (C). */
@Module({
	imports: [LedgerModule, OrdersSetupModule, DocumentsModule, AdminOrdersModule],
	controllers: [ReturnsController, CreditNotesController, CancelAndRefundController, RefundVouchersController],
	providers: [ReturnsService, RefundVouchersService],
	exports: [ReturnsService, RefundVouchersService],
})
export class ReturnsModule {}
