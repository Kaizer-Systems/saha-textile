import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormProduct } from '../form-product/form-product';

@Component({
	selector: 'app-create-product',
	templateUrl: './create-product.html',
	styleUrls: ['./create-product.scss'],
	imports: [PageWrapper, FormProduct],
})
export class CreateProduct {}
