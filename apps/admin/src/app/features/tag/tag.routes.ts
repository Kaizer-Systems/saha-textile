import { Routes } from '@angular/router';

import { CreateTag } from './create-tag/create-tag';
import { EditTag } from './edit-tag/edit-tag';
import { Tag } from './tag';

export default [
	{
		path: '',
		component: Tag,
	},
	{
		path: 'create',
		component: CreateTag,
	},
	{
		path: 'edit/:id',
		component: EditTag,
	},
] as Routes;
