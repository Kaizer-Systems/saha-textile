import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, input, signal } from '@angular/core';

import { SettingStore } from '@core/state/setting.store';
import { ICurrency } from '@data-access/interfaces/currency.interface';
import { injectCurrenciesQuery } from '@data-access/queries/currency.queries';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

/**
 * The top bar's currency picker. It reads the store's signals directly, so it shows as soon as the settings arrive:
 * on a first visit they can arrive after hydration, and a copy kept in a plain field was never drawn again, leaving
 * the top bar without its picker until the next page.
 */
@Component({
	selector: 'app-currency',
	templateUrl: './currency.html',
	styleUrls: ['./currency.scss'],
	imports: [ClickOutsideDirective, Button],
})
export class Currency {
	private readonly platformId = inject<object>(PLATFORM_ID);
	private readonly document = inject(DOCUMENT);
	private readonly settingStore = inject(SettingStore);

	readonly style = input<string>('basic');
	readonly selectedCurrency = this.settingStore.selectedCurrency;
	readonly open = signal(false);

	private readonly currenciesQuery = injectCurrenciesQuery(() => ({ status: 1 }));
	readonly currencies = computed<ICurrency[]>(() => this.currenciesQuery.data()?.data ?? []);

	constructor() {
		// The shop's own currencies (`GET /currency`): a saved choice takes today's rate, or falls back to ₹.
		effect(() => this.settingStore.useCurrencies(this.currencies()));
	}

	openDropDown(): void {
		this.open.update((open) => !open);
	}

	selectCurrency(currency: ICurrency): void {
		this.open.set(false);
		// Persisted to localStorage inside the store so it survives the reload.
		this.settingStore.setCurrency(currency);
		if (isPlatformBrowser(this.platformId)) {
			this.document.location.reload();
		}
	}

	hideDropdown(): void {
		this.open.set(false);
	}
}
