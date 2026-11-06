import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { LoaderStore } from '@core/state/loader.store';

import { Button } from './button';

describe('Button', () => {
	const render = () => {
		const spinner = signal<unknown>(true);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: LoaderStore, useValue: { button_spinner: spinner } }],
		});
		TestBed.overrideComponent(Button, { set: { imports: [], template: '' } });
		const button = TestBed.createComponent(Button).componentInstance;
		TestBed.tick();
		return { button, spinner };
	};

	it('remembers the pressed button until the spinner stops', () => {
		const { button, spinner } = render();
		button.onClick('save');
		expect(button.buttonId).toBe('save');
		spinner.set('still');
		TestBed.tick();
		expect(button.buttonId).toBe('save');
		spinner.set(false);
		TestBed.tick();
		expect(button.buttonId).toBeNull();
	});
});
