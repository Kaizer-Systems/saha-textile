import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormCustomer } from '../form-customer/form-customer';

@Component({
	selector: 'app-edit-customer',
	templateUrl: './edit-customer.html',
	styleUrls: ['./edit-customer.scss'],
	imports: [PageWrapper, FormCustomer],
})
export class EditCustomer {}
