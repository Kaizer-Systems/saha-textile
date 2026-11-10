import { Component, DOCUMENT, inject, NgZone } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationStart, Router, RouterModule } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { Observable, filter } from 'rxjs';

import { ThemeModeStore } from '@core/brand/theme-mode';
import { ScrollMemory } from '@core/navigation/scroll-memory';
import { countdownKey } from '@core/events/event-popup-rules';
import { ShopEvents } from '@core/events/shop-events';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SettingStore } from '@core/state/setting.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { Layout } from '@layout/layout';

const SITE_TITLE = 'Saha Textile';

@Component({
	selector: 'app-root',
	imports: [RouterModule, Layout],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	// The global shell (header/footer/widgets + one-time data loads) lives in
	// Layout, rendered here ABOVE the router — Analog's pathless-layout convention
	// is a parens route group, which @analogjs/vite-plugin-angular fails to
	// transform. Maintenance is the one full-page route that skips the shell.
	protected get showLayout(): boolean {
		return !this.router.url.startsWith('/maintenance');
	}

	private router = inject(Router);
	private titleService = inject(Title);
	private ngZone = inject(NgZone);
	private seo = inject(LocaleSeo);
	private transloco = inject(TranslocoService);
	private shopEvents = inject(ShopEvents);

	private settingStore = inject(SettingStore);
	private siteConfigStore = inject(SiteConfigStore);
	/** Applies the light or dark mode (the shopper's switch, else the site mode), on the server too. */
	private readonly themeMode = inject(ThemeModeStore);
	/** New pages open at the top; Back returns to the saved position. */
	private readonly scrollMemory = inject(ScrollMemory);

	siteConfig$: Observable<ISiteConfig> = toObservable(this.siteConfigStore.siteConfig) as Observable<ISiteConfig>;

	public isTabInFocus = true;
	public timeoutId: ReturnType<typeof setTimeout>;
	private currentMessageIndex = 0;
	private currentMessage: string;
	private pageTitle = SITE_TITLE;
	private delay = 1000; // Delay between messages in milliseconds

	constructor() {
		const document = inject<Document>(DOCUMENT);
		const config = inject(NgbRatingConfig);

		config.max = 5;
		config.readonly = true;

		// App-init global data loads (moved out of AuthInterceptor to avoid a
		// circular HTTP_INTERCEPTORS dependency). App is the root component, built
		// after the HTTP providers, so these HTTP calls route through interceptors safely.
		this.settingStore.loadSettings();
		this.siteConfigStore.loadSiteConfig();

		this.siteConfig$.subscribe((theme) => {
			// Set Direction
			if (theme?.general?.language_direction === 'rtl') {
				document.getElementsByTagName('html')[0].setAttribute('dir', 'rtl');
				document.body.classList.add('rtl');
			} else {
				document.getElementsByTagName('html')[0].removeAttribute('dir');
				document.body.classList.remove('rtl');
			}

			// Titles and descriptions come from each page in its own language (LocaleSeo), and the
			// default share picture from the Brand Kit (Layout). The theme file's picture was the
			// vendor demo's logo, so it is no longer used.
		});

		// A page without its own title, description or share picture must not keep the previous page's.
		this.router.events
			.pipe(filter((event) => event instanceof NavigationStart))
			.subscribe(() => this.seo.resetDocument(SITE_TITLE));

		document.addEventListener('visibilitychange', () => {
			this.ngZone.run(() => {
				this.isTabInFocus = !document.hidden;
				if (this.isTabInFocus) {
					clearTimeout(this.timeoutId);
					this.titleService.setTitle(this.pageTitle);
				} else {
					this.pageTitle = this.titleService.getTitle();
					this.updateMessage();
				}
			});
		});
	}

	/**
	 * The two lines a hidden tab's title alternates, in the page's language. While an event is
	 * published the second becomes its short line, for example "🎉 Puja Sale ends in 1d 9h".
	 */
	private messages(): string[] {
		const t = (key: string) => this.transloco.translate(key);
		const event = this.shopEvents.stripItems()[0];
		const left = event ? this.shopEvents.left(event.countdownTo) : null;
		const second = event
			? `🎉 ${event.title} ${t(countdownKey(event))}${left ? ` ${left.days}${t('event_unit_day')} ${left.hours}${t('event_unit_hour')}` : ''}`
			: t('tab_offers_for_you');
		return [t('tab_come_back'), second];
	}

	updateMessage() {
		// Clear the previous timeout
		clearTimeout(this.timeoutId);

		// Update the current message
		const messages = this.messages();
		this.currentMessageIndex %= messages.length;
		this.currentMessage = messages[this.currentMessageIndex] as string;
		this.titleService.setTitle(this.currentMessage);
		// Increment the message index or reset it to 0 if it reaches the end
		this.currentMessageIndex = (this.currentMessageIndex + 1) % messages.length;

		// Set a new timeout to call the function again after the specified delay
		this.timeoutId = setTimeout(() => {
			this.updateMessage();
		}, this.delay);
	}

	ngOnDestroy() {
		// Clear the timeout when the component is destroyed
		clearTimeout(this.timeoutId);
	}
}
