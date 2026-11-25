import { Module } from '@nestjs/common';
import {
	MongoAttendanceRepository,
	MongoEmployeeRepository,
	MongoPayrollAdvanceRepository,
	MongoPayrollRulesRepository,
	MongoSalaryTemplateRepository,
	MongoStatutoryFilingRepository,
} from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
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

import { PayrollAdvancesService } from './payroll-advances.service';
import { PayrollReturnsService } from './payroll-returns.service';
import { PayrollRulesService } from './payroll-rules.service';
import { PayrollSetupController } from './payroll-setup.controller';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryTemplatesService } from './salary-templates.service';

/** Employees' store, sealing personal numbers with PAYROLL_PII_KEY when it is set (D29). */
export function employeeStoreFor(config: Pick<AppConfig, 'payroll'>): MongoEmployeeRepository {
	const key = config.payroll.piiKey;
	return new MongoEmployeeRepository(key ? new Uint8Array(Buffer.from(key, 'base64')) : null);
}

/** Payroll (accounts brief S). */
@Module({
	imports: [LedgerModule, DocumentsModule, OrdersSetupModule],
	controllers: [PayrollController, PayrollSetupController],
	providers: [
		PayrollService,
		PayrollRulesService,
		SalaryTemplatesService,
		PayrollReturnsService,
		PayrollAdvancesService,
		{ provide: PAYROLL_RULES_REPOSITORY, useClass: MongoPayrollRulesRepository },
		{ provide: SALARY_TEMPLATE_REPOSITORY, useClass: MongoSalaryTemplateRepository },
		{ provide: STATUTORY_FILING_REPOSITORY, useClass: MongoStatutoryFilingRepository },
		{ provide: PAYROLL_ADVANCE_REPOSITORY, useClass: MongoPayrollAdvanceRepository },
		{ provide: EMPLOYEE_REPOSITORY, inject: [APP_CONFIG], useFactory: employeeStoreFor },
		{ provide: ATTENDANCE_REPOSITORY, useClass: MongoAttendanceRepository },
	],
})
export class PayrollModule {}
