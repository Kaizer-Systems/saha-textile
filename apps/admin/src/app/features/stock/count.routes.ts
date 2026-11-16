import { Routes } from '@angular/router';

import { CountList } from './count-list';
import { CountPage } from './count-page';

/** Stock › Stock counts (c01–c03, g02). */
export default [
	{ path: '', component: CountList },
	{ path: ':id', component: CountPage },
] as Routes;
