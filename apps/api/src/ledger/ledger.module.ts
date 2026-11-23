import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { BooksCatchUpController, BooksCatchUpService } from './books-catch-up';
import { BooksPostingService } from './books-posting';
import { ConvertController, ConvertService } from './convert';
import { DocumentLockAsksController, EditLogService } from './edit-log';
import { DocumentLocksController, LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { MoneyLandingController, MoneyLandingService } from './money-landing';
import { RolesController, RolesService } from './roles';

/** The general ledger (accounts brief Q, T, D10): later documents post through LedgerService.post. */
@Module({
	imports: [AccountsTemplatesModule, LocationsModule, OrdersSetupModule],
	controllers: [
		LedgerController,
		DocumentLocksController,
		DocumentLockAsksController,
		MoneyLandingController,
		BooksCatchUpController,
		ConvertController,
		RolesController,
	],
	providers: [
		LedgerService,
		EditLogService,
		MoneyLandingService,
		BooksPostingService,
		BooksCatchUpService,
		ConvertService,
		RolesService,
	],
	exports: [LedgerService, EditLogService, MoneyLandingService, BooksPostingService],
})
export class LedgerModule {}
