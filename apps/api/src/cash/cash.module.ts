import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { ClaimsService } from './claims.service';
import { PettyService } from './petty.service';

/** Cash boxes, sheets, petty expenses and staff claims (accounts brief O). */
@Module({
	imports: [AccountsTemplatesModule, LedgerModule, LocationsModule, OrdersSetupModule],
	controllers: [CashController],
	providers: [CashService, PettyService, ClaimsService],
	exports: [CashService],
})
export class CashModule {}
