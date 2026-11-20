import { Routes } from '@angular/router';

import { BusinessForm } from './business-form';
import { BusinessList } from './business-list';
import { BusinessPage } from './business-page';

/** Customers › Businesses (orders and checkout brief bz01–bz06). */
export default [
	{ path: '', component: BusinessList },
	{ path: 'create', component: BusinessForm },
	{ path: ':id', component: BusinessPage },
	{ path: ':id/edit', component: BusinessForm },
] as Routes;
