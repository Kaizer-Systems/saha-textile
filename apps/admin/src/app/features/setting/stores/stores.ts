import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { STORE_GO_LIVE_WORDS, goLiveToast } from '@core/catalog/go-live-report';
import { AuthStore } from '@core/state/auth.store';
import { displayPhone } from '@core/stores/store-hours';
import {
	STORE_LOCATIONS_KEY,
	StoreLocationGateway,
	injectStoreLocationsQuery,
} from '@core/stores/store-location.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';

import type { AdminStoreLocationRow } from '@saha-textile/contracts';

/**
 * Settings › Stores: every store in the order Contact Us shows them. Rows are dragged by their
 * handle, or moved with the arrow buttons on a phone or from the keyboard; each move saves at once.
 */
@Component({
	selector: 'app-stores-settings',
	templateUrl: './stores.html',
	styleUrls: ['./stores.scss'],
	imports: [
		PageWrapper,
		RouterLink,
		TranslocoModule,
		HasPermissionDirective,
		CdkDropList,
		CdkDrag,
		CdkDragHandle,
		DeleteModal,
	],
})
export class StoresSettings {
	private readonly gateway = inject(StoreLocationGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	private readonly query = injectStoreLocationsQuery();
	/** The rows as shown; a drag moves them here first, so the list never jumps back while saving. */
	readonly rows = signal<AdminStoreLocationRow[]>([]);
	private readonly saved = computed(() => this.query.data() ?? []);
	readonly loading = computed(() => this.query.isPending());
	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));

	constructor() {
		effect(() => this.rows.set(this.saved()));
	}

	name(row: AdminStoreLocationRow): string {
		return row.store.name['en'] ?? row.store.id;
	}

	/** The phone as a card shows it, or a dash while it is not known. */
	phone(row: AdminStoreLocationRow): string {
		return row.store.phone ? displayPhone(row.store.phone) : '—';
	}

	/** Languages still missing, for the badge: none, or how many fields in which language. */
	missing(row: AdminStoreLocationRow): number {
		return row.gaps.length;
	}

	drop(event: CdkDragDrop<AdminStoreLocationRow[]>) {
		this.move(event.previousIndex, event.currentIndex);
	}

	move(from: number, to: number) {
		if (from === to || to < 0 || to >= this.rows().length) return;
		const next = [...this.rows()];
		moveItemInArray(next, from, to);
		this.rows.set(next);
		this.gateway.reorder(next.map((row) => row.store.id)).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('store_order_saved'));
				void this.queryClient.invalidateQueries({ queryKey: STORE_LOCATIONS_KEY });
			},
			error: () => this.rows.set(this.saved()),
		});
	}

	toggle(row: AdminStoreLocationRow, event: Event) {
		const input = event.target as HTMLInputElement;
		this.gateway.setActive(row.store.id, input.checked).subscribe((result) => {
			input.checked = result.active;
			if (input.checked !== row.store.active || result.gaps.length) {
				goLiveToast(
					{ live: result.active, gaps: result.gaps },
					this.notifier,
					(key) => this.transloco.translate(key),
					STORE_GO_LIVE_WORDS,
				);
			}
			void this.queryClient.invalidateQueries({ queryKey: STORE_LOCATIONS_KEY });
		});
	}

	remove(row: AdminStoreLocationRow) {
		this.gateway.remove(row.store.id).subscribe(() => {
			this.notifier.showSuccess(this.transloco.translate('store_deleted'));
			void this.queryClient.invalidateQueries({ queryKey: STORE_LOCATIONS_KEY });
		});
	}
}
