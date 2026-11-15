import { Reflector } from '@nestjs/core';
import { ActiveLocaleConfig, PRIMARY_LOCALE } from '@saha-textile/contracts';
import { PRIMARY_LOCALE as SHARED_PRIMARY } from '@saha-textile/core-domain/languages';
import { describe, expect, it } from 'vitest';

import { PUBLIC_ROUTE_KEY } from '../src/auth/session.guard';
import { isPublicRead } from '../src/common/public-read';
import { LanguagesController } from '../src/languages/languages.controller';
import { LanguagesService } from '../src/languages/languages.service';

const controller = (locales: string[]) => new LanguagesController(new LanguagesService({ locales }));

describe('GET /storefront/languages', () => {
	it('answers the active languages, English first, in the shared shape', () => {
		const answer = controller(['en', 'bn']).list();
		expect(answer).toEqual({ default: 'en', active: ['en', 'bn'] });
		expect(ActiveLocaleConfig.parse(answer)).toEqual(answer);
	});

	it('uses the same English as the browser-safe language rules', () => {
		expect(SHARED_PRIMARY).toBe(PRIMARY_LOCALE);
	});

	it('puts English first and drops repeats whatever the settings say', () => {
		expect(controller(['bn', 'en', 'bn']).list().active).toEqual(['en', 'bn']);
	});

	it('is public, cacheable for a minute, and outside the shared rate limit', () => {
		const handler = LanguagesController.prototype.list;
		expect(new Reflector().get(PUBLIC_ROUTE_KEY, handler)).toBe(true);
		expect(Reflect.getMetadata('__headers__', handler)).toEqual([
			{ name: 'Cache-Control', value: 'public, max-age=60' },
		]);
		expect(isPublicRead('GET', '/storefront/languages')).toBe(true);
		expect(isPublicRead('POST', '/storefront/languages')).toBe(false);
	});
});
