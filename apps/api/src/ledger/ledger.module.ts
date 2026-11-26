import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { DocumentsModule } from '../documents/documents.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';
import { AccountsListsController, AccountsListsService } from './accounts-lists';
import { AccountsOverviewController, AccountsOverviewService } from './accounts-overview';
import { AccountsPrints } from './accounts-prints';
import { BooksCatchUpController, BooksCatchUpService } from './books-catch-up';
import { BooksPostingService } from './books-posting';
import { ConvertController, ConvertService } from './convert';
import { DocumentLockAsksController, EditLogService } from './edit-log';
import { DocumentLocksController, LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { MoneyLandingController, MoneyLandingService } from './money-landing';
import { ReportPreviewController, ReportPreviewService } from './report-preview';
import { RolesController, RolesService } from './roles';
import { TemplateUpdatesController, TemplateUpdatesService } from './template-updates';
import { BooksImportController, BooksImportService } from './books-import';
import { YearCloseController, YearCloseService } from './year-close';

/** The general ledger (accounts brief Q, T, D10): later documents post through LedgerService.post. */
@Module({
	imports: [AccountsTemplatesModule, LocationsModule, OrdersSetupModule, DocumentsModule],
	controllers: [
		LedgerController,
		DocumentLocksController,
		DocumentLockAsksController,
		MoneyLandingController,
		BooksCatchUpController,
		ConvertController,
		RolesController,
		ReportPreviewController,
		TemplateUpdatesController,
		AccountsListsController,
		AccountsOverviewController,
		YearCloseController,
		BooksImportController,
	],
	providers: [
		LedgerService,
		EditLogService,
		MoneyLandingService,
		BooksPostingService,
		BooksCatchUpService,
		ConvertService,
		RolesService,
		ReportPreviewService,
		TemplateUpdatesService,
		AccountsListsService,
		AccountsPrints,
		AccountsOverviewService,
		YearCloseService,
		BooksImportService,
	],
	exports: [LedgerService, EditLogService, MoneyLandingService, BooksPostingService],
})
export class LedgerModule {}
