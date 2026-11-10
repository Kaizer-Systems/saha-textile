import type { Routes } from '@angular/router';

import { ScreenPage } from './screens/screen-page';

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'overview' },
	{ path: ':screen', component: ScreenPage },
	{ path: '**', redirectTo: 'overview' },
];
