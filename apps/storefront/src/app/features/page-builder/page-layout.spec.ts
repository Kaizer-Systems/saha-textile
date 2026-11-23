import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { sectionClasses } from './page-builder.types';
import { PageLayout } from './page-layout';

describe('PageLayout', () => {
	it('takes the sections, draws them outside the builder by default, and styles them with the shared classes', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(PageLayout, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(PageLayout);
		fixture.componentRef.setInput('sections', []);
		fixture.detectChanges();
		const layout = fixture.componentInstance;
		expect(layout.sections()).toEqual([]);
		expect(layout.preview()).toBe(false);
		expect(layout.classes).toBe(sectionClasses);
	});
});
