import { Location } from '@angular/common';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

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
