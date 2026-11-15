import { Inject, Injectable } from '@nestjs/common';
import { type ActiveLocaleConfig, PRIMARY_LOCALE } from '@saha-textile/contracts';
import { orderLocales } from '@saha-textile/core-domain/languages';

import { APP_CONFIG, type AppConfig } from '../config/app-config';

/**
 * The shop's active languages, the one list every app reads (`GET /storefront/languages`).
 * Today it comes from `ACTIVE_LOCALES`; English is always in it, first.
 */
@Injectable()
export class LanguagesService {
	constructor(@Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'locales'>) {}

	active(): ActiveLocaleConfig {
		return { default: PRIMARY_LOCALE, active: orderLocales(this.config.locales) };
	}
}
