import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { FeatureKey } from '@saha-textile/contracts';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

/**
 * Settings › Features (accounts brief J3, owner-approved 2026-11-23): each part of the software on
 * or off, with what it opens and how many records use it. A switch in use can't go off, and one
 * that needs another (Stores needs Locations) waits for it; the API refuses the same.
 */
@Component({
	selector: 'app-feature-switches',
	imports: [PageWrapper, TranslocoModule],
	templateUrl: './feature-switches.html',
})
export class FeatureSwitchesSettings {
	private readonly gateway = inject(CompanyGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly canEdit = computed(() => this.auth.permissions().includes('company.edit'));
	readonly query = injectQuery(() => ({
		queryKey: COMPANY_KEYS.features,
		queryFn: () => firstValueFrom(this.gateway.features()),
	}));
	/** Changes not saved yet. */
	readonly changes = signal<Partial<Record<FeatureKey, boolean>>>({});
	readonly saving = signal(false);
	readonly rows = computed(() =>
		(this.query.data()?.rows ?? []).map((row) => {
			const on = this.changes()[row.key] ?? row.on;
			const missing = on
				? (row.needs.find(
						(need) => !(this.changes()[need] ?? this.query.data()?.rows.find((r) => r.key === need)?.on),
					) ?? null)
				: null;
			return { ...row, on, locked: row.on && row.inUse > 0, missing };
		}),
	);
	readonly dirty = computed(() => Object.keys(this.changes()).length > 0);
	readonly blocked = computed(() => this.rows().some((row) => row.missing));

	toggle(key: FeatureKey, on: boolean): void {
		this.changes.update((current) => ({ ...current, [key]: on }));
	}

	async save(): Promise<void> {
		if (!this.dirty() || this.blocked() || !this.canEdit()) return;
		this.saving.set(true);
		try {
			await firstValueFrom(this.gateway.saveFeatures(this.changes(), this.query.data()?.updatedAt ?? null));
			this.changes.set({});
			await this.queryClient.invalidateQueries({ queryKey: COMPANY_KEYS.features });
			this.notifier.showSuccess(this.transloco.translate('features_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('features_save_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
