import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';
import { ReconcileService } from './reconcile.service';
import { StatementsService } from './statements.service';

/** Bank accounts (accounts brief BA). */
@Module({
	imports: [LedgerModule],
	controllers: [BanksController],
	providers: [BanksService, StatementsService, ReconcileService],
	exports: [BanksService],
})
export class BanksModule {}
