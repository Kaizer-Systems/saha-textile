import { Routes } from '@angular/router';

import { AddonTemplate } from './addon-template';

export default [
	{ path: '', component: AddonTemplate },
	{ path: 'create', component: AddonTemplate },
	{ path: 'edit/:code', component: AddonTemplate },
] as Routes;
