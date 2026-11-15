import { Routes } from '@angular/router';

import { FileManager } from './file-manager/file-manager';
import { Media } from './media';

export default [
	{
		path: '',
		component: Media,
	},
	// The new Media page while it is being built (media step 1.5); `/media` moves to it once uploads work.
	{
		path: 'files',
		component: FileManager,
	},
] as Routes;
