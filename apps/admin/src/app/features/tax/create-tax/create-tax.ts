import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormTax } from '../form-tax/form-tax';

@Component({
	selector: 'app-create-tax',
	templateUrl: './create-tax.html',
	styleUrls: ['./create-tax.scss'],
	imports: [PageWrapper, FormTax],
})
export class CreateTax {}
