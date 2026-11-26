import { Component, computed, effect, inject, signal, untracked, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { paiseOf } from '@features/cash/cash-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { CashBoxWrite, CashRules, Denomination } from '@saha-textile/contracts';

type BoxRow = CashBoxWrite & { key: string };

/** A new box's starting values. */
const blankBox = (): BoxRow => ({
	key: `new_${Math.random().toString(36).slice(2)}`,
	name: '',
	locationId: '',
	kind: 'day_sheet',
	floatPaise: 0,
	countedBy: 'cashier',
	reviewedBy: 'location_manager',
	active: true,
});

/**
 * Settings › Cash boxes (accounts brief O1): each location's boxes with their float, who counts and who reviews; the
 * notes and coins counted at day end (what is in circulation on, the rest off); and the rules for bills, suspense and
 * small differences. Saved together.
 */
@Component({
	selector: 'app-cash-boxes-settings',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './cash-boxes.html',
})
export class CashBoxesSettings {
	private readonly gateway = inject(CashGateway);
	private readonly places = inject(LocationsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly inr = (paise: number) => rupees(paise);
	readonly canEdit = computed(() => this.auth.permissions().includes('cash.settings'));
	readonly boxes = signal<BoxRow[]>([]);
	readonly denominations = signal<Denomination[]>([]);
	readonly bill = signal('');
	readonly days = signal(30);
	readonly autoAccept = signal('0');
	readonly editing = signal<BoxRow>(blankBox());
	readonly float = signal('');
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	readonly settings = injectQuery(() => ({
		queryKey: CASH_KEYS.settings,
		queryFn: () => firstValueFrom(this.gateway.settings()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.places.list()),
	}));
	readonly placeName = (id: string) => (this.locations.data() ?? []).find((l) => l.id === id)?.name ?? '—';

	constructor() {
		effect(() => {
			const view = this.settings.data();
			if (!view) return;
			untracked(() => {
				this.boxes.set(view.boxes.map((b) => ({ ...b, key: b.id })));
				this.denominations.set(view.settings.denominations.map((d) => ({ ...d })));
				this.bill.set(String(view.settings.rules.billPhotoOverPaise / 100));
				this.days.set(view.settings.rules.suspenseDays);
				this.autoAccept.set(String(view.settings.rules.autoAcceptUpToPaise / 100));
			});
		});
	}

	toggle(index: number, on: boolean): void {
		this.denominations.update((list) => list.map((d, at) => (at === index ? { ...d, on } : d)));
	}

	editBox(template: TemplateRef<unknown>, row: BoxRow | null): void {
		const start = row ? { ...row } : { ...blankBox(), locationId: this.locations.data()?.[0]?.id ?? '' };
		this.editing.set(start);
		this.float.set(String(start.floatPaise / 100));
		this.modal = this.modals.open(template, { centered: true });
	}

	setEditing(change: Partial<BoxRow>): void {
		this.editing.update((row) => ({ ...row, ...change }));
	}

	/** The pop-up's Done: the box joins the list, saved with the page. */
	keepBox(): void {
		const row = { ...this.editing(), floatPaise: paiseOf(this.float()) ?? 0 };
		if (!row.name.trim() || !row.locationId) return;
		this.boxes.update((list) =>
			list.some((b) => b.key === row.key) ? list.map((b) => (b.key === row.key ? row : b)) : [...list, row],
		);
		this.modal?.close();
	}

	private rules(): CashRules {
		return {
			billPhotoOverPaise: Math.round(Number(this.bill() || 0) * 100),
			suspenseDays: Number(this.days()) || 1,
			autoAcceptUpToPaise: Math.round(Number(this.autoAccept() || 0) * 100),
		};
	}

	async save(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.saveSettings({
					boxes: this.boxes().map(({ key, ...box }) => ({
						...box,
						...(key.startsWith('new_') ? {} : { id: key }),
					})),
					denominations: this.denominations(),
					rules: this.rules(),
				}),
			);
			this.notifier.showSuccess(this.transloco.translate('cash_settings_saved'));
			await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
		} catch (error) {
			const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
		} finally {
			this.busy.set(false);
		}
	}
}
