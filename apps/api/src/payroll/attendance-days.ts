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
	type AttendanceDay,
	type AttendanceMonthGrid,
	type Employee,
} from '@saha-textile/contracts';
import {
	DEFAULT_SHIFT,
	lateMinutes,
	markedStatus,
	monthFromDays,
	type AttendanceDayRepository,
	type EmployeeRepository,
	type LocationRepository,
} from '@saha-textile/core-domain';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ATTENDANCE_DAY_REPOSITORY, EMPLOYEE_REPOSITORY, LOCATION_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { API_TAGS } from '../openapi-tags';
import { PayrollRulesService } from './payroll-rules.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const istDay = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
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
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'adminUserLocations'>,
		@Inject(PayrollRulesService) private readonly rules: Pick<PayrollRulesService, 'forMonth'>,
	) {}

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
		const saved = await this.days.get(e.id, day);
		if (saved?.inAt) throw refuse('attendance_already_in');
		const at = now.toISOString();
		const base = saved ?? blankDay(e, day);
		return this.saveOrConflict(
			{
				...base,
				status: 'incomplete',
				inAt: at,
				lateMinutes: lateMinutes(at, DEFAULT_SHIFT),
				markedBy: userId,
			},
			saved ? saved.version : null,
		);
	}

	/** AT1: mark out after marking in; the day's status follows the hours. */
	async markOut(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<AttendanceDay> {
		const { e } = await this.me(principal);
		const saved = await this.days.get(e.id, istDay(now));
		if (!saved?.inAt) throw refuse('attendance_not_in');
		const at = now.toISOString();
		return this.saveOrConflict(
			{ ...saved, outAt: at, status: markedStatus(saved.inAt, at, DEFAULT_SHIFT) },
			saved.version,
		);
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
		const out: AttendanceDay[] = [];
		for (let d = ask.from; d <= ask.to; d = nextDay(d)) {
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

	/** AT2: a store's month, each person's days and what the lock will count. */
	async grid(
		principal: AuthenticatedPrincipal | undefined,
		month: string,
		locationId: string,
	): Promise<AttendanceMonthGrid> {
		await this.inScope(principal, locationId);
		const people = (await this.employees.list()).filter((e) => e.locationId === locationId);
		const days = await this.days.month(month, { locationId });
		const { states } = await this.rules.forMonth(month);
		const paid = new Map(states.flatMap((s) => (s.leaveTypes ?? []).map((t) => [t.key, t.paid] as const)));
		return {
			month,
			locationId,
			lockedAt: null,
			people: people.map((e) => {
				const mine = days.filter((d) => d.employeeId === e.id);
				const counted = monthFromDays(mine, (key) => paid.get(key) ?? 'unpaid');
				return {
					employeeId: e.id,
					name: e.name,
					days: mine,
					paidDays: counted.paidDays,
					leaveByType: counted.leaveByType,
					withoutPay: counted.withoutPay,
					lateMarks: mine.filter((d) => d.lateMinutes > 0).length,
				};
			}),
		};
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
		const saved = await this.days.get(employeeId, day);
		const base = saved ?? blankDay(e, day);
		const next: AttendanceDay = who.permissions.includes('attendance.edit')
			? { ...base, ...change, changedBy: who.userId, pending: null }
			: { ...base, pending: { ...change, askedBy: who.userId, askedAt: now.toISOString() } };
		return this.saveOrConflict(next, saved ? saved.version : null);
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
		const { askedBy: _a, askedAt: _b, ...change } = saved.pending;
		const next: AttendanceDay = approve
			? { ...saved, ...change, changedBy: who.userId, pending: null }
			: { ...saved, pending: null };
		return this.saveOrConflict(next, saved.version);
	}
}

const DayParams = z.object({ employeeId: z.string().min(1), day: IsoDate });
const GridQuery = z.object({ month: YearMonth, locationId: z.string().min(1) });

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/attendance')
export class AttendanceDaysController {
	constructor(private readonly attendance: AttendanceDaysService) {}

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
