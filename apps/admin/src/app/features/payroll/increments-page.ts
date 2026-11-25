import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';

import { RevisePayPopup } from './revise-pay-popup';

import type { EmployeeView, IncrementPlan, IncrementRowsInputValue } from '@saha-textile/contracts';

type PlanKind = IncrementPlan['kind'];

/** 1 April of the coming financial year, in India: where a cycle usually starts. */
export function nextCycleStart(now = new Date()): string {
	const ist = new Date(now.getTime() + 5.5 * 3_600_000);
	const year = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() + 1 : ist.getUTCFullYear();
	return `${year}-04-01`;
}

/** The brief's example bands (TCS's FY26 cycle as reported, rounded): a starting point, edited freely. */
export const STARTING_BANDS = [
	{ rating: 'A+', pct: 12 },
	{ rating: 'A', pct: 8 },
	{ rating: 'B', pct: 3 },
	{ rating: 'C', pct: 0 },
];

/**
 * Payroll › Increments (brief 26 SR3, approved 2026-11-26): an increment cycle for many people at once. Who (store,
 * department, joined before), the plan (by rating band, the same %, or the same amount; saved by name and reused),
 * each row's rating and % typed over, every row worked out as a single revision is, the year's cost, the Export menu,
 * and Accept for the rows selected; a row with a blocking check is never selected.
 */
@Component({
	selector: 'app-increments-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective, ExportMenu],
	templateUrl: './increments-page.html',
})
export class IncrementsPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);

	readonly from = signal(nextCycleStart());
	readonly reason = signal('');
	readonly store = signal('');
	readonly department = signal('');
	readonly joinedBefore = signal('');
	readonly planName = signal('');
	readonly kind = signal<PlanKind>('rating');
	readonly bands = signal(STARTING_BANDS.map((b) => ({ ...b })));
	readonly pct = signal(5);
	readonly amountMonth = signal(1_000);
	/** Each person's rating, % typed over, and whether they are left out. */
	readonly ratings = signal<Record<string, string>>({});
	readonly typedPct = signal<Record<string, number>>({});
	readonly unselected = signal<Record<string, boolean>>({});
	readonly busy = signal(false);

	readonly employees = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.employees,
		queryFn: () => firstValueFrom(this.gateway.employees()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly plans = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.incrementPlans,
		queryFn: () => firstValueFrom(this.gateway.incrementPlans()),
	}));

	readonly departments = computed(() =>
		[
			...new Set(
				(this.employees.data() ?? [])
					.filter((e) => !e.leftOn)
					.map((e) => e.department)
					.filter(Boolean),
			),
		].sort(),
	);

	/** Who is in the cycle: still employed, at the store and in the department picked, joined before the day given. */
	readonly people = computed(() =>
		(this.employees.data() ?? []).filter(
			(e) =>
				!e.leftOn &&
				(!this.store() || e.locationId === this.store()) &&
				(!this.department() || e.department === this.department()) &&
				(!this.joinedBefore() || e.joinedOn < this.joinedBefore()),
		),
	);

	ratingOf(e: EmployeeView): string {
		return this.ratings()[e.id] ?? this.bands()[1]?.rating ?? this.bands()[0]?.rating ?? '';
	}

	/** A row's %: typed over, else the band of its rating (by rating), else the plan's. */
	pctOf(e: EmployeeView): number {
		const typed = this.typedPct()[e.id];
		if (typed !== undefined) return typed;
		if (this.kind() === 'rating') return this.bands().find((b) => b.rating === this.ratingOf(e))?.pct ?? 0;
		return this.pct();
	}

	private wayOf(e: EmployeeView): IncrementRowsInputValue['rows'][number]['way'] {
		return this.kind() === 'amount' && this.typedPct()[e.id] === undefined
			? { kind: 'amount', monthINR: this.amountMonth() }
			: { kind: 'percent', pct: this.pctOf(e) };
	}

	/** The cycle as the API takes it, for every person shown. */
	readonly input = computed((): IncrementRowsInputValue => ({
		from: this.from(),
		reason: this.reason().trim() || 'Increment cycle',
		rows: this.people().map((e) => ({ employeeId: e.id, way: this.wayOf(e), rating: this.ratingOf(e) || null })),
	}));

	readonly preview = injectQuery(() => ({
		queryKey: [...PAYROLL_KEYS.all, 'increments', JSON.stringify(this.input())],
		queryFn: () => firstValueFrom(this.gateway.incrementsPreview(this.input())),
		enabled: this.people().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(this.from()),
		placeholderData: keepPreviousData,
	}));

	rowOf(id: string) {
		return this.preview.data()?.find((r) => r.employeeId === id) ?? null;
	}

	blocked(id: string): boolean {
		return (this.rowOf(id)?.checks ?? []).some((c) => c.blocking);
	}

	/** Selected unless left out by hand or held by a blocking check. */
	selected(id: string): boolean {
		return !this.unselected()[id] && !this.blocked(id);
	}

	readonly chosen = computed(() => this.people().filter((e) => this.selected(e.id)));

	/** The cycle's cost a year for the rows selected (the budget). */
	readonly yearCost = computed(() =>
		this.chosen().reduce((sum, e) => {
			const r = this.rowOf(e.id);
			return sum + (r ? r.ctcYearNewINR - r.ctcYearNowINR : 0);
		}, 0),
	);

	setRating(id: string, rating: string): void {
		this.ratings.update((r) => ({ ...r, [id]: rating }));
		this.typedPct.update(({ [id]: _drop, ...rest }) => rest);
	}

	/** A row's % typed over; a cleared box goes back to the band or the plan's %. */
	setPct(id: string, value: unknown): void {
		if (value === '' || value === null || value === undefined)
			this.typedPct.update(({ [id]: _drop, ...rest }) => rest);
		else this.typedPct.update((t) => ({ ...t, [id]: Number(value) || 0 }));
	}

	toggle(id: string): void {
		this.unselected.update((u) => ({ ...u, [id]: !u[id] }));
	}

	setBand(index: number, fields: Partial<{ rating: string; pct: number }>): void {
		this.bands.update((b) => b.map((x, i) => (i === index ? { ...x, ...fields } : x)));
	}

	/** A new band, named by the next number not already used. */
	addBand(): void {
		this.bands.update((b) => {
			let n = b.length + 1;
			while (b.some((x) => x.rating === `R${n}`)) n++;
			return [...b, { rating: `R${n}`, pct: 0 }];
		});
	}

	/** The breakup on screen is of what is typed now: a whole date, and not one kept from before. */
	readonly current = computed(
		() => !!this.preview.data() && !this.preview.isPlaceholderData() && /^\d{4}-\d{2}-\d{2}$/.test(this.from()),
	);

	removeBand(index: number): void {
		this.bands.update((b) => b.filter((_, i) => i !== index));
	}

	/** A saved plan, picked to reuse. */
	usePlan(id: string): void {
		const plan = this.plans.data()?.find((p) => p.id === id);
		if (!plan) return;
		this.planName.set(plan.name);
		this.kind.set(plan.kind);
		this.bands.set(plan.bands.map((b) => ({ ...b })));
		this.pct.set(plan.pct);
		this.amountMonth.set(plan.amountMonthINR);
	}

	async savePlan(): Promise<void> {
		try {
			await firstValueFrom(
				this.gateway.saveIncrementPlan({
					name: this.planName().trim(),
					kind: this.kind(),
					bands: this.bands(),
					pct: this.pct(),
					amountMonthINR: this.amountMonth(),
				}),
			);
			this.notifier.showSuccess(this.transloco.translate('inc_plan_saved'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.incrementPlans });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		}
	}

	/** SR3's eye: the person's own Revise pay pop-up. */
	open(e: EmployeeView): void {
		const popup = this.modals.open(RevisePayPopup, { centered: true, size: 'xl' });
		(popup.componentInstance as RevisePayPopup).start(e);
	}

	readonly name = (id: string) => this.employees.data()?.find((e) => e.id === id)?.name ?? id;

	async accept(): Promise<void> {
		const ids = new Set(this.chosen().map((e) => e.id));
		const all = this.input();
		this.busy.set(true);
		try {
			const results = await firstValueFrom(
				this.gateway.acceptIncrements({
					...all,
					reason: this.reason().trim(),
					rows: all.rows.filter((r) => ids.has(r.employeeId)),
				}),
			);
			const failed = results.filter((r) => !r.ok);
			this.notifier.showSuccess(this.transloco.translate('inc_accepted', { n: results.length - failed.length }));
			for (const f of failed)
				this.notifier.showError(
					`${this.name(f.employeeId)}: ${this.transloco.translate(`payroll_problem_${f.problem ?? 'failed'}`)}`,
				);
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	readonly exportSource = (): ExportSource | null => {
		const t = (key: string) => this.transloco.translate(key);
		return {
			fileName: `increments-${this.from()}`,
			title: t('payroll_increments'),
			area: 'accounts',
			filters: [{ label: t('rev_from'), value: this.from() }],
			header: [
				t('payroll_col_name'),
				t('inc_rating'),
				t('inc_ctc_now'),
				'%',
				t('inc_ctc_new'),
				t('inc_change_month'),
				t('inc_selected'),
			],
			rows: this.people().map((e) => {
				const r = this.rowOf(e.id);
				return [
					e.name,
					this.ratingOf(e),
					r?.ctcYearNowINR ?? null,
					r?.changePct ?? null,
					r?.ctcYearNewINR ?? null,
					r?.changeMonthINR ?? null,
					this.selected(e.id) ? t('yes') : t('no'),
				];
			}),
		};
	};
}
