import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormCoupon } from '../form-coupon/form-coupon';

@Component({
	selector: 'app-create-coupon',
	templateUrl: './create-coupon.html',
	styleUrls: ['./create-coupon.scss'],
	imports: [PageWrapper, FormCoupon],
})
export class CreateCoupon {}
