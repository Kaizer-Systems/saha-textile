import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallHelpModal, installGuide } from './install-help-modal';

const SAFARI = 'Version/18.0 Safari/605.1.15';
const device = (userAgent: string, maxTouchPoints = 0) => ({ maxTouchPoints, userAgent });

describe('installGuide', () => {
	it.each([
		['iPhone', device(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${SAFARI}`, 5), 'ios'],
		['older iPad', device(`Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) ${SAFARI}`, 5), 'ios'],
		['iPad reporting as a Mac', device(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI}`, 5), 'ios'],
		['Safari on a Mac', device(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI}`), 'mac'],
		['Chrome on a Mac', device('Mozilla/5.0 (Macintosh) Chrome/130.0.0.0 Safari/537.36'), 'other'],
		['Edge on a Mac', device('Mozilla/5.0 (Macintosh) Safari/537.36 Edg/130.0.0.0'), 'other'],
		['Firefox on a Mac', device('Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0'), 'other'],
		['Firefox on Windows', device('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130.0'), 'other'],
	])('%s', (_name, browser, guide) => {
		expect(installGuide(browser)).toBe(guide);
	});
});

describe('InstallHelpModal', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		TestBed.resetTestingModule();
	});

	const render = () => {
		const modal = { dismiss: vi.fn() };
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: modal }] });
		TestBed.overrideComponent(InstallHelpModal, { set: { imports: [], template: '' } });
		return { component: TestBed.createComponent(InstallHelpModal).componentInstance, modal };
	};

	it('lists the three steps for this browser', () => {
		vi.stubGlobal('navigator', device('iPhone', 5));
		expect(render().component.steps).toEqual(['install_ios_step_1', 'install_ios_step_2', 'install_ios_step_3']);
	});

	it('closes through the active modal', () => {
		vi.stubGlobal('navigator', device('Firefox'));
		const { component, modal } = render();
		component.modal.dismiss('Cross click');
		expect(modal.dismiss).toHaveBeenCalledWith('Cross click');
	});
});
