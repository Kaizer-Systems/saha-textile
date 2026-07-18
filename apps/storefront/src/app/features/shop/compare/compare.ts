import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { CompareFacade } from '@core/state/compare/compare.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CompareService } from '@data-access/services/compare.service';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-compeer',
	templateUrl: './compare.html',
	styleUrls: ['./compare.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Breadcrumb, NgbRating, NoData, AsyncPipe, TitleCasePipe, CurrencySymbolPipe, TranslocoModule],
})
export class Compare {
	private compareFacade = inject(CompareFacade);
	compareService = inject(CompareService);

	public breadcrumb = translatedBreadcrumb('compare');

	public skeletonItems = Array.from({ length: 3 }, (_, index) => index);

	compareItems$: Observable<IProduct[]> = this.compareFacade.compareItems$;

	constructor() {
		this.compareFacade.getCompare();
	}

	removeCompare(id: number) {
		this.compareFacade.deleteCompare(id);
	}
}
