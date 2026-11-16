import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { FmNewFolder } from './fm-new-folder';

const setup = (refuse = false) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = {
		createFolder: vi.fn(() =>
			refuse ? throwError(() => new Error('taken')) : of({ id: 'fld_new', name: 'Bridal 2027' }),
		),
	};
	const toastr = { success: vi.fn(), error: vi.fn() };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: ToastrService, useValue: toastr },
			{ provide: QueryClient, useValue: queries },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FmNewFolder, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(FmNewFolder).componentInstance;
	popup.start({ parentId: 'fld_b', place: 'My files › Banarasi' });
	return { popup, modal, gateway, toastr, queries };
};

describe('New folder (A23; shared by the Media page and the picker, D10)', () => {
	it('needs a name, then makes the folder in the place it was opened for and closes with it', async () => {
		const { popup, modal, gateway, toastr, queries } = setup();
		await popup.create();
		expect(gateway.createFolder).not.toHaveBeenCalled();
		popup.name.set('  Bridal 2027 ');
		await popup.create();
		expect(gateway.createFolder).toHaveBeenCalledWith({ name: 'Bridal 2027', parentId: 'fld_b' });
		expect(modal.close).toHaveBeenCalledWith({ id: 'fld_new', name: 'Bridal 2027' });
		// The toastr's own toast: a picker underneath must stay open.
		expect(toastr.success).toHaveBeenCalledWith('fm_folder_created');
		expect(queries.invalidateQueries).toHaveBeenCalled();
	});

	it('stays open with the reason when refused, and never sends twice while one is on its way', async () => {
		const { popup, modal } = setup(true);
		popup.name.set('Bridal 2027');
		await popup.create();
		expect(modal.close).not.toHaveBeenCalled();
		expect(popup.error()).toBe('fm_action_failed');

		const busy = setup();
		busy.popup.name.set('Bridal 2027');
		busy.popup.creating.set(true);
		await busy.popup.create();
		expect(busy.gateway.createFolder).not.toHaveBeenCalled();
	});
});
