import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from './notification.service';

const render = (platform = 'browser') => {
	const toastr = { success: vi.fn(), error: vi.fn() };
	const modal = { dismissAll: vi.fn() };
	const http = { get: vi.fn(() => of({ data: [] })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ToastrService, useValue: toastr },
			{ provide: NgbModal, useValue: modal },
			{ provide: HttpClient, useValue: http },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	return { service: TestBed.inject(NotificationService), toastr, modal, http };
};

describe('NotificationService', () => {
	it('shows a success toast, closes modals and tells subscribers', () => {
		const { service, toastr, modal } = render();
		const seen: unknown[] = [];
		service.alertSubject.subscribe((value) => seen.push(value));
		service.showSuccess('Saved');
		expect(toastr.success).toHaveBeenCalledWith('Saved');
		expect(modal.dismissAll).toHaveBeenCalledOnce();
		expect(seen).toEqual([{ type: 'success', message: 'Saved' }]);
	});

	it('shows an error toast', () => {
		const { service, toastr } = render();
		service.showError('Failed');
		expect(toastr.error).toHaveBeenCalledWith('Failed');
	});

	it.each(['', '   ', undefined as unknown as string])('stays quiet for %j', (message) => {
		const { service, toastr } = render();
		service.showSuccess(message);
		service.showError(message);
		expect(toastr.success).not.toHaveBeenCalled();
		expect(toastr.error).not.toHaveBeenCalled();
	});

	it('stays quiet when switched off or on the server', () => {
		const off = render();
		off.service.notification = false;
		off.service.showSuccess('x');
		off.service.showError('x');
		expect(off.toastr.success).not.toHaveBeenCalled();
		expect(off.toastr.error).not.toHaveBeenCalled();
		const server = render('server');
		server.service.showSuccess('x');
		server.service.showError('x');
		expect(server.toastr.success).not.toHaveBeenCalled();
		expect(server.toastr.error).not.toHaveBeenCalled();
	});

	it('reads the notifications', () => {
		const { service, http } = render();
		service.getNotifications({ page: 1 });
		expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/notification.json'), { params: { page: 1 } });
	});
});
