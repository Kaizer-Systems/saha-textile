import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { ShortDateTimePipe, apiProblem } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { InventorySettingsView, InventorySettingsWrite, PurchaseStep } from '@saha-textile/contracts';

/** The four purchase-entry steps (P1) with the permission each needs. */
export const PURCHASE_STEPS: ReadonlyArray<{
	step: PurchaseStep;
	label: string;
	permission: string;
	permissionLabel: string;
	differentKey: 'checkByDifferentPerson' | 'postByDifferentPerson' | 'paymentByDifferentPerson' | null;
}> = [
	{
		step: 'draft',
		label: 'pe_step_draft',
		permission: 'purchase.create',
		permissionLabel: 'perm_purchase_create',
		differentKey: null,
	},
	{
		step: 'check',
		label: 'check_goods',
		permission: 'purchase.check',
		permissionLabel: 'perm_purchase_check',
		differentKey: 'checkByDifferentPerson',
	},
	{
		step: 'post',
		label: 'post_to_stock',
		permission: 'purchase.post',
		permissionLabel: 'perm_purchase_post',
		differentKey: 'postByDifferentPerson',
	},
	{
		step: 'payment',
		label: 'record_payment',
		permission: 'purchase.payment',
		permissionLabel: 'perm_purchase_payment',
		differentKey: 'paymentByDifferentPerson',
	},
];

type Numbers = Pick<
	InventorySettingsWrite,
	'priceChangeWarnPct' | 'marginFloorPct' | 'heldReminderDays' | 'unpaidAlertDays' | 'defaultPaymentTermsDays'
>;

/** The limits the API enforces (contracts), checked here first so the box says what is wrong. */
export const NUMBER_LIMITS: Readonly<Record<keyof Numbers, { min: number; max: number; whole: boolean }>> = {
	priceChangeWarnPct: { min: 0, max: 500, whole: false },
	marginFloorPct: { min: 0, max: 100, whole: false },
	heldReminderDays: { min: 1, max: 365, whole: true },
	unpaidAlertDays: { min: 1, max: 365, whole: true },
	defaultPaymentTermsDays: { min: 0, max: 365, whole: true },
};

/** A typed figure → a number within its limits, or null with the box marked wrong. */
export function settingNumber(text: string, limit: { min: number; max: number; whole: boolean }): number | null {
	const value = Number(String(text).trim());
	if (String(text).trim() === '' || !Number.isFinite(value)) return null;
	if (value < limit.min || value > limit.max) return null;
	if (limit.whole && !Number.isInteger(value)) return null;
	return value;
}

/**
 * Books closed earlier than before (or cleared) re-opens filed days: ask first. Moving it later
 * or setting it for the first time needs no question.
 */
export function reopensBooks(before: string | null, after: string | null): boolean {
	if (!before) return false;
	return after === null || after < before;
}

/**
 * Settings › Purchases and stock (x02). Who may do each purchase-entry step and the books-closed
 * date are the super admin's (P1, P9); the warning figures belong to anyone with `setting.edit`.
 * Write-offs follow the Approve write-offs permission (P2), explained here and set in Roles.
 */
@Component({
	selector: 'app-purchase-settings',
	templateUrl: './purchase-settings.html',
	imports: [FormFields, FormsModule, HasPermissionDirective, PageWrapper, ShortDateTimePipe, TranslocoModule],
})
export class PurchaseSettings {
	private readonly gateway = inject(StockGateway);
	private readonly rolesGateway = inject(AdminRolesGateway);
	private readonly auth = inject(AuthStore);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);

	readonly steps = PURCHASE_STEPS;
	readonly limits = NUMBER_LIMITS;
	readonly today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

	readonly query = injectQuery(() => ({
		queryKey: STOCK_KEYS.settings,
		queryFn: () => firstValueFrom(this.gateway.settings()),
	}));
	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));
	readonly canChangeSteps = computed(() => !!this.query.data()?.canChangeSteps && this.canEdit());
	private readonly roles = injectQuery(() => ({
		queryKey: ['admin-roles', 'list', 'with-permissions'],
		queryFn: () => firstValueFrom(this.rolesGateway.list()),
		enabled: this.canChangeSteps() && this.auth.permissions().includes('role.index'),
	}));

	/** The page's working copy; filled from the server once, and again after each save. */
	readonly form = signal<InventorySettingsWrite | null>(null);
	readonly typed = signal<Record<keyof Numbers, string>>({
		priceChangeWarnPct: '',
		marginFloorPct: '',
		heldReminderDays: '',
		unpaidAlertDays: '',
		defaultPaymentTermsDays: '',
	});
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data && !untracked(this.form)) this.fill(data);
		});
	}

	/** Roles that hold a step's permission: the only ones that could do it. */
	optionsFor(permission: string): Array<{ id: string; label: string }> {
		return (this.roles.data()?.items ?? [])
			.filter((role) => role.permissions.includes(permission))
			.map((role) => ({ id: role.id, label: role.label }));
	}

	/** False when the chosen role is not in the list (unreadable list, deleted role, or it lost the permission). */
	listed(permission: string, id: string): boolean {
		return this.optionsFor(permission).some((role) => role.id === id);
	}

	/** The chosen role's name even when the role list is not readable (no `role.index`). */
	roleLabel(id: string | null): string {
		if (!id) return '';
		return (
			this.roles.data()?.items.find((role) => role.id === id)?.label ??
			this.query.data()?.stepRoleLabels[id] ??
			this.transloco.translate('role_no_longer_exists')
		);
	}

	readonly invalid = computed(() => {
		const typed = this.typed();
		return (Object.keys(NUMBER_LIMITS) as Array<keyof Numbers>).filter(
			(key) => settingNumber(typed[key], NUMBER_LIMITS[key]) === null,
		);
	});

	readonly booksInFuture = computed(() => {
		const date = this.form()?.booksClosedUpTo ?? null;
		return !!date && date > this.today;
	});

	setRole(step: PurchaseStep, roleId: string): void {
		this.form.update((form) =>
			form ? { ...form, stepRules: { ...form.stepRules, [`${step}RoleId`]: roleId || null } } : form,
		);
	}

	setDifferent(key: NonNullable<(typeof PURCHASE_STEPS)[number]['differentKey']>, on: boolean): void {
		this.form.update((form) => (form ? { ...form, stepRules: { ...form.stepRules, [key]: on } } : form));
	}

	setBooks(value: string): void {
		this.form.update((form) => (form ? { ...form, booksClosedUpTo: value || null } : form));
	}

	setDeliverTo(value: string): void {
		this.form.update((form) => (form ? { ...form, defaultDeliverTo: value } : form));
	}

	type(key: keyof Numbers, value: string): void {
		this.typed.update((typed) => ({ ...typed, [key]: value }));
	}

	differentOn(key: (typeof PURCHASE_STEPS)[number]['differentKey']): boolean {
		const form = this.form();
		return !!key && !!form?.stepRules[key];
	}

	roleOf(step: PurchaseStep): string {
		return this.form()?.stepRules[`${step}RoleId`] ?? '';
	}

	async save(): Promise<void> {
		const form = this.form();
		const saved = this.query.data();
		if (!form || !saved || this.busy() || this.invalid().length || this.booksInFuture()) return;
		const before = saved.booksClosedUpTo ?? null;
		const after = form.booksClosedUpTo ?? null;
		if (this.canChangeSteps() && reopensBooks(before, after)) {
			const yes = await askConfirm(this.modals, {
				icon: 'ri-lock-unlock-line',
				title: 'books_reopen_title',
				body: after ? 'books_reopen_body' : 'books_reopen_body_all',
				params: { from: before, to: after ?? '' },
				yes: 'books_reopen_yes',
			});
			if (!yes) return;
		}
		const typed = this.typed();
		const body: InventorySettingsWrite = {
			...form,
			priceChangeWarnPct: Number(typed.priceChangeWarnPct),
			marginFloorPct: Number(typed.marginFloorPct),
			heldReminderDays: Number(typed.heldReminderDays),
			unpaidAlertDays: Number(typed.unpaidAlertDays),
			defaultPaymentTermsDays: Number(typed.defaultPaymentTermsDays),
		};
		this.busy.set(true);
		this.error.set(null);
		try {
			const next = await firstValueFrom(this.gateway.saveSettings(body));
			this.queryClient.setQueryData(STOCK_KEYS.settings, next);
			this.fill(next);
			this.notifier.showSuccess(this.transloco.translate('settings_saved'));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	private fill(data: InventorySettingsView): void {
		this.form.set({
			stepRules: { ...data.stepRules },
			priceChangeWarnPct: data.priceChangeWarnPct,
			marginFloorPct: data.marginFloorPct,
			heldReminderDays: data.heldReminderDays,
			booksClosedUpTo: data.booksClosedUpTo,
			unpaidAlertDays: data.unpaidAlertDays,
			defaultPaymentTermsDays: data.defaultPaymentTermsDays,
			defaultDeliverTo: data.defaultDeliverTo,
			// Shop details move to their own page (revision 3); this page passes them through unchanged.
			business: data.business,
		});
		this.typed.set({
			priceChangeWarnPct: String(data.priceChangeWarnPct),
			marginFloorPct: String(data.marginFloorPct),
			heldReminderDays: String(data.heldReminderDays),
			unpaidAlertDays: String(data.unpaidAlertDays),
			defaultPaymentTermsDays: String(data.defaultPaymentTermsDays),
		});
	}
}
