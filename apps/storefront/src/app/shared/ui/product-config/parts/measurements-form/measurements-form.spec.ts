import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { MeasurementsForm, snapMeasurement } from './measurements-form';

describe('snapMeasurement', () => {
	it('snaps a centimetre entry onto the half-inch step', () => {
		expect(snapMeasurement('87.9', 'cm', 'in', 0.5, 24, 50)).toBe(34.5);
	});

	it('refuses a snapped value one step past the field maximum', () => {
		expect(snapMeasurement('87.9', 'cm', 'in', 0.5, 10, 24)).toBeNull();
	});
});

describe('snapMeasurement edges', () => {
	it('refuses a step of zero and text that is not a number', () => {
		expect(snapMeasurement('10', 'in', 'in', 0, 1, 100)).toBeNull();
		expect(snapMeasurement('abc', 'in', 'in', 0.5, 1, 100)).toBeNull();
	});

	it('converts inches to a centimetre field, and whole steps', () => {
		expect(snapMeasurement('10', 'in', 'cm', 1, 1, 100)).toBe(25);
		expect(snapMeasurement('10', 'cm', 'cm', 0.5, 1, 100)).toBe(10);
		expect(snapMeasurement('10.2', 'in', 'in', 1e-7, 1, 100)).toBe(10);
		expect(snapMeasurement('0', 'in', 'in', 1, 1, 100)).toBeNull();
	});
});

describe('MeasurementsForm', () => {
	const fields = [
		{ code: 'chest', label: 'Chest', unit: 'in', min: 10, max: 50, step: 0.5 },
		{ code: 'waist', label: 'Waist', unit: 'cm' },
	] as never;

	const render = (values?: Record<string, number>) => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(MeasurementsForm, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(MeasurementsForm);
		const valid: boolean[] = [];
		const seen: unknown[] = [];
		fixture.componentInstance.validChange.subscribe((value) => valid.push(value));
		fixture.componentInstance.valueChange.subscribe((value) => seen.push(value));
		fixture.componentRef.setInput('fields', fields);
		if (values) fixture.componentRef.setInput('initialValues', values);
		fixture.detectChanges();
		return { form: fixture.componentInstance, valid, seen };
	};
	const typed = (value: string) => ({ target: { value } }) as never;

	it('builds a control per field, invalid until filled', () => {
		const { form, valid, seen } = render();
		expect(Object.keys(form.form.controls)).toEqual(['chest', 'waist']);
		expect(valid.at(-1)).toBe(false);
		expect(seen).toEqual([]);
	});

	it('is valid at once when prefilled, and reports later changes', () => {
		const { form, valid, seen } = render({ chest: 30, waist: 70 });
		expect(valid.at(-1)).toBe(true);
		expect(seen.at(-1)).toEqual({ chest: 30, waist: 70 });
		form.form.get('chest')?.setValue(5);
		expect(valid.at(-1)).toBe(false);
	});

	it('keeps a snapped value and clears the draft', () => {
		const { form } = render();
		form.onDraft('chest', '30.2');
		const event = typed('30.2') as unknown as { target: { value: string } };
		form.keep('chest', 'in', 0.5, 10, 50, event as never);
		expect(form.form.get('chest')?.value).toBe(30);
		expect(form.draft()).toEqual({});
		expect(event.target.value).toBe('30');
	});

	it('flags a value outside the range', () => {
		const { form } = render();
		form.keep('chest', 'in', 0.5, 10, 50, typed('99'));
		expect(form.form.get('chest')?.errors).toEqual({ range: true });
		expect(form.form.get('chest')?.touched).toBe(true);
	});

	it('copes with a field it does not hold, and uses default limits', () => {
		const { form } = render();
		expect(() => form.keep('other', 'in', undefined, undefined, undefined, typed('999'))).not.toThrow();
		expect(() => form.keep('other', 'in', undefined, undefined, undefined, typed('10'))).not.toThrow();
	});

	it('shows a stored value in the chosen unit', () => {
		const { form } = render({ chest: 10, waist: 25.4 });
		expect(form.displayText('chest', 'in')).toBe('10');
		form.showUnit('cm');
		expect(form.displayText('chest', 'in')).toBe('25.4');
		expect(form.displayText('waist', 'cm')).toBe('25.4');
		form.showUnit('in');
		expect(form.displayText('waist', 'cm')).toBe('10');
		form.form.get('chest')?.setValue('');
		expect(form.displayText('chest', 'in')).toBe('');
		form.form.get('chest')?.setValue(null);
		expect(form.displayText('chest', 'in')).toBe('');
		expect(form.displayText('gone', 'in')).toBe('');
	});

	it('previews the snapped figure in the field unit', () => {
		const { form } = render();
		expect(form.preview('chest', 'in')).toBe('');
		form.onDraft('chest', '');
		expect(form.preview('chest', 'in')).toBe('');
		form.onDraft('chest', '30.2');
		expect(form.preview('chest', 'in', 0.5, 10, 50)).toBe('30 in');
		form.onDraft('waist', '70');
		expect(form.preview('waist', 'cm')).toBe('178 cm');
		form.onDraft('chest', '999');
		expect(form.preview('chest', 'in')).toBe('');
	});
});
