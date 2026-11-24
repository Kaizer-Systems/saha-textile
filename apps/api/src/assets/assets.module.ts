import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';

import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/** Fixed assets and depreciation (accounts brief R1–R4). */
@Module({
	imports: [LedgerModule],
	controllers: [AssetsController],
	providers: [AssetsService],
})
export class AssetsModule {}
