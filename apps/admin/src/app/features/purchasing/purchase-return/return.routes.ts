import { Routes } from '@angular/router';

import { ReturnForm } from './return-form';
import { ReturnList } from './return-list';
import { ReturnView } from './return-view';

/** Purchases › Purchase returns (r01–r04). */
export default [
	{ path: '', component: ReturnList },
	{ path: 'create', component: ReturnForm },
	{ path: ':id', component: ReturnView },
	{ path: ':id/edit', component: ReturnForm },
] as Routes;
