import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { OrderRoutingSettings, OrderRoutingSettingsWrite } from '@saha-textile/contracts';

const KEY = ['settings', 'order-routing'] as const;

/**
 * Settings › Order routing (accounts brief M2, as drawn; D14 approved 2026-11-23): how a new online order gets
 * its "ships from" location, whether an order may be split, and who may assign.
 */
@Component({
	selector: 'app-order-routing',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './order-routing.html',
})
export class OrderRoutingPage {
	private readonly http = inject(HttpClient);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly url = `${runtimeConfig.apiUrl}/admin/settings/order-routing`;

	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));
	readonly query = injectQuery(() => ({
		queryKey: KEY,
		queryFn: () => firstValueFrom(this.http.get<OrderRoutingSettings>(this.url)),
	}));
	readonly form = signal<OrderRoutingSettingsWrite | null>(null);
	readonly saving = signal(false);
	readonly modes = ['manual', 'suggest', 'auto'] as const;
	readonly who = ['owner_admin', 'location_manager', 'location_staff'] as const;

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (!data) return;
			untracked(() => {
				const { updatedAt, updatedBy, ...rest } = data;
				void updatedBy;
				this.form.set({ ...rest, expectedUpdatedAt: updatedAt });
			});
		});
	}

	set<K extends keyof OrderRoutingSettingsWrite>(key: K, value: OrderRoutingSettingsWrite[K]): void {
		this.form.update((f) => (f ? { ...f, [key]: value } : f));
	}

	async save(): Promise<void> {
		const form = this.form();
		if (!form || !this.canEdit()) return;
		this.saving.set(true);
		try {
			await firstValueFrom(
				this.http.put<OrderRoutingSettings>(this.url, {
					...form,
					splitLimitINR: Number(form.splitLimitINR) || 0,
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: KEY });
			this.notifier.showSuccess(this.transloco.translate('routing_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('routing_save_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
