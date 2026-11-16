import { Routes } from '@angular/router';

import { EditPage } from './edit-page/edit-page';
import { Page } from './page';

export default [
	{
		path: '',
		component: Page,
	},
	{
		path: 'edit/:id',
		component: EditPage,
	},
] as Routes;
