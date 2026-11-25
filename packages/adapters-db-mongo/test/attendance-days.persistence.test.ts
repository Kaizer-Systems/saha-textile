import { AttendanceDay } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { AttendanceDayModel } from '../src/models/bank.model';
import { MongoAttendanceDayRepository } from '../src/repositories/payroll.repository';

import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Attendance day by day (brief 26 AT): one person's day keyed by person and day, a store's month, the changes waiting
 * for approval, and saves over the version read:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/attendance-days.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('attendance days store (integration, rs0)', () => {
	const P = runPrefix('att_day');
	const priya = `${P}emp_priya`;
	const rahul = `${P}emp_rahul`;
	const kolkata = `${P}loc_kolkata`;
	const siliguri = `${P}loc_siliguri`;
	const repo = new MongoAttendanceDayRepository();
	const dayOf = (employeeId: string, day: string, over: Partial<AttendanceDay> = {}) =>
		AttendanceDay.parse({
			id: `${employeeId}_${day}`,
			employeeId,
			day,
			locationId: kolkata,
			status: 'present',
			inAt: `${day}T04:30:00.000Z`,
			outAt: `${day}T13:00:00.000Z`,
			markedBy: employeeId,
			...over,
		});
	const pending = {
		status: 'leave' as const,
		leaveKey: 'CL',
		inAt: null,
		outAt: null,
		reason: 'Was on casual leave',
		askedBy: 'adm_manager',
		askedAt: '2098-02-11T06:00:00.000Z',
	};
	const ids = (rows: readonly AttendanceDay[]) => rows.filter((r) => r.id.startsWith(P)).map((r) => r.id);

	beforeAll(async () => {
		await connectMongo();
		// February 2098 and a day either side of it, at two stores.
		await repo.save(dayOf(priya, '2098-02-10'), null);
		await repo.save(dayOf(priya, '2098-01-31'), null);
		await repo.save(dayOf(priya, '2098-03-01'), null);
		await repo.save(dayOf(priya, '2098-02-03', { pending }), null);
		await repo.save(dayOf(rahul, '2098-02-28', { locationId: siliguri, status: 'half' }), null);
		await repo.save(dayOf(rahul, '2098-02-01', { locationId: siliguri, pending }), null);
	});
	afterAll(async () => {
		await AttendanceDayModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('reads one person’s day by person and day, and none for a day not kept', async () => {
		expect(await repo.get(priya, '2098-02-10')).toEqual({ ...dayOf(priya, '2098-02-10'), version: 0 });
		expect((await repo.get(priya, '2098-02-03'))?.pending).toEqual(pending);
		expect(await repo.get(priya, '2098-02-11')).toBeNull();
	});

	it('reads a month day by day for some people or one store, nothing either side of it', async () => {
		expect(ids(await repo.month('2098-02', { employeeIds: [priya, rahul] }))).toEqual([
			`${rahul}_2098-02-01`,
			`${priya}_2098-02-03`,
			`${priya}_2098-02-10`,
			`${rahul}_2098-02-28`,
		]);
		expect(ids(await repo.month('2098-02', { employeeIds: [priya] }))).toEqual([
			`${priya}_2098-02-03`,
			`${priya}_2098-02-10`,
		]);
		expect(ids(await repo.month('2098-02', { locationId: siliguri }))).toEqual([
			`${rahul}_2098-02-01`,
			`${rahul}_2098-02-28`,
		]);
		expect(ids(await repo.month('2098-02', { employeeIds: [priya], locationId: siliguri }))).toEqual([]);
		expect(ids(await repo.month('2098-02', {}))).toHaveLength(4);
		expect(await repo.month('2098-02', { employeeIds: [] })).toEqual([]);
	});

	it('reads one person’s days between two days, both counted, in order', async () => {
		expect(ids(await repo.range(priya, '2098-01-31', '2098-02-10'))).toEqual([
			`${priya}_2098-01-31`,
			`${priya}_2098-02-03`,
			`${priya}_2098-02-10`,
		]);
		expect(ids(await repo.range(priya, '2098-02-04', '2098-02-28'))).toEqual([`${priya}_2098-02-10`]);
		expect(await repo.range(rahul, '2098-03-01', '2098-03-31')).toEqual([]);
	});

	it('lists the changes waiting for approval at some stores, or at every store, by day', async () => {
		expect(ids(await repo.pending([kolkata]))).toEqual([`${priya}_2098-02-03`]);
		expect(ids(await repo.pending([kolkata, siliguri]))).toEqual([`${rahul}_2098-02-01`, `${priya}_2098-02-03`]);
		expect(ids(await repo.pending(null))).toEqual([`${rahul}_2098-02-01`, `${priya}_2098-02-03`]);
		expect(await repo.pending([])).toEqual([]);
	});

	it('makes a day once at version 0, then saves only over the version read', async () => {
		const day = dayOf(priya, '2098-02-12', { status: 'incomplete', outAt: null });
		expect((await repo.save(day, null)).version).toBe(0);
		await expect(repo.save({ ...day, status: 'present' }, null)).rejects.toThrow('attendance_day_changed');
		const approved = {
			...day,
			status: 'present' as const,
			outAt: '2098-02-12T13:00:00.000Z',
			changedBy: 'adm_owner',
		};
		expect(await repo.save(approved, 0)).toEqual({ ...approved, version: 1 });
		expect(await repo.get(priya, '2098-02-12')).toMatchObject({
			status: 'present',
			changedBy: 'adm_owner',
			version: 1,
		});
		await expect(repo.save({ ...approved, reason: 'Too late' }, 0)).rejects.toThrow('attendance_day_changed');
		await expect(repo.save(dayOf(priya, '2098-02-13'), 2)).rejects.toThrow('attendance_day_changed');
	});

	it('passes on a failure to make a day that is not a second save', async () => {
		const nameless = { ...dayOf(priya, '2098-02-14'), id: undefined } as unknown as AttendanceDay;
		const failure = await repo.save(nameless, null).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).not.toBe('attendance_day_changed');
	});
});
