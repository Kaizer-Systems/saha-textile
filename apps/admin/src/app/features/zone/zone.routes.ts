import { Routes } from '@angular/router';

import { ZoneEditor } from './zone-editor';
import { ZoneList } from './zone-list';

/** Customers › Zones (DEC-B2B-ZONES). */
export default [
	{ path: '', component: ZoneList },
	{ path: 'create', component: ZoneEditor },
	{ path: ':id', component: ZoneEditor },
] as Routes;
