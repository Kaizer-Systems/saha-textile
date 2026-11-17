import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PbSlider } from './pb-slider';

import type { ResolvedPieceView } from '../page-builder.types';

const piece = (after: 'loop' | 'stop', count = 3): ResolvedPieceView =>
	({
		name: 'main',
		slider: { seconds: 3, controls: 'bottom_center', after },
		pictures: Array.from({ length: count }, (_, i) => ({ key: `hero:main:${i}` })),
	}) as unknown as ResolvedPieceView;

const render = (value: ResolvedPieceView, platform = 'server') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(PbSlider, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PbSlider);
	fixture.componentRef.setInput('piece', value);
	fixture.detectChanges();
	return fixture.componentInstance;
};

afterEach(() => vi.useRealTimers());

describe('the builder slider (B3, F1–F4)', () => {
	it('goes round after the last picture when it loops', () => {
		const slider = render(piece('loop'));
		slider.go(3);
		expect(slider.index()).toBe(0);
		slider.go(-1);
		expect(slider.index()).toBe(2);
	});

	it('stays on the last picture when it stops there', () => {
		const slider = render(piece('stop'));
		slider.go(5);
		expect(slider.index()).toBe(2);
		slider.go(-3);
		expect(slider.index()).toBe(0);
	});

	it('pauses and plays from its pause button', () => {
		const slider = render(piece('loop'));
		expect(slider.paused()).toBe(false);
		slider.toggle();
		expect(slider.paused()).toBe(true);
		expect(slider.count()).toBe(3);
	});
});
