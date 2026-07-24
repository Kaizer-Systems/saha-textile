import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormCurrency } from '../form-currency/form-currency';

@Component({
	selector: 'app-create-currency',
	templateUrl: './create-currency.html',
	styleUrls: ['./create-currency.scss'],
	imports: [PageWrapper, FormCurrency],
})
export class CreateCurrency {}
