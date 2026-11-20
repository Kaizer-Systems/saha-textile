import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, catchError, debounceTime, distinctUntilChanged, firstValueFrom, map, of, switchMap } from 'rxjs';

import { BUSINESSES_KEY, BusinessesGateway, injectZoneChoicesQuery } from '@core/business/businesses.gateway';
import { apiIssues, apiProblem } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import {
	CustomerAddressPopup,
	addressCardLine,
	phoneTextOf,
	postalLabelKeyOf,
	type CustomerAddressRow,
} from '@features/customer/form-customer/customer-address-popup';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { askConfirm, askReason } from '@features/purchasing/shared/popups';
import { cleanGstin, gstinVerdict } from '@features/purchasing/supplier/supplier-form';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type {
	SavedAddressWrite,
	SetOffSettingWrite,
	Business,
	BusinessStanding,
	BusinessType,
	BusinessWrite,
	SupplierGstinCheck,
	SupplierKind,
} from '@saha-textile/contracts';

export const BUSINESS_TYPES: readonly BusinessType[] = [
	'proprietorship',
	'partnership',
	'llp',
	'privateLimited',
	'publicLimited',
	'huf',
	'trustOrSociety',
	'government',
	'other',
];
const RETAIL_ZONE = 'zone_retail';

/**
 * Add or edit a business (bz02): the supplier form's fields and GSTIN check, plus the customer side
 * (credit limit, credit days, zone and standing) and contacts, the accounts contact getting payment
 * links and statements. Zone and credit save only for staff with their permissions; a standing
 * change asks for a reason and is saved through its own route.
 */
@Component({
	selector: 'app-business-form',
	templateUrl: './business-form.html',
	imports: [FormFields, HasPermissionDirective, PageWrapper, ReactiveFormsModule, RouterModule, TranslocoModule],
})
export class BusinessForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(BusinessesGateway);
	private readonly purchasing = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly destroyRef = inject(DestroyRef);
	private readonly modals = inject(NgbModal);
	private readonly auth = inject(AuthStore);

	readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	readonly types = BUSINESS_TYPES;
	readonly states = toSignal(this.purchasing.states(), {
		initialValue: [] as Array<{ code: string; name: string }>,
	});
	readonly mayAssignZone = computed(() => this.auth.permissions().includes('business.assign'));
	readonly maySetCredit = computed(() => this.auth.permissions().includes('business.approve'));
	readonly zones = injectZoneChoicesQuery(() => this.mayAssignZone());
	readonly zoneRows = computed(() =>
		[...(this.zones.data() ?? [])].sort((a, b) => (a.system ? -1 : b.system ? 1 : a.name.localeCompare(b.name))),
	);

	private readonly fb = inject(FormBuilder).nonNullable;
	readonly form = this.fb.group({
		legalName: ['', [Validators.required, Validators.maxLength(200)]],
		tradeName: ['', Validators.maxLength(80)],
		businessType: ['privateLimited' as BusinessType, Validators.required],
		kind: ['regular' as SupplierKind, Validators.required],
		gstin: [''],
		pan: [''],
		stateCode: ['19', Validators.required],
		line: ['', [Validators.required, Validators.maxLength(300)]],
		city: ['', Validators.maxLength(80)],
		pin: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
		contacts: this.fb.array([this.contactGroup()]),
		buysFromUs: [true],
		creditLimitINR: [0, [Validators.min(0), Validators.max(100_000_000)]],
		creditDays: [30, [Validators.min(0), Validators.max(365)]],
		zoneId: [RETAIL_ZONE],
		standing: ['active' as BusinessStanding],
		sellsToUs: [false],
		paymentTermsDays: [30, [Validators.min(0), Validators.max(365)]],
		usesItemCodes: [false],
		notes: ['', Validators.maxLength(1000)],
		active: [true],
	});

	readonly gstinValue = signal('');
	readonly check = signal<SupplierGstinCheck | 'failed' | null>(null);
	readonly verdict = computed(() => gstinVerdict(this.gstinValue(), this.check()));
	readonly stateName = computed(() => {
		const verdict = this.verdict();
		if (verdict.kind !== 'ok') return '';
		return this.states().find((state) => state.code === verdict.stateCode)?.name ?? verdict.stateCode;
	});
	readonly serverErrors = signal<Record<string, string>>({});
	readonly saving = signal(false);
	private readonly gstinTyped = new Subject<string>();
	private loaded: Business | null = null;

	get contacts(): FormArray {
		return this.form.controls.contacts;
	}

	private contactGroup(contact?: Business['contacts'][number]) {
		return this.fb.group({
			id: [contact?.id ?? ''],
			name: [contact?.name ?? '', Validators.maxLength(120)],
			email: [contact?.email ?? '', [Validators.email, Validators.maxLength(200)]],
			callingCode: [contact?.mobile?.countryCallingCode ?? '91'],
			mobile: [contact?.mobile?.number ?? '', Validators.maxLength(20)],
			isAccounts: [contact?.isAccounts ?? true],
		});
	}

	constructor() {
		this.gstinTyped
			.pipe(
				map(cleanGstin),
				debounceTime(300),
				distinctUntilChanged(),
				switchMap((gstin) =>
					gstin.length < 15
						? of(null)
						: this.purchasing.checkGstin(gstin, this.id()).pipe(catchError(() => of('failed' as const))),
				),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((result) => this.applyCheck(result));
		const id = this.id();
		if (id) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		try {
			this.fill(await firstValueFrom(this.gateway.get(id)));
			// The supplier fields (GST kind, terms, item codes) live on the same record, read as a supplier.
			const supplier = await firstValueFrom(this.purchasing.supplier(id)).catch(() => null);
			if (supplier) {
				this.form.patchValue({
					kind: supplier.kind,
					paymentTermsDays: supplier.paymentTermsDays,
					usesItemCodes: supplier.usesItemCodes,
				});
			}
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	private fill(business: Business): void {
		const customer = business.roles.customer;
		this.contacts.clear();
		for (const contact of business.contacts) this.contacts.push(this.contactGroup(contact));
		if (!business.contacts.length) this.contacts.push(this.contactGroup());
		this.form.patchValue({
			legalName: business.legalName,
			tradeName: business.tradeName,
			businessType: business.businessType,
			gstin: business.gstin ?? '',
			pan: business.pan ?? '',
			stateCode: business.stateCode,
			line: business.registeredAddress.line,
			city: business.registeredAddress.city,
			pin: business.registeredAddress.pin,
			buysFromUs: !!customer,
			creditLimitINR: customer?.creditLimitINR ?? 0,
			creditDays: customer?.creditDays ?? 30,
			zoneId: customer?.zoneId ?? RETAIL_ZONE,
			standing: customer?.standing ?? 'active',
			sellsToUs: business.roles.supplier,
			notes: business.notes ?? '',
			active: business.active,
		});
		this.loaded = business;
		const setOff = business.setOff;
		this.setOffMode.set(setOff.mode);
		if (setOff.mode === 'agreement') {
			this.setOffReference.set(setOff.reference);
			this.setOffSignedOn.set(setOff.signedOn);
			this.setOffValidUntil.set(setOff.validUntil ?? '');
			this.setOffCopy.set({ assetId: setOff.mediaId, name: setOff.reference });
		}
		this.addresses.set(business.addresses as unknown as CustomerAddressRow[]);
		this.onGstinInput(business.gstin ?? '');
	}

	/* ------------------------------------------------------------------ set-off (so01) */

	readonly setOffModes = ['never', 'agreement'] as const;
	readonly setOffMode = signal<'never' | 'agreement'>('never');
	readonly setOffReference = signal('');
	readonly setOffSignedOn = signal('');
	readonly setOffValidUntil = signal('');
	readonly setOffCopy = signal<{ assetId: string; name: string } | null>(null);

	/** The setting as the API takes it, or null while an agreement is missing a part. */
	setOffSetting(): SetOffSettingWrite | null {
		if (this.setOffMode() === 'never') return { mode: 'never' };
		const copy = this.setOffCopy();
		if (!this.setOffReference().trim() || !this.setOffSignedOn() || !copy) return null;
		return {
			mode: 'agreement',
			reference: this.setOffReference().trim(),
			signedOn: this.setOffSignedOn(),
			validUntil: this.setOffValidUntil() || null,
			mediaId: copy.assetId,
		};
	}

	/** Whether the set-off section was changed from what is saved. */
	private setOffChanged(next: SetOffSettingWrite): boolean {
		return JSON.stringify(next) !== JSON.stringify(this.loaded?.setOff ?? { mode: 'never' });
	}

	async pickSetOffCopy(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'biz_choose_signed_copy',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.setOffCopy.set({ assetId: picked[0].assetId, name: picked[0].name });
	}

	/* ------------------------------------------------------------------ delivery addresses (bz02) */

	/** Saved delivery addresses; on a business not saved yet, the typed ones wait for the save. */
	readonly addresses = signal<CustomerAddressRow[]>([]);
	readonly draftAddresses = signal<SavedAddressWrite[]>([]);
	readonly addressRows = computed<CustomerAddressRow[]>(() =>
		this.id()
			? this.addresses()
			: this.draftAddresses().map((row, index) => ({ ...row, id: `draft_${index}`, country: row.countryCode }) as never),
	);

	addressLine(row: CustomerAddressRow): string {
		return addressCardLine(row, this.transloco.getActiveLang());
	}

	postalLabelKey(row: CustomerAddressRow): string {
		return postalLabelKeyOf(row);
	}

	phoneText(row: CustomerAddressRow): string {
		return phoneTextOf(row);
	}

	/** Add a delivery address (bz02): the shared address popup, with the country rules. */
	async openAddress(row: CustomerAddressRow | null = null): Promise<void> {
		const popup = this.modals.open(CustomerAddressPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'customer_address_popup_title',
		});
		(popup.componentInstance as CustomerAddressPopup).start({
			customerId: null,
			customerName: this.form.controls.tradeName.value || this.form.controls.legalName.value,
			...(row ? { row } : {}),
			firstAddress: !this.addressRows().length,
		});
		const body = (await popup.result.catch(() => null)) as SavedAddressWrite | null;
		if (!body) return;
		const id = this.id();
		if (!id) {
			const index = row ? Number(row.id.replace('draft_', '')) : -1;
			this.draftAddresses.update((rows) => {
				const next = index >= 0 ? rows.map((existing, at) => (at === index ? body : existing)) : [...rows, body];
				return body.isDefault ? next.map((existing) => ({ ...existing, isDefault: existing === body })) : next;
			});
			return;
		}
		try {
			const saved = await firstValueFrom(
				row ? this.gateway.replaceAddress(id, row.id, body) : this.gateway.addAddress(id, body),
			);
			this.addresses.set(saved.addresses as unknown as CustomerAddressRow[]);
			if (this.loaded) this.loaded = { ...this.loaded, revision: saved.revision };
			this.notifier.showSuccess(this.transloco.translate('cust_address_saved'));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	async removeAddress(row: CustomerAddressRow): Promise<void> {
		const id = this.id();
		if (!id) {
			const index = Number(row.id.replace('draft_', ''));
			this.draftAddresses.update((rows) => rows.filter((_, at) => at !== index));
			return;
		}
		const yes = await askConfirm(this.modals, {
			icon: 'ri-delete-bin-line',
			title: 'delete_address',
			body: 'biz_remove_address_body',
			params: { label: row.label ?? '' },
			yes: 'delete_address',
			danger: true,
		});
		if (!yes) return;
		try {
			const saved = await firstValueFrom(this.gateway.removeAddress(id, row.id));
			this.addresses.set(saved.addresses as unknown as CustomerAddressRow[]);
			if (this.loaded) this.loaded = { ...this.loaded, revision: saved.revision };
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	addContact(): void {
		this.contacts.push(this.contactGroup());
		this.contacts.at(this.contacts.length - 1).patchValue({ isAccounts: false });
	}

	removeContact(index: number): void {
		this.contacts.removeAt(index);
	}

	/** One accounts contact: choosing one clears the others. */
	setAccounts(index: number): void {
		this.contacts.controls.forEach((group, at) => group.patchValue({ isAccounts: at === index }));
	}

	onGstinInput(raw: string): void {
		const gstin = cleanGstin(raw);
		this.gstinValue.set(gstin);
		this.check.set(null);
		this.serverErrors.update(({ gstin: _gstin, ...rest }) => rest);
		if (gstin.length !== 15) {
			this.form.controls.stateCode.enable({ emitEvent: false });
			this.form.controls.pan.enable({ emitEvent: false });
		}
		this.gstinTyped.next(gstin);
	}

	/** A good GSTIN sets State and PAN and locks them, as on the supplier form. */
	private applyCheck(result: SupplierGstinCheck | 'failed' | null): void {
		this.check.set(result);
		const verdict = this.verdict();
		// The same record (a supplier that now also buys from us) is not "already saved".
		if (verdict.kind === 'ok' || (verdict.kind === 'taken' && verdict.id === this.id())) {
			const gstin = this.gstinValue();
			this.form.controls.stateCode.setValue(gstin.slice(0, 2));
			this.form.controls.pan.setValue(gstin.slice(2, 12));
			this.form.controls.stateCode.disable({ emitEvent: false });
			this.form.controls.pan.disable({ emitEvent: false });
		}
	}

	readonly gstinBlocks = computed(() => {
		const verdict = this.verdict();
		return (
			verdict.kind === 'problem' ||
			(verdict.kind === 'taken' && verdict.id !== this.id()) ||
			verdict.kind === 'checking' ||
			verdict.kind === 'typing'
		);
	});

	gstinRequired(): boolean {
		return this.form.controls.kind.value !== 'unregistered';
	}

	canSave(): boolean {
		const value = this.form.getRawValue();
		if (this.saving() || this.gstinBlocks()) return false;
		if (this.gstinRequired() && !this.gstinValue()) return false;
		if (!value.buysFromUs && !value.sellsToUs) return false;
		return this.form.valid || this.form.disabled;
	}

	body(): BusinessWrite {
		const value = this.form.getRawValue();
		const text = (input: string) => input.trim() || null;
		const gstin = this.gstinValue() || null;
		return {
			legalName: value.legalName.trim(),
			tradeName: value.tradeName.trim(),
			businessType: value.businessType,
			kind: value.kind,
			gstin,
			pan: gstin ? gstin.slice(2, 12) : text(value.pan.toUpperCase()),
			stateCode: gstin ? gstin.slice(0, 2) : value.stateCode,
			registeredAddress: { line: value.line.trim(), city: value.city.trim(), pin: value.pin.trim() },
			contacts: value.contacts
				.filter((contact) => contact.name.trim())
				.map((contact) => ({
					...(contact.id ? { id: contact.id } : {}),
					name: contact.name.trim(),
					role: '',
					email: text(contact.email),
					mobile: contact.mobile.replace(/\D/g, '')
						? { countryCallingCode: contact.callingCode.replace(/\D/g, '') || '91', number: contact.mobile }
						: null,
					isAccounts: contact.isAccounts,
				})),
			sellsToUs: value.sellsToUs,
			customer: value.buysFromUs
				? {
						zoneId: value.zoneId || RETAIL_ZONE,
						creditLimitINR: Number(value.creditLimitINR) || 0,
						creditDays: Number(value.creditDays) || 0,
					}
				: null,
			supplier: value.sellsToUs
				? { paymentTermsDays: Number(value.paymentTermsDays) || 0, usesItemCodes: value.usesItemCodes }
				: null,
			notes: text(value.notes),
			active: value.active,
			...(this.loaded ? { revision: this.loaded.revision } : {}),
		};
	}

	async save(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.canSave()) return;
		const standing = this.form.controls.standing.value;
		const before = this.loaded?.roles.customer?.standing ?? 'active';
		let reason: string | null = null;
		if (this.form.controls.buysFromUs.value && standing !== before) {
			const answer = await askReason(this.modals, {
				title: 'biz_standing_change',
				body: 'biz_standing_change_body',
				params: { standing: this.transloco.translate(`ord_standing_${standing}`) },
				label: 'biz_reason',
				confirm: 'biz_save_business',
				act: async (typed) => typed,
			});
			if (typeof answer !== 'string') return;
			reason = answer;
		}
		this.saving.set(true);
		this.serverErrors.set({});
		try {
			let saved = await firstValueFrom(this.gateway.save(this.id(), this.body()));
			if (reason) saved = await firstValueFrom(this.gateway.setStanding(saved.id, { standing, reason }));
			const setOff = this.setOffSetting();
			if (
				setOff &&
				this.form.controls.buysFromUs.value &&
				this.form.controls.sellsToUs.value &&
				this.auth.permissions().includes('business.settle') &&
				this.setOffChanged(setOff)
			) {
				saved = await firstValueFrom(this.gateway.setSetOff(saved.id, setOff));
			}
			// A new business: the delivery addresses typed before it existed are saved now (bz02).
			if (!this.id()) {
				for (const address of this.draftAddresses()) {
					saved = await firstValueFrom(this.gateway.addAddress(saved.id, address));
				}
			}
			void this.queryClient.invalidateQueries({ queryKey: [...BUSINESSES_KEY] });
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
			this.notifier.showSuccess(this.transloco.translate(this.id() ? 'biz_updated' : 'biz_created'));
			void this.router.navigate(['/businesses', saved.id]);
		} catch (error) {
			const errors: Record<string, string> = {};
			for (const issue of apiIssues(error)) {
				const field = issue.code.startsWith('gstin') ? 'gstin' : (issue.target ?? issue.code);
				errors[field] = issue.message;
			}
			this.serverErrors.set(errors);
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}

	cancel(): void {
		const id = this.id();
		void this.router.navigate(id && this.loaded ? ['/businesses', id] : ['/businesses']);
	}
}
