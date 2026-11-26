import { Routes } from '@angular/router';

import { FileManager } from './file-manager/file-manager';
import { Media } from './media';

export default [
	// The Media page as a file manager (media steps 1–2); `/media` opens it since step 2e.
	{
		path: '',
		component: FileManager,
	},
	{
		path: 'files',
		component: FileManager,
	},
	// The earlier Media page, kept reachable (not in the menu) until the owner types its removal.
	{
		path: 'previous',
		component: Media,
	},
] as Routes;
