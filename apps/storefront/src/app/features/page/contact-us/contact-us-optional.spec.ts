import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ContactMessageService, type ContactMessageRequest } from '@data-access/services/contact-message.service';
import { NotificationService } from '@data-access/services/notification.service';

import { ContactUs } from './contact-us';

vi.mock('@data-access/queries/store-location.queries', () => ({
	injectStoreLocationsQuery: () => ({ data: signal([]) }),
}));
vi.mock('@data-access/queries/brand.queries', () => ({ injectBrandQuery: () => ({ data: signal(null) }) }));

describe('ContactUs', () => {
	const motion = { reduce: false };
	beforeEach(() => {
		motion.reduce = false;
		window.matchMedia = vi.fn(() => ({ matches: motion.reduce })) as never;
	});
	const render = (locale = 'en') => {
		const siteConfig = signal<unknown>(null);
		const contact = {
			answer: new Subject<{ accepted: boolean }>(),
			send: vi.fn((_body: ContactMessageRequest) => contact.answer),
		};
		const modals = { open: vi.fn() };
		const notifications = { showError: vi.fn() };
		const seo = {
			applyJsonLd: vi.fn(),
			removeJsonLd: vi.fn(),
			applyDocument: vi.fn(),
			applyBreadcrumbList: vi.fn(),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: TranslocoService,
					useValue: { selectTranslate: () => of('Contact Us'), translate: (key: string) => `t:${key}` },
				},
				{ provide: Router, useValue: { url: '/contact-us' } },
				{ provide: SiteConfigStore, useValue: { siteConfig } },
				{ provide: LocaleSeo, useValue: seo },
				{ provide: ContactMessageService, useValue: contact },
				{ provide: NgbModal, useValue: modals },
				{ provide: NotificationService, useValue: notifications },
				{ provide: ACTIVE_LOCALE, useValue: locale },
			],
		});
		TestBed.overrideComponent(ContactUs, { set: { imports: [], template: '' } });
		const form = TestBed.createComponent(ContactUs).componentInstance;
		TestBed.tick();
		return { form, siteConfig, seo, contact, modals, notifications };
	};

	it('sends a cleared phone and the hidden box as empty text', () => {
		const { form, contact } = render();
		form.form.patchValue({
			name: 'Asha Roy',
			email: 'asha@example.test',
			phone: null,
			subject: 'Saree query',
			message: 'Do you have this in red?',
			website: null,
		});
		form.submit();
		expect(contact.send).toHaveBeenCalledWith(
			expect.objectContaining({ phone: '', website: '', name: 'Asha Roy' }),
		);
	});
});
