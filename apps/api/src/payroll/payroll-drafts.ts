import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AttendanceRepository, PayrollRunRepository } from '@saha-textile/core-domain';

import { ATTENDANCE_REPOSITORY, PAYROLL_RUN_REPOSITORY } from '../infra/tokens';
import { PayrollService } from './payroll.service';

/** How often the job looks for a month ended with no draft yet. */
export const PAYROLL_DRAFT_SWEEP_MS = 15 * 60_000;

/** The month before the one an instant falls in, in India, and whether it is 06:00 there yet. */
export function draftDue(now: Date): { month: string; due: boolean } {
	const ist = new Date(now.getTime() + 5.5 * 3_600_000);
	const before = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
	return { month: before.toISOString().slice(0, 7), due: ist.getUTCDate() > 1 || ist.getUTCHours() >= 6 };
}

/**
 * Payslips made at the month's end (brief 26 PE1, PE-D1; approved 2026-11-26): from 06:00 on the 1st, the month just
 * ended gets a draft run worked out by the rules, once its attendance is locked; a month whose attendance is locked
 * later gets its draft then. A run already there (draft or further) is never touched by the job.
 */
@Injectable()
export class PayrollDraftsService implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('PayrollDrafts');
	private timer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(PayrollService) private readonly payroll: Pick<PayrollService, 'prepare'>,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'get'>,
		@Inject(ATTENDANCE_REPOSITORY) private readonly attendance: Pick<AttendanceRepository, 'get'>,
	) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.makeDue(), PAYROLL_DRAFT_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** The month just ended, drafted once its attendance is locked; nothing when it is not time or already there. */
	async makeDue(now = new Date()): Promise<string | null> {
		const { month, due } = draftDue(now);
		if (!due || (await this.runs.get(month))) return null;
		if (!(await this.attendance.get(month))?.lockedAt) return null;
		try {
			await this.payroll.prepare(month, now);
			return month;
		} catch (error) {
			this.logger.warn(`Draft for ${month} not made: ${(error as Error).message}`);
			return null;
		}
	}
}
