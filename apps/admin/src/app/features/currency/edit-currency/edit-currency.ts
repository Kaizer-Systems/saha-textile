import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormCurrency } from '../form-currency/form-currency';

@Component({
	selector: 'app-edit-currency',
	templateUrl: './edit-currency.html',
	styleUrls: ['./edit-currency.scss'],
	imports: [PageWrapper, FormCurrency],
})
export class EditCurrency {}
