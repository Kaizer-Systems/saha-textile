import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { GST_STATES } from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { LocationWrite } from '@saha-textile/contracts';

const blank = (): LocationWrite => ({
	name: '',
	shortCode: '',
	warehouse: true,
	store: false,
	office: false,
	courierPickup: false,
	shipsOnline: false,
	showOnStoresPage: false,
	storeLocationId: null,
	address: '',
	pin: '',
	city: '',
	stateCode: '19',
	phone: '',
	openingHours: '',
	shopsEstablishmentNo: '',
	gstRegistrationId: null,
	invoiceIdentity: 'location',
	numberSeries: 'gstin',
	counterCashBox: false,
	pettyCashFloatINR: 0,
	active: true,
	expectedUpdatedAt: null,
});

/**
 * Add or edit a location (accounts brief K2, as drawn; owner-approved 2026-11-23): what it is, address and
 * contact, billing and books. A store is always a warehouse; only registrations in its State can be picked.
 */
@Component({
	selector: 'app-location-form',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './location-form.html',
})
export class LocationFormPage {
	private readonly gateway = inject(LocationsGateway);
	private readonly company = inject(CompanyGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly states = GST_STATES.filter((s) => !s.retired);
	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id'))), { initialValue: null });
	readonly isNew = computed(() => !this.id() || this.id() === 'new');
	readonly canEdit = computed(() => this.auth.permissions().includes('location.edit'));
	readonly list = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly form = signal<LocationWrite>(blank());
	readonly saving = signal(false);
	readonly current = computed(() =>
		this.isNew() ? null : (this.list.data()?.find((l) => l.id === this.id()) ?? null),
	);
	/** Only registrations in this location's State (J2): another State needs its own. */
	readonly registrationChoices = computed(() =>
		(this.registrations.data() ?? []).filter((r) => r.stateCode === this.form().stateCode),
	);

	constructor() {
		effect(() => {
			const current = this.current();
			if (!current) return;
			untracked(() => {
				const { id, createdAt, updatedAt, updatedBy, ...rest } = current as typeof current & {
					people?: number;
				};
				void id;
				void createdAt;
				void updatedBy;
				const { people, ...write } = rest as typeof rest & { people?: number };
				void people;
				this.form.set({ ...write, expectedUpdatedAt: updatedAt });
			});
		});
	}

	set<K extends keyof LocationWrite>(key: K, value: LocationWrite[K]): void {
		this.form.update((f) => {
			const next = { ...f, [key]: value };
			// A store is always a warehouse; an office holds no stock (K2 rules).
			if (key === 'store' && value) Object.assign(next, { warehouse: true, office: false });
			if (key === 'warehouse' && !value) Object.assign(next, { store: false });
			if (key === 'office' && value) Object.assign(next, { warehouse: false, store: false });
			if (key === 'warehouse' && value) Object.assign(next, { office: false });
			if (key === 'stateCode' && f.gstRegistrationId) Object.assign(next, { gstRegistrationId: null });
			return next;
		});
	}

	async save(): Promise<void> {
		if (!this.canEdit()) return;
		this.saving.set(true);
		try {
			const body = { ...this.form(), pettyCashFloatINR: Math.max(0, Number(this.form().pettyCashFloatINR) || 0) };
			if (this.isNew()) await firstValueFrom(this.gateway.create(body));
			else await firstValueFrom(this.gateway.save(this.id()!, body));
			await this.queryClient.invalidateQueries({ queryKey: ['locations'] });
			this.notifier.showSuccess(this.transloco.translate('location_saved'));
			await this.router.navigate(['/setting/locations']);
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code.startsWith('location_problem:')
						? `location_problem_${code.split(':')[1]}`
						: 'location_save_failed',
				),
			);
		} finally {
			this.saving.set(false);
		}
	}

	async toggleActive(): Promise<void> {
		const current = this.current();
		if (!current || !this.canEdit()) return;
		await firstValueFrom(this.gateway.setActive(current.id, !current.active));
		await this.queryClient.invalidateQueries({ queryKey: ['locations'] });
	}
}
