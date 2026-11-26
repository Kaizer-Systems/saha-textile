import { Routes } from '@angular/router';

import { ExpenseBillFormPage } from './bill-form';
import { ExpenseBillListPage } from './bill-list';

/** Purchases › Expense bills (brief 25 EB1). */
export default [
	{ path: '', component: ExpenseBillListPage },
	{ path: 'create', component: ExpenseBillFormPage },
	{ path: ':id', component: ExpenseBillFormPage },
] as Routes;
