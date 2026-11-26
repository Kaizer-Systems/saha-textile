import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

/**
 * Edit user › Locations (accounts brief L1; owner-approved 2026-11-23): where this person works, their home
 * location, whether they may switch and whether they may see all together. The note says exactly what they see.
 */
@Component({
	selector: 'app-user-locations',
	imports: [TranslocoModule],
	templateUrl: './user-locations.html',
})
export class AdminUserLocationsCard {
	private readonly gateway = inject(LocationsGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly userId = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), {
		initialValue: '',
	});
	readonly canEdit = computed(() => this.auth.permissions().includes('location.edit'));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly saved = injectQuery(() => ({
		queryKey: LOCATION_KEYS.user(this.userId()),
		queryFn: () => firstValueFrom(this.gateway.adminUserLocations(this.userId())),
		enabled: !!this.userId(),
	}));
	readonly worksAt = signal<string[]>([]);
	readonly homeLocationId = signal<string | null>(null);
	readonly maySwitch = signal(false);
	readonly maySeeAll = signal(false);
	readonly saving = signal(false);
	readonly active = computed(() => (this.locations.data() ?? []).filter((l) => l.active));
	/** What this person will see (L1's side note). */
	readonly sees = computed(() => {
		if (this.maySeeAll()) return this.transloco.translate('user_loc_sees_all');
		const names = this.active()
			.filter((l) => this.worksAt().includes(l.id))
			.map((l) => l.name);
		if (!names.length) return this.transloco.translate('user_loc_sees_none');
		return this.transloco.translate(this.maySwitch() ? 'user_loc_sees_switch' : 'user_loc_sees_fixed', {
			names: names.join(', '),
		});
	});

	constructor() {
		effect(() => {
			const s = this.saved.data();
			if (!s) return;
			untracked(() => {
				this.worksAt.set(s.worksAt);
				this.homeLocationId.set(s.homeLocationId);
				this.maySwitch.set(s.maySwitch);
				this.maySeeAll.set(s.maySeeAll);
			});
		});
	}

	toggle(id: string, on: boolean): void {
		this.worksAt.update((list) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id)));
		if (!on && this.homeLocationId() === id) this.homeLocationId.set(this.worksAt()[0] ?? null);
		if (on && !this.homeLocationId()) this.homeLocationId.set(id);
	}

	async save(): Promise<void> {
		if (!this.canEdit() || !this.userId()) return;
		this.saving.set(true);
		try {
			await firstValueFrom(
				this.gateway.saveAdminUserLocations(this.userId(), {
					worksAt: this.worksAt(),
					homeLocationId: this.homeLocationId(),
					maySwitch: this.maySwitch(),
					maySeeAll: this.maySeeAll(),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: ['locations'] });
			this.notifier.showSuccess(this.transloco.translate('user_loc_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('user_loc_save_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
