import { isPlatformBrowser, Location } from '@angular/common';
import {
	DOCUMENT,
	inject,
	Injectable,
	InjectionToken,
	isDevMode,
	NgZone,
	PLATFORM_ID,
	provideEnvironmentInitializer,
} from '@angular/core';
import { NavigationError, NavigationStart, Router } from '@angular/router';

const WORKER_PATH = '/sw.js';
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** A page younger than this was just served, so a missing file is not a stale build. */
const FRESH_PAGE_MS = 30_000;
/** How Chrome, Safari and Firefox word a page file that the latest build removed. */
const MISSING_BUILD_FILE = /dynamically imported module|importing a module script failed|error loading dynamically/i;

/** Off in development, where Vite serves the app and there is no `sw.js`. */
export const SERVICE_WORKER_ENABLED = new InjectionToken<boolean>('SERVICE_WORKER_ENABLED', {
	providedIn: 'root',
	factory: () => !isDevMode(),
});

/**
 * Registers the service worker and keeps open pages off old builds.
 *
 * An installed app can stay open for days. When a new build goes live this marks the page out of
 * date, and the next in-app link becomes a normal page load. The shopper sees one ordinary page
 * change and no notice, and nothing typed into the current page is lost.
 *
 * Runs after the page has loaded, in the browser only, so it cannot touch first paint or the
 * server's HTML. Timers stay outside Angular's zone: a repeating one inside it stops the app ever
 * becoming stable, and Angular then drops clicks made during hydration.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
	private readonly enabled = inject(SERVICE_WORKER_ENABLED);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly location = inject(Location);
	private readonly page = inject<Document>(DOCUMENT);
	private readonly router = inject(Router);
	private readonly zone = inject(NgZone);

	private outOfDate = false;

	start(): void {
		const view = this.page.defaultView;
		const workers = view?.navigator.serviceWorker;
		if (!this.enabled || !this.isBrowser || !view || !workers) return;

		this.router.events.subscribe((event) => {
			const leaving =
				event instanceof NavigationStart && event.navigationTrigger === 'imperative' && this.outOfDate;
			const missingFile =
				event instanceof NavigationError &&
				MISSING_BUILD_FILE.test(String(event.error)) &&
				view.performance.now() > FRESH_PAGE_MS;
			if (leaving || missingFile) this.page.location.assign(this.location.prepareExternalUrl(event.url));
		});

		this.zone.runOutsideAngular(() => {
			const begin = () => void this.register(view, workers);
			if (this.page.readyState === 'complete') begin();
			else view.addEventListener('load', begin, { once: true });
		});
	}

	private async register(view: Window, workers: ServiceWorkerContainer): Promise<void> {
		// The first worker to take control is an install, not an update.
		let controlled = !!workers.controller;
		workers.addEventListener('controllerchange', () => {
			this.outOfDate = controlled;
			controlled = true;
		});

		let registration: ServiceWorkerRegistration;
		try {
			registration = await workers.register(WORKER_PATH, { scope: '/', updateViaCache: 'none' });
		} catch {
			return; // The shop works without it, as it does in a browser with no service workers.
		}

		let lastCheck = Date.now();
		const check = () => {
			lastCheck = Date.now();
			registration.update().catch(() => undefined); // Offline; the next check tries again.
		};
		view.setInterval(check, CHECK_EVERY_MS);
		this.page.addEventListener('visibilitychange', () => {
			if (this.page.visibilityState === 'visible' && Date.now() - lastCheck >= CHECK_EVERY_MS) check();
		});
	}
}

export function provideAppUpdate() {
	return provideEnvironmentInitializer(() => inject(AppUpdate).start());
}
