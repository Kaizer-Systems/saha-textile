import { Component, viewChild } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormProduct } from '../form-product/form-product';
import { HoldsProductForm } from '../product-leave.guard';

@Component({
	selector: 'app-edit-product',
	templateUrl: './edit-product.html',
	styleUrls: ['./edit-product.scss'],
	imports: [PageWrapper, FormProduct],
})
export class EditProduct implements HoldsProductForm {
	readonly form = viewChild(FormProduct);
}
