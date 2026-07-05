import { Routes } from '@angular/router';

import { Error403 } from './error403/error403';

export default [
	{
		path: '',
		children: [
			{
				path: '403',
				component: Error403,
			},
		],
	},
] as Routes;
