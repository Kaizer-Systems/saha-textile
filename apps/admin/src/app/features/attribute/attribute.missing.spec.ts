import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';

import { Attribute } from './attribute';

vi.mock('@data-access/queries/attribute.queries', () => ({
	injectAttributesQuery: (params: () => unknown) => {
		params();
		return {
			data: () => ({
				data: [
					{ id: 'color', name: 'Colour' },
					{ id: 'fabric', name: 'Fabric' },
				],
				total: 2,
			}),
			refetch: vi.fn(),
		};
	},
}));

describe('the attribute list opened from Settings › Languages', () => {
	it('lists and counts only the attributes still missing that language', () => {
		const params = new BehaviorSubject(convertToParamMap({ missing: 'bn' }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{
					provide: ActivatedRoute,
					useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } },
				},
				{ provide: AdminLanguagesGateway, useValue: { missing: () => of({ ids: ['fabric'] }) } },
				{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
				{ provide: AttributeService, useValue: {} },
				{ provide: NotificationService, useValue: {} },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(Attribute, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Attribute);
		fixture.detectChanges();
		TestBed.tick();
		expect(fixture.componentInstance.tableConfig()).toMatchObject({ data: [{ id: 'fabric' }], total: 1 });
	});
});
