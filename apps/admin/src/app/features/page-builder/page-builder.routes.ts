import { Routes } from '@angular/router';

import { PbBuilder } from './builder/pb-builder';
import { PageBuilderHome } from './page-builder-home';
import { PageBuilderPages } from './page-builder-pages';
import { PbPageSettings } from './pb-page-settings';

export default [
	{ path: '', component: PageBuilderPages },
	{ path: ':type', component: PageBuilderHome },
	{ path: ':type/settings', component: PbPageSettings },
	{ path: ':type/layouts/:id', component: PbBuilder },
] as Routes;
