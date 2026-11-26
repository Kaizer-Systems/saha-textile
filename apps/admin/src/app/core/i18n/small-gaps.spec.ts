import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { BehaviorSubject, NEVER } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { gapsFromError } from '@core/catalog/go-live-report';

import { savedLanguageLists } from './active-languages';
import { injectMissingLanguage } from './missing-language';

describe('language edges', () => {
	afterEach(() => localStorage.clear());

	it('reads a saved copy whose states are not a list of states as having none', () => {
		localStorage.setItem('st_admin_languages', JSON.stringify({ content: ['en', 'bn'], states: 'draft' }));
		expect(savedLanguageLists()).toEqual({ content: ['en', 'bn'], admin: ['en'], shop: ['en'], states: {} });
	});

	it('filters to nothing while the missing list is still on its way', () => {
		const params = new BehaviorSubject(convertToParamMap({ missing: 'bn' }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{ provide: AdminLanguagesGateway, useValue: { missing: () => NEVER } },
			],
		});
		const filter = TestBed.runInInjectionContext(() => injectMissingLanguage('products'));
		expect(filter.code()).toBe('bn');
		expect(filter.ids()).toEqual(new Set());
	});

	it('reads a Go Live gap for the whole field (no language) from a refused save', () => {
		const refused = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ code: 'go_live_blocked', path: ['slug'] }] } },
		});
		expect(gapsFromError(refused)).toEqual([{ field: 'slug', locale: null }]);
	});
});
