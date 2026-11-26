import { Component, inject, input } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { lengthText } from '@core/catalog/metre-length';
import { intlLocale } from '@core/i18n/locale';
import { IProduct, IVariation } from '@data-access/interfaces/product.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
	selector: 'app-product-information',
	templateUrl: './product-information.html',
	styleUrls: ['./product-information.scss'],
	imports: [TitleCasePipe, TranslocoModule],
})
export class ProductInformation {
	private transloco = inject(TranslocoService);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct | null>();
	readonly variation = input<IVariation | null>(null);

	/** Tenths of a metre as "4.5 m" (fabric by the metre). */
	tenths(value: number): string {
		return lengthText(value, this.transloco.translate('unit_m'));
	}

	/** 5.5 m in every language: Bengali keeps English digits (BN-3). */
	metres(value: number): string {
		return `${new Intl.NumberFormat(intlLocale(this.transloco.getActiveLang())).format(value)} m`;
	}
}
