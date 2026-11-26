import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';

import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RecurringService } from './recurring.service';

/** Fixed assets and depreciation (accounts brief R1–R4), and rent and recurring entries (R5). */
@Module({
	imports: [LedgerModule],
	controllers: [AssetsController],
	providers: [AssetsService, RecurringService],
})
export class AssetsModule {}
