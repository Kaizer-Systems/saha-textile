import { CurrencyPipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';

import { SettingStore } from '@core/state/setting.store';

@Pipe({
	name: 'currencySymbol',
	standalone: true,
})
export class CurrencySymbolPipe implements PipeTransform {
	private currencyPipe = inject(CurrencyPipe);
	private settingStore = inject(SettingStore);

	public symbol: string = '$';

	transform(value: number, position: 'before_price' | 'after_price' | string = 'before_price'): string {
		// Read the (persisted/hydrated) settings signal synchronously — a pure pipe's transform must not
		// depend on an async subscription, or the first (sync) pass runs before settings load and yields NaN.
		const setting = this.settingStore.setting();

		if (!value) {
			value = 0;
		}

		value = Number(value);

		if (setting?.general?.default_currency?.exchange_rate) {
			value = value * setting.general.default_currency.exchange_rate;
		}

		this.symbol = setting?.general?.default_currency?.symbol || this.symbol;
		position = setting?.general?.default_currency?.symbol_position || position;

		let formattedValue = value && this.currencyPipe.transform(value?.toFixed(2), this.symbol);
		formattedValue = formattedValue && formattedValue?.replace(this.symbol, '')!;

		if (position === 'before_price') {
			return `${this.symbol}${formattedValue}`;
		} else {
			return `${formattedValue}${this.symbol}`;
		}
	}
}
