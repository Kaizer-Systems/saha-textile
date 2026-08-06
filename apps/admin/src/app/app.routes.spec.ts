import { describe, expect, it } from 'vitest';

import { AuthGuard } from '@core/guards/auth.guard';

import { routes } from './app.routes';

/**
 * Where the route guard sits, which is a correctness property rather than a style one.
 *
 * It used to sit on the `auth` routes and nowhere else — exactly inverted. An anonymous
 * visitor to `/auth/login` was redirected by the guard to `/auth/login`, whose guard
 * redirected again, spinning the router at 100% CPU on a blank page until the tab had to be
 * force-closed. Meanwhile the back office itself was reachable while signed out.
 *
 * It went unnoticed because the app seeded a fake token into `localStorage`, so
 * `isAuthenticated()` answered true before anyone signed in and the guard always passed.
 * Removing that token in the cookie-session migration is what exposed both halves.
 */
const guardsOf = (route: { canActivate?: unknown[]; canActivateChild?: unknown[] }) => [
	...(route.canActivate ?? []),
	...(route.canActivateChild ?? []),
];

describe('admin route guards', () => {
	it('leaves the authentication screens reachable while signed out', () => {
		const auth = routes.find((route) => route.path === 'auth');

		expect(auth, 'the auth route disappeared').toBeDefined();
		// Guarding these is self-redirecting by construction: the guard's answer for an
		// unauthenticated caller IS one of these routes.
		expect(guardsOf(auth!)).toEqual([]);
	});

	it('guards every back-office shell', () => {
		const shells = routes.filter((route) => route.path === '' && route.children);

		expect(shells.length).toBeGreaterThan(0);
		for (const shell of shells) {
			expect(guardsOf(shell), 'a back-office shell is reachable while signed out').toContain(AuthGuard);
		}
	});
});
