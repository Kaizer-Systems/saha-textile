import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
	Attendance,
	AttendanceDay,
	Employee,
	PayrollAdvance,
	PayrollRulesVersion,
	PayrollRun,
	IncrementPlan,
	SalaryTemplate,
} from '@saha-textile/contracts';
import type {
	AttendanceDayRepository,
	AttendanceRepository,
	EmployeeRepository,
	PayrollAdvanceRepository,
	PayrollRulesRepository,
	PayrollRunRepository,
	IncrementPlanRepository,
	SalaryTemplateRepository,
	StatutoryFilingRecord,
	StatutoryFilingRepository,
	TransactionContext,
} from '@saha-textile/core-domain';

import {
	AttendanceDayModel,
	EmployeeModel,
	PayrollAdvanceModel,
	PayrollAttendanceModel,
	PayrollRulesModel,
	PayrollRunModel,
	IncrementPlanModel,
	SalaryTemplateModel,
	StatutoryFilingModel,
} from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

type Sealed = { iv: string; tag: string; data: string };

const seal = (key: Buffer, text: string): Sealed => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
};

const open = (key: Buffer, sealed: Sealed): string | null => {
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
		decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
};

/**
 * Employees in MongoDB (`employees`). Aadhaar and the bank account are sealed with `PAYROLL_PII_KEY` (AES-256-GCM, a
 * fresh IV per write, decision D29); without the key they can't be saved, and read back empty.
 */
export class MongoEmployeeRepository implements EmployeeRepository {
	private readonly key: Buffer | null;

	constructor(key?: Uint8Array | null) {
		if (key && key.length !== 32) throw new Error('PAYROLL_PII_KEY must be 32 bytes');
		this.key = key ? Buffer.from(key) : null;
	}

	private toDoc(employee: Employee) {
		const { id, aadhaar, bankAccount, ...rest } = employee;
		if ((aadhaar || bankAccount) && !this.key) throw new Error('payroll_pii_key_missing');
		const key = this.key as Buffer;
		return {
			_id: id,
			...rest,
			aadhaarSealed: aadhaar ? seal(key, aadhaar) : null,
			bankSealed: bankAccount ? seal(key, bankAccount) : null,
		};
	}

	private fromDoc(doc: AggregateDoc): Employee {
		const { _id, aadhaarSealed, bankSealed, ...rest } = doc as AggregateDoc & {
			aadhaarSealed?: Sealed | null;
			bankSealed?: Sealed | null;
		};
		const read = (sealed: Sealed | null | undefined) => (sealed && this.key ? (open(this.key, sealed) ?? '') : '');
		return Employee.parse({ ...rest, id: _id, aadhaar: read(aadhaarSealed), bankAccount: read(bankSealed) });
	}

	async list(): Promise<Employee[]> {
		const docs = await EmployeeModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => this.fromDoc(doc));
	}

	async get(id: string): Promise<Employee | null> {
		const doc = await EmployeeModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? this.fromDoc(doc) : null;
	}

	async insert(employee: Employee): Promise<void> {
		await EmployeeModel.create(this.toDoc(employee));
	}

	async save(employee: Employee, expectedVersion: number, context?: TransactionContext): Promise<Employee> {
		const { _id, ...rest } = this.toDoc(employee);
		const result = await EmployeeModel.updateOne(
			{ _id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		)
			.session(sessionFrom(context) ?? null)
			.exec();
		if (!result.matchedCount) throw new Error('employee_changed');
		return { ...employee, version: expectedVersion + 1 };
	}
}

/** A month's attendance in MongoDB (`payrollAttendance`, one document per month). */
/** Brief 26 AT: attendance day by day. */
export class MongoAttendanceDayRepository implements AttendanceDayRepository {
	private static read(doc: AggregateDoc): AttendanceDay {
		const { _id, ...rest } = doc;
		return AttendanceDay.parse({ ...rest, id: _id });
	}

	async get(employeeId: string, day: string): Promise<AttendanceDay | null> {
		const doc = await AttendanceDayModel.findById(`${employeeId}_${day}`).lean<AggregateDoc>().exec();
		return doc ? MongoAttendanceDayRepository.read(doc) : null;
	}

	async month(
		month: string,
		filter: { employeeIds?: readonly string[]; locationId?: string },
	): Promise<AttendanceDay[]> {
		const query: Record<string, unknown> = { day: { $gte: `${month}-01`, $lte: `${month}-31` } };
		if (filter.employeeIds) query['employeeId'] = { $in: [...filter.employeeIds] };
		if (filter.locationId) query['locationId'] = filter.locationId;
		const docs = await AttendanceDayModel.find(query).sort({ day: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((d) => MongoAttendanceDayRepository.read(d));
	}

	async pending(locationIds: readonly string[] | null): Promise<AttendanceDay[]> {
		const query: Record<string, unknown> = { pending: { $ne: null } };
		if (locationIds) query['locationId'] = { $in: [...locationIds] };
		const docs = await AttendanceDayModel.find(query).sort({ day: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((d) => MongoAttendanceDayRepository.read(d));
	}

	async range(employeeId: string, from: string, to: string): Promise<AttendanceDay[]> {
		const docs = await AttendanceDayModel.find({ employeeId, day: { $gte: from, $lte: to } })
			.sort({ day: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((d) => MongoAttendanceDayRepository.read(d));
	}

	async save(day: AttendanceDay, expectedVersion: number | null): Promise<AttendanceDay> {
		const { id, ...rest } = day;
		if (expectedVersion === null) {
			await AttendanceDayModel.create({ _id: id, ...rest, version: 0 }).catch((error: { code?: number }) => {
				throw error.code === 11000 ? new Error('attendance_day_changed', { cause: error }) : error;
			});
			return { ...day, version: 0 };
		}
		const result = await AttendanceDayModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('attendance_day_changed');
		return { ...day, version: expectedVersion + 1 };
	}
}

export class MongoAttendanceRepository implements AttendanceRepository {
	async get(month: string): Promise<Attendance | null> {
		const doc = await PayrollAttendanceModel.findById(month).lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return Attendance.parse({ ...rest, month: _id });
	}

	async save(attendance: Attendance, expectedVersion: number | null): Promise<Attendance> {
		const { month, ...rest } = attendance;
		if (expectedVersion === null) {
			await PayrollAttendanceModel.create({ _id: month, ...rest, version: 0 }).catch(
				(error: { code?: number }) => {
					throw error.code === 11000 ? new Error('attendance_changed', { cause: error }) : error;
				},
			);
			return { ...attendance, version: 0 };
		}
		const result = await PayrollAttendanceModel.updateOne(
			{ _id: month, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('attendance_changed');
		return { ...attendance, version: expectedVersion + 1 };
	}
}

/** Payroll runs in MongoDB (`payrollRuns`, one per month). */
export class MongoPayrollRunRepository implements PayrollRunRepository {
	async list(): Promise<PayrollRun[]> {
		const docs = await PayrollRunModel.find({}).sort({ month: -1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => {
			const { _id, ...rest } = doc;
			return PayrollRun.parse({ ...rest, id: _id });
		});
	}

	async get(month: string): Promise<PayrollRun | null> {
		const doc = await PayrollRunModel.findOne({ month }).lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return PayrollRun.parse({ ...rest, id: _id });
	}

	async save(run: PayrollRun, expectedVersion: number | null, context?: TransactionContext): Promise<PayrollRun> {
		const { id, ...rest } = run;
		const session = sessionFrom(context) ?? null;
		if (expectedVersion === null) {
			await PayrollRunModel.create([{ _id: id, ...rest, version: 0 }], { session }).catch(
				(error: { code?: number }) => {
					throw error.code === 11000 ? new Error('payroll_run_changed', { cause: error }) : error;
				},
			);
			return { ...run, version: 0 };
		}
		const result = await PayrollRunModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		)
			.session(session)
			.exec();
		if (!result.matchedCount) throw new Error('payroll_run_changed');
		return { ...run, version: expectedVersion + 1 };
	}
}

const duplicate = (code: string) => (error: { code?: number }) => {
	throw error.code === 11000 ? new Error(code, { cause: error }) : error;
};

/** Payroll rule versions in MongoDB (`payrollRules`, keyed by the day each starts). */
export class MongoPayrollRulesRepository implements PayrollRulesRepository {
	async list(): Promise<PayrollRulesVersion[]> {
		const docs = await PayrollRulesModel.find({}).sort({ from: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(({ _id, ...rest }) => PayrollRulesVersion.parse({ ...rest, id: _id }));
	}

	async insert(version: PayrollRulesVersion): Promise<void> {
		const { id, ...rest } = version;
		await PayrollRulesModel.create({ _id: id, ...rest }).catch(duplicate('payroll_rules_from_taken'));
	}
}

/** Salary structure templates in MongoDB (`salaryTemplates`). */
export class MongoSalaryTemplateRepository implements SalaryTemplateRepository {
	async list(): Promise<SalaryTemplate[]> {
		const docs = await SalaryTemplateModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(({ _id, ...rest }) => SalaryTemplate.parse({ ...rest, id: _id }));
	}

	async get(id: string): Promise<SalaryTemplate | null> {
		const doc = await SalaryTemplateModel.findById(id).lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return SalaryTemplate.parse({ ...rest, id: _id });
	}

	async insert(template: SalaryTemplate): Promise<void> {
		const { id, ...rest } = template;
		await SalaryTemplateModel.create({ _id: id, ...rest });
	}

	async save(template: SalaryTemplate, expectedVersion: number): Promise<SalaryTemplate> {
		const { id, ...rest } = template;
		const result = await SalaryTemplateModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('salary_template_changed');
		return { ...template, version: expectedVersion + 1 };
	}
}

/** Brief 26 SR3: increment plans in MongoDB (`incrementPlans`), by name. */
export class MongoIncrementPlanRepository implements IncrementPlanRepository {
	async list(): Promise<IncrementPlan[]> {
		const docs = await IncrementPlanModel.find({}).sort({ name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(({ _id, ...rest }) => IncrementPlan.parse({ ...rest, id: _id }));
	}

	async save(plan: IncrementPlan): Promise<IncrementPlan> {
		const { id, ...rest } = plan;
		await IncrementPlanModel.updateOne({ _id: id }, { $set: rest }, { upsert: true }).exec();
		return plan;
	}

	async delete(id: string): Promise<void> {
		await IncrementPlanModel.deleteOne({ _id: id }).exec();
	}
}

/** Statutory returns marked filed in MongoDB (`statutoryFilings`, keyed `<kind>:<period>`). */
export class MongoStatutoryFilingRepository implements StatutoryFilingRepository {
	async list(): Promise<StatutoryFilingRecord[]> {
		return StatutoryFilingModel.find({}, { _id: 0 }).sort({ period: -1 }).lean<StatutoryFilingRecord[]>().exec();
	}

	async insert(filing: StatutoryFilingRecord): Promise<void> {
		// One filing per return: professional tax and the welfare fund once per State (brief 25 ST2).
		const id = filing.stateCode
			? `${filing.kind}:${filing.period}:${filing.stateCode}`
			: `${filing.kind}:${filing.period}`;
		await StatutoryFilingModel.create({ _id: id, ...filing }).catch(duplicate('statutory_already_filed'));
	}
}

/** Advances given to employees in MongoDB (`payrollAdvances`). */
export class MongoPayrollAdvanceRepository implements PayrollAdvanceRepository {
	async list(employeeId?: string): Promise<PayrollAdvance[]> {
		const docs = await PayrollAdvanceModel.find(employeeId ? { employeeId } : {})
			.sort({ givenOn: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(({ _id, ...rest }) => PayrollAdvance.parse({ ...rest, id: _id }));
	}

	async insert(advance: PayrollAdvance, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = advance;
		await PayrollAdvanceModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) ?? null });
	}
}
