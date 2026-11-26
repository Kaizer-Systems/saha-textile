import { Routes } from '@angular/router';

import { EditEvent } from './edit-event';
import { Events } from './events';

export default [
	{ path: '', component: Events },
	{ path: 'create/:type', component: EditEvent },
	{ path: 'edit/:id', component: EditEvent },
] as Routes;
