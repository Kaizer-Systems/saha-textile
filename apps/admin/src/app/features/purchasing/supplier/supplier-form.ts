import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, catchError, debounceTime, distinctUntilChanged, firstValueFrom, map, of, switchMap } from 'rxjs';

import { apiIssues, apiProblem } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { injectInventorySettingsQuery } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { Supplier, SupplierGstinCheck, SupplierKind, SupplierWrite } from '@saha-textile/contracts';

/** A GSTIN as typed, made comparable: capitals, no spaces. */
export const cleanGstin = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** What the GSTIN line under the box says (s02 green line, s02b red line). */
export type GstinVerdict =
	| { kind: 'empty' }
	| { kind: 'typing' }
	| { kind: 'checking' }
	/** The check itself failed (network): nothing is blocked, the API checks again on save. */
	| { kind: 'unchecked' }
	| { kind: 'problem'; key: string; params: Record<string, string> }
	| { kind: 'taken'; id: string; name: string }
	| { kind: 'ok'; stateCode: string; pan: string; taxType: 'intra_state' | 'inter_state' };

export function gstinVerdict(value: string, check: SupplierGstinCheck | 'failed' | null): GstinVerdict {
	if (!value) return { kind: 'empty' };
	if (value.length < 15) return { kind: 'typing' };
	if (check === 'failed') return { kind: 'unchecked' };
	if (!check) return { kind: 'checking' };
	if (check.problem === 'check_digit')
		return {
			kind: 'problem',
			key: 'gstin_check_digit_wrong',
			params: { expected: check.expectedLastCharacter ?? '' },
		};
	if (check.problem === 'state') return { kind: 'problem', key: 'gstin_state_unknown', params: {} };
	if (check.problem === 'shape') return { kind: 'problem', key: 'gstin_shape_wrong', params: {} };
	if (check.sameGstin) return { kind: 'taken', id: check.sameGstin.id, name: check.sameGstin.name };
	return {
		kind: 'ok',
		stateCode: check.stateCode ?? value.slice(0, 2),
		pan: check.pan ?? value.slice(2, 12),
		taxType: check.taxType === 'intra_state' ? 'intra_state' : 'inter_state',
	};
}

/**
 * Add or edit a supplier (s02, s02b). The GSTIN is checked as it is typed (format, State code,
 * check digit, a supplier already using it); State and PAN are then read from it and locked. The
 * API checks everything again on save.
 */
@Component({
	selector: 'app-supplier-form',
	templateUrl: './supplier-form.html',
	imports: [FormFields, PageWrapper, ReactiveFormsModule, RouterModule, TranslocoModule],
})
export class SupplierForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly destroyRef = inject(DestroyRef);
	private readonly auth = inject(AuthStore);

	readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	readonly states = toSignal(this.gateway.states(), { initialValue: [] as Array<{ code: string; name: string }> });
	private readonly settings = injectInventorySettingsQuery(() => this.auth.permissions().includes('setting.index'));

	private readonly fb = inject(FormBuilder).nonNullable;
	readonly form = this.fb.group({
		gstin: [''],
		kind: ['regular' as SupplierKind, Validators.required],
		legalName: ['', [Validators.required, Validators.maxLength(200)]],
		shortName: ['', Validators.maxLength(80)],
		line: ['', [Validators.required, Validators.maxLength(300)]],
		city: ['', Validators.maxLength(80)],
		stateCode: ['19', Validators.required],
		pin: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
		pan: [''],
		contactName: ['', Validators.maxLength(120)],
		phone: ['', Validators.maxLength(30)],
		email: ['', [Validators.email, Validators.maxLength(200)]],
		paymentTermsDays: [30, [Validators.required, Validators.min(0), Validators.max(365)]],
		usesItemCodes: [false],
		notes: ['', Validators.maxLength(1000)],
		active: [true],
	});

	readonly gstinValue = signal('');
	readonly check = signal<SupplierGstinCheck | 'failed' | null>(null);
	readonly verdict = computed(() => gstinVerdict(this.gstinValue(), this.check()));
	/** Same PAN under another GSTIN: allowed (a branch in another State), shown with a link. */
	readonly samePan = computed(() => {
		const check = this.check();
		return this.verdict().kind === 'ok' && check && check !== 'failed' ? check.samePan : [];
	});
	readonly stateName = computed(() => {
		const verdict = this.verdict();
		if (verdict.kind !== 'ok') return '';
		return this.states().find((state) => state.code === verdict.stateCode)?.name ?? verdict.stateCode;
	});
	readonly gstinState = computed(() => {
		const verdict = this.verdict();
		return verdict.kind === 'ok' ? verdict.stateCode : '';
	});
	/** CGST + SGST from suppliers in the shop's State, IGST from the rest. */
	readonly taxKey = computed(() => {
		const verdict = this.verdict();
		return verdict.kind === 'ok' && verdict.taxType === 'intra_state' ? 'tax_cgst_sgst' : 'tax_igst';
	});
	/** Field errors the API sent back on save, by field. */
	readonly serverErrors = signal<Record<string, string>>({});
	readonly saving = signal(false);
	private readonly gstinTyped = new Subject<string>();
	private loaded = false;

	constructor() {
		this.gstinTyped
			.pipe(
				map(cleanGstin),
				debounceTime(300),
				distinctUntilChanged(),
				switchMap((gstin) =>
					gstin.length < 15
						? of(null)
						: this.gateway.checkGstin(gstin, this.id()).pipe(
								// A failed check (network) is not a verdict: the API checks again on save.
								catchError(() => of('failed' as const)),
							),
				),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((result) => this.applyCheck(result));

		// New suppliers start with the shop's default terms (x02); edits keep their own.
		effect(() => {
			const days = this.settings.data()?.defaultPaymentTermsDays;
			if (days !== undefined && !this.id() && !this.form.controls.paymentTermsDays.dirty) {
				this.form.controls.paymentTermsDays.setValue(days);
			}
		});

		const id = this.id();
		if (id) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		try {
			const supplier = await firstValueFrom(this.gateway.supplier(id));
			this.fill(supplier);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	private fill(supplier: Supplier): void {
		this.form.reset({
			gstin: supplier.gstin ?? '',
			kind: supplier.kind,
			legalName: supplier.legalName,
			shortName: supplier.shortName === supplier.legalName ? '' : supplier.shortName,
			line: supplier.address.line,
			city: supplier.address.city,
			stateCode: supplier.stateCode,
			pin: supplier.address.pin,
			pan: supplier.pan ?? '',
			contactName: supplier.contactName ?? '',
			phone: supplier.phone ?? '',
			email: supplier.email ?? '',
			paymentTermsDays: supplier.paymentTermsDays,
			usesItemCodes: supplier.usesItemCodes,
			notes: supplier.notes ?? '',
			active: supplier.active,
		});
		this.loaded = true;
		this.onGstinInput(supplier.gstin ?? '');
	}

	onGstinInput(raw: string): void {
		const gstin = cleanGstin(raw);
		this.gstinValue.set(gstin);
		this.check.set(null);
		this.serverErrors.update(({ gstin: _gstin, ...rest }) => rest);
		this.unlockFromGstin(gstin);
		this.gstinTyped.next(gstin);
	}

	/** A good GSTIN sets State and PAN and locks them; anything else unlocks them again. */
	private applyCheck(result: SupplierGstinCheck | 'failed' | null): void {
		this.check.set(result);
		const verdict = this.verdict();
		const { stateCode, pan } = this.form.controls;
		if (verdict.kind === 'ok' || verdict.kind === 'taken') {
			const code = verdict.kind === 'ok' ? verdict.stateCode : this.gstinValue().slice(0, 2);
			stateCode.setValue(code);
			pan.setValue(verdict.kind === 'ok' ? verdict.pan : this.gstinValue().slice(2, 12));
			stateCode.disable({ emitEvent: false });
			pan.disable({ emitEvent: false });
		}
	}

	private unlockFromGstin(gstin: string): void {
		if (gstin.length === 15) return;
		this.form.controls.stateCode.enable({ emitEvent: false });
		this.form.controls.pan.enable({ emitEvent: false });
	}

	/** Save is off while the GSTIN is wrong, checking, already used, or needed and missing. */
	readonly gstinBlocks = computed(() => {
		const verdict = this.verdict();
		return (
			verdict.kind === 'problem' ||
			verdict.kind === 'taken' ||
			verdict.kind === 'checking' ||
			verdict.kind === 'typing'
		);
	});

	gstinRequired(): boolean {
		return this.form.controls.kind.value !== 'unregistered';
	}

	canSave(): boolean {
		if (this.saving() || this.gstinBlocks()) return false;
		if (this.gstinRequired() && !this.gstinValue()) return false;
		return this.form.valid || this.form.disabled;
	}

	body(): SupplierWrite {
		const value = this.form.getRawValue();
		const text = (input: string) => input.trim() || null;
		const gstin = this.gstinValue() || null;
		return {
			legalName: value.legalName.trim(),
			shortName: value.shortName.trim(),
			kind: value.kind,
			gstin,
			pan: gstin ? gstin.slice(2, 12) : text(value.pan.toUpperCase()),
			stateCode: gstin ? gstin.slice(0, 2) : value.stateCode,
			address: { line: value.line.trim(), city: value.city.trim(), pin: value.pin.trim() },
			contactName: text(value.contactName),
			phone: text(value.phone),
			email: text(value.email),
			paymentTermsDays: Number(value.paymentTermsDays),
			usesItemCodes: value.usesItemCodes,
			notes: text(value.notes),
			active: value.active,
		};
	}

	async save(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.canSave()) return;
		this.saving.set(true);
		this.serverErrors.set({});
		try {
			const saved = await firstValueFrom(this.gateway.saveSupplier(this.id(), this.body()));
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
			this.notifier.showSuccess(this.transloco.translate(this.id() ? 'supplier_updated' : 'supplier_created'));
			void this.router.navigate(['/suppliers', saved.id]);
		} catch (error) {
			const errors: Record<string, string> = {};
			for (const issue of apiIssues(error)) {
				const field = issue.code.startsWith('gstin') ? 'gstin' : (issue.target ?? issue.code);
				errors[field] = issue.message;
			}
			this.serverErrors.set(errors);
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}

	cancel(): void {
		const id = this.id();
		void this.router.navigate(id && this.loaded ? ['/suppliers', id] : ['/suppliers']);
	}
}
