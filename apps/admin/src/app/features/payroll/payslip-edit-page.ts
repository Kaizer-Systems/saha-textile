import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	minimumWageShortfall,
	NO_EDITS,
	payslipChecks,
	payslipFromLines,
	ptPersonOf,
	rupeesInWords,
	statePt,
	type StateRules,
} from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { inForce } from './payroll-rules-page';

import type { AddedPayslipLine, PayrollRow, PayslipByRules, PayslipEditsInput } from '@saha-textile/contracts';

type Head = 'basic' | 'da' | 'hra' | 'conveyance' | 'special' | 'other';
type Deduction = 'pf' | 'esi' | 'pt' | 'tds' | 'advance';
export const PAYSLIP_HEADS: readonly Head[] = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'];
export const PAYSLIP_DEDUCTIONS: readonly Deduction[] = ['pf', 'esi', 'pt', 'tds', 'advance'];
export const EARNING_KINDS = ['taxable', 'exempt', 'reimbursement', 'arrears'] as const;
export const DEDUCTION_KINDS = ['after_tax', 'before_tax', 'tax_adjustment'] as const;

const EMPTY: PayslipEditsInput = { heads: {}, added: [], deductions: {}, reasons: {} };
const monthEnd = (month: string) =>
	`${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** The payslip as the rules made it: kept on an edited row, else the row itself. */
export function rulesOf(row: PayrollRow): PayslipByRules {
	return (
		row.byRules ?? {
			headsPaise: { ...(row.headsPaise ?? {}) },
			grossPaise: row.grossPaise,
			pfEmployeePaise: row.pfEmployeePaise,
			pfEmployerPaise: row.pfEmployerPaise,
			esiEmployeePaise: row.esiEmployeePaise,
			esiEmployerPaise: row.esiEmployerPaise,
			ptPaise: row.ptPaise,
			tdsPaise: row.tdsPaise,
			advancePaise: row.advancePaise,
			netPaise: row.netPaise,
		}
	);
}

/**
 * Edit payslip (brief 26 PE2, approved 2026-11-26): every line of a draft payslip editable, lines added in any
 * section, and the payslip worked out again on every keystroke by the same rules the run uses (PF, ESI and the
 * State's tax follow the lines typed); each line typed over keeps "By the rules" beside it with ↺ and asks why; the
 * checks show what blocks publishing and what only warns. Saved to the draft run.
 */
@Component({
	selector: 'app-payslip-edit-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './payslip-edit-page.html',
})
export class PayslipEditPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly month = toSignal(this.route.paramMap.pipe(map((p) => p.get('month') ?? '')), { initialValue: '' });
	readonly employeeId = toSignal(this.route.paramMap.pipe(map((p) => p.get('employeeId') ?? '')), {
		initialValue: '',
	});
	readonly money = rupees;
	readonly heads = PAYSLIP_HEADS;
	readonly deductionKeys = PAYSLIP_DEDUCTIONS;
	readonly earningKinds = EARNING_KINDS;
	readonly deductionKinds = DEDUCTION_KINDS;
	readonly busy = signal(false);

	readonly run = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.run(this.month()),
		queryFn: () => firstValueFrom(this.gateway.run(this.month())),
		enabled: !!this.month(),
	}));
	readonly employees = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.employees,
		queryFn: () => firstValueFrom(this.gateway.employees()),
	}));
	readonly versions = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.rules,
		queryFn: () => firstValueFrom(this.gateway.rules()),
	}));

	readonly row = computed(() => this.run.data()?.rows.find((r) => r.employeeId === this.employeeId()) ?? null);
	readonly employee = computed(() => this.employees.data()?.find((e) => e.id === this.employeeId()) ?? null);
	readonly version = computed(() => inForce(this.versions.data() ?? [], monthEnd(this.month())));
	readonly stateRules = computed(
		() =>
			(this.version()?.states?.find((s) => s.stateCode === this.row()?.stateCode) as unknown as StateRules) ??
			null,
	);
	readonly draft = computed(() => this.run.data()?.status === 'draft');

	/** What is typed: the row's saved edits until changed here. */
	readonly edits = signal<PayslipEditsInput>(EMPTY);
	private loaded = '';

	constructor() {
		effect(() => {
			const row = this.row();
			const key = `${this.month()}/${row?.employeeId ?? ''}`;
			if (row && this.loaded !== key) {
				this.loaded = key;
				this.edits.set(structuredClone(row.edits ?? EMPTY));
			}
		});
	}

	readonly base = computed(() => {
		const row = this.row();
		return row ? rulesOf(row) : null;
	});

	private readonly ptFor = (gross: number): number => {
		const base = this.base();
		const e = this.employee();
		const state = this.stateRules();
		if (base && gross === base.grossPaise) return base.ptPaise;
		return state && e ? statePt(this.month(), gross, state, ptPersonOf(e, this.month())) : 0;
	};

	private worked(edits: PayslipEditsInput) {
		const base = this.base();
		const e = this.employee();
		const v = this.version();
		if (!base || !e || !v) return null;
		return payslipFromLines({
			rulesHeads: Object.fromEntries(PAYSLIP_HEADS.map((h) => [h, base.headsPaise[h] ?? 0])) as Record<
				Head,
				number
			>,
			edits,
			pfOn: e.pfOn,
			esiOn: e.esiOn,
			// The admin's compiler reads the contract's nested fields as optional; the version parsed by the API has them.
			rules: v as unknown as Parameters<typeof payslipFromLines>[0]['rules'],
			ptFor: this.ptFor,
			tdsPaise: base.tdsPaise,
			advancePaise: base.advancePaise,
		});
	}

	/** The payslip as typed, and as the rules made it, worked out live. */
	readonly lines = computed(() => this.worked(this.edits()));
	readonly byRules = computed(() => this.worked(NO_EDITS));

	readonly checks = computed(() => {
		const lines = this.lines();
		const byRules = this.byRules();
		if (!lines || !byRules) return [];
		return payslipChecks({
			edited: lines,
			byRules,
			edits: this.edits(),
			ptFor: this.ptFor,
			minimumWageShortfallPaise: minimumWageShortfall(
				lines.heads,
				this.employee()?.skillLevel,
				this.stateRules()?.minimumWages,
				monthEnd(this.month()),
			),
		});
	});
	readonly blocking = computed(() => this.checks().some((c) => c.blocking));
	readonly inWords = computed(() => rupeesInWords((this.lines()?.netPaise ?? 0) / 100));
	readonly deductionsTotal = (l: NonNullable<ReturnType<PayslipEditPage['worked']>>) =>
		l.grossPaise + l.reimbursementsPaise - l.netPaise;

	/** A line by the rules (a head or a deduction), for "By the rules". */
	rule(key: Head | Deduction): number {
		const l = this.byRules();
		if (!l) return 0;
		if ((PAYSLIP_HEADS as readonly string[]).includes(key)) return l.heads[key as Head];
		return {
			pf: l.pfEmployeePaise,
			esi: l.esiEmployeePaise,
			pt: l.ptPaise,
			tds: l.tdsPaise,
			advance: l.advancePaise,
		}[key as Deduction];
	}

	/** A line as it stands on this payslip. */
	now(key: Head | Deduction): number {
		const l = this.lines();
		if (!l) return 0;
		if ((PAYSLIP_HEADS as readonly string[]).includes(key)) return l.heads[key as Head];
		return {
			pf: l.pfEmployeePaise,
			esi: l.esiEmployeePaise,
			pt: l.ptPaise,
			tds: l.tdsPaise,
			advance: l.advancePaise,
		}[key as Deduction];
	}

	typed(key: Head | Deduction): boolean {
		const e = this.edits();
		return (PAYSLIP_HEADS as readonly string[]).includes(key)
			? e.heads[key as Head] !== undefined
			: e.deductions[key as Deduction] !== undefined;
	}

	/** A line typed in rupees; a cleared box goes back to the rules. */
	setLine(key: Head | Deduction, value: unknown): void {
		const paise =
			value === '' || value === null || value === undefined
				? undefined
				: Math.max(0, Math.round(Number(value) * 100) || 0);
		const isHead = (PAYSLIP_HEADS as readonly string[]).includes(key);
		this.edits.update((e) => {
			const group = { ...(isHead ? e.heads : e.deductions) } as Record<string, number | undefined>;
			if (paise === undefined) delete group[key];
			else group[key] = paise;
			return isHead ? { ...e, heads: group } : { ...e, deductions: group };
		});
	}

	/** ↺: back to the rules, and its reason with it. */
	reset(key: Head | Deduction): void {
		this.setLine(key, null);
		this.setReason(key, '');
	}

	setReason(key: string, reason: string): void {
		this.edits.update((e) => {
			const reasons = { ...e.reasons };
			if (reason) reasons[key] = reason;
			else delete reasons[key];
			return { ...e, reasons };
		});
	}

	readonly newKind = signal<AddedPayslipLine['kind']>('taxable');
	readonly newDeductionKind = signal<AddedPayslipLine['kind']>('after_tax');

	addLine(kind: AddedPayslipLine['kind']): void {
		this.edits.update((e) => ({
			...e,
			added: [
				...e.added,
				{ id: `l${Date.now().toString(36)}${e.added.length}`, kind, name: '', paise: 0, oneOff: true },
			],
		}));
	}

	setAdded(id: string, fields: Partial<AddedPayslipLine>): void {
		this.edits.update((e) => ({ ...e, added: e.added.map((l) => (l.id === id ? { ...l, ...fields } : l)) }));
	}

	/** An added line's amount typed in rupees (never below nothing). */
	setAmount(id: string, value: unknown): void {
		this.setAdded(id, { paise: Math.max(0, Math.round(Number(value) * 100) || 0) });
	}

	/** The word for a line a check is about: a head or a deduction. */
	readonly lineWord = (line: string) =>
		(PAYSLIP_HEADS as readonly string[]).includes(line) ? `payroll_head_${line}` : `pe_deduction_${line}`;

	removeAdded(id: string): void {
		this.edits.update((e) => ({ ...e, added: e.added.filter((l) => l.id !== id) }));
	}

	readonly earningLines = computed(() =>
		this.edits().added.filter((l) => (EARNING_KINDS as readonly string[]).includes(l.kind)),
	);
	readonly deductionLines = computed(() =>
		this.edits().added.filter((l) => (DEDUCTION_KINDS as readonly string[]).includes(l.kind)),
	);
	/** An added line needs a name before it is saved. */
	readonly unnamed = computed(() => this.edits().added.some((l) => !l.name.trim()));

	async save(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.editPayslip(this.month(), this.employeeId(), this.edits()));
			this.notifier.showSuccess(this.transloco.translate('pe_saved'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
			await this.router.navigate(['/payroll/runs'], { queryParams: { month: this.month() } });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
