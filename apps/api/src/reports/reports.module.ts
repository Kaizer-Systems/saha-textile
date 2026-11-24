import { Module } from '@nestjs/common';

import { AccountsTemplatesModule } from '../accounts-templates/accounts-templates.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';

import { ReportBuilderController } from './report-builder.controller';
import { ReportBuilderService } from './report-builder.service';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';

/** Reports (accounts brief U, V): statements, and the report library and builder. */
@Module({
	imports: [LedgerModule, AccountsTemplatesModule, LocationsModule],
	controllers: [StatementsController, ReportBuilderController],
	providers: [StatementsService, ReportBuilderService],
})
export class ReportsModule {}
