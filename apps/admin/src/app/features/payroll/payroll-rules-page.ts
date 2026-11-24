import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { PayrollRulesVersion, PayrollRulesWriteInput } from '@saha-textile/contracts';

const inr = (paise: number) => paise / 100;
const paise = (rupees: number) => Math.round(rupees * 100);
const num = (n: number) => n.toLocaleString('en-IN');

/** The version form, money in rupees; slabs with an empty "up to" are the open top slab. */
export interface RulesForm {
	from: string;
	note: string;
	pfRatePct: number;
	pfWageCap: number;
	epsRatePct: number;
	epsCap: number;
	esiEmployeePct: number;
	esiEmployerPct: number;
	esiGrossLimit: number;
	ptSlabs: { upTo: number | null; tax: number }[];
	maxDeductionPct: number;
	pfAdminPct: number;
	pfAdminMin: number;
	edliPct: number;
	pfHeadcount: number;
	esiHeadcount: number;
	bonusHeadcount: number;
	bonusWarnAt: number;
	gratuityHeadcount: number;
	gratuityDaysPerYear: number;
	gratuityMonthDays: number;
	lwfEmployee: number;
	lwfEmployer: number;
	lwfMonths: string;
	pfDueDay: number;
	esiDueDay: number;
	ptDueDay: number;
	lwfDueDay: number;
}

export function toForm(v: PayrollRulesVersion, from: string): RulesForm {
	return {
		from,
		note: '',
		pfRatePct: v.pfRatePct,
		pfWageCap: inr(v.pfWageCapPaise),
		epsRatePct: v.epsRatePct,
		epsCap: inr(v.epsCapPaise),
		esiEmployeePct: v.esiEmployeePct,
		esiEmployerPct: v.esiEmployerPct,
		esiGrossLimit: inr(v.esiGrossLimitPaise),
		ptSlabs: v.ptSlabs.map((s) => ({ upTo: s.upToPaise === null ? null : inr(s.upToPaise), tax: inr(s.taxPaise) })),
		maxDeductionPct: v.maxDeductionPct,
		pfAdminPct: v.pfAdminPct,
		pfAdminMin: inr(v.pfAdminMinPaise),
		edliPct: v.edliPct,
		pfHeadcount: v.pfHeadcount,
		esiHeadcount: v.esiHeadcount,
		bonusHeadcount: v.bonusHeadcount,
		bonusWarnAt: v.bonusWarnAt,
		gratuityHeadcount: v.gratuityHeadcount,
		gratuityDaysPerYear: v.gratuityDaysPerYear,
		gratuityMonthDays: v.gratuityMonthDays,
		lwfEmployee: inr(v.lwfEmployeePaise),
		lwfEmployer: inr(v.lwfEmployerPaise),
		lwfMonths: v.lwfMonths.join(', '),
		pfDueDay: v.pfDueDay,
		esiDueDay: v.esiDueDay,
		ptDueDay: v.ptDueDay,
		lwfDueDay: v.lwfDueDay,
	};
}

export function toWrite(f: RulesForm): PayrollRulesWriteInput {
	return {
		from: f.from,
		note: f.note,
		pfRatePct: f.pfRatePct,
		pfWageCapPaise: paise(f.pfWageCap),
		epsRatePct: f.epsRatePct,
		epsCapPaise: paise(f.epsCap),
		esiEmployeePct: f.esiEmployeePct,
		esiEmployerPct: f.esiEmployerPct,
		esiGrossLimitPaise: paise(f.esiGrossLimit),
		ptSlabs: f.ptSlabs.map((s) => ({ upToPaise: s.upTo === null ? null : paise(s.upTo), taxPaise: paise(s.tax) })),
		maxDeductionPct: f.maxDeductionPct,
		pfAdminPct: f.pfAdminPct,
		pfAdminMinPaise: paise(f.pfAdminMin),
		edliPct: f.edliPct,
		pfHeadcount: f.pfHeadcount,
		esiHeadcount: f.esiHeadcount,
		bonusHeadcount: f.bonusHeadcount,
		bonusWarnAt: f.bonusWarnAt,
		gratuityHeadcount: f.gratuityHeadcount,
		gratuityDaysPerYear: f.gratuityDaysPerYear,
		gratuityMonthDays: f.gratuityMonthDays,
		lwfEmployeePaise: paise(f.lwfEmployee),
		lwfEmployerPaise: paise(f.lwfEmployer),
		lwfMonths: f.lwfMonths
			.split(',')
			.map((m) => Number(m.trim()))
			.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
		pfDueDay: f.pfDueDay,
		esiDueDay: f.esiDueDay,
		ptDueDay: f.ptDueDay,
		lwfDueDay: f.lwfDueDay,
	};
}

/** The version in force on a day: the last one starting on or before it. */
export function inForce(versions: readonly PayrollRulesVersion[], day: string): PayrollRulesVersion | null {
	return versions.filter((v) => v.from <= day).at(-1) ?? versions[0] ?? null;
}

/** S1's rows for a version: each rule's words and their figures. */
export function ruleRows(
	v: PayrollRulesVersion,
): { key: string; from: string | null; values: Record<string, string> }[] {
	const taxes = v.ptSlabs.filter((s) => s.taxPaise > 0).map((s) => `₹${num(inr(s.taxPaise))}`);
	const freeUpTo = v.ptSlabs.find((s) => s.taxPaise === 0)?.upToPaise ?? 0;
	return [
		{ key: 'wages', from: null, values: {} },
		{
			key: 'pf',
			from: v.from,
			values: {
				rate: num(v.pfRatePct),
				eps: num(v.epsRatePct),
				cap: num(inr(v.pfWageCapPaise)),
				admin: num(v.pfAdminPct),
				adminMin: num(inr(v.pfAdminMinPaise)),
				edli: num(v.edliPct),
				n: num(v.pfHeadcount),
				day: num(v.pfDueDay),
			},
		},
		{
			key: 'esi',
			from: v.from,
			values: {
				ee: num(v.esiEmployeePct),
				er: num(v.esiEmployerPct),
				limit: num(inr(v.esiGrossLimitPaise)),
				n: num(v.esiHeadcount),
				day: num(v.esiDueDay),
			},
		},
		{
			key: 'pt',
			from: v.from,
			values: { taxes: taxes.join(' / '), over: num(inr(freeUpTo)), day: num(v.ptDueDay) },
		},
		{
			key: 'lwf',
			from: v.from,
			values: {
				ee: num(inr(v.lwfEmployeePaise)),
				er: num(inr(v.lwfEmployerPaise)),
				months: v.lwfMonths.join(', '),
				day: num(v.lwfDueDay),
			},
		},
		{ key: 'deductions', from: v.from, values: { pct: num(v.maxDeductionPct) } },
		{ key: 'bonus', from: null, values: { n: num(v.bonusHeadcount), warn: num(v.bonusWarnAt) } },
		{
			key: 'gratuity',
			from: null,
			values: {
				days: num(v.gratuityDaysPerYear),
				monthDays: num(v.gratuityMonthDays),
				n: num(v.gratuityHeadcount),
			},
		},
		{ key: 'tds', from: null, values: {} },
		{ key: 'min_wages', from: null, values: {} },
	];
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings › Payroll rules (accounts brief S1): each rule as a dated version, the one in force today shown in words; a
 * law change is added as a new version from the day it applies, and earlier months keep the old one.
 */
@Component({
	selector: 'app-payroll-rules-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './payroll-rules-page.html',
})
export class PayrollRulesPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly versions = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.rules,
		queryFn: () => firstValueFrom(this.gateway.rules()),
	}));
	readonly current = computed(() => inForce(this.versions.data() ?? [], istToday()));
	readonly rows = computed(() => {
		const v = this.current();
		return v ? ruleRows(v) : [];
	});
	readonly form = signal<RulesForm | null>(null);
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	day(date: string | null): string {
		return shortDate(date);
	}

	open(template: TemplateRef<unknown>): void {
		const v = this.current();
		if (!v) return;
		this.form.set(toForm(v, istToday()));
		this.modal = this.modals.open(template, { centered: true, size: 'xl', scrollable: true });
	}

	patch(fields: Partial<RulesForm>): void {
		this.form.update((f) => (f ? { ...f, ...fields } : f));
	}

	setSlab(index: number, patch: Partial<RulesForm['ptSlabs'][number]>): void {
		this.form.update((f) =>
			f ? { ...f, ptSlabs: f.ptSlabs.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : f,
		);
	}

	async save(): Promise<void> {
		const f = this.form();
		if (!f) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.addRules(toWrite(f)));
			this.notifier.showSuccess(this.transloco.translate('payroll_rules_added'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.rules });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
