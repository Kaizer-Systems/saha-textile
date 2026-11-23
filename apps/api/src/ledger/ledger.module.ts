import { Module } from '@nestjs/common';

import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { DocumentLockAsksController, EditLogService } from './edit-log';
import { DocumentLocksController, LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/** The general ledger (accounts brief Q, T, D10): later documents post through LedgerService.post. */
@Module({
	imports: [LocationsModule, OrdersSetupModule],
	controllers: [LedgerController, DocumentLocksController, DocumentLockAsksController],
	providers: [LedgerService, EditLogService],
	exports: [LedgerService, EditLogService],
})
export class LedgerModule {}
