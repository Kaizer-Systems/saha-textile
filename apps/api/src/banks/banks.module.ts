import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

/** Bank accounts (accounts brief BA). */
@Module({
	imports: [LedgerModule],
	controllers: [BanksController],
	providers: [BanksService],
	exports: [BanksService],
})
export class BanksModule {}
