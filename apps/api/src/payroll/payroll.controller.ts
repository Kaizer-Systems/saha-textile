import { Body, Controller, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceWrite, EmployeeEdit, EmployeeWrite, PayrollStep, YearMonth } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PayrollService } from './payroll.service';

/** Payroll (accounts brief S): employees, attendance and the monthly run. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/payroll')
export class PayrollController {
	constructor(private readonly payroll: PayrollService) {}

	@Get('employees')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'payrollEmployees',
		summary: 'Employees, numbers masked unless the person may see them (S3)',
	})
	employees(@Principal() principal?: AuthenticatedPrincipal) {
		return this.payroll.listEmployees(principal);
	}

	@Post('employees')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollEmployeeCreate', summary: 'Add an employee (S3)' })
	createEmployee(@Body(new ZodValidationPipe(EmployeeWrite)) body: EmployeeWrite) {
		return this.payroll.createEmployee(body);
	}

	@Put('employees/:id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollEmployeeUpdate', summary: 'Change an employee (S3, S4)' })
	updateEmployee(@Param('id') id: string, @Body(new ZodValidationPipe(EmployeeEdit)) body: EmployeeEdit) {
		return this.payroll.updateEmployee(id, body);
	}

	@Get('employees/:id/income-tax/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'payrollIncomeTax',
		summary: 'An employee’s year of income tax worked both ways (TX1)',
	})
	incomeTax(@Param('id') id: string, @Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.payroll.incomeTax(id, month);
	}

	@Get('attendance/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollAttendance', summary: 'A month’s attendance (S8)' })
	attendance(@Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.payroll.getAttendance(month);
	}

	@Put('attendance/:month')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollAttendanceSave', summary: 'Save or lock a month’s attendance (S8)' })
	saveAttendance(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Body(new ZodValidationPipe(AttendanceWrite)) body: AttendanceWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.payroll.saveAttendance(month, body, principal);
	}

	@Get('runs')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollRuns', summary: 'Payroll runs (S5)' })
	runs() {
		return this.payroll.listRuns();
	}

	@Get('runs/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollRun', summary: 'A month’s payroll run, or null (S5)' })
	run(@Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.payroll.getRun(month);
	}

	@Post('runs/:month')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollPrepare', summary: 'Prepare a month’s payroll from its attendance (S5)' })
	prepare(@Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.payroll.prepare(month);
	}

	@Post('runs/:month/step')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'payrollStep', summary: 'Approve, post or pay a month’s payroll (S5)' })
	step(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Body(new ZodValidationPipe(PayrollStep)) body: PayrollStep,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.payroll.step(month, body, principal);
	}
}
