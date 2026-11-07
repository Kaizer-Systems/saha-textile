import { Routes } from '@angular/router';

import { Redirect } from './redirect';

export default [
	{ path: '', component: Redirect },
	{ path: 'create', component: Redirect },
	{ path: 'edit/:source', component: Redirect },
] as Routes;
