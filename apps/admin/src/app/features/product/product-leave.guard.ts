import type { Signal } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';

import type { FormProduct } from './form-product/form-product';

/** A page that holds the product form. */
export interface HoldsProductForm {
	readonly form: Signal<FormProduct | undefined>;
}

/** Brief 7c: leaving the product form with work saved nowhere asks first. */
export const productLeaveGuard: CanDeactivateFn<HoldsProductForm> = (page) => page.form()?.confirmLeave() ?? true;
