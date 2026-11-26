import { Routes } from '@angular/router';

import { SupplierForm } from './supplier-form';
import { SupplierList } from './supplier-list';
import { SupplierPage } from './supplier-page';

/** Purchases › Suppliers (s01–s03). */
export default [
	{ path: '', component: SupplierList },
	{ path: 'create', component: SupplierForm },
	{ path: ':id', component: SupplierPage },
	{ path: ':id/edit', component: SupplierForm },
] as Routes;
