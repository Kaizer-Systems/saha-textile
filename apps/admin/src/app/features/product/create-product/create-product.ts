import { Component, viewChild } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormProduct } from '../form-product/form-product';
import { HoldsProductForm } from '../product-leave.guard';

@Component({
	selector: 'app-create-product',
	templateUrl: './create-product.html',
	styleUrls: ['./create-product.scss'],
	imports: [PageWrapper, FormProduct],
})
export class CreateProduct implements HoldsProductForm {
	readonly form = viewChild(FormProduct);
}
