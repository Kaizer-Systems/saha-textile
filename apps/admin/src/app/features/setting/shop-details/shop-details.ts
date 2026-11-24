import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { catchError, debounceTime, distinctUntilChanged, filter, firstValueFrom, map, of, switchMap } from 'rxjs';

import { ShortDateTimePipe, apiProblem } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { translateCount } from '@shared/pipes/language.pipes';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { ShopDetailsImpact, ShopDetailsView, ShopDetailsWrite } from '@saha-textile/contracts';

/** The boxes on X04, as typed. */
export interface ShopForm {
	gstin: string;
	legalName: string;
	tradeName: string;
	address: string;
	city: string;
	pin: string;
	phone: string;
	email: string;
}

export type ShopField = keyof ShopForm;

/** A GSTIN as typed, made comparable: capitals, no spaces. */
export const cleanShopGstin = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/** The line under the GSTIN box (X04 green line, X04C red line). */
export type ShopGstinVerdict =
	| { kind: 'empty' }
	| { kind: 'typing' }
	| { kind: 'checking' }
	/** The check itself failed (network): nothing is blocked, the API checks again on save. */
	| { kind: 'unchecked' }
	| { kind: 'problem'; key: string; params: Record<string, string> }
	| { kind: 'ok'; stateCode: string; stateName: string; pan: string };

/** What the server said about one typed GSTIN (the admin cannot load the contracts' checker). */
export interface ShopGstinCheck {
	gstin: string;
	result: ShopDetailsImpact | 'failed';
}

/**
 * The verdict for a typed GSTIN. The saved GSTIN reads from the saved record; any other full
 * GSTIN waits for the server's check of that exact value.
 */
export function shopGstinVerdict(
	typed: string,
	saved: Pick<ShopDetailsView, 'gstin' | 'stateCode' | 'stateName' | 'pan'> | null,
	check: ShopGstinCheck | null,
): ShopGstinVerdict {
	const value = cleanShopGstin(typed);
	if (!value) return { kind: 'empty' };
	if (value.length < 15) return { kind: 'typing' };
	if (value.length > 15) return { kind: 'problem', key: 'gstin_shape_wrong', params: {} };
	if (saved?.gstin && value === saved.gstin && saved.stateCode)
		return {
			kind: 'ok',
			stateCode: saved.stateCode,
			stateName: saved.stateName ?? saved.stateCode,
			pan: saved.pan ?? '',
		};
	if (!check || check.gstin !== value) return { kind: 'checking' };
	if (check.result === 'failed') return { kind: 'unchecked' };
	const result = check.result;
	if (result.problem === 'check_digit')
		return {
			kind: 'problem',
			key: 'shop_gstin_check_digit_wrong',
			params: { expected: result.expectedLastCharacter ?? '' },
		};
	if (result.problem === 'state') return { kind: 'problem', key: 'shop_gstin_state_unknown', params: {} };
	if (result.problem || !result.stateTo) return { kind: 'problem', key: 'gstin_shape_wrong', params: {} };
	return { kind: 'ok', stateCode: result.stateTo.code, stateName: result.stateTo.name, pan: result.pan ?? '' };
}

const REQUIRED: readonly ShopField[] = ['gstin', 'legalName', 'address', 'city', 'pin'];

/**
 * What is wrong with each box, as a translation key (the API checks the same rules again):
 * required rows filled, a GSTIN that reads, a 6-digit PIN not starting with 0, a phone of 8–15
 * digits, an email that looks like one.
 */
export function shopFormProblems(form: ShopForm, verdict: ShopGstinVerdict): Partial<Record<ShopField, string>> {
	const problems: Partial<Record<ShopField, string>> = {};
	for (const field of REQUIRED) if (!form[field].trim()) problems[field] = 'shop_field_required';
	if (verdict.kind === 'typing') problems.gstin = 'gstin_shape_wrong';
	if (verdict.kind === 'problem') problems.gstin = verdict.key;
	if (form.pin.trim() && !/^[1-9]\d{5}$/.test(form.pin.trim())) problems.pin = 'shop_pin_shape';
	const phone = form.phone.trim();
	const digits = phone.replace(/\D/g, '').length;
	if (phone && (!/^[+\d][\d\s()-]*$/.test(phone) || digits < 8 || digits > 15)) problems.phone = 'shop_phone_shape';
	const email = form.email.trim();
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.email = 'invalid_email';
	return problems;
}

export function shopFormOf(view: ShopDetailsView): ShopForm {
	return {
		gstin: view.gstin ?? '',
		legalName: view.legalName,
		tradeName: view.tradeName,
		address: view.address,
		city: view.city,
		pin: view.pin,
		phone: view.phone,
		email: view.email,
	};
}

export function sameShopForm(a: ShopForm, b: ShopForm): boolean {
	return (Object.keys(a) as ShopField[]).every((field) =>
		field === 'gstin' ? cleanShopGstin(a.gstin) === cleanShopGstin(b.gstin) : a[field].trim() === b[field].trim(),
	);
}

/**
 * S2 A: a new GSTIN or legal name asks first (X04B). A first entry asks too when it moves the
 * home State away from West Bengal; filling an empty name or GSTIN in the home State does not.
 */
export function shopChangeNeedsConfirm(saved: ShopDetailsView, form: ShopForm): boolean {
	const gstin = cleanShopGstin(form.gstin);
	const gstinChanged = gstin !== (saved.gstin ?? '');
	const nameChanged = form.legalName.trim() !== saved.legalName;
	const stateChanges = gstin.slice(0, 2) !== saved.homeStateCode;
	return (gstinChanged && (!!saved.gstin || stateChanges)) || (nameChanged && !!saved.legalName);
}

/**
 * Settings › Shop details (X04–X04D; purchases brief R3-1, owner round 2026-11-18). Holders of
 * Edit shop details see open boxes and Save; everyone else with Settings access sees the same
 * page read only (S1 A). A new GSTIN or legal name is confirmed in a popup (S2 A).
 */
@Component({
	selector: 'app-shop-details-settings',
	templateUrl: './shop-details.html',
	imports: [FormFields, FormsModule, PageWrapper, RouterModule, ShortDateTimePipe, TranslocoModule],
})
export class ShopDetailsSettings {
	private readonly gateway = inject(StockGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);

	readonly query = injectQuery(() => ({
		queryKey: STOCK_KEYS.shopDetails,
		queryFn: () => firstValueFrom(this.gateway.shopDetails()),
	}));
	readonly canEdit = computed(() => !!this.query.data()?.canEdit);

	readonly form = signal<ShopForm | null>(null);
	/** Rows the person has left once: their problems show from then on (all of them after a Save). */
	readonly touched = signal<ReadonlySet<ShopField>>(new Set());
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	/** The server's check of the last full GSTIN typed (X04 green line, X04C red line). */
	readonly gstinCheck = signal<ShopGstinCheck | null>(null);
	readonly verdict = computed(() =>
		shopGstinVerdict(this.form()?.gstin ?? '', this.query.data() ?? null, this.gstinCheck()),
	);
	readonly problems = computed(() => {
		const form = this.form();
		return form ? shopFormProblems(form, this.verdict()) : {};
	});
	readonly changed = computed(() => {
		const form = this.form();
		const saved = this.query.data();
		return !!form && !!saved && !sameShopForm(form, shopFormOf(saved));
	});
	readonly canSave = computed(
		() => this.canEdit() && this.changed() && !this.busy() && Object.keys(this.problems()).length === 0,
	);
	/** The fields still empty on the saved record, as one list in the reader's words. */
	readonly missingText = computed(() => {
		const missing = this.query.data()?.missing ?? [];
		const names = missing.map((field) => this.transloco.translate(FIELD_LABELS[field]));
		return names.length ? listFormat(names, this.transloco.getActiveLang()) : '';
	});

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (data && !untracked(this.form)) this.form.set(shopFormOf(data));
		});
		// A full GSTIN other than the saved one is checked by the server as it is typed.
		toObservable(computed(() => cleanShopGstin(this.form()?.gstin ?? '')))
			.pipe(
				distinctUntilChanged(),
				filter((gstin) => gstin.length === 15 && gstin !== (this.query.data()?.gstin ?? '') && this.canEdit()),
				debounceTime(250),
				switchMap((gstin) =>
					this.gateway.shopDetailsImpact(gstin).pipe(
						map((result): ShopGstinCheck => ({ gstin, result })),
						catchError(() => of<ShopGstinCheck>({ gstin, result: 'failed' })),
					),
				),
				takeUntilDestroyed(inject(DestroyRef)),
			)
			.subscribe((check) => this.gstinCheck.set(check));
	}

	set(field: ShopField, value: string): void {
		this.form.update((form) =>
			form ? { ...form, [field]: field === 'gstin' ? cleanShopGstin(value) : value } : form,
		);
	}

	touch(field: ShopField): void {
		this.touched.update((fields) => new Set([...fields, field]));
	}

	/**
	 * The problem a row shows: once it was left, or after a Save was tried. A full GSTIN that
	 * cannot be right shows at once (X04C), with the right last character.
	 */
	problemOf(field: ShopField): string | null {
		// A problem verdict always names its key in problems().gstin (shopFormProblems).
		if (field === 'gstin' && this.verdict().kind === 'problem') return this.problems().gstin as string;
		return this.touched().has(field) ? (this.problems()[field] ?? null) : null;
	}

	/** Save is off while a shown row is wrong; pressing it shows every remaining problem. */
	readonly blocked = computed(() =>
		(Object.keys(this.form() ?? {}) as ShopField[]).some((field) => !!this.problemOf(field)),
	);

	cancel(): void {
		const saved = this.query.data();
		if (saved) this.form.set(shopFormOf(saved));
		this.touched.set(new Set());
		this.error.set(null);
	}

	async save(): Promise<void> {
		const form = this.form();
		const saved = this.query.data();
		if (!form || !saved || this.busy()) return;
		this.touched.set(new Set(Object.keys(form) as ShopField[]));
		if (!this.canSave()) return;
		this.error.set(null);
		if (shopChangeNeedsConfirm(saved, form)) {
			this.busy.set(true);
			const gstin = cleanShopGstin(form.gstin);
			const known = this.gstinCheck();
			let impact: ShopDetailsImpact | null = null;
			try {
				impact =
					known?.gstin === gstin && known.result !== 'failed'
						? known.result
						: await firstValueFrom(this.gateway.shopDetailsImpact(gstin));
			} catch (error) {
				this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
				return;
			} finally {
				this.busy.set(false);
			}
			if (impact.problem || !impact.stateTo) {
				// The server says this GSTIN cannot be right: show why under the box instead of asking.
				this.gstinCheck.set({ gstin, result: impact });
				return;
			}
			const yes = await askConfirm(this.modals, this.confirmAsk(saved, form, impact, impact.stateTo));
			if (!yes) return;
		}
		const body: ShopDetailsWrite = {
			gstin: cleanShopGstin(form.gstin),
			legalName: form.legalName.trim(),
			tradeName: form.tradeName.trim(),
			address: form.address.trim(),
			city: form.city.trim(),
			pin: form.pin.trim(),
			phone: form.phone.trim(),
			email: form.email.trim(),
			expectedUpdatedAt: saved.updatedAt,
		};
		this.busy.set(true);
		try {
			const next = await firstValueFrom(this.gateway.saveShopDetails(body));
			this.queryClient.setQueryData(STOCK_KEYS.shopDetails, next);
			this.form.set(shopFormOf(next));
			this.touched.set(new Set());
			this.notifier.showSuccess(this.transloco.translate('shop_details_saved'));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	/** X04B: old → new, the State, what happens to purchase tax, and that sent documents keep theirs. */
	private confirmAsk(
		saved: ShopDetailsView,
		form: ShopForm,
		impact: ShopDetailsImpact,
		stateTo: { code: string; name: string },
	) {
		const t = (key: string, params: Record<string, unknown> = {}) => this.transloco.translate(key, params);
		const gstin = cleanShopGstin(form.gstin);
		const gstinChanged = gstin !== (saved.gstin ?? '');
		const items: string[] = [];
		const none = t('shop_change_none');
		if (gstinChanged) items.push(t('shop_change_gstin', { from: saved.gstin || none, to: gstin }));
		if (form.legalName.trim() !== saved.legalName)
			items.push(t('shop_change_name', { from: saved.legalName || none, to: form.legalName.trim() }));
		const from = `${impact.stateFrom.name} (${impact.stateFrom.code})`;
		const to = `${stateTo.name} (${stateTo.code})`;
		if (impact.stateChanges) {
			items.push(t('shop_change_state', { from, to }));
			const names = (rows: ShopDetailsImpact['toIntraState']) =>
				listFormat(
					rows.slice(0, 5).map((row) => row.name),
					this.transloco.getActiveLang(),
				) + (rows.length > 5 ? ` ${t('shop_change_and_more', { count: rows.length - 5 })}` : '');
			if (impact.toIntraState.length)
				items.push(
					translateCount(this.transloco, 'shop_change_to_intra', impact.toIntraState.length, {
						names: names(impact.toIntraState),
					}),
				);
			if (impact.toInterState.length)
				items.push(
					translateCount(this.transloco, 'shop_change_to_inter', impact.toInterState.length, {
						names: names(impact.toInterState),
					}),
				);
			if (!impact.toIntraState.length && !impact.toInterState.length)
				items.push(t('shop_change_no_supplier_moves'));
		} else {
			items.push(t('shop_change_state_same', { state: to }));
			items.push(t('shop_change_tax_same', { state: stateTo.name }));
		}
		items.push(t('shop_change_docs'));
		return {
			icon: 'ri-shield-keyhole-line',
			title: gstinChanged ? 'shop_change_title_gstin' : 'shop_change_title_name',
			body: 'shop_change_body',
			yes: gstinChanged ? 'shop_change_yes_gstin' : 'shop_change_yes_name',
			items,
			more: t(gstinChanged ? 'shop_change_note' : 'shop_change_note_name'),
		};
	}
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
	gstin: 'gstin',
	legalName: 'legal_name',
	address: 'address',
	city: 'city',
	pin: 'pin_code',
};

/** "GSTIN, city and PIN code": the reader's list words (English digits and names stay as typed). */
function listFormat(items: readonly string[], lang: string): string {
	// Both locales are built into every browser; a list of strings never makes format() throw.
	return new Intl.ListFormat(lang === 'bn' ? 'bn-IN' : 'en-IN', { style: 'long', type: 'conjunction' }).format(items);
}
