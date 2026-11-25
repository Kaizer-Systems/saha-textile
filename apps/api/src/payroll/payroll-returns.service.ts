import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Employee,
	Payslip,
	PayrollRow,
	PayrollRun,
	SchemeLine,
	StatutoryFile,
	StatutoryFiling,
	StatutoryKind,
	StatutoryReturn,
} from '@saha-textile/contracts';
import {
	SALARY_HEADS,
	GST_STATES,
	csvText,
	ecrFile,
	financialYearOf,
	esicFile,
	ifscBank,
	payslipHeads,
	rupeesInWords,
	schemeLines,
	stateDue,
	stateRulesFor,
	statutoryDue,
	structureTotal,
	tdsQuarter,
	type EmployeeRepository,
	type LocationRepository,
	type PayrollRunRepository,
	type ShopDetailsRepository,
	type StatutoryFilingRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	EMPLOYEE_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
	STATUTORY_FILING_REPOSITORY,
} from '../infra/tokens';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { payslipData } from '../documents/payslip-print';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { PayrollAdvancesService } from './payroll-advances.service';
import { PayrollRulesService } from './payroll-rules.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
const whole = (p: number) => Math.round(p / 100);
const daysIn = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const istMonth = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
const sum = (rows: readonly PayrollRow[], pick: (r: PayrollRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
const structurePaise = (e: Employee) => ({
	basic: paise(e.structure.basic),
	da: paise(e.structure.da),
	hra: paise(e.structure.hra),
	special: paise(e.structure.special),
	conveyance: paise(e.structure.conveyance),
	other: paise(e.structure.other),
});

/** What each monthly return collects from a run's rows (paise). */
const MONTHLY: Record<Exclude<StatutoryKind, 'tds'>, (rows: readonly PayrollRow[], run: PayrollRun) => number> = {
	pf: (rows, run) =>
		sum(rows, (r) => r.pfEmployeePaise + r.pfEmployerPaise) + (run.pfAdminPaise ?? 0) + (run.edliPaise ?? 0),
	esi: (rows) => sum(rows, (r) => r.esiEmployeePaise + r.esiEmployerPaise),
	pt: (rows) => sum(rows, (r) => r.ptPaise),
	lwf: (rows) => sum(rows, (r) => (r.lwfEmployeePaise ?? 0) + (r.lwfEmployerPaise ?? 0)),
};
/** A row's State: the one its run saved, or (runs before States) the State saved on the person then. */
const LEGACY_STATE = '19';
const stateOfRow = (r: PayrollRow) => r.stateCode ?? LEGACY_STATE;
/** A filing's key: professional tax and the welfare fund are filed per State. */
const filingKey = (kind: StatutoryKind, period: string, stateCode: string | null) =>
	kind === 'pt' || kind === 'lwf' ? `${kind}:${period}:${stateCode ?? LEGACY_STATE}` : `${kind}:${period}`;

/**
 * Payslips (S6), which schemes apply (S2) and the statutory returns (S7): PF ECR, ESI, professional tax and the labour
 * welfare fund each month, TDS on salary each quarter; each with its due day, its portal file and a filed mark.
 */
@Injectable()
export class PayrollReturnsService {
	constructor(
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'list' | 'get'>,
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: Pick<EmployeeRepository, 'list'>,
		@Inject(STATUTORY_FILING_REPOSITORY) private readonly filings: StatutoryFilingRepository,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'get'>,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: Pick<ShopDetailsRepository, 'get'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(PayrollAdvancesService) private readonly advances: Pick<PayrollAdvancesService, 'schedule'>,
		@Inject(DocumentFormatsService)
		private readonly formats: Pick<DocumentFormatsService, 'seller' | 'renderActiveCopies'>,
	) {}

	/**
	 * PS4: one person's payslip, or every payslip of the run each on its own page, in the active payslip format. The
	 * year to date adds their earlier runs of the financial year.
	 */
	async payslipsPdf(month: string, employeeId: string | null): Promise<{ fileName: string; data: Uint8Array }> {
		const run = await this.postedRun(month);
		const rows = employeeId ? run.rows.filter((r) => r.employeeId === employeeId) : run.rows;
		const [first] = rows;
		if (!first) throw new NotFoundException(accountsRefusal('payslip_not_found'));
		const year = financialYearOf(month);
		const fyStart = `${year.slice(0, 4)}-04`;
		const earlier = (await this.runs.list()).filter((r) => r.month >= fyStart && r.month < month);
		const people = new Map((await this.employees.list()).map((e) => [e.id, e]));
		const seller = await this.formats.seller(previewDocument('payslip').seller);
		const page = async (row: PayrollRow) => {
			const state = row.stateCode ?? '19';
			return payslipData({
				seller,
				month,
				year,
				row,
				earlier: earlier.flatMap((r) => r.rows.filter((x) => x.employeeId === row.employeeId)),
				employee: people.get(row.employeeId) ?? null,
				locationName: (await this.locations.get(row.locationId))?.name ?? '',
				stateName: GST_STATES.find((s) => s.code === state)?.name ?? state,
				daysInMonth: daysIn(month),
				paidOn: run.paidOn ?? null,
				rulesFrom: run.rulesFrom,
			});
		};
		const head = await page(first);
		const rest = await Promise.all(rows.slice(1).map(page));
		return {
			fileName: employeeId
				? `payslip-${month}-${first.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`
				: `payslips-${month}.pdf`,
			data: await this.formats.renderActiveCopies('payslip', [head, ...rest]),
		};
	}

	/** S2: the schemes for a month, from who is on the roll and what they earn. */
	async schemes(month: string): Promise<SchemeLine[]> {
		const { pay, schemes } = await this.rules.forMonth(month);
		const start = `${month}-01`;
		const end = `${month}-${String(daysIn(month)).padStart(2, '0')}`;
		const onRoll = (await this.employees.list()).filter(
			(e) => e.joinedOn <= end && (!e.leftOn || e.leftOn >= start),
		);
		return schemeLines(
			{
				headcount: onRoll.length,
				esiEligible: onRoll.filter((e) => structureTotal(structurePaise(e)) <= pay.esiGrossLimitPaise).length,
				pfOnAny: onRoll.some((e) => e.pfOn),
			},
			schemes,
		);
	}

	private async postedRun(month: string): Promise<PayrollRun> {
		const run = await this.runs.get(month);
		if (!run) throw new NotFoundException(accountsRefusal('payroll_run_not_found'));
		return run;
	}

	/** S6: one person's payslip from a run; the heads come from the run so a reprint never changes. */
	async payslip(month: string, employeeId: string): Promise<Payslip> {
		const run = await this.postedRun(month);
		const row = run.rows.find((r) => r.employeeId === employeeId);
		if (!row) throw new NotFoundException(accountsRefusal('payslip_not_found'));
		const employee = (await this.employees.list()).find((e) => e.id === employeeId);
		const { pay } = await this.rules.forMonth(month);
		const days = daysIn(month);
		const heads =
			row.headsPaise ??
			(employee ? payslipHeads(structurePaise(employee), days, row.paidDays, row.grossPaise) : {});
		const shop = await this.shop.get();
		const location = await this.locations.get(row.locationId);
		const schedule = row.advancePaise ? await this.advances.schedule(employeeId) : null;
		const recoveries = schedule?.rows.filter((r) => r.recoveredPaise > 0) ?? [];
		const n = recoveries.findIndex((r) => r.month === month) + 1;
		const deductions: Payslip['deductions'] = [
			{
				key: 'pf' as const,
				paise: row.pfEmployeePaise,
				wagesPaise: Math.min(row.pfWagesPaise, pay.pfWageCapPaise),
				recovery: null,
			},
			{ key: 'esi' as const, paise: row.esiEmployeePaise, wagesPaise: null, recovery: null },
			{ key: 'pt' as const, paise: row.ptPaise, wagesPaise: null, recovery: null },
			{ key: 'tds' as const, paise: row.tdsPaise, wagesPaise: null, recovery: null },
			{ key: 'lwf' as const, paise: row.lwfEmployeePaise ?? 0, wagesPaise: null, recovery: null },
			{
				key: 'advance' as const,
				paise: row.advancePaise,
				wagesPaise: null,
				recovery: n > 0 ? { n, of: recoveries.length } : null,
			},
		].filter((d) => d.paise > 0);
		const total = deductions.reduce((s, d) => s + d.paise, 0);
		const last4 = employee?.bankAccount.slice(-4) ?? '';
		return {
			month,
			company: shop?.legalName || shop?.tradeName || '',
			employeeId,
			name: row.name,
			code: employee?.code ?? '',
			location: location?.name ?? '',
			uan: employee?.uan ?? '',
			daysInMonth: days,
			paidDays: row.paidDays,
			earnings: SALARY_HEADS.filter((h) => (heads[h] ?? 0) > 0).map((h) => ({
				head: h,
				paise: heads[h] as number,
			})),
			grossPaise: row.grossPaise,
			deductions,
			totalDeductionsPaise: total,
			netPaise: row.netPaise,
			netWords: rupeesInWords(row.netPaise / 100),
			paidTo: last4 && employee ? { bank: ifscBank(employee.ifsc) ?? employee.ifsc, last4 } : null,
			paidOn: run.paidOn ?? null,
			rulesFrom: run.rulesFrom,
			schemesFrom: run.schemesFrom ?? null,
			status: run.status,
		};
	}

	/** S7: every return from posted payrolls, monthly ones and TDS by quarter, filed or not, by due day. */
	async returns(now = new Date()): Promise<StatutoryReturn[]> {
		const runs = (await this.runs.list()).filter((r) => r.status === 'posted' || r.status === 'paid');
		const filed = new Map(
			(await this.filings.list()).map((f) => [filingKey(f.kind, f.period, f.stateCode ?? null), f]),
		);
		const out: StatutoryReturn[] = [];
		const row = (
			kind: StatutoryKind,
			period: string,
			periodTo: string,
			due: string,
			amount: number,
			over: boolean,
			stateCode: string | null = null,
		) => {
			const filing = filed.get(filingKey(kind, period, stateCode));
			out.push({
				kind,
				stateCode,
				period,
				periodTo,
				due,
				amountPaise: amount,
				status: filing ? 'filed' : over ? 'ready' : 'later',
				filedOn: filing?.filedOn ?? null,
				reference: filing?.reference ?? '',
			});
		};
		for (const run of runs) {
			const { schemes, states } = await this.rules.forMonth(run.month);
			for (const kind of ['pf', 'esi'] as const) {
				const amount = MONTHLY[kind](run.rows, run);
				if (amount > 0) row(kind, run.month, run.month, statutoryDue(kind, run.month, schemes), amount, true);
			}
			// ST2: professional tax and the welfare fund go to each State, on its own day.
			for (const stateCode of [...new Set(run.rows.map(stateOfRow))].sort())
				for (const kind of ['pt', 'lwf'] as const) {
					const amount = MONTHLY[kind](
						run.rows.filter((r) => stateOfRow(r) === stateCode),
						run,
					);
					const rules = stateRulesFor(states, stateCode);
					const due = rules ? stateDue(kind, run.month, rules) : statutoryDue(kind, run.month, schemes);
					if (amount > 0) row(kind, run.month, run.month, due, amount, true, stateCode);
				}
		}
		const quarters = new Map<string, PayrollRun[]>();
		for (const run of runs) {
			const q = tdsQuarter(run.month).from;
			quarters.set(q, [...(quarters.get(q) ?? []), run]);
		}
		const current = istMonth(now);
		for (const [from, inQuarter] of quarters) {
			const q = tdsQuarter(from);
			row(
				'tds',
				q.from,
				q.to,
				q.due,
				sum(
					inQuarter.flatMap((r) => r.rows),
					(r) => r.tdsPaise,
				),
				q.to < current,
			);
		}
		return out.sort(
			(a, b) =>
				a.due.localeCompare(b.due) ||
				a.kind.localeCompare(b.kind) ||
				(a.stateCode ?? '').localeCompare(b.stateCode ?? ''),
		);
	}

	/** S7: the file a portal takes for a return; professional tax and the welfare fund for one State. */
	async file(kind: StatutoryKind, period: string, stateCode: string | null = null): Promise<StatutoryFile> {
		const people = new Map((await this.employees.list()).map((e) => [e.id, e]));
		const who = (r: PayrollRow) => people.get(r.employeeId);
		if (kind === 'tds') {
			const q = tdsQuarter(period);
			const runs = (await this.runs.list()).filter(
				(r) => r.month >= q.from && r.month <= q.to && (r.status === 'posted' || r.status === 'paid'),
			);
			const lines = runs
				.sort((a, b) => a.month.localeCompare(b.month))
				.flatMap((run) =>
					run.rows
						.filter((r) => r.tdsPaise > 0)
						.map((r) => [
							who(r)?.pan ?? '',
							r.name,
							run.month,
							run.paidOn ?? '',
							whole(r.grossPaise),
							whole(r.tdsPaise),
						]),
				);
			return {
				fileName: `24Q-${q.from}-to-${q.to}.csv`,
				text: csvText(['PAN', 'Employee', 'Month', 'Paid on', 'Salary paid', 'TDS deducted'], lines),
			};
		}
		const run = await this.postedRun(period);
		if (run.status !== 'posted' && run.status !== 'paid') throw refuse('payroll_not_posted');
		if (kind === 'pf') {
			const { pay } = await this.rules.forMonth(period);
			const days = daysIn(period);
			return {
				fileName: `ECR-${period}.txt`,
				text: ecrFile(
					run.rows
						.filter((r) => r.pfEmployeePaise > 0)
						.map((r) => {
							const wages = Math.min(r.pfWagesPaise, pay.pfWageCapPaise);
							return {
								uan: who(r)?.uan ?? '',
								name: r.name,
								grossPaise: r.grossPaise,
								epfWagesPaise: wages,
								epsWagesPaise: r.epsPaise ? wages : 0,
								edliWagesPaise: wages,
								employeePaise: r.pfEmployeePaise,
								epsPaise: r.epsPaise,
								employerDiffPaise: r.pfEmployerPaise - r.epsPaise,
								ncpDays: Math.max(0, days - r.paidDays),
								refundPaise: 0,
							};
						}),
				),
			};
		}
		if (kind === 'esi') {
			const start = `${period}-01`;
			return {
				fileName: `ESIC-${period}.csv`,
				text: esicFile(
					run.rows
						.filter((r) => r.esiEmployeePaise > 0)
						.map((r) => {
							const leftOn = who(r)?.leftOn ?? null;
							return {
								ipNumber: who(r)?.esiNumber ?? '',
								name: r.name,
								paidDays: r.paidDays,
								grossPaise: r.grossPaise,
								leftOn: leftOn && leftOn >= start ? leftOn : null,
							};
						}),
				),
			};
		}
		const inState = run.rows.filter((r) => stateOfRow(r) === (stateCode ?? LEGACY_STATE));
		if (kind === 'pt')
			return {
				fileName: `PT-${stateCode ?? LEGACY_STATE}-${period}.csv`,
				text: csvText(
					['Employee', 'PAN', 'Gross salary', 'Professional tax'],
					inState
						.filter((r) => r.ptPaise > 0)
						.map((r) => [r.name, who(r)?.pan ?? '', whole(r.grossPaise), whole(r.ptPaise)]),
				),
			};
		return {
			fileName: `LWF-${stateCode ?? LEGACY_STATE}-${period}.csv`,
			text: csvText(
				['Employee', 'Employee share', 'Employer share'],
				inState
					.filter((r) => (r.lwfEmployeePaise ?? 0) > 0)
					.map((r) => [r.name, whole(r.lwfEmployeePaise as number), whole(r.lwfEmployerPaise ?? 0)]),
			),
		};
	}

	/** S7 Mark filed: once per return, after it is ready. */
	async markFiled(
		kind: StatutoryKind,
		period: string,
		write: StatutoryFiling,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<StatutoryReturn> {
		const state = kind === 'pt' || kind === 'lwf' ? (write.stateCode ?? LEGACY_STATE) : null;
		const found = (await this.returns(now)).find(
			(r) => r.kind === kind && r.period === period && r.stateCode === state,
		);
		if (!found) throw new NotFoundException(accountsRefusal('statutory_return_not_found'));
		if (found.status === 'filed') throw new ConflictException(accountsRefusal('statutory_already_filed'));
		if (found.status === 'later') throw refuse('statutory_not_due_yet');
		try {
			await this.filings.insert({
				kind,
				period,
				stateCode: state,
				filedOn: write.filedOn,
				reference: write.reference,
				filedBy: principal?.userId ?? null,
				filedAt: now.toISOString(),
			});
		} catch (error) {
			if (error instanceof Error && error.message === 'statutory_already_filed')
				throw new ConflictException(accountsRefusal('statutory_already_filed'));
			throw error;
		}
		return { ...found, status: 'filed', filedOn: write.filedOn, reference: write.reference };
	}
}
