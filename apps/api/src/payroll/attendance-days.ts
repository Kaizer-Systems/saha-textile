import {
	BadRequestException,
	Body,
	ConflictException,
	Controller,
	ForbiddenException,
	Get,
	Header,
	Inject,
	Injectable,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	DayChange,
	IsoDate,
	LeaveAsk,
	YearMonth,
	type Attendance,
	type AttendanceDay,
	type AttendanceMonthGrid,
	type AttendanceRow,
	type Employee,
	type MyAttendance,
} from '@saha-textile/contracts';
import {
	daysOfMonth,
	lateMinutes,
	leaveLeft,
	markedStatus,
	monthFromDays,
	ruleFor,
	settledMonth,
	shiftOf,
	storeCalendar,
	type AttendanceDayRepository,
	type AttendanceRepository,
	type EmployeeRepository,
	type LeaveRule,
	type LeaveType,
	type LocationRepository,
	type PayrollRunRepository,
} from '@saha-textile/core-domain';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	ATTENDANCE_DAY_REPOSITORY,
	ATTENDANCE_REPOSITORY,
	EMPLOYEE_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { API_TAGS } from '../openapi-tags';
import { PayrollRulesService } from './payroll-rules.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const istDay = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);
/** The day after the last any leave can be asked for: the end of the range read for leave waiting. */
const FAR = '2999-12-31';
const addDays = (day: string, n: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A day someone marked or set; a record kept only for a request (or one turned down) is not. */
const isSet = (d: AttendanceDay) => !!(d.inAt || d.markedBy || d.changedBy);
/** On the payroll in a month: joined by its end and not gone before it began. */
const onRoll = (e: Employee, month: string) =>
	e.joinedOn <= (daysOfMonth(month).at(-1) as string) && (!e.leftOn || e.leftOn >= `${month}-01`);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const blankDay = (e: Pick<Employee, 'id' | 'locationId'>, day: string): AttendanceDay => ({
	id: `${e.id}_${day}`,
	employeeId: e.id,
	day,
	locationId: e.locationId,
	status: 'absent',
	leaveKey: null,
	inAt: null,
	outAt: null,
	lateMinutes: 0,
	markedBy: null,
	changedBy: null,
	reason: null,
	pending: null,
	version: 0,
});

/**
 * Attendance day by day (brief 26 AT1-AT3; approved 2026-11-26). Each person marks their own day from their phone
 * (the server's time); people with "attendance.index" see and report on the stores in their charge; with
 * "attendance.edit" they change a day at once (with a reason); without it their change waits for someone with
 * "attendance.approve", who never approves their own. Leave asked for waits the same way.
 */
@Injectable()
export class AttendanceDaysService {
	constructor(
		@Inject(ATTENDANCE_DAY_REPOSITORY) private readonly days: AttendanceDayRepository,
		@Inject(EMPLOYEE_REPOSITORY) private readonly employees: Pick<EmployeeRepository, 'list'>,
		@Inject(LOCATION_REPOSITORY)
		private readonly locations: Pick<LocationRepository, 'adminUserLocations' | 'list'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
		@Inject(ATTENDANCE_REPOSITORY) private readonly months: AttendanceRepository,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'get'>,
	) {}

	/** A month's rules for each store: its shift, its calendar (weekly offs and its State's holidays), leave paid. */
	private async monthContext(month: string) {
		const [{ states, shifts }, locations] = await Promise.all([this.rules.forMonth(month), this.locations.list()]);
		const stateOf = (locationId: string) =>
			states.find((s) => s.stateCode === locations.find((l) => l.id === locationId)?.stateCode);
		return {
			shift: (locationId: string) => shiftOf(shifts, locationId),
			calendar: (locationId: string) =>
				storeCalendar(month, locationId, shiftOf(shifts, locationId), stateOf(locationId)?.holidays ?? []),
			paidAs: (locationId: string) => {
				const paid = new Map((stateOf(locationId)?.leaveTypes ?? []).map((t) => [t.key, t.paid] as const));
				return (key: string) => paid.get(key) ?? 'unpaid';
			},
			leaveTypes: (locationId: string): readonly LeaveType[] =>
				(stateOf(locationId)?.leaveTypes ?? []).filter((t) => t.active),
		};
	}

	/**
	 * AT1: each active leave type of the person's State with the rule that applies to them, and the days left; null
	 * for a type given on request or without pay, which has no balance to keep.
	 */
	private async leaveOf(e: Employee, today: string, types: readonly LeaveType[]) {
		const days = await this.days.range(e.id, e.joinedOn, FAR);
		const taken = (key: string, waiting: boolean) => (from: string, to: string) =>
			days
				.filter((d) => d.day >= from && d.day <= to)
				.map((d) => (waiting ? d.pending : isSet(d) ? d : null))
				.reduce(
					(sum, d) =>
						sum + (d?.leaveKey !== key ? 0 : d.status === 'leave' ? 1 : d.status === 'half' ? 0.5 : 0),
					0,
				);
		return types.flatMap((type) => {
			const rule = ruleFor(type, e);
			if (!rule) return [];
			const kept = rule.credit.kind !== 'on_request' && type.paid !== 'unpaid';
			const left = kept
				? leaveLeft(rule, {
						joinedOn: e.joinedOn,
						today,
						opening: e.openingLeave?.find((o) => o.typeKey === type.key) ?? null,
						taken: taken(type.key, false),
					})
				: null;
			return [{ type, rule, left, waiting: taken(type.key, true)(today, FAR) }];
		});
	}

	/** AT1: My attendance: today, the month so far and the leave left. */
	async summary(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<MyAttendance> {
		const { e } = await this.me(principal);
		const today = istDay(now);
		const context = await this.monthContext(monthOf(today));
		const shift = context.shift(e.locationId);
		const set = (await this.days.month(monthOf(today), { employeeIds: [e.id] })).filter(isSet);
		const leaveByType: Record<string, number> = {};
		for (const d of set)
			if (d.leaveKey && (d.status === 'leave' || d.status === 'half'))
				leaveByType[d.leaveKey] = (leaveByType[d.leaveKey] ?? 0) + (d.status === 'leave' ? 1 : 0.5);
		const location = (await this.locations.list()).find((l) => l.id === e.locationId);
		return {
			employeeId: e.id,
			name: e.name,
			locationId: e.locationId,
			locationName: location?.name ?? e.locationId,
			today,
			shift: { start: shift.start, end: shift.end },
			day: set.find((d) => d.day === today) ?? null,
			present: set.reduce((n, d) => n + (d.status === 'present' ? 1 : d.status === 'half' ? 0.5 : 0), 0),
			leaveByType,
			leave: (await this.leaveOf(e, today, context.leaveTypes(e.locationId))).map(({ type, rule, left }) => ({
				key: type.key,
				name: type.name,
				left,
				halfDays: rule.taking.halfDays,
				noticeDays: rule.taking.noticeDays ?? null,
			})),
		};
	}

	/** AT2: a person's month counted from the days set, the rest settled by the store's calendar. */
	private count(
		month: string,
		e: Employee,
		records: readonly AttendanceDay[],
		context: Awaited<ReturnType<AttendanceDaysService['monthContext']>>,
	) {
		const set = records.filter(isSet);
		const { days, unmarked } = settledMonth(month, e, set, context.calendar(e.locationId));
		return {
			...monthFromDays(days, context.paidAs(e.locationId)),
			unmarked,
			lateMarks: set.filter((d) => d.lateMinutes > 0).length,
		};
	}

	/** The month's row the payroll run reads: paid days, leave days, and the leave by type as its note. */
	private row(
		month: string,
		e: Employee,
		records: readonly AttendanceDay[],
		context: Awaited<ReturnType<AttendanceDaysService['monthContext']>>,
	): AttendanceRow {
		const counted = this.count(month, e, records, context);
		const leave = Object.entries(counted.leaveByType);
		return {
			employeeId: e.id,
			paidDays: counted.paidDays,
			leaveTaken: leave.reduce((sum, [, n]) => sum + n, 0),
			note: leave.map(([key, n]) => `${key} ${n}`).join(' · '),
		};
	}

	/** Nobody marks or asks for leave in a locked month. */
	private async refuseLocked(month: string): Promise<void> {
		if ((await this.months.get(month))?.lockedAt) throw refuse('attendance_locked');
	}

	/**
	 * AT-D2: a locked month changes only by someone with "attendance.edit", and only while its payroll run is a draft;
	 * the locked month, when it is one, for counting the person again.
	 */
	private async lockedFor(who: AuthenticatedPrincipal, month: string): Promise<Attendance | null> {
		const locked = await this.months.get(month);
		if (!locked?.lockedAt) return null;
		if (!who.permissions.includes('attendance.edit')) throw refuse('attendance_locked');
		const run = await this.runs.get(month);
		if (run && run.status !== 'draft') throw refuse('attendance_run_not_draft');
		return locked;
	}

	/** A changed day in a locked month counts its person's row again. */
	private async recount(locked: Attendance, e: Employee): Promise<void> {
		const records = await this.days.month(locked.month, { employeeIds: [e.id] });
		const row = this.row(locked.month, e, records, await this.monthContext(locked.month));
		const rows = locked.rows.some((r) => r.employeeId === e.id)
			? locked.rows.map((r) => (r.employeeId === e.id ? row : r))
			: [...locked.rows, row];
		await this.saveMonth({ ...locked, rows }, locked.version);
	}

	private async saveMonth(month: Attendance, expected: number | null): Promise<Attendance> {
		try {
			return await this.months.save(month, expected);
		} catch (error) {
			if (error instanceof Error && error.message === 'attendance_changed')
				throw new ConflictException(accountsRefusal('attendance_changed'));
			throw error;
		}
	}

	/** The employee a login belongs to (AT-D1: the employee's user), and the login. */
	private async me(principal: AuthenticatedPrincipal | undefined): Promise<{ e: Employee; userId: string }> {
		const userId = principal?.userId;
		const mine = (await this.employees.list()).find((e) => !!userId && e.userId === userId && !e.leftOn);
		if (!mine || !userId) throw new NotFoundException(accountsRefusal('attendance_no_employee'));
		return { e: mine, userId };
	}

	/** The stores a user is in charge of; null for every store. */
	private async scope(principal: AuthenticatedPrincipal | undefined): Promise<string[] | null> {
		if (!principal) return [];
		const access = await this.locations.adminUserLocations(principal.userId);
		if (access?.maySeeAll) return null;
		return access?.worksAt ?? [];
	}

	/** The signed-in person, when the store is in their charge. */
	private async inScope(
		principal: AuthenticatedPrincipal | undefined,
		locationId: string,
	): Promise<AuthenticatedPrincipal> {
		const stores = await this.scope(principal);
		if (!principal || (stores && !stores.includes(locationId)))
			throw new ForbiddenException(accountsRefusal('attendance_not_your_store'));
		return principal;
	}

	private async saveOrConflict(day: AttendanceDay, expected: number | null): Promise<AttendanceDay> {
		try {
			return await this.days.save(day, expected);
		} catch (error) {
			if (error instanceof Error && error.message === 'attendance_day_changed')
				throw new ConflictException(accountsRefusal('attendance_day_changed'));
			throw error;
		}
	}

	/** AT1: mark in, once a day, at the server's time. */
	async markIn(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<AttendanceDay> {
		const { e, userId } = await this.me(principal);
		const day = istDay(now);
		await this.refuseLocked(monthOf(day));
		const saved = await this.days.get(e.id, day);
		if (saved?.inAt) throw refuse('attendance_already_in');
		const at = now.toISOString();
		const base = saved ?? blankDay(e, day);
		const shift = (await this.monthContext(monthOf(day))).shift(e.locationId);
		return this.saveOrConflict(
			{
				...base,
				status: 'incomplete',
				inAt: at,
				lateMinutes: lateMinutes(at, shift),
				markedBy: userId,
			},
			saved ? saved.version : null,
		);
	}

	/** AT1: mark out after marking in; the day's status follows the hours. */
	async markOut(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<AttendanceDay> {
		const { e } = await this.me(principal);
		const day = istDay(now);
		await this.refuseLocked(monthOf(day));
		const saved = await this.days.get(e.id, day);
		if (!saved?.inAt) throw refuse('attendance_not_in');
		const at = now.toISOString();
		const shift = (await this.monthContext(monthOf(day))).shift(e.locationId);
		return this.saveOrConflict({ ...saved, outAt: at, status: markedStatus(saved.inAt, at, shift) }, saved.version);
	}

	/** AT1: my month's days. */
	async mine(principal: AuthenticatedPrincipal | undefined, month: string): Promise<AttendanceDay[]> {
		const { e } = await this.me(principal);
		return this.days.month(month, { employeeIds: [e.id] });
	}

	/** AT1: ask for leave; each day waits for the manager's approval. */
	async askLeave(
		principal: AuthenticatedPrincipal | undefined,
		ask: LeaveAsk,
		now = new Date(),
	): Promise<AttendanceDay[]> {
		const { e, userId } = await this.me(principal);
		await this.refuseLocked(monthOf(ask.from));
		await this.refuseLocked(monthOf(ask.to));
		const today = istDay(now);
		const context = await this.monthContext(monthOf(today));
		const asked = (await this.leaveOf(e, today, context.leaveTypes(e.locationId))).find(
			(l) => l.type.key === ask.leaveKey,
		);
		if (!asked) throw refuse('leave_type_unknown');
		const days = await this.leaveDays(e, ask, asked.rule);
		if (ask.half && !asked.rule.taking.halfDays) throw refuse('leave_no_half_days');
		if (asked.rule.taking.noticeDays && ask.from < addDays(today, asked.rule.taking.noticeDays))
			throw refuse('leave_notice');
		if (!days.length) throw refuse('leave_no_working_days');
		const asking = ask.half ? 0.5 : days.length;
		const most =
			asked.rule.credit.kind === 'on_request'
				? asked.rule.credit.days - asked.waiting
				: asked.left === null || asked.rule.taking.canGoNegative
					? Number.POSITIVE_INFINITY
					: asked.left - asked.waiting;
		if (asking > most) throw refuse('leave_not_enough');
		const out: AttendanceDay[] = [];
		for (const d of days) {
			const saved = await this.days.get(e.id, d);
			const change: DayChange = {
				status: ask.half ? 'half' : 'leave',
				leaveKey: ask.leaveKey,
				inAt: null,
				outAt: null,
				reason: ask.reason || 'Leave asked for',
			};
			out.push(
				await this.saveOrConflict(
					{
						...(saved ?? blankDay(e, d)),
						pending: { ...change, askedBy: userId, askedAt: now.toISOString() },
					},
					saved ? saved.version : null,
				),
			);
		}
		return out;
	}

	/** AT1: the days a leave asked for covers: weekly offs and holidays left out unless the type counts them. */
	private async leaveDays(e: Employee, ask: LeaveAsk, rule: LeaveRule): Promise<string[]> {
		const calendars = new Map<string, { offDays: string[]; holidays: { day: string }[] }>();
		const out: string[] = [];
		for (let d = ask.from; d <= ask.to; d = nextDay(d)) {
			if (!rule.taking.countOffsBetween) {
				const month = monthOf(d);
				const calendar = calendars.get(month) ?? (await this.monthContext(month)).calendar(e.locationId);
				calendars.set(month, calendar);
				if (calendar.offDays.includes(d) || calendar.holidays.some((h) => h.day === d)) continue;
			}
			out.push(d);
		}
		return out;
	}

	/** AT2: a store's month, each person's days and what the lock will count. */
	async grid(
		principal: AuthenticatedPrincipal | undefined,
		month: string,
		locationId: string,
	): Promise<AttendanceMonthGrid> {
		await this.inScope(principal, locationId);
		const people = (await this.employees.list()).filter((e) => e.locationId === locationId && onRoll(e, month));
		const days = await this.days.month(month, { locationId });
		const context = await this.monthContext(month);
		const calendar = context.calendar(locationId);
		return {
			month,
			locationId,
			lockedAt: (await this.months.get(month))?.lockedAt ?? null,
			offDays: calendar.offDays,
			holidays: calendar.holidays,
			people: people.map((e) => {
				const mine = days.filter((d) => d.employeeId === e.id);
				const counted = this.count(month, e, mine, context);
				return {
					employeeId: e.id,
					name: e.name,
					days: mine.filter((d) => isSet(d) || d.pending),
					paidDays: counted.paidDays,
					leaveByType: counted.leaveByType,
					withoutPay: counted.withoutPay,
					lateMarks: counted.lateMarks,
					unmarked: counted.unmarked,
				};
			}),
		};
	}

	/**
	 * AT2: lock the month from the days: each person on the roll counted (days nobody marked absent, weekly offs and
	 * holidays paid), for the payroll run; refused while a change waits for approval or a day is incomplete.
	 */
	async lock(principal: AuthenticatedPrincipal | undefined, month: string, now = new Date()): Promise<Attendance> {
		const saved = await this.months.get(month);
		if (saved?.lockedAt) throw refuse('attendance_locked');
		const days = await this.days.month(month, {});
		if (days.some((d) => d.pending)) throw refuse('attendance_requests_waiting');
		if (days.some((d) => isSet(d) && d.status === 'incomplete')) throw refuse('attendance_days_incomplete');
		const context = await this.monthContext(month);
		const rows = (await this.employees.list())
			.filter((e) => onRoll(e, month))
			.map((e) =>
				this.row(
					month,
					e,
					days.filter((d) => d.employeeId === e.id),
					context,
				),
			);
		return this.saveMonth(
			{
				month,
				daysInMonth: daysOfMonth(month).length,
				rows,
				lockedAt: now.toISOString(),
				lockedBy: principal?.userId ?? null,
				version: saved?.version ?? 0,
			},
			saved ? saved.version : null,
		);
	}

	/** AT3: change a day: at once with "attendance.edit", otherwise as a request waiting for approval. */
	async change(
		principal: AuthenticatedPrincipal | undefined,
		employeeId: string,
		day: string,
		change: DayChange,
		now = new Date(),
	): Promise<AttendanceDay> {
		const e = (await this.employees.list()).find((x) => x.id === employeeId);
		if (!e) throw new NotFoundException(accountsRefusal('employee_not_found'));
		const who = await this.inScope(principal, e.locationId);
		const locked = await this.lockedFor(who, monthOf(day));
		const saved = await this.days.get(employeeId, day);
		const base = saved ?? blankDay(e, day);
		const next: AttendanceDay = who.permissions.includes('attendance.edit')
			? { ...base, ...change, changedBy: who.userId, pending: null }
			: { ...base, pending: { ...change, askedBy: who.userId, askedAt: now.toISOString() } };
		const done = await this.saveOrConflict(next, saved ? saved.version : null);
		if (locked) await this.recount(locked, e);
		return done;
	}

	/** AT3, WL: the days waiting on approval in the user's stores. */
	async pending(principal: AuthenticatedPrincipal | undefined): Promise<AttendanceDay[]> {
		return this.days.pending(await this.scope(principal));
	}

	/** AT3: approve or turn down a waiting change; nobody decides their own. */
	async decide(
		principal: AuthenticatedPrincipal | undefined,
		employeeId: string,
		day: string,
		approve: boolean,
	): Promise<AttendanceDay> {
		const saved = await this.days.get(employeeId, day);
		if (!saved?.pending) throw new NotFoundException(accountsRefusal('attendance_nothing_waiting'));
		const who = await this.inScope(principal, saved.locationId);
		if (saved.pending.askedBy === who.userId)
			throw new ForbiddenException(accountsRefusal('attendance_own_request'));
		const locked = await this.lockedFor(who, monthOf(day));
		const { askedBy: _a, askedAt: _b, ...change } = saved.pending;
		const next: AttendanceDay = approve
			? { ...saved, ...change, changedBy: who.userId, pending: null }
			: { ...saved, pending: null };
		const done = await this.saveOrConflict(next, saved.version);
		const e = (await this.employees.list()).find((x) => x.id === employeeId);
		if (locked && approve && e) await this.recount(locked, e);
		return done;
	}
}

const DayParams = z.object({ employeeId: z.string().min(1), day: IsoDate });
const GridQuery = z.object({ month: YearMonth, locationId: z.string().min(1) });

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/attendance')
export class AttendanceDaysController {
	constructor(private readonly attendance: AttendanceDaysService) {}

	@Get('me')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attendance.use')
	@ApiOperation({ operationId: 'attendanceMe', summary: 'My attendance: today, the month and leave left (AT1)' })
	summary(@Principal() principal?: AuthenticatedPrincipal) {
		return this.attendance.summary(principal);
	}

	@Post('me/in')
	@RequirePermissions('attendance.use')
	@ApiOperation({ operationId: 'attendanceMarkIn', summary: 'Mark my day in (AT1)' })
	markIn(@Principal() principal?: AuthenticatedPrincipal) {
		return this.attendance.markIn(principal);
	}

	@Post('me/out')
	@RequirePermissions('attendance.use')
	@ApiOperation({ operationId: 'attendanceMarkOut', summary: 'Mark my day out (AT1)' })
	markOut(@Principal() principal?: AuthenticatedPrincipal) {
		return this.attendance.markOut(principal);
	}

	@Get('me/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attendance.use')
	@ApiOperation({ operationId: 'attendanceMine', summary: 'My month’s days (AT1)' })
	mine(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.mine(principal, month);
	}

	@Post('me/leave')
	@RequirePermissions('attendance.use')
	@ApiOperation({ operationId: 'attendanceAskLeave', summary: 'Ask for leave (AT1)' })
	askLeave(@Body(new ZodValidationPipe(LeaveAsk)) body: LeaveAsk, @Principal() principal?: AuthenticatedPrincipal) {
		return this.attendance.askLeave(principal, body);
	}

	@Get('grid')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attendance.index')
	@ApiOperation({ operationId: 'attendanceGrid', summary: 'A store’s month, day by day (AT2)' })
	grid(
		@Query(new ZodValidationPipe(GridQuery)) q: z.infer<typeof GridQuery>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.grid(principal, q.month, q.locationId);
	}

	@Put('days/:employeeId/:day')
	@RequirePermissions('attendance.index')
	@ApiOperation({ operationId: 'attendanceChange', summary: 'Change a day, or ask for the change (AT3)' })
	change(
		@Param(new ZodValidationPipe(DayParams)) p: z.infer<typeof DayParams>,
		@Body(new ZodValidationPipe(DayChange)) body: DayChange,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.change(principal, p.employeeId, p.day, body);
	}

	@Post('lock/:month')
	@RequirePermissions('attendance.edit')
	@ApiOperation({ operationId: 'attendanceLock', summary: 'Lock a month from the days, for the payroll run (AT2)' })
	lock(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.lock(principal, month);
	}

	@Get('pending')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attendance.approve')
	@ApiOperation({ operationId: 'attendancePending', summary: 'Days waiting on approval (AT3)' })
	pending(@Principal() principal?: AuthenticatedPrincipal) {
		return this.attendance.pending(principal);
	}

	@Post('days/:employeeId/:day/approve')
	@RequirePermissions('attendance.approve')
	@ApiOperation({ operationId: 'attendanceApprove', summary: 'Approve a waiting change (AT3)' })
	approve(
		@Param(new ZodValidationPipe(DayParams)) p: z.infer<typeof DayParams>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.decide(principal, p.employeeId, p.day, true);
	}

	@Post('days/:employeeId/:day/reject')
	@RequirePermissions('attendance.approve')
	@ApiOperation({ operationId: 'attendanceReject', summary: 'Turn down a waiting change (AT3)' })
	reject(
		@Param(new ZodValidationPipe(DayParams)) p: z.infer<typeof DayParams>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.attendance.decide(principal, p.employeeId, p.day, false);
	}
}
