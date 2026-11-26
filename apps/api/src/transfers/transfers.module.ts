import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

/** Stock transfers between locations (accounts brief N). */
@Module({
	imports: [DocumentsModule, LedgerModule, LocationsModule, OrdersSetupModule],
	controllers: [TransfersController],
	providers: [TransfersService],
	exports: [TransfersService],
})
export class TransfersModule {}
