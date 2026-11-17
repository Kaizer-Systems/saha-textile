import { Routes } from '@angular/router';

import { PageBuilderHome } from './page-builder-home';
import { PageBuilderPages } from './page-builder-pages';

export default [
	{ path: '', component: PageBuilderPages },
	{ path: ':type', component: PageBuilderHome },
] as Routes;
