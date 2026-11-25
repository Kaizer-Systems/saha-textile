import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { GST_STATES } from '@saha-textile/core-domain/company';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type {
	IncomeTaxRules,
	PayrollRulesVersion,
	PayrollRulesWriteInput,
	PtFrequency,
	StatePayrollRules,
} from '@saha-textile/contracts';

const inr = (paise: number) => paise / 100;
const paise = (rupees: number) => Math.round(rupees * 100);
const num = (n: number) => n.toLocaleString('en-IN');

/** A State's professional tax and welfare fund in the form (brief 25 ST1), money in rupees, months as "6, 12". */
export interface StateForm {
	stateCode: string;
	ptFrequency: PtFrequency;
	ptSlabs: { upTo: number | null; tax: number }[];
	ptMonths: string;
	ptDueDay: number;
	lwfEmployee: number;
	lwfEmployer: number;
	lwfMonths: string;
	lwfDueDay: number;
}

/** The State whose set an older version's company-wide figures are. */
const LEGACY_STATE = '19';

/** "6, 12" → [6, 12]; anything not a month left out. */
export function monthList(text: string): number[] {
	return text
		.split(',')
		.map((m) => Number(m.trim()))
		.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
}

/** A version's State sets: its own, or one from the company-wide figures of an older version. */
export function statesOf(v: PayrollRulesVersion): StatePayrollRules[] {
	if (v.states?.length) return v.states;
	return [
		{
			stateCode: LEGACY_STATE,
			ptFrequency: 'monthly',
			ptSlabs: v.ptSlabs,
			ptMonths: [],
			ptDueDay: v.ptDueDay,
			lwfEmployeePaise: v.lwfEmployeePaise,
			lwfEmployerPaise: v.lwfEmployerPaise,
			lwfMonths: v.lwfMonths,
			lwfDueDay: v.lwfDueDay,
		},
	];
}

export function stateToForm(s: StatePayrollRules): StateForm {
	return {
		stateCode: s.stateCode,
		ptFrequency: s.ptFrequency,
		ptSlabs: s.ptSlabs.map((x) => ({ upTo: x.upToPaise === null ? null : inr(x.upToPaise), tax: inr(x.taxPaise) })),
		ptMonths: s.ptMonths.join(', '),
		ptDueDay: s.ptDueDay,
		lwfEmployee: inr(s.lwfEmployeePaise),
		lwfEmployer: inr(s.lwfEmployerPaise),
		lwfMonths: s.lwfMonths.join(', '),
		lwfDueDay: s.lwfDueDay,
	};
}

export function stateToWrite(s: StateForm): StatePayrollRules {
	return {
		stateCode: s.stateCode,
		ptFrequency: s.ptFrequency,
		ptSlabs:
			s.ptFrequency === 'none'
				? []
				: s.ptSlabs.map((x) => ({ upToPaise: x.upTo === null ? null : paise(x.upTo), taxPaise: paise(x.tax) })),
		ptMonths: s.ptFrequency === 'half_yearly' || s.ptFrequency === 'yearly' ? monthList(s.ptMonths) : [],
		ptDueDay: s.ptDueDay,
		lwfEmployeePaise: paise(s.lwfEmployee),
		lwfEmployerPaise: paise(s.lwfEmployer),
		lwfMonths: monthList(s.lwfMonths),
		lwfDueDay: s.lwfDueDay,
	};
}

/** A State's name from its GST code. */
export function stateName(code: string): string {
	return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

export type SlabGroup = 'newSlabs' | 'oldSlabsBelow60' | 'oldSlabs60To79' | 'oldSlabs80Plus';
export type TierGroup = 'newSurcharge' | 'oldSurcharge';
export const SLAB_GROUPS: SlabGroup[] = ['newSlabs', 'oldSlabsBelow60', 'oldSlabs60To79', 'oldSlabs80Plus'];
export const TIER_GROUPS: TierGroup[] = ['newSurcharge', 'oldSurcharge'];

/** TX2: income tax in the form, money in rupees; a slab with an empty "up to" is the open top slab. */
export interface IncomeTaxForm {
	slabs: Record<SlabGroup, { upTo: number | null; rate: number }[]>;
	tiers: Record<TierGroup, { over: number; rate: number }[]>;
	newStandard: number;
	newRebateUpTo: number;
	oldStandard: number;
	oldRebateUpTo: number;
	oldRebateMax: number;
	cessPct: number;
	limit80c: number;
	limit80d: number;
	limitHomeLoan: number;
	proofFromMonth: number;
}

export function taxToForm(t: IncomeTaxRules): IncomeTaxForm {
	const slabs = (list: IncomeTaxRules['newSlabs']) =>
		list.map((x) => ({ upTo: x.upToPaise === null ? null : inr(x.upToPaise), rate: x.ratePct }));
	const tiers = (list: IncomeTaxRules['newSurcharge']) =>
		list.map((x) => ({ over: inr(x.overPaise), rate: x.ratePct }));
	return {
		slabs: {
			newSlabs: slabs(t.newSlabs),
			oldSlabsBelow60: slabs(t.oldSlabsBelow60),
			oldSlabs60To79: slabs(t.oldSlabs60To79),
			oldSlabs80Plus: slabs(t.oldSlabs80Plus),
		},
		tiers: { newSurcharge: tiers(t.newSurcharge), oldSurcharge: tiers(t.oldSurcharge) },
		newStandard: inr(t.newStandardDeductionPaise),
		newRebateUpTo: inr(t.newRebateUpToPaise),
		oldStandard: inr(t.oldStandardDeductionPaise),
		oldRebateUpTo: inr(t.oldRebateUpToPaise),
		oldRebateMax: inr(t.oldRebateMaxPaise),
		cessPct: t.cessPct,
		limit80c: inr(t.limit80cPaise),
		limit80d: inr(t.limit80dPaise),
		limitHomeLoan: inr(t.limitHomeLoanPaise),
		proofFromMonth: t.proofFromMonth,
	};
}

export function taxToWrite(f: IncomeTaxForm): IncomeTaxRules {
	const slabs = (list: IncomeTaxForm['slabs']['newSlabs']) =>
		list.map((x) => ({ upToPaise: x.upTo === null ? null : paise(x.upTo), ratePct: x.rate }));
	const tiers = (list: IncomeTaxForm['tiers']['newSurcharge']) =>
		list.map((x) => ({ overPaise: paise(x.over), ratePct: x.rate }));
	return {
		newSlabs: slabs(f.slabs.newSlabs),
		newStandardDeductionPaise: paise(f.newStandard),
		newRebateUpToPaise: paise(f.newRebateUpTo),
		newSurcharge: tiers(f.tiers.newSurcharge),
		oldSlabsBelow60: slabs(f.slabs.oldSlabsBelow60),
		oldSlabs60To79: slabs(f.slabs.oldSlabs60To79),
		oldSlabs80Plus: slabs(f.slabs.oldSlabs80Plus),
		oldStandardDeductionPaise: paise(f.oldStandard),
		oldRebateUpToPaise: paise(f.oldRebateUpTo),
		oldRebateMaxPaise: paise(f.oldRebateMax),
		oldSurcharge: tiers(f.tiers.oldSurcharge),
		cessPct: f.cessPct,
		limit80cPaise: paise(f.limit80c),
		limit80dPaise: paise(f.limit80d),
		limitHomeLoanPaise: paise(f.limitHomeLoan),
		proofFromMonth: f.proofFromMonth,
	};
}

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
	/** ST1: each State's professional tax and welfare fund. */
	states: StateForm[];
	/** TX2: income tax on salary (null only for a version the screens got without it). */
	incomeTax: IncomeTaxForm | null;
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
		states: statesOf(v).map(stateToForm),
		incomeTax: v.incomeTax ? taxToForm(v.incomeTax) : null,
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
		lwfMonths: monthList(f.lwfMonths),
		pfDueDay: f.pfDueDay,
		esiDueDay: f.esiDueDay,
		ptDueDay: f.ptDueDay,
		lwfDueDay: f.lwfDueDay,
		states: f.states.map(stateToWrite),
		...(f.incomeTax ? { incomeTax: taxToWrite(f.incomeTax) } : {}),
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
	// ST1: professional tax and the welfare fund, a row each per State.
	const stateRows = statesOf(v).flatMap((st) => {
		const taxes = st.ptSlabs.filter((s) => s.taxPaise > 0).map((s) => `₹${num(inr(s.taxPaise))}`);
		const freeUpTo = st.ptSlabs.find((s) => s.taxPaise === 0)?.upToPaise ?? 0;
		const state = stateName(st.stateCode);
		const ptKey = { monthly: 'pt', half_yearly: 'pt_period', yearly: 'pt_period', none: 'pt_none' }[st.ptFrequency];
		return [
			{
				key: ptKey,
				from: v.from,
				values: {
					state,
					taxes: taxes.join(' / '),
					over: num(inr(freeUpTo)),
					months: st.ptMonths.join(', '),
					day: num(st.ptDueDay),
				},
			},
			{
				key: 'lwf',
				from: v.from,
				values: {
					state,
					ee: num(inr(st.lwfEmployeePaise)),
					er: num(inr(st.lwfEmployerPaise)),
					months: st.lwfMonths.join(', '),
					day: num(st.lwfDueDay),
				},
			},
		];
	});
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
		...stateRows,
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
		v.incomeTax
			? {
					key: 'tds',
					from: v.from,
					values: {
						std: num(inr(v.incomeTax.newStandardDeductionPaise)),
						rebate: num(inr(v.incomeTax.newRebateUpToPaise)),
						oldStd: num(inr(v.incomeTax.oldStandardDeductionPaise)),
						cess: num(v.incomeTax.cessPct),
					},
				}
			: { key: 'tds', from: null, values: {} },
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
		this.stateAt.set(0);
		this.modal = this.modals.open(template, { centered: true, size: 'xl', scrollable: true });
	}

	patch(fields: Partial<RulesForm>): void {
		this.form.update((f) => (f ? { ...f, ...fields } : f));
	}

	/** ST1: the State shown in the form, by its place in the list, and the State picked to add. */
	readonly stateAt = signal(0);
	readonly stateToAdd = signal('');
	readonly stateName = stateName;
	readonly stateChoices = GST_STATES.filter((s) => !s.retired);
	readonly picked = computed(() => this.form()?.states[this.stateAt()] ?? null);
	readonly frequencies: PtFrequency[] = ['monthly', 'half_yearly', 'yearly', 'none'];

	/** TX2: the income-tax slab tables and surcharge tiers in the form. */
	readonly slabGroups = SLAB_GROUPS;
	readonly tierGroups = TIER_GROUPS;

	private patchTaxForm(change: (t: IncomeTaxForm) => IncomeTaxForm): void {
		this.form.update((f) => (f?.incomeTax ? { ...f, incomeTax: change(f.incomeTax) } : f));
	}

	patchTax(fields: Partial<Omit<IncomeTaxForm, 'slabs' | 'tiers'>>): void {
		this.patchTaxForm((t) => ({ ...t, ...fields }));
	}

	setTaxSlab(group: SlabGroup, index: number, patch: Partial<IncomeTaxForm['slabs'][SlabGroup][number]>): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: { ...t.slabs, [group]: t.slabs[group].map((x, i) => (i === index ? { ...x, ...patch } : x)) },
		}));
	}

	addTaxSlab(group: SlabGroup): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: {
				...t.slabs,
				[group]: [...t.slabs[group].slice(0, -1), { upTo: 0, rate: 0 }, ...t.slabs[group].slice(-1)],
			},
		}));
	}

	removeTaxSlab(group: SlabGroup, index: number): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: { ...t.slabs, [group]: t.slabs[group].filter((_, i) => i !== index) },
		}));
	}

	setTier(group: TierGroup, index: number, patch: Partial<IncomeTaxForm['tiers'][TierGroup][number]>): void {
		this.patchTaxForm((t) => ({
			...t,
			tiers: { ...t.tiers, [group]: t.tiers[group].map((x, i) => (i === index ? { ...x, ...patch } : x)) },
		}));
	}

	addTier(group: TierGroup): void {
		this.patchTaxForm((t) => ({ ...t, tiers: { ...t.tiers, [group]: [...t.tiers[group], { over: 0, rate: 0 }] } }));
	}

	removeTier(group: TierGroup, index: number): void {
		this.patchTaxForm((t) => ({
			...t,
			tiers: { ...t.tiers, [group]: t.tiers[group].filter((_, i) => i !== index) },
		}));
	}

	hasState(code: string): boolean {
		return !!this.form()?.states.some((s) => s.stateCode === code);
	}

	patchState(fields: Partial<StateForm>): void {
		const at = this.stateAt();
		this.form.update((f) =>
			f ? { ...f, states: f.states.map((s, i) => (i === at ? { ...s, ...fields } : s)) } : f,
		);
	}

	setSlab(index: number, patch: Partial<StateForm['ptSlabs'][number]>): void {
		const st = this.picked();
		if (st) this.patchState({ ptSlabs: st.ptSlabs.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
	}

	/** A slab added below the open top slab. */
	addSlab(): void {
		const st = this.picked();
		if (st)
			this.patchState({ ptSlabs: [...st.ptSlabs.slice(0, -1), { upTo: 0, tax: 0 }, ...st.ptSlabs.slice(-1)] });
	}

	removeSlab(index: number): void {
		const st = this.picked();
		if (st) this.patchState({ ptSlabs: st.ptSlabs.filter((_, i) => i !== index) });
	}

	/** "Add a State": its set starts empty (no tax until its slabs are entered) and is shown at once. */
	addState(): void {
		const code = this.stateToAdd();
		const f = this.form();
		if (!f || !code || f.states.some((s) => s.stateCode === code)) return;
		this.form.set({
			...f,
			states: [
				...f.states,
				{
					stateCode: code,
					ptFrequency: 'monthly',
					ptSlabs: [{ upTo: null, tax: 0 }],
					ptMonths: '',
					ptDueDay: 21,
					lwfEmployee: 0,
					lwfEmployer: 0,
					lwfMonths: '',
					lwfDueDay: 15,
				},
			],
		});
		this.stateAt.set(f.states.length);
		this.stateToAdd.set('');
	}

	removeState(index: number): void {
		this.form.update((f) => (f ? { ...f, states: f.states.filter((_, i) => i !== index) } : f));
		this.stateAt.set(0);
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
