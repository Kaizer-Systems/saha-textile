import { Location } from '@angular/common';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';
import { Maintenance } from '@features/maintenance/maintenance';

import { Error404 } from './error404/error404';
import { Error500 } from './error500/error500';

describe.each([
	{ name: 'Error404', type: Error404 },
	{ name: 'Error500', type: Error500 },
])('$name', ({ type }) => {
	it('goes back', () => {
		const location = { back: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: Location, useValue: location }] });
		TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
		TestBed.createComponent(type as Type<Error404>).componentInstance.back();
		expect(location.back).toHaveBeenCalledOnce();
	});
});

describe('Maintenance', () => {
	it('loads the settings', () => {
		const store = { setting: signal(null), loadSettings: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: SettingStore, useValue: store }] });
		TestBed.overrideComponent(Maintenance, { set: { imports: [], template: '' } });
		TestBed.createComponent(Maintenance);
		expect(store.loadSettings).toHaveBeenCalledOnce();
	});
});
