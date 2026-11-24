import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { ChartOfAccounts, FixedAsset } from '@saha-textile/contracts';

/** The ledgers an asset can be paid from: cash, bank and suppliers. */
export function payingLedgers(chart: ChartOfAccounts): { id: string; name: string }[] {
	const keys = new Set(['cash_in_hand', 'bank_accounts', 'bank_od', 'sundry_creditors']);
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const placed = (groupId: string): boolean => {
		const group = groups.get(groupId);
		if (!group) return false;
		return (
			(group.systemKey !== null && keys.has(group.systemKey)) || (group.parentId ? placed(group.parentId) : false)
		);
	};
	return chart.ledgers
		.filter((l) => l.active !== false && placed(l.groupId))
		.map((l) => ({ id: l.id, name: l.name }));
}

/** SLM's monthly amount for the When saved card (paise). */
export function monthlySlm(costINR: number, residualINR: number, lifeMonths: number): number {
	return lifeMonths > 0 ? Math.round(((costINR - residualINR) * 100) / lifeMonths) : 0;
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Add or change a fixed asset (accounts brief R2, R4): the kind sets the presets (Schedule II life, 5% residual, the
 * tax block rate), which can be changed for this asset; a new asset is either already in the books or posted against
 * the ledger it was paid from. An asset can be disposed of.
 */
@Component({
	selector: 'app-asset-form',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './asset-form.html',
})
export class AssetFormPage {
	private readonly gateway = inject(AssetsGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly monthly = monthlySlm;
	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), { initialValue: null });
	readonly categories = injectQuery(() => ({
		queryKey: ASSET_KEYS.categories,
		queryFn: () => firstValueFrom(this.gateway.categories()),
	}));
	readonly asset = injectQuery(() => ({
		queryKey: ASSET_KEYS.one(this.id() ?? ''),
		queryFn: () => firstValueFrom(this.gateway.one(this.id() as string)),
		enabled: !!this.id(),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly paying = computed(() => {
		const chart = this.chart.data();
		return chart ? payingLedgers(chart) : [];
	});

	readonly name = signal('');
	readonly categoryKey = signal('furniture');
	readonly locationId = signal('');
	readonly cost = signal(0);
	readonly putToUseOn = signal(istToday());
	readonly method = signal<'slm' | 'wdv'>('slm');
	readonly lifeMonths = signal(120);
	readonly residual = signal(0);
	readonly run = signal<'monthly' | 'yearly'>('monthly');
	readonly taxRatePct = signal(10);
	readonly inputGst = signal<'claimed' | 'blocked'>('claimed');
	readonly reference = signal('');
	readonly acquisition = signal<'books' | 'post'>('books');
	readonly ledgerId = signal('');
	readonly disposeOn = signal(istToday());
	readonly proceeds = signal(0);
	readonly busy = signal(false);
	private loaded = false;

	constructor() {
		effect(() => {
			const a = this.asset.data();
			if (!a || this.loaded) return;
			this.loaded = true;
			this.fill(a);
		});
		effect(() => {
			const first = (this.locations.data() ?? []).find((l) => l.active);
			if (first && !this.locationId()) this.locationId.set(first.id);
		});
	}

	fill(a: FixedAsset): void {
		this.name.set(a.name);
		this.categoryKey.set(a.categoryKey);
		this.locationId.set(a.locationId);
		this.cost.set(a.costINR);
		this.putToUseOn.set(a.putToUseOn);
		this.method.set(a.method);
		this.lifeMonths.set(a.lifeMonths);
		this.residual.set(a.residualINR);
		this.run.set(a.run);
		this.taxRatePct.set(a.taxRatePct);
		this.inputGst.set(a.inputGst);
		this.reference.set(a.reference);
	}

	/** A kind's presets: life in months, the residual at the suggested %, and the tax block rate. */
	pickCategory(key: string): void {
		this.categoryKey.set(key);
		const preset = this.categories.data()?.categories.find((c) => c.key === key);
		if (!preset) return;
		this.lifeMonths.set(preset.lifeYears * 12);
		this.taxRatePct.set(preset.taxRatePct);
		this.residual.set(Math.round(this.cost() * (this.categories.data()?.residualPercent ?? 5)) / 100);
	}

	setCost(value: number): void {
		this.cost.set(value);
		this.residual.set(Math.round(value * (this.categories.data()?.residualPercent ?? 5)) / 100);
	}

	private async run$(work: () => Promise<unknown>, done: string): Promise<boolean> {
		this.busy.set(true);
		try {
			await work();
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: ASSET_KEYS.all });
			return true;
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`assets_problem_${apiProblem(error, 'failed')}`));
			return false;
		} finally {
			this.busy.set(false);
		}
	}

	async save(): Promise<void> {
		const fields = {
			name: this.name().trim(),
			categoryKey: this.categoryKey(),
			locationId: this.locationId(),
			method: this.method(),
			lifeMonths: this.lifeMonths(),
			residualINR: this.residual(),
			run: this.run(),
			taxRatePct: this.taxRatePct(),
			inputGst: this.inputGst(),
			reference: this.reference().trim(),
		};
		const id = this.id();
		const ok = await this.run$(
			() =>
				id
					? firstValueFrom(this.gateway.update(id, { ...fields, version: this.asset.data()?.version ?? 0 }))
					: firstValueFrom(
							this.gateway.create({
								...fields,
								costINR: this.cost(),
								putToUseOn: this.putToUseOn(),
								acquisition:
									this.acquisition() === 'post'
										? { kind: 'post', ledgerId: this.ledgerId() }
										: { kind: 'books' },
							}),
						),
			'assets_saved',
		);
		if (ok) void this.router.navigate(['/accounts/assets']);
	}

	async dispose(): Promise<void> {
		const id = this.id();
		if (!id) return;
		await this.run$(
			() =>
				firstValueFrom(
					this.gateway.dispose(id, {
						on: this.disposeOn(),
						proceedsINR: this.proceeds(),
						version: this.asset.data()?.version ?? 0,
					}),
				),
			'assets_disposed',
		);
	}
}
