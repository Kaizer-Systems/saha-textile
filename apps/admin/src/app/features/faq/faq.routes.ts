import { Routes } from '@angular/router';

import { CreateFaq } from './create-faq/create-faq';
import { EditFaq } from './edit-faq/edit-faq';
import { Faq } from './faq';

export default [
	{
		path: '',
		component: Faq,
	},
	{
		path: 'create',
		component: CreateFaq,
	},
	{
		path: 'edit/:id',
		component: EditFaq,
	},
] as Routes;
