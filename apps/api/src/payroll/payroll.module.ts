import { Module } from '@nestjs/common';
import {
	MongoAttendanceDayRepository,
	MongoIncrementPlanRepository,
	MongoAttendanceRepository,
	MongoEmployeeRepository,
	MongoPayrollAdvanceRepository,
	MongoPayrollRulesRepository,
	MongoSalaryTemplateRepository,
	MongoStatutoryFilingRepository,
} from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	ATTENDANCE_DAY_REPOSITORY,
	INCREMENT_PLAN_REPOSITORY,
	ATTENDANCE_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	PAYROLL_ADVANCE_REPOSITORY,
	PAYROLL_RULES_REPOSITORY,
	SALARY_TEMPLATE_REPOSITORY,
	STATUTORY_FILING_REPOSITORY,
} from '../infra/tokens';
import { DocumentsModule } from '../documents/documents.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';

import { AttendanceDaysController, AttendanceDaysService } from './attendance-days';
import { PayrollAdvancesService } from './payroll-advances.service';
import { PayrollReturnsService } from './payroll-returns.service';
import { PayrollRulesService } from './payroll-rules.service';
import { PayrollSetupController } from './payroll-setup.controller';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { IncrementsController, IncrementsService } from './increments';
import { SalaryRevisionsController, SalaryRevisionsService } from './salary-revisions';
import { SalaryTemplatesService } from './salary-templates.service';

/** Employees' store, sealing personal numbers with PAYROLL_PII_KEY when it is set (D29). */
export function employeeStoreFor(config: Pick<AppConfig, 'payroll'>): MongoEmployeeRepository {
	const key = config.payroll.piiKey;
	return new MongoEmployeeRepository(key ? new Uint8Array(Buffer.from(key, 'base64')) : null);
}

/** Payroll (accounts brief S). */
@Module({
	imports: [LedgerModule, DocumentsModule, OrdersSetupModule],
	controllers: [
		PayrollController,
		PayrollSetupController,
		AttendanceDaysController,
		SalaryRevisionsController,
		IncrementsController,
	],
	providers: [
		PayrollService,
		PayrollRulesService,
		SalaryTemplatesService,
		PayrollReturnsService,
		PayrollAdvancesService,
		AttendanceDaysService,
		SalaryRevisionsService,
		IncrementsService,
		{ provide: PAYROLL_RULES_REPOSITORY, useClass: MongoPayrollRulesRepository },
		{ provide: SALARY_TEMPLATE_REPOSITORY, useClass: MongoSalaryTemplateRepository },
		{ provide: STATUTORY_FILING_REPOSITORY, useClass: MongoStatutoryFilingRepository },
		{ provide: PAYROLL_ADVANCE_REPOSITORY, useClass: MongoPayrollAdvanceRepository },
		{ provide: EMPLOYEE_REPOSITORY, inject: [APP_CONFIG], useFactory: employeeStoreFor },
		{ provide: ATTENDANCE_REPOSITORY, useClass: MongoAttendanceRepository },
		{ provide: ATTENDANCE_DAY_REPOSITORY, useClass: MongoAttendanceDayRepository },
		// Brief 26 SR3: increment plans.
		{ provide: INCREMENT_PLAN_REPOSITORY, useClass: MongoIncrementPlanRepository },
	],
})
export class PayrollModule {}
