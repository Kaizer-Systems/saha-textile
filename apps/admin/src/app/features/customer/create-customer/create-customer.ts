import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormCustomer } from '../form-customer/form-customer';

@Component({
	selector: 'app-create-customer',
	templateUrl: './create-customer.html',
	styleUrls: ['./create-customer.scss'],
	imports: [PageWrapper, FormCustomer],
})
export class CreateCustomer {}
