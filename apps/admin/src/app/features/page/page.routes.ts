import { Routes } from '@angular/router';

import { CreatePage } from './create-page/create-page';
import { EditPage } from './edit-page/edit-page';
import { Page } from './page';

export default [
	{
		path: '',
		component: Page,
	},
	{
		path: 'create',
		component: CreatePage,
	},
	{
		path: 'edit/:id',
		component: EditPage,
	},
] as Routes;
