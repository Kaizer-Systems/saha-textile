import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PbHistory } from './pb-history';

describe('History (E3)', () => {
	it('lists this session newest first, loads the saved versions, and brings one back through the builder', () => {
		TestBed.resetTestingModule();
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		const revisions = [
			{
				id: 'rev_2',
				number: 2,
				createdAt: '2026-11-17T10:42:00.000Z',
				createdByName: 'Moulik',
				wentLiveAt: null,
				sections: 9,
				isDraft: true,
				isLive: false,
			},
		];
		const gateway = { history: vi.fn(() => of({ revisions })), previewCode: vi.fn() };
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: PageBuilderGateway, useValue: gateway },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(PbHistory, { set: { imports: [], template: '' } });
		const history = TestBed.createComponent(PbHistory).componentInstance;
		const at = new Date('2026-11-17T10:40:00.000Z');
		history.start({
			layoutId: 'lay_winter',
			pageType: 'home',
			locale: 'bn',
			name: 'Winter weddings',
			session: [
				{ at, key: 'pb_log_added', params: { name: 'A' }, steps: 1 },
				{ at, key: 'pb_log_removed', params: { name: 'B' }, steps: 1 },
			],
			readOnly: false,
		});
		expect(history.session().map((line) => line.key)).toEqual(['pb_log_removed', 'pb_log_added']);
		expect(gateway.history).toHaveBeenCalledWith('lay_winter');
		expect(history.revisions()).toEqual(revisions);
		history.bringBack(revisions[0] as never);
		expect(modal.close).toHaveBeenCalledWith({ bringBack: 'rev_2' });
	});
});
