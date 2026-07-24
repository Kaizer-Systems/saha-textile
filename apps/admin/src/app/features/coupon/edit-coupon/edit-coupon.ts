import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormCoupon } from '../form-coupon/form-coupon';

@Component({
	selector: 'app-edit-coupon',
	templateUrl: './edit-coupon.html',
	styleUrls: ['./edit-coupon.scss'],
	imports: [PageWrapper, FormCoupon],
})
export class EditCoupon {}
