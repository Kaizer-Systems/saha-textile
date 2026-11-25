import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Body,
	ConflictException,
	Controller,
	Inject,
	Injectable,
	NotFoundException,
	Param,
	Post,
	Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	PayslipEditsInput,
	type Employee,
	type PayrollRow,
	type PayrollRun,
	type PayslipByRules,
} from '@saha-textile/contracts';
import {
	minimumWageShortfall,
	NO_EDITS,
	payslipChecks,
	payslipFromLines,
	pfEstablishmentCharges,
	ptPersonOf,
	statePt,
	stateRulesFor,
	type AuditLogRepository,
	type EmployeeRepository,
	type PayrollRules,
	type PayrollRunRepository,
	type PayrollSchemes,
	type SalaryStructure,
	type StateRules,
} from '@saha-textile/core-domain';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AUDIT_LOG_REPOSITORY, EMPLOYEE_REPOSITORY, PAYROLL_RUN_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { API_TAGS } from '../openapi-tags';
import { PayrollRulesService } from './payroll-rules.service';
import { SalaryRevisionsService } from './salary-revisions';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const monthEnd = (month: string) =>
	`${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** The payslip as the rules made it, kept the first time it is edited. */
export function byRulesOf(row: PayrollRow): PayslipByRules {
	return {
		headsPaise: { ...(row.headsPaise ?? {}) },
		grossPaise: row.grossPaise,
		pfEmployeePaise: row.pfEmployeePaise,
		pfEmployerPaise: row.pfEmployerPaise,
		esiEmployeePaise: row.esiEmployeePaise,
		esiEmployerPaise: row.esiEmployerPaise,
		ptPaise: row.ptPaise,
		tdsPaise: row.tdsPaise,
		advancePaise: row.advancePaise,
		netPaise: row.netPaise,
	};
}

/** Nothing typed over, nothing added: the payslip is the rules' again. */
const unedited = (e: PayslipEditsInput) =>
	!Object.values(e.heads).some((v) => v !== undefined) &&
	!Object.values(e.deductions).some((v) => v !== undefined) &&
	!e.added.length;

/**
 * Brief 26 PE2: a row with its edits applied: the payslip worked out from its lines (the rules' heads, typed over and
 * added to), its checks, and the payslip by the rules kept beside it. Edits that change nothing restore the rules'.
 */
export function applyEdits(
	row: PayrollRow,
	edits: PayslipEditsInput,
	ctx: { e: Employee; month: string; rules: PayrollRules; stateRules: StateRules | null },
): PayrollRow {
	const base: PayslipByRules = row.byRules ?? byRulesOf(row);
	const { edits: _e, byRules: _b, checks: _c, otherDeductionsPaise: _o, reimbursementsPaise: _r, ...plain } = row;
	if (unedited(edits)) return { ...plain, ...restore(base) };
	const person = ptPersonOf(ctx.e, ctx.month);
	// The State's tax on a changed gross; the run's own figure while the gross is the rules'.
	const ptFor = (gross: number) =>
		gross === base.grossPaise
			? base.ptPaise
			: ctx.stateRules
				? statePt(ctx.month, gross, ctx.stateRules, person)
				: 0;
	const head = (h: keyof SalaryStructure) => base.headsPaise[h] ?? 0;
	const rulesHeads: SalaryStructure = {
		basic: head('basic'),
		da: head('da'),
		hra: head('hra'),
		conveyance: head('conveyance'),
		special: head('special'),
		other: head('other'),
	};
	const common = {
		rulesHeads,
		pfOn: ctx.e.pfOn,
		esiOn: ctx.e.esiOn,
		rules: ctx.rules,
		ptFor,
		tdsPaise: base.tdsPaise,
		advancePaise: base.advancePaise,
	};
	const lines = payslipFromLines({ ...common, edits });
	const byRules = payslipFromLines({ ...common, edits: NO_EDITS });
	const checks = payslipChecks({
		edited: lines,
		byRules,
		edits,
		ptFor,
		minimumWageShortfallPaise: minimumWageShortfall(
			lines.heads,
			ctx.e.skillLevel,
			ctx.stateRules?.minimumWages,
			monthEnd(ctx.month),
		),
	});
	const lwf = plain.lwfEmployeePaise ?? 0;
	return {
		...plain,
		grossPaise: lines.grossPaise,
		pfWagesPaise: lines.pfWagesPaise,
		pfEmployeePaise: lines.pfEmployeePaise,
		pfEmployerPaise: lines.pfEmployerPaise,
		epsPaise: lines.epsPaise,
		esiEmployeePaise: lines.esiEmployeePaise,
		esiEmployerPaise: lines.esiEmployerPaise,
		ptPaise: lines.ptPaise,
		tdsPaise: lines.tdsPaise,
		advancePaise: lines.advancePaise,
		netPaise: lines.netPaise - lwf,
		headsPaise: lines.heads,
		otherDeductionsPaise: lines.otherDeductionsPaise,
		reimbursementsPaise: lines.reimbursementsPaise,
		edits,
		byRules: base,
		checks,
	};
}

/** The rules' figures back on a row whose edits were all undone. */
function restore(b: PayslipByRules): Partial<PayrollRow> {
	return {
		headsPaise: b.headsPaise,
		grossPaise: b.grossPaise,
		pfEmployeePaise: b.pfEmployeePaise,
		pfEmployerPaise: b.pfEmployerPaise,
		esiEmployeePaise: b.esiEmployeePaise,
		esiEmployerPaise: b.esiEmployerPaise,
		ptPaise: b.ptPaise,
		tdsPaise: b.tdsPaise,
		advancePaise: b.advancePaise,
		netPaise: b.netPaise,
	};
}

/** The employer's EPF admin charges and EDLI on the run's rows as they stand. */
export function chargesOf(rows: readonly PayrollRow[], pay: PayrollRules, schemes: PayrollSchemes) {
	return pfEstablishmentCharges(
		rows.filter((r) => r.pfEmployeePaise > 0).map((r) => Math.min(r.pfWagesPaise, pay.pfWageCapPaise)),
		schemes,
	);
}

/**
 * Editing payslips before publishing (brief 26 PE2; approved 2026-11-26): on a draft run only, by someone who may
 * edit; each edit works the payslip out again, keeps its checks on the row, and is written to the audit log with who,
 * when, the lines changed and why.
 */
@Injectable()
export class PayslipEditsService {
	constructor(
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'get' | 'save'>,
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: Pick<EmployeeRepository, 'get' | 'save'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(SalaryRevisionsService) private readonly revisions: Pick<SalaryRevisionsService, 'accept'>,
	) {}

	/**
	 * PE4 "Yes", PE-D3: a published run's edited figures kept as each person's salary from the next month: the heads
	 * typed (for a whole month) and lines added every month into the other allowance, saved as a revision (the old
	 * salary kept as a dated version), and an advance's instalment typed; one-off lines never carry. A person refused
	 * keeps the refusal on their result; the others go on.
	 */
	async keep(
		month: string,
		employeeIds: readonly string[],
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<{ employeeId: string; ok: boolean; problem: string | null }[]> {
		const run = await this.runs.get(month);
		if (!run) throw new NotFoundException(accountsRefusal('payroll_run_not_found'));
		if (run.status === 'draft') throw refuse('payroll_run_not_published');
		const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
			.toISOString()
			.slice(0, 10);
		const days = Number(monthEnd(month).slice(8));
		const out: { employeeId: string; ok: boolean; problem: string | null }[] = [];
		for (const id of employeeIds) {
			const row = run.rows.find((r) => r.employeeId === id);
			const e = await this.employees.get(id);
			if (!row?.edits || !e) {
				out.push({ employeeId: id, ok: false, problem: 'payroll_row_not_found' });
				continue;
			}
			const edits = row.edits;
			// A head typed for the days paid, as a whole month's.
			const whole = (paise: number) =>
				(row.paidDays > 0 ? Math.round((paise * days) / row.paidDays) : paise) / 100;
			const recurring = edits.added
				.filter((l) => !l.oneOff && ['taxable', 'exempt'].includes(l.kind))
				.reduce((sum, l) => sum + l.paise, 0);
			const structure = { ...e.structure };
			for (const h of ['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const) {
				const typed = edits.heads[h];
				if (typed !== undefined) structure[h] = whole(typed);
			}
			structure.other += whole(recurring);
			try {
				const headsChanged = Object.values(edits.heads).some((v) => v !== undefined) || recurring > 0;
				if (headsChanged) {
					await this.revisions.accept(
						id,
						{
							way: { kind: 'heads', structure },
							from: next,
							templateId: null,
							typed: {},
							lockCtc: false,
							reason: `Kept from the payslip of ${month}`,
							agreed: true,
						},
						principal,
						now,
					);
				}
				const advance = edits.deductions.advance;
				if (advance !== undefined) {
					const latest = (await this.employees.get(id)) as Employee;
					await this.employees.save(
						{ ...latest, advancePerMonthINR: advance / 100, updatedAt: now.toISOString() },
						latest.version,
					);
				}
				out.push({ employeeId: id, ok: true, problem: null });
			} catch (error) {
				out.push({
					employeeId: id,
					ok: false,
					problem: (error as { response?: { message?: unknown } }).response?.message?.toString() ?? 'failed',
				});
			}
		}
		return out;
	}

	async edit(
		month: string,
		employeeId: string,
		edits: PayslipEditsInput,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<PayrollRun> {
		const run = await this.runs.get(month);
		if (!run) throw new NotFoundException(accountsRefusal('payroll_run_not_found'));
		if (run.status !== 'draft') throw refuse('payroll_run_approved');
		const row = run.rows.find((r) => r.employeeId === employeeId);
		const e = await this.employees.get(employeeId);
		if (!row || !e) throw new NotFoundException(accountsRefusal('payroll_row_not_found'));
		const { pay, schemes, states } = await this.rules.forMonth(month);
		const next = applyEdits(row, edits, {
			e,
			month,
			rules: pay,
			stateRules: stateRulesFor(states, row.stateCode ?? e.ptState),
		});
		const rows = run.rows.map((r) => (r.employeeId === employeeId ? next : r));
		const charges = chargesOf(rows, pay, schemes);
		let saved: PayrollRun;
		try {
			saved = await this.runs.save(
				{
					...run,
					rows,
					pfAdminPaise: charges.adminPaise,
					edliPaise: charges.edliPaise,
					updatedAt: now.toISOString(),
				},
				run.version,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'payroll_run_changed')
				throw new ConflictException(accountsRefusal('payroll_run_changed'));
			throw error;
		}
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: principal?.userId ?? null,
			targetUserId: null,
			audience: 'admin',
			action: 'payroll.payslip.edit',
			entityType: 'payrollRun',
			entityId: run.id,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: {
				month,
				employeeId,
				lines: [
					...Object.keys(edits.heads),
					...Object.keys(edits.deductions),
					...edits.added.map((l) => l.name),
				],
				reasons: edits.reasons,
				netBeforePaise: row.netPaise,
				netAfterPaise: next.netPaise,
			},
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now.toISOString(),
		});
		return saved;
	}
}

const KeepFigures = z.object({ employeeIds: z.array(z.string().min(1)).min(1).max(500) });
const RowParams = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), employeeId: z.string().min(1) });

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/payroll/runs/:month')
export class PayslipEditsController {
	constructor(private readonly edits: PayslipEditsService) {}

	@Post('keep-figures')
	@RequirePermissions('accounts.edit')
	@ApiOperation({
		operationId: 'payrollKeepFigures',
		summary: 'Keep a published run’s edited figures as the salary (PE4)',
	})
	keep(
		@Param('month') month: string,
		@Body(new ZodValidationPipe(KeepFigures)) body: z.infer<typeof KeepFigures>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.edits.keep(month, body.employeeIds, principal);
	}

	@Put('rows/:employeeId/edits')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollPayslipEdit', summary: 'Edit a payslip on a draft run (PE2)' })
	edit(
		@Param(new ZodValidationPipe(RowParams)) p: z.infer<typeof RowParams>,
		@Body(new ZodValidationPipe(PayslipEditsInput)) body: PayslipEditsInput,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.edits.edit(p.month, p.employeeId, body, principal);
	}
}
