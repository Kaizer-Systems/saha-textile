import { Component, inject, input } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

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

	/** 5.5 m in English, 5,5 m in French. */
	metres(value: number): string {
		return `${new Intl.NumberFormat(this.transloco.getActiveLang()).format(value)} m`;
	}
}
