import { Routes } from '@angular/router';

import { OrderForm } from './order-form';
import { OrderList } from './order-list';
import { OrderView } from './order-view';

/** Purchases › Purchase orders (po01–po05). */
export default [
	{ path: '', component: OrderList },
	{ path: 'create', component: OrderForm },
	{ path: ':id', component: OrderView },
	{ path: ':id/edit', component: OrderForm },
] as Routes;
