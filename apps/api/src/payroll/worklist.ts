import { BadRequestException, Body, Controller, Get, Header, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorklistAnswer, type Employee, type WorklistRow } from '@saha-textile/contracts';
import {
	minimumWageShortfall,
	ruleFor,
	stateRulesFor,
	type AdjustmentRequestRepository,
	type EmployeeRepository,
	type LocationRepository,
	type PayrollRunRepository,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	ADJUSTMENT_REQUEST_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { API_TAGS } from '../openapi-tags';
import { AttendanceDaysService } from './attendance-days';
import { PayrollRulesService } from './payroll-rules.service';

const paise = (inr: number) => Math.round(inr * 100);
const istDay = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * The worklist (brief 26 WL1, WL2; approved 2026-11-26): rows worked out from their own places for the signed-in
 * person, each only for those with the permission it needs (within their stores where it has one): attendance
 * changes and leave asked for (✓ ✕ in the row), payslips on a draft with a blocking check, salaries under the State's
 * minimum wage (PE5), opening leave carried above a type's cap, and stock write-offs and counts waiting (Stock ›
 * Approvals, opened there). A row leaves once its item is done; the first to act closes it for all.
 */
@Injectable()
export class WorklistService {
	constructor(
		@Inject(AttendanceDaysService) private readonly attendance: Pick<AttendanceDaysService, 'pending' | 'decide'>,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'list'>,
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: Pick<EmployeeRepository, 'list'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY) private readonly stock: Pick<AdjustmentRequestRepository, 'list'>,
	) {}

	async rows(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<WorklistRow[]> {
		const may = (code: string) => !!principal?.permissions.includes(code);
		const people = may('attendance.approve') || may('accounts.edit') ? await this.employees.list() : [];
		const name = (id: string) => people.find((e) => e.id === id)?.name ?? id;
		const out: WorklistRow[] = [];
		if (may('attendance.approve'))
			for (const d of await this.attendance.pending(principal)) {
				const p = d.pending as NonNullable<typeof d.pending>;
				const leave = !!p.leaveKey && (p.status === 'leave' || p.status === 'half');
				out.push({
					id: `${leave ? 'leave_asked' : 'attendance_change'}:${d.id}`,
					kind: leave ? 'leave_asked' : 'attendance_change',
					needs: 'approve',
					area: 'payroll',
					params: {
						name: name(d.employeeId),
						day: d.day,
						from: d.status,
						to: p.status,
						leave: p.leaveKey ?? '',
					},
					askedBy: p.askedBy,
					since: p.askedAt,
					open: {
						path: ['/payroll/attendance'],
						query: {
							month: d.day.slice(0, 7),
							locationId: d.locationId,
							employeeId: d.employeeId,
							day: d.day,
						},
					},
					answerable: true,
				});
			}
		if (may('accounts.edit')) {
			for (const run of (await this.runs.list()).filter((r) => r.status === 'draft'))
				for (const r of run.rows.filter((x) => x.checks?.some((c) => c.blocking)))
					out.push({
						id: `payslip_blocking:${run.month}_${r.employeeId}`,
						kind: 'payslip_blocking',
						needs: 'fix',
						area: 'payroll',
						params: { name: r.name, month: run.month },
						askedBy: null,
						since: run.updatedAt,
						open: { path: ['/payroll/runs', run.month, 'payslips', r.employeeId, 'edit'], query: {} },
						answerable: false,
					});
			out.push(
				...(await this.peopleRows(
					people.filter((e) => !e.leftOn),
					now,
				)),
			);
		}
		if (may('stock.approve')) {
			const page = await this.stock.list({ status: 'pending', page: 1, pageSize: 100 });
			for (const a of page.items)
				out.push({
					id: `stock_approval:${a.id}`,
					kind: 'stock_approval',
					needs: 'approve',
					area: 'stock',
					params: { title: a.title, quantity: a.quantity, kind: a.kind },
					askedBy: a.requestedByName ?? a.requestedBy,
					since: a.requestedAt,
					open: { path: ['/stock/approvals'], query: { id: a.id } },
					answerable: false,
				});
		}
		return out.sort((a, b) => b.since.localeCompare(a.since));
	}

	/** PE5 and OB: salaries under the State's minimum wage, and opening leave carried above a type's cap. */
	private async peopleRows(people: readonly Employee[], now: Date): Promise<WorklistRow[]> {
		const today = istDay(now);
		const { states } = await this.rules.forMonth(today.slice(0, 7));
		const stateOf = new Map((await this.locations.list()).map((l) => [l.id, l.stateCode]));
		return people.flatMap((e): WorklistRow[] => {
			const state = stateRulesFor(states, stateOf.get(e.locationId) ?? e.ptState);
			const s = e.structure;
			const short = minimumWageShortfall(
				{
					basic: paise(s.basic),
					da: paise(s.da),
					hra: paise(s.hra),
					special: paise(s.special),
					conveyance: paise(s.conveyance),
					other: paise(s.other),
				},
				e.skillLevel,
				state?.minimumWages,
				today,
			);
			const rows: WorklistRow[] = short
				? [
						{
							id: `salary_below_minimum:${e.id}`,
							kind: 'salary_below_minimum',
							needs: 'fix',
							area: 'payroll',
							params: { name: e.name, short: short / 100 },
							askedBy: null,
							since: e.updatedAt,
							open: { path: ['/payroll/employees'], query: { employeeId: e.id } },
							answerable: false,
						},
					]
				: [];
			for (const o of e.openingLeave ?? []) {
				const type = state?.leaveTypes?.find((t) => t.key === o.typeKey);
				const rule = type ? ruleFor(type, e) : null;
				// Leave that never lapses (maternity) has no cap to pass.
				const cap = rule && rule.validity.kind !== 'never' ? rule.carryMax : null;
				const carried = o.carried ?? 0;
				if (cap === null || carried <= cap) continue;
				rows.push({
					id: `opening_leave_over_cap:${e.id}_${o.typeKey}`,
					kind: 'opening_leave_over_cap',
					needs: 'check',
					area: 'payroll',
					params: { name: e.name, leave: o.typeKey, carried, cap },
					askedBy: null,
					since: e.createdAt,
					open: { path: ['/payroll/employees'], query: { employeeId: e.id } },
					answerable: false,
				});
			}
			return rows;
		});
	}

	/** The bell's count. */
	async count(principal: AuthenticatedPrincipal | undefined): Promise<{ count: number }> {
		return { count: (await this.rows(principal)).length };
	}

	/** ✓ or ✕ in a row: only yes-or-no items (attendance changes and leave asked for, by day). */
	async answer(principal: AuthenticatedPrincipal | undefined, id: string, approve: boolean): Promise<{ done: true }> {
		const [kind, ref] = id.split(':') as [string, string | undefined];
		const at = ref?.lastIndexOf('_') ?? -1;
		if ((kind !== 'attendance_change' && kind !== 'leave_asked') || !ref || at < 1)
			throw new BadRequestException(accountsRefusal('worklist_not_answerable'));
		await this.attendance.decide(principal, ref.slice(0, at), ref.slice(at + 1), approve);
		return { done: true };
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/worklist')
export class WorklistController {
	constructor(private readonly worklist: WorklistService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'worklist', summary: 'Everything waiting on me (WL1)' })
	rows(@Principal() principal?: AuthenticatedPrincipal) {
		return this.worklist.rows(principal);
	}

	@Get('count')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'worklistCount', summary: 'How many items wait on me, for the bell (WL1)' })
	count(@Principal() principal?: AuthenticatedPrincipal) {
		return this.worklist.count(principal);
	}

	@Post(':id/approve')
	@ApiOperation({ operationId: 'worklistApprove', summary: 'Answer a yes-or-no row with ✓ (WL1)' })
	approve(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.worklist.answer(principal, id, true);
	}

	@Post(':id/reject')
	@ApiOperation({ operationId: 'worklistReject', summary: 'Answer a yes-or-no row with ✕, with a reason (WL1)' })
	reject(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(WorklistAnswer)) _body: WorklistAnswer,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.worklist.answer(principal, id, false);
	}
}
