import { Routes } from '@angular/router';

import { AuthGuard } from '@core/guards/auth.guard';

import { content } from './routes/content.routes';
import { full } from './routes/full.routes';

export const routes: Routes = [
	{
		path: '',
		redirectTo: 'auth/login',
		pathMatch: 'full',
	},
	/**
	 * Deliberately UNGUARDED. These are the screens an operator uses precisely because they
	 * are not signed in — login, PIN login, and the password-recovery chain.
	 *
	 * `AuthGuard` used to sit here as `canActivateChild`, which made an anonymous visit to
	 * `/auth/login` redirect to `/auth/login`: the guard answers
	 * `createUrlTree(['/auth/login'])`, that target is a child of this route, the guard runs
	 * again, and the router spins the main thread at 100% CPU rendering nothing. The tab
	 * became unresponsive — no console, no close.
	 *
	 * It never fired while the app seeded a fake token into `localStorage`, because
	 * `isAuthenticated()` was true before anyone signed in and the guard always passed.
	 * Removing that token in the cookie-session migration is what exposed it.
	 */
	{
		path: 'auth',
		loadChildren: () => import('@features/auth/auth.routes'),
	},
	/**
	 * The back office. Guarded here, which is where the guard belongs and where it was
	 * missing: `AuthGuard` was applied ONLY to the auth routes, so these shells were
	 * reachable while signed out. An anonymous operator got an empty admin frame answering
	 * 401 to everything instead of being sent to the login screen.
	 *
	 * This is presentation only and always was — every admin endpoint independently enforces
	 * the admin audience, role and permissions against the session cookie, so the missing
	 * guard was a usability and clarity defect rather than an access-control hole.
	 */
	{
		path: '',
		loadComponent: () => import('@layout/content/content').then((m) => m.Content),
		canActivate: [AuthGuard],
		canActivateChild: [AuthGuard],
		children: content,
	},
	{
		path: '',
		loadComponent: () => import('@layout/full/full').then((m) => m.Full),
		canActivate: [AuthGuard],
		canActivateChild: [AuthGuard],
		children: full,
	},
	{
		path: '**',
		pathMatch: 'full',
		loadComponent: () => import('@features/errors/error404/error404').then((m) => m.Error404),
	},
];
