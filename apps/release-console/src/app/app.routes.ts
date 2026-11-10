import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';

import { ConsoleSession } from './data/session';
import { ConsolePage } from './pages/console-page';
import { LockPage } from './pages/lock-page';
import { ProjectPage } from './pages/project-page';
import { ScreenPage } from './screens/screen-page';
import { Shell } from './shell/shell';

/** Everything but the lock screen needs an unlocked session; the API ends stale ones with a 401. */
export const unlocked: CanActivateFn = () =>
	inject(ConsoleSession).token() ? true : inject(Router).createUrlTree(['/lock']);

export const routes: Routes = [
	{ path: 'lock', component: LockPage },
	{
		path: '',
		component: Shell,
		canActivate: [unlocked],
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'console/projects' },
			{ path: 'console', pathMatch: 'full', redirectTo: 'console/projects' },
			{ path: 'console/:page', component: ConsolePage },
			{ path: 'p/:project', pathMatch: 'full', redirectTo: 'p/:project/overview' },
			{ path: 'p/:project/r/:repo', pathMatch: 'full', redirectTo: 'p/:project/r/:repo/overview' },
			{ path: 'p/:project/r/:repo/:screen', component: ScreenPage },
			{ path: 'p/:project/:page', component: ProjectPage },
		],
	},
	{ path: '**', redirectTo: '' },
];
