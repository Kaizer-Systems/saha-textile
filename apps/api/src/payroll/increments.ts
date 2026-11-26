import { createHash } from 'node:crypto';

import { Body, Controller, Delete, Get, Header, Inject, Injectable, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	IncrementPlanWrite,
	IncrementRowsInput,
	type IncrementPlan,
	type IncrementRowPreview,
	type IncrementRowResult,
} from '@saha-textile/contracts';
import type { IncrementPlanRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { INCREMENT_PLAN_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { SalaryRevisionsService } from './salary-revisions';

/** A refusal's code, as the API words it, or `failed`. */
const problemOf = (error: unknown) =>
	(error as { response?: { message?: unknown } }).response?.message?.toString() ?? 'failed';

/**
 * Increments many at once (brief 26 SR3; approved 2026-11-26): plans saved by name and reused (by rating band, the
 * same %, or the same amount), each row of a cycle worked out as SR2 works one person, and Accept saving each row
 * as SR2 does, a refusal kept on its row instead of stopping the rest.
 */
@Injectable()
export class IncrementsService {
	constructor(
		@Inject(INCREMENT_PLAN_REPOSITORY) private readonly plans: IncrementPlanRepository,
		@Inject(SalaryRevisionsService) private readonly revisions: Pick<SalaryRevisionsService, 'preview' | 'accept'>,
	) {}

	plansList(): Promise<IncrementPlan[]> {
		return this.plans.list();
	}

	/** A plan is kept by its name: saving the same name again replaces it. */
	savePlan(write: IncrementPlanWrite, now = new Date()): Promise<IncrementPlan> {
		const id = `inc_${createHash('sha256').update(write.name.trim().toLowerCase()).digest('hex').slice(0, 16)}`;
		return this.plans.save({ ...write, id, updatedAt: now.toISOString() });
	}

	deletePlan(id: string): Promise<void> {
		return this.plans.delete(id);
	}

	private revision(input: IncrementRowsInput, row: IncrementRowsInput['rows'][number]) {
		return {
			way: row.way,
			from: input.from,
			templateId: null,
			typed: {},
			lockCtc: true,
			reason: input.reason,
			agreed: false,
		};
	}

	/** SR3: each row worked out: the CTC a year now and new, the change a month, and the checks. */
	async preview(input: IncrementRowsInput): Promise<IncrementRowPreview[]> {
		const out: IncrementRowPreview[] = [];
		for (const row of input.rows) {
			const p = await this.revisions.preview(row.employeeId, this.revision(input, row));
			out.push({
				employeeId: row.employeeId,
				ctcYearNowINR: p.now.ctcMonthINR * 12,
				ctcYearNewINR: p.next.ctcMonthINR * 12,
				changeMonthINR: p.next.ctcMonthINR - p.now.ctcMonthINR,
				changePct: p.changePct,
				checks: p.checks,
			});
		}
		return out;
	}

	/** SR3: Accept the rows selected, each as SR2 would; one refused does not stop the others. */
	async accept(
		input: IncrementRowsInput,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<IncrementRowResult[]> {
		const out: IncrementRowResult[] = [];
		for (const row of input.rows) {
			try {
				await this.revisions.accept(row.employeeId, this.revision(input, row), principal);
				out.push({ employeeId: row.employeeId, ok: true, problem: null });
			} catch (error) {
				out.push({ employeeId: row.employeeId, ok: false, problem: problemOf(error) });
			}
		}
		return out;
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/payroll')
export class IncrementsController {
	constructor(private readonly increments: IncrementsService) {}

	@Get('increment-plans')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'payrollIncrementPlans', summary: 'Increment plans saved by name (SR3)' })
	plans() {
		return this.increments.plansList();
	}

	@Put('increment-plans')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollIncrementPlanSave', summary: 'Save an increment plan by its name (SR3)' })
	savePlan(@Body(new ZodValidationPipe(IncrementPlanWrite)) body: IncrementPlanWrite) {
		return this.increments.savePlan(body);
	}

	@Delete('increment-plans/:id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollIncrementPlanDelete', summary: 'Remove an increment plan (SR3)' })
	deletePlan(@Param('id') id: string) {
		return this.increments.deletePlan(id);
	}

	@Post('increments/preview')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollIncrementsPreview', summary: 'Work out an increment cycle (SR3)' })
	preview(@Body(new ZodValidationPipe(IncrementRowsInput)) body: IncrementRowsInput) {
		return this.increments.preview(body);
	}

	@Post('increments/accept')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollIncrementsAccept', summary: 'Accept an increment cycle’s rows (SR3)' })
	accept(
		@Body(new ZodValidationPipe(IncrementRowsInput)) body: IncrementRowsInput,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.increments.accept(body, principal);
	}
}
