import { Routes } from '@angular/router';

import { EntryCheck } from './entry-check';
import { EntryForm } from './entry-form';
import { EntryList } from './entry-list';
import { EntryView } from './entry-view';
import { LabelSheet } from './label-sheet';

/** Purchases › Purchase entries (p01–p13, g01). */
export default [
	{ path: '', component: EntryList },
	{ path: 'create', component: EntryForm },
	{ path: 'labels', component: LabelSheet },
	{ path: ':id', component: EntryView },
	{ path: ':id/edit', component: EntryForm },
	{ path: ':id/check', component: EntryCheck },
	{ path: ':id/labels', component: LabelSheet },
] as Routes;
