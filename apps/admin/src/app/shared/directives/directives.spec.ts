import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { HasPermissionDirective } from './has-permission.directive';
import { NumberDirective } from './numbers-only.directive';
import { ClickOutsideDirective } from './out-side-directive';

describe('HasPermissionDirective', () => {
	@Component({
		imports: [HasPermissionDirective],
		template: `
			<p *hasPermission="need()">shown</p>
		`,
	})
	class Host {
		readonly need = signal<string | string[] | undefined>('a');
	}

	const render = (held: string[]) => {
		const permissions = signal(held);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: AuthStore, useValue: { permissions } }] });
		const fixture = TestBed.createComponent(Host);
		fixture.detectChanges();
		const shown = () => {
			fixture.detectChanges();
			return (fixture.nativeElement as HTMLElement).querySelector('p') !== null;
		};
		return { fixture, permissions, shown };
	};

	it('shows content for a held permission, and removes it when lost', () => {
		const { permissions, shown } = render(['a']);
		expect(shown()).toBe(true);
		permissions.set([]);
		expect(shown()).toBe(false);
		permissions.set(['a']);
		expect(shown()).toBe(true);
	});

	it('needs every permission in a list, and refuses an empty list', () => {
		const { fixture, shown, permissions } = render(['a', 'b']);
		fixture.componentInstance.need.set(['a', 'b']);
		expect(shown()).toBe(true);
		permissions.set(['a']);
		expect(shown()).toBe(false);
		fixture.componentInstance.need.set([]);
		expect(shown()).toBe(false);
	});

	it('shows content that needs nothing, and stays hidden without the permission', () => {
		const { fixture, shown } = render([]);
		expect(shown()).toBe(false);
		fixture.componentInstance.need.set(undefined);
		expect(shown()).toBe(true);
		fixture.componentInstance.need.set(undefined);
		expect(shown()).toBe(true);
	});
});

describe('NumberDirective', () => {
	@Component({
		imports: [NumberDirective],
		template: `
			<input numbersOnly />
		`,
	})
	class Host {}

	const type = (value: string) => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(Host);
		fixture.detectChanges();
		const input = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
		input.value = value;
		const event = new Event('input', { cancelable: true });
		let stopped = false;
		event.stopPropagation = () => {
			stopped = true;
		};
		input.dispatchEvent(event);
		return { value: input.value, stopped };
	};

	it('strips anything that is not a digit', () => {
		expect(type('a1b2')).toEqual({ value: '12', stopped: true });
	});

	it('leaves digits alone', () => {
		expect(type('12')).toEqual({ value: '12', stopped: false });
	});
});

describe('ClickOutsideDirective', () => {
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

	it('fires for a click elsewhere only, and ignores a non-element target', () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(Host);
		fixture.detectChanges();
		(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#inside')?.click();
		expect(fixture.componentInstance.seen).toBe(0);
		document.body.click();
		expect(fixture.componentInstance.seen).toBe(1);
		fixture.componentInstance.directive()?.onClick({ target: document } as never);
		expect(fixture.componentInstance.seen).toBe(1);
		fixture.destroy();
	});
});
