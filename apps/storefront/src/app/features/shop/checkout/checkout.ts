import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

/** Checkout waits on its tax, shipping, numbering and stock decisions. Until then it says so. */
@Component({
	selector: 'app-checkout',
	templateUrl: './checkout.html',
	imports: [Breadcrumb, NoData, RouterLink, TranslocoModule],
})
export class Checkout {
	public breadcrumb = translatedBreadcrumb('checkout');
}
