import { AsyncPipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IShipping, IShippingModel } from '@data-access/interfaces/shipping.interface';
import { injectShippingsQuery } from '@data-access/queries/shipping.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { NoData } from '@shared/ui/no-data/no-data';

import { ShippingCountryModal } from './modal/shipping-country-modal/shipping-country-modal';

@Component({
	selector: 'app-shipping',
	templateUrl: './shipping.html',
	styleUrls: ['./shipping.scss'],
	imports: [
		PageWrapper,
		HasPermissionDirective,
		RouterModule,
		NoData,
		ShippingCountryModal,
		DeleteModal,
		TranslocoModule,
		AsyncPipe,
	],
})
export class Shipping {
	private readonly shippingsQuery = injectShippingsQuery(() => ({}));

	shipping$: Observable<IShippingModel | undefined> = toObservable(this.shippingsQuery.data);

	readonly CountryShippingModal = viewChild<ShippingCountryModal>('countryShippingModal');
	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	delete(_actionType: string, _data: IShipping) {
		// Mock: delete has no backend yet.
	}
}
