import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { DocumentLockAsksController, EditLogService } from './edit-log';
import { DocumentLocksController, LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { MoneyLandingController, MoneyLandingService } from './money-landing';

/** The general ledger (accounts brief Q, T, D10): later documents post through LedgerService.post. */
@Module({
	imports: [AccountsTemplatesModule, LocationsModule, OrdersSetupModule],
	controllers: [LedgerController, DocumentLocksController, DocumentLockAsksController, MoneyLandingController],
	providers: [LedgerService, EditLogService, MoneyLandingService],
	exports: [LedgerService, EditLogService, MoneyLandingService],
})
export class LedgerModule {}
