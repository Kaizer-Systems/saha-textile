import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { CreditNotesController, ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/** Returns, credit notes and debit notes (accounts brief B). */
@Module({
	imports: [LedgerModule, OrdersSetupModule, DocumentsModule],
	controllers: [ReturnsController, CreditNotesController],
	providers: [ReturnsService],
	exports: [ReturnsService],
})
export class ReturnsModule {}
