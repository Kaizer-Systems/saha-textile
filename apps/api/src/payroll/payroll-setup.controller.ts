import { Body, Controller, Get, Header, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdvanceGive,
	PayrollRulesWrite,
	SalaryTemplateEdit,
	SalaryTemplateWrite,
	StatutoryFiling,
	StatutoryKind,
	StatutoryStateQuery,
	StructurePreviewInput,
	YearMonth,
} from '@saha-textile/contracts';

import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PayrollAdvancesService } from './payroll-advances.service';
import { PayrollReturnsService } from './payroll-returns.service';
import { PayrollRulesService } from './payroll-rules.service';
import { SalaryTemplatesService } from './salary-templates.service';

/** Payroll rules (S1), schemes (S2), structure templates (S4), payslips (S6), statutory returns (S7), advances (S9). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/payroll')
export class PayrollSetupController {
	constructor(
		private readonly rules: PayrollRulesService,
		private readonly templates: SalaryTemplatesService,
		private readonly returns: PayrollReturnsService,
		private readonly advances: PayrollAdvancesService,
	) {}

	@Get('rules')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollRules', summary: 'Payroll rule versions, oldest first (S1)' })
	listRules() {
		return this.rules.list();
	}

	@Post('rules')
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'payrollRulesAdd', summary: 'Add a dated payroll rule version (S1)' })
	addRules(
		@Body(new ZodValidationPipe(PayrollRulesWrite)) body: PayrollRulesWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.rules.add(body, principal);
	}

	@Get('schemes/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollSchemes', summary: 'Which schemes apply in a month (S2)' })
	schemes(@Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.returns.schemes(month);
	}

	@Get('structures')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollStructures', summary: 'Salary structure templates (S4)' })
	structures() {
		return this.templates.list();
	}

	@Post('structures/preview')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollStructurePreview', summary: 'What a structure gives on a monthly pay (S4)' })
	preview(@Body(new ZodValidationPipe(StructurePreviewInput)) body: StructurePreviewInput) {
		return this.templates.preview(body.components, body.payINR);
	}

	@Post('structures')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollStructureCreate', summary: 'Add a salary structure template (S4)' })
	createStructure(@Body(new ZodValidationPipe(SalaryTemplateWrite)) body: SalaryTemplateWrite) {
		return this.templates.create(body);
	}

	@Put('structures/:id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollStructureUpdate', summary: 'Change a salary structure template (S4)' })
	updateStructure(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SalaryTemplateEdit)) body: SalaryTemplateEdit,
	) {
		return this.templates.update(id, body);
	}

	@Get('runs/:month/payslips/:employeeId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollPayslip', summary: 'One person’s payslip for a month (S6)' })
	payslip(@Param('month', new ZodValidationPipe(YearMonth)) month: string, @Param('employeeId') employeeId: string) {
		return this.returns.payslip(month, employeeId);
	}

	@Get('runs/:month/payslips.pdf')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollPayslipsPdf', summary: 'A run’s payslips, or one person’s, as a PDF (PS4)' })
	async payslipsPdf(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Query('employeeId') employeeId: string | undefined,
		@Res() reply: FastifyReply,
	) {
		const file = await this.returns.payslipsPdf(month, employeeId || null);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(file.data));
	}

	@Get('statutory')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollStatutory', summary: 'Statutory returns due and filed (S7)' })
	statutory() {
		return this.returns.returns();
	}

	@Get('statutory/:kind/:period/file')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollStatutoryFile', summary: 'The file a portal takes for a return (S7)' })
	statutoryFile(
		@Param('kind', new ZodValidationPipe(StatutoryKind)) kind: StatutoryKind,
		@Param('period', new ZodValidationPipe(YearMonth)) period: string,
		@Query('state', new ZodValidationPipe(StatutoryStateQuery)) state: string | null,
	) {
		return this.returns.file(kind, period, state);
	}

	@Post('statutory/:kind/:period/filed')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'payrollStatutoryFiled', summary: 'Mark a statutory return filed (S7)' })
	markFiled(
		@Param('kind', new ZodValidationPipe(StatutoryKind)) kind: StatutoryKind,
		@Param('period', new ZodValidationPipe(YearMonth)) period: string,
		@Body(new ZodValidationPipe(StatutoryFiling)) body: StatutoryFiling,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.markFiled(kind, period, body, principal);
	}

	@Get('advances')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollAdvances', summary: 'Advances given, with their schedules (S9)' })
	listAdvances() {
		return this.advances.list();
	}

	@Get('advances/:employeeId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollAdvance', summary: 'One person’s advance schedule (S9)' })
	advance(@Param('employeeId') employeeId: string) {
		return this.advances.schedule(employeeId);
	}

	@Post('advances/:employeeId')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'payrollAdvanceGive', summary: 'Give an advance, paid from cash or bank (S9)' })
	giveAdvance(
		@Param('employeeId') employeeId: string,
		@Body(new ZodValidationPipe(AdvanceGive)) body: AdvanceGive,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.advances.give(employeeId, body, principal);
	}
}
