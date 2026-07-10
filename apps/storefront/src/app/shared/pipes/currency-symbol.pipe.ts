import { CurrencyPipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';

import { ICurrency } from '@data-access/interfaces/currency.interface';
import { SettingStore } from '@core/state/setting.store';

@Pipe({
	name: 'currencySymbol',
	standalone: true,
	// Impure: the selected currency arrives asynchronously (from the settings load)
	// and via a signal, not an input. A pure pipe caches the first (often null)
	// value and never re-runs, rendering "undefined $" until an input changes. NGXS
	// masked this by persisting selectedCurrency synchronously; the SignalStore
	// resolves it after bootstrap, so the pipe must re-evaluate as it updates.
	pure: false,
})
export class CurrencySymbolPipe implements PipeTransform {
	private currencyPipe = inject(CurrencyPipe);
	private settingStore = inject(SettingStore);

	public symbol: string = '$';

	transform(
		value: number | undefined,
		position: 'before_price' | 'after_price' | string = 'before_price',
	): string | number {
		const selectedCurrency = this.settingStore.selectedCurrency() as ICurrency | null;

		if (!value) {
			value = 0;
		}
		value = Number(value);
		value = value * (selectedCurrency?.exchange_rate ?? 1);

		this.symbol = selectedCurrency?.symbol || '$';
		position = selectedCurrency?.symbol_position ?? position;

		let formattedValue = this.currencyPipe.transform(value, this.symbol);
		formattedValue = formattedValue?.replace(this.symbol, '')!;

		if (position === 'before_price') {
			return `${this.symbol} ${formattedValue}`;
		} else {
			return `${formattedValue} ${this.symbol}`;
		}
	}
}
