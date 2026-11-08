import { Routes } from '@angular/router';

import { CreateSearchTerm } from './create-search-term/create-search-term';
import { EditSearchTerm } from './edit-search-term/edit-search-term';
import { SearchTermList } from './search-term';

export default [
	{ path: '', component: SearchTermList },
	{ path: 'create', component: CreateSearchTerm },
	{ path: 'edit/:id', component: EditSearchTerm },
] as Routes;
