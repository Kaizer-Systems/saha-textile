import { Injectable, signal } from '@angular/core';

import { of } from 'rxjs';

import type { ICurrency } from '../../../../../storefront/src/app/data-access/interfaces/currency.interface';
import type { IValues } from '../../../../../storefront/src/app/data-access/interfaces/setting.interface';

/**
 * Stable application-settings boundary for stories. It supports the public
 * methods used by both Angular applications without performing HTTP or storage
 * work inside the component catalogue.
 */
@Injectable({ providedIn: 'root' })
export class SettingStore {
	readonly setting = signal<IValues | null>(null);
	readonly selectedCurrency = signal<ICurrency | null>(null);

	loadSettings(): void {}

	loadSetting() {
		return of({ values: this.setting() });
	}

	setCurrency(currency: ICurrency): void {
		this.selectedCurrency.set(currency);
	}

	update(_payload?: unknown): void {}
}
