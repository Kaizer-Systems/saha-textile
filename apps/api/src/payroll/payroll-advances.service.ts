import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdvanceGive, AdvanceSchedule, Employee, PayrollAdvance } from '@saha-textile/contracts';
import {
	advanceSchedule,
	resolveRole,
	type EmployeeRepository,
	type PayrollAdvanceRepository,
	type PayrollRunRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	EMPLOYEE_REPOSITORY,
	PAYROLL_ADVANCE_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);

/**
 * Advances and loans to employees (accounts brief S9). Giving one posts a payment (Staff advance Dr, the cash or bank
 * ledger Cr) and adds it to what the payroll recovers each month; the schedule shows each month's recovery, actual for
 * posted payrolls and planned after.
 */
@Injectable()
export class PayrollAdvancesService {
	constructor(
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
		@Inject(PAYROLL_ADVANCE_REPOSITORY) private readonly advances: PayrollAdvanceRepository,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'list'>,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'post'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	private async employee(id: string): Promise<Employee> {
		const employee = await this.employees.get(id);
		if (!employee) throw new NotFoundException(accountsRefusal('employee_not_found'));
		return employee;
	}

	private async scheduleFor(employee: Employee, given: PayrollAdvance[]): Promise<AdvanceSchedule> {
		const posted = (await this.runs.list()).filter((r) => r.status === 'posted' || r.status === 'paid');
		const recovered: Record<string, number> = {};
		for (const run of posted) {
			const row = run.rows.find((r) => r.employeeId === employee.id);
			if (row?.advancePaise) recovered[run.month] = row.advancePaise;
		}
		const postedThrough =
			posted
				.map((r) => r.month)
				.sort()
				.at(-1) ?? null;
		const rows = advanceSchedule({
			given: given.map((g) => ({ month: g.givenOn.slice(0, 7), paise: g.amountPaise })),
			recovered,
			postedThrough,
			perMonthPaise: paise(employee.advancePerMonthINR),
		});
		return {
			employeeId: employee.id,
			name: employee.name,
			perMonthPaise: paise(employee.advancePerMonthINR),
			leftPaise: paise(employee.advanceDueINR),
			given,
			rows,
		};
	}

	/** Everyone who has been given an advance, with their schedule. */
	async list(): Promise<AdvanceSchedule[]> {
		const all = await this.advances.list();
		const out: AdvanceSchedule[] = [];
		for (const employee of await this.employees.list()) {
			const given = all.filter((a) => a.employeeId === employee.id);
			if (given.length) out.push(await this.scheduleFor(employee, given));
		}
		return out;
	}

	async schedule(employeeId: string): Promise<AdvanceSchedule> {
		const employee = await this.employee(employeeId);
		return this.scheduleFor(employee, await this.advances.list(employeeId));
	}

	/** S9 Give an advance: a payment from cash or bank to Staff advance, recovered through payroll. */
	async give(
		employeeId: string,
		write: AdvanceGive,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<AdvanceSchedule> {
		const employee = await this.employee(employeeId);
		if (employee.version !== write.version) throw new ConflictException(accountsRefusal('employee_changed'));
		if (employee.leftOn) throw refuse('employee_has_left');
		const chart = await this.ledger.chart();
		let staffAdvance: string;
		try {
			staffAdvance = resolveRole(chart.ledgers, 'staff_advance').id;
		} catch {
			throw refuse('books_not_set_up');
		}
		const by = principal?.userId ?? null;
		const id = `adv_${randomUUID()}`;
		const amount = paise(write.amountINR);
		await this.transactions.withTransaction(async (context) => {
			const voucher = await this.ledger.post(
				{
					kind: 'payment',
					date: write.givenOn,
					narration: `Advance to ${employee.name}`,
					source: { type: 'payrollAdvance', id, number: null },
					idempotencyKey: `payrollAdvance:${id}`,
					lines: [
						{ ledger: { id: staffAdvance }, locationId: employee.locationId, debitPaise: amount },
						{ ledger: { id: write.ledgerId }, locationId: employee.locationId, creditPaise: amount },
					],
				},
				context,
				by,
			);
			await this.advances.insert(
				{
					id,
					employeeId,
					givenOn: write.givenOn,
					amountPaise: amount,
					ledgerId: write.ledgerId,
					voucherId: voucher.id,
					note: write.note,
					createdBy: by,
					createdAt: now.toISOString(),
				},
				context,
			);
			await this.employees.save(
				{
					...employee,
					advanceDueINR: employee.advanceDueINR + write.amountINR,
					advancePerMonthINR: write.perMonthINR,
					updatedAt: now.toISOString(),
				},
				employee.version,
				context,
			);
		});
		return this.schedule(employeeId);
	}
}
