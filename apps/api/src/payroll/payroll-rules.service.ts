import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { PayrollRulesVersion, PayrollRulesWrite } from '@saha-textile/contracts';
import {
	PAYROLL_RULES_2026,
	PAYROLL_SCHEMES_2026,
	type AuditLogRepository,
	type PayrollRules,
	type PayrollRulesRepository,
	type PayrollRunRepository,
	type PayrollSchemes,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { AUDIT_LOG_REPOSITORY, PAYROLL_RULES_REPOSITORY, PAYROLL_RUN_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The built-in starting version: the 2026 pay rules and schemes, until a person adds a later one (S1). */
export const BUILT_IN_PAYROLL_RULES: PayrollRulesVersion = {
	...PAYROLL_RULES_2026,
	...PAYROLL_SCHEMES_2026,
	ptSlabs: [...PAYROLL_RULES_2026.ptSlabs],
	lwfMonths: [...PAYROLL_SCHEMES_2026.lwfMonths],
	from: PAYROLL_RULES_2026.from,
	note: '',
	id: 'prs_built_in',
	builtIn: true,
	createdBy: null,
	createdAt: '2026-04-01T00:00:00.000Z',
};

/** A stored version split into the month's pay rules and the scheme rules. */
export function rulesOf(v: PayrollRulesVersion): { pay: PayrollRules; schemes: PayrollSchemes; from: string } {
	return {
		from: v.from,
		pay: {
			from: v.from,
			pfRatePct: v.pfRatePct,
			pfWageCapPaise: v.pfWageCapPaise,
			epsRatePct: v.epsRatePct,
			epsCapPaise: v.epsCapPaise,
			esiEmployeePct: v.esiEmployeePct,
			esiEmployerPct: v.esiEmployerPct,
			esiGrossLimitPaise: v.esiGrossLimitPaise,
			ptSlabs: v.ptSlabs,
			maxDeductionPct: v.maxDeductionPct,
		},
		schemes: {
			from: v.from,
			pfAdminPct: v.pfAdminPct,
			pfAdminMinPaise: v.pfAdminMinPaise,
			edliPct: v.edliPct,
			pfHeadcount: v.pfHeadcount,
			esiHeadcount: v.esiHeadcount,
			bonusHeadcount: v.bonusHeadcount,
			bonusWarnAt: v.bonusWarnAt,
			gratuityHeadcount: v.gratuityHeadcount,
			gratuityDaysPerYear: v.gratuityDaysPerYear,
			gratuityMonthDays: v.gratuityMonthDays,
			lwfEmployeePaise: v.lwfEmployeePaise,
			lwfEmployerPaise: v.lwfEmployerPaise,
			lwfMonths: v.lwfMonths,
			pfDueDay: v.pfDueDay,
			esiDueDay: v.esiDueDay,
			ptDueDay: v.ptDueDay,
			lwfDueDay: v.lwfDueDay,
		},
	};
}

/**
 * Settings › Payroll rules (accounts brief S1). Each version is dated; a month uses the version in force on its last
 * day, so a law change never alters a month already approved. A new version can't start on or before a month whose
 * payroll is already approved, posted or paid.
 */
@Injectable()
export class PayrollRulesService {
	constructor(
		@Inject(PAYROLL_RULES_REPOSITORY) private readonly store: PayrollRulesRepository,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly runs: Pick<PayrollRunRepository, 'list'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	/** Every version, oldest first, the built-in one included. */
	async list(): Promise<PayrollRulesVersion[]> {
		const stored = await this.store.list();
		return [BUILT_IN_PAYROLL_RULES, ...stored].sort((a, b) => a.from.localeCompare(b.from));
	}

	/** The rules in force on a month's last day (the built-in version for months before it too). */
	async forMonth(month: string): Promise<ReturnType<typeof rulesOf>> {
		const end = monthEnd(month);
		const versions = await this.list();
		const inForce = versions.filter((v) => v.from <= end).at(-1) ?? BUILT_IN_PAYROLL_RULES;
		return rulesOf(inForce);
	}

	async add(write: PayrollRulesWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const closed = (await this.runs.list()).filter((r) => r.status !== 'draft').map((r) => monthEnd(r.month));
		if (closed.some((end) => write.from <= end)) throw refuse('payroll_rules_before_approved');
		const version: PayrollRulesVersion = {
			...write,
			id: `prs_${write.from}`,
			builtIn: false,
			createdBy: principal?.userId ?? null,
			createdAt: now.toISOString(),
		};
		try {
			await this.store.insert(version);
		} catch (error) {
			if (error instanceof Error && error.message === 'payroll_rules_from_taken')
				throw new ConflictException(accountsRefusal('payroll_rules_from_taken'));
			throw error;
		}
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: version.createdBy,
			targetUserId: null,
			audience: 'admin',
			action: 'payroll.rules.add',
			entityType: 'payrollRules',
			entityId: version.id,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: { from: version.from },
			requestId: null,
			ipHash: null,
			createdAt: version.createdAt,
		} as never);
		return version;
	}
}
