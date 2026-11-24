import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Attendance, Employee, PayrollRun } from '@saha-textile/contracts';
import type {
	AttendanceRepository,
	EmployeeRepository,
	PayrollRunRepository,
	TransactionContext,
} from '@saha-textile/core-domain';

import { EmployeeModel, PayrollAttendanceModel, PayrollRunModel } from '../models/bank.model';
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
