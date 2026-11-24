import { Module } from '@nestjs/common';
import {
	MongoAttendanceRepository,
	MongoEmployeeRepository,
	MongoPayrollRunRepository,
} from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ATTENDANCE_REPOSITORY, EMPLOYEE_REPOSITORY, PAYROLL_RUN_REPOSITORY } from '../infra/tokens';
import { LedgerModule } from '../ledger/ledger.module';

import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/** Employees' store, sealing personal numbers with PAYROLL_PII_KEY when it is set (D29). */
export function employeeStoreFor(config: Pick<AppConfig, 'payroll'>): MongoEmployeeRepository {
	const key = config.payroll.piiKey;
	return new MongoEmployeeRepository(key ? new Uint8Array(Buffer.from(key, 'base64')) : null);
}

/** Payroll (accounts brief S). */
@Module({
	imports: [LedgerModule],
	controllers: [PayrollController],
	providers: [
		PayrollService,
		{ provide: EMPLOYEE_REPOSITORY, inject: [APP_CONFIG], useFactory: employeeStoreFor },
		{ provide: ATTENDANCE_REPOSITORY, useClass: MongoAttendanceRepository },
		{ provide: PAYROLL_RUN_REPOSITORY, useClass: MongoPayrollRunRepository },
	],
})
export class PayrollModule {}
