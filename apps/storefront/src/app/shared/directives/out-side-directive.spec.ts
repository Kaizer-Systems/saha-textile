import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { ClickOutsideDirective } from './out-side-directive';

@Component({
	imports: [ClickOutsideDirective],
	template: `
		<div
			id="inside"
			(clickOutside)="seen = seen + 1"
		></div>
	`,
})
class Host {
	seen = 0;
	readonly directive = viewChild(ClickOutsideDirective);
}

describe('ClickOutsideDirective', () => {
	const render = () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(Host);
		fixture.detectChanges();
		return fixture;
	};

	it('fires for a click elsewhere', () => {
		const fixture = render();
		document.body.click();
		expect(fixture.componentInstance.seen).toBe(1);
		fixture.destroy();
	});

	it('stays quiet for a click inside', () => {
		const fixture = render();
		(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#inside')?.click();
		expect(fixture.componentInstance.seen).toBe(0);
		fixture.destroy();
	});

	it('ignores a target that is not an element', () => {
		const fixture = render();
		fixture.componentInstance.directive()?.onClick({ target: document } as never);
		expect(fixture.componentInstance.seen).toBe(0);
		fixture.destroy();
	});
});
