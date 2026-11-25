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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	SalaryRevisionInput,
	type Employee,
	type SalaryRevisionPreview,
	type SalaryVersion,
} from '@saha-textile/contracts';
import {
	arrears,
	breakup,
	codeWages,
	gratuityProvision,
	minimumWageShortfall,
	monthPay,
	ptPersonOf,
	revisedCtc,
	statePt,
	stateRulesFor,
	structureFromCtc,
	structureTotal,
	typedOver,
	type AuditLogRepository,
	type CtcComponent,
	type CtcSplit,
	type EmployeeRepository,
	type EmployerCost,
	type LocationRepository,
	type PayrollRunRepository,
	type RevisionWay,
	type SalaryStructure,
	type SalaryTemplateRepository,
	type WageHead,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	AUDIT_LOG_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	SALARY_TEMPLATE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { API_TAGS } from '../openapi-tags';
import { PayrollRulesService } from './payroll-rules.service';

const paise = (inr: number) => Math.round(inr * 100);
const inr = (p: number) => p / 100;
const HEADS: readonly WageHead[] = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'];
const paiseOf = (s: Employee['structure']): SalaryStructure => ({
	basic: paise(s.basic),
	da: paise(s.da),
	hra: paise(s.hra),
	special: paise(s.special),
	conveyance: paise(s.conveyance),
	other: paise(s.other),
});
const rupeesOf = (s: SalaryStructure): Employee['structure'] => ({
	basic: inr(s.basic),
	da: inr(s.da),
	hra: inr(s.hra),
	special: inr(s.special),
	conveyance: inr(s.conveyance),
	other: inr(s.other),
});
const daysIn = (month: string) =>
	new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const nextMonth = (month: string) => {
	const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
	return d.toISOString().slice(0, 7);
};

/** The way in, in paise. */
function wayOf(input: SalaryRevisionInput): RevisionWay {
	const w = input.way;
	if (w.kind === 'percent') return w;
	if (w.kind === 'amount') return { kind: 'amount', monthPaise: paise(w.monthINR) };
	if (w.kind === 'ctc') return { kind: 'ctc', yearPaise: paise(w.yearINR) };
	return { kind: 'heads', structure: paiseOf(w.structure) };
}

/**
 * A person's own structure as a CTC split, for someone with no CTC template: each head the share of the CTC it holds
 * now, the special allowance (else the largest allowance) taking the rest.
 */
function ownSplit(now: SalaryStructure, ctcPaise: number): CtcComponent[] {
	const rest: WageHead =
		now.special > 0 ? 'special' : ((['other', 'conveyance', 'hra'] as const).find((h) => now[h] > 0) ?? 'special');
	return HEADS.filter((h) => h !== rest && now[h] > 0)
		.map((h): CtcComponent => ({ head: h, how: 'percent', value: (now[h] * 100) / ctcPaise }))
		.concat({ head: rest, how: 'rest', value: 0 });
}

/**
 * Revising one person's pay (brief 26 SR2, SR4; approved 2026-11-26): four ways in (a %, an amount, a new CTC kept
 * locked, the heads typed), the person's structure splitting the new CTC, heads typed over after, a breakup of now
 * and new, arrears for months already paid, and the checks. Accept keeps the old salary as a dated version, saves the
 * new one from its day, and writes the audit record; a decrease needs the person's agreement or notice.
 */
@Injectable()
export class SalaryRevisionsService {
	constructor(
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: Pick<EmployeeRepository, 'get' | 'save'>,
		@Inject(SALARY_TEMPLATE_REPOSITORY) private readonly templates: Pick<SalaryTemplateRepository, 'get'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'list'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	private async employee(id: string): Promise<Employee> {
		const e = await this.employees.get(id);
		if (!e) throw new NotFoundException(accountsRefusal('employee_not_found'));
		return e;
	}

	/** SR2: the revision worked out: the new structure and CTC, the breakup, arrears and checks. */
	private async working(e: Employee, input: SalaryRevisionInput) {
		const month = input.from.slice(0, 7);
		const { pay: rules, schemes, states } = await this.rules.forMonth(month);
		const stateCode = (await this.locations.list()).find((l) => l.id === e.locationId)?.stateCode ?? e.ptState;
		const stateRules = stateRulesFor(states, stateCode);
		const payOf = (s: SalaryStructure) =>
			monthPay({
				structure: s,
				daysInMonth: 30,
				paidDays: 30,
				pfOn: e.pfOn,
				esiOn: e.esiOn,
				advanceDuePaise: 0,
				tdsPaise: 0,
				rules,
				ptFor: (gross) => (stateRules ? statePt(month, gross, stateRules, ptPersonOf(e, month)) : 0),
			});
		// What the employer pays inside the CTC: PF, ESI and the gratuity provision.
		const cost: EmployerCost = (s) => {
			const p = payOf(s);
			return p.pfEmployerPaise + p.esiEmployerPaise + gratuityProvision(s, true, schemes);
		};
		const now = paiseOf(e.structure);
		const nowCtc = e.ctcYearINR ? Math.round(paise(e.ctcYearINR) / 12) : structureTotal(now) + cost(now);
		const templateId = input.templateId ?? e.templateId;
		const template = templateId ? await this.templates.get(templateId) : null;
		const components: CtcComponent[] =
			template?.basis === 'ctc'
				? template.components.map((c) => ({ ...c, value: c.how === 'fixed' ? paise(c.value) : c.value }))
				: ownSplit(now, nowCtc);
		const way = wayOf(input);
		const ctc = revisedCtc(nowCtc, way, cost);
		let split: CtcSplit =
			way.kind === 'heads'
				? {
						structure: way.structure,
						grossPaise: structureTotal(way.structure),
						employerPaise: cost(way.structure),
						fits: true,
					}
				: structureFromCtc(components, ctc, cost);
		const rest = components.find((c) => c.how === 'rest')?.head ?? 'special';
		const lock = input.lockCtc && way.kind !== 'heads' ? { ctcPaise: ctc, rest } : null;
		for (const head of HEADS) {
			const typed = input.typed[head];
			if (typed === undefined) continue;
			const over = typedOver(split.structure, head, paise(typed), lock, cost);
			split = { ...over, fits: split.fits && over.fits };
		}
		const next = split.structure;
		const nextCtc = split.grossPaise + split.employerPaise;
		const take = (s: SalaryStructure) => payOf(s).netPaise;
		// SR4: months already paid from the revision's day, paid again with the next month.
		const closed = (await this.runs.list()).filter((r) => r.status !== 'draft' && r.month >= month);
		const paid = closed.flatMap((r) =>
			r.rows
				.filter((x) => x.employeeId === e.id)
				.map((x) => ({ month: r.month, paidDays: x.paidDays, daysInMonth: daysIn(r.month) })),
		);
		const due = arrears(now, next, paid);
		const latest = closed
			.map((r) => r.month)
			.sort()
			.at(-1);
		const decrease = nextCtc < nowCtc;
		const shortfall = minimumWageShortfall(next, e.skillLevel, stateRules?.minimumWages, input.from);
		const underHalf = codeWages(next) - next.basic - next.da;
		const checks: SalaryRevisionPreview['checks'] = [
			...(split.fits ? [] : [{ code: 'rest_below_zero' as const, blocking: true, inr: 0 }]),
			...(decrease && !input.agreed
				? [{ code: 'decrease_needs_agreement' as const, blocking: true, inr: 0 }]
				: []),
			...(shortfall ? [{ code: 'below_minimum_wage' as const, blocking: false, inr: inr(shortfall) }] : []),
			...(underHalf ? [{ code: 'wages_under_half' as const, blocking: false, inr: inr(underHalf) }] : []),
		];
		const side = (s: SalaryStructure, ctcPaise: number) => ({
			structure: rupeesOf(s),
			grossINR: inr(structureTotal(s)),
			employerINR: inr(ctcPaise - structureTotal(s)),
			ctcMonthINR: inr(ctcPaise),
			takeHomeINR: inr(take(s)),
		});
		const preview: SalaryRevisionPreview = {
			now: side(now, nowCtc),
			next: side(next, nextCtc),
			lines: breakup(now, next).map((l) => ({
				head: l.head,
				nowINR: inr(l.now),
				nextINR: inr(l.next),
				changeINR: inr(l.change),
			})),
			changePct: nowCtc ? Math.round(((nextCtc - nowCtc) / nowCtc) * 10_000) / 100 : 0,
			decrease,
			arrears:
				due.paise > 0 && latest ? { inr: inr(due.paise), months: due.months, paidIn: nextMonth(latest) } : null,
			checks,
		};
		return { preview, next, nextCtc, template, decrease };
	}

	/** SR2: the breakup of a revision, before it is accepted. */
	async preview(employeeId: string, input: SalaryRevisionInput): Promise<SalaryRevisionPreview> {
		return (await this.working(await this.employee(employeeId), input)).preview;
	}

	/** SR2: accept a revision: the old salary kept as a dated version, the new one saved from its day. */
	async accept(
		employeeId: string,
		input: SalaryRevisionInput,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<Employee> {
		const e = await this.employee(employeeId);
		const w = await this.working(e, input);
		const blocking = w.preview.checks.find((c) => c.blocking);
		if (blocking) throw new BadRequestException(accountsRefusal(`revision_${blocking.code}`));
		const history: SalaryVersion[] = e.salaryHistory?.length
			? [...e.salaryHistory]
			: [
					{
						from: e.joinedOn,
						structure: e.structure,
						ctcYearINR: e.ctcYearINR ?? null,
						reason: '',
						decrease: false,
						acceptedBy: null,
						acceptedAt: e.createdAt,
						arrearsPaidIn: null,
					},
				];
		if (input.from <= (history.at(-1) as SalaryVersion).from)
			throw new BadRequestException(accountsRefusal('revision_not_after_last'));
		const at = now.toISOString();
		const ctcYearINR = inr(w.nextCtc * 12);
		const version: SalaryVersion = {
			from: input.from,
			structure: rupeesOf(w.next),
			ctcYearINR,
			reason: input.reason,
			decrease: w.decrease,
			acceptedBy: principal?.userId ?? null,
			acceptedAt: at,
			arrearsPaidIn: w.preview.arrears?.paidIn ?? null,
		};
		let saved: Employee;
		try {
			saved = await this.employees.save(
				{
					...e,
					structure: version.structure,
					ctcYearINR,
					templateId: w.template?.id ?? e.templateId ?? null,
					salaryHistory: [...history, version],
					updatedAt: at,
				},
				e.version,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'employee_changed')
				throw new ConflictException(accountsRefusal('employee_changed'));
			throw error;
		}
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: version.acceptedBy,
			targetUserId: null,
			audience: 'admin',
			action: 'payroll.salary.revise',
			entityType: 'employee',
			entityId: e.id,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: {
				from: input.from,
				reason: input.reason,
				changePct: w.preview.changePct,
				ctcYearBeforeINR: inr(paise(w.preview.now.ctcMonthINR) * 12),
				ctcYearINR,
				decrease: w.decrease,
			},
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: at,
		});
		return saved;
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/payroll/employees/:id/revision')
export class SalaryRevisionsController {
	constructor(private readonly revisions: SalaryRevisionsService) {}

	@Post('preview')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollRevisionPreview', summary: 'Work out a pay revision (SR2)' })
	preview(@Param('id') id: string, @Body(new ZodValidationPipe(SalaryRevisionInput)) body: SalaryRevisionInput) {
		return this.revisions.preview(id, body);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'payrollRevisionAccept', summary: 'Accept a pay revision (SR2)' })
	accept(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SalaryRevisionInput)) body: SalaryRevisionInput,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.revisions.accept(id, body, principal);
	}
}
