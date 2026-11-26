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
	/** The demo blouse template: every field kept in inches on a half-inch step. */
	const blouse = [
		{ code: 'shoulder', label: 'Shoulder', unit: 'in', min: 10, max: 24, step: 0.5 },
		{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50, step: 0.5 },
		{ code: 'waist', label: 'Waist', unit: 'in', min: 22, max: 48, step: 0.5 },
		{ code: 'sleeve', label: 'Sleeve', unit: 'in', min: 4, max: 26, step: 0.5 },
	] as never as { code: string; label: string; unit: string; min?: number; max?: number; step?: number }[];
	const mixed = [
		{ code: 'chest', label: 'Chest', unit: 'in', min: 10, max: 50, step: 0.5 },
		{ code: 'waist', label: 'Waist', unit: 'cm' },
	] as never as typeof blouse;

	const render = (fields: typeof blouse, values?: Record<string, number>) => {
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
		const form = fixture.componentInstance;
		const field = (code: string) => fields.find((f) => f.code === code) as never;
		const type = (code: string, text: string) => {
			form.onInput(field(code), text);
			form.onLeave(code);
		};
		const boxes = () => fields.map((f) => form.boxText(f as never));
		return { fixture, form, valid, seen, field, type, boxes };
	};

	it('builds a control per field, invalid until filled', () => {
		const { form, valid, seen } = render(mixed);
		expect(Object.keys(form.form.controls)).toEqual(['chest', 'waist']);
		expect(valid.at(-1)).toBe(false);
		expect(seen).toEqual([]);
	});

	it('is valid at once when prefilled, and reports later changes', () => {
		const { form, valid, seen } = render(mixed, { chest: 30, waist: 70 });
		expect(valid.at(-1)).toBe(true);
		expect(seen.at(-1)).toEqual({ chest: 30, waist: 70 });
		form.form.get('chest')?.setValue(5);
		expect(valid.at(-1)).toBe(false);
	});

	it('keeps inches as typed, shows centimetres to one decimal, and gives the typed number back', () => {
		const { form, type, boxes, valid } = render(blouse);
		type('shoulder', '14');
		type('chest', '36');
		type('waist', '30');
		type('sleeve', '18');
		expect(form.form.value).toEqual({ shoulder: 14, chest: 36, waist: 30, sleeve: 18 });
		expect(valid.at(-1)).toBe(true);
		form.showUnit('cm');
		expect(boxes()).toEqual(['35.6', '91.4', '76.2', '45.7']);
		form.showUnit('in');
		expect(boxes()).toEqual(['14', '36', '30', '18']);
		expect(form.form.value).toEqual({ shoulder: 14, chest: 36, waist: 30, sleeve: 18 });
	});

	it('keeps centimetres as typed; the kept half-inch figure shows under the box and in inches', () => {
		const { form, type, boxes, field } = render(blouse);
		form.showUnit('cm');
		type('shoulder', '38');
		type('chest', '90');
		type('waist', '75');
		type('sleeve', '45');
		expect(boxes()).toEqual(['38', '90', '75', '45']);
		expect(form.form.value).toEqual({ shoulder: 15, chest: 35.5, waist: 29.5, sleeve: 17.5 });
		expect(form.keptNote(field('chest'))).toBe('35.5 in');
		form.showUnit('in');
		expect(boxes()).toEqual(['15', '35.5', '29.5', '17.5']);
		expect(form.keptNote(field('chest'))).toBe('');
		form.showUnit('cm');
		expect(boxes()).toEqual(['38', '90', '75', '45']);
	});

	it('never wipes a number outside the range: it stays, the field is invalid, and the note names the range', () => {
		const { form, type, boxes, field, valid } = render(blouse);
		// The reported case: the middle two fall below their minimums, the outer two are fine.
		type('shoulder', '12');
		type('chest', '14');
		type('waist', '16');
		type('sleeve', '18');
		expect(boxes()).toEqual(['12', '14', '16', '18']);
		expect(form.form.value).toEqual({ shoulder: 12, chest: null, waist: null, sleeve: 18 });
		expect(form.form.get('chest')?.errors).toEqual({ range: true });
		expect(valid.at(-1)).toBe(false);
		expect(form.outOfRange(field('shoulder'))).toBeNull();
		expect(form.outOfRange(field('chest'))).toEqual({ min: '24', max: '50', unit: 'in' });
		form.showUnit('cm');
		expect(boxes()).toEqual(['30.5', '35.6', '40.6', '45.7']);
		expect(form.outOfRange(field('chest'))).toEqual({ min: '61', max: '127', unit: 'cm' });
		expect(form.outOfRange(field('waist'))).toEqual({ min: '55.9', max: '121.9', unit: 'cm' });
	});

	it('waits for the shopper to leave a box before naming the range', () => {
		const { form, field } = render(blouse);
		form.onInput(field('chest'), '3');
		expect(form.form.get('chest')?.hasError('range')).toBe(true);
		expect(form.outOfRange(field('chest'))).toBeNull();
		form.onLeave('chest');
		expect(form.outOfRange(field('chest'))).not.toBeNull();
		form.onInput(field('chest'), '36');
		expect(form.outOfRange(field('chest'))).toBeNull();
		expect(form.form.get('chest')?.value).toBe(36);
	});

	it('treats an emptied box as missing, not out of range', () => {
		const { form, type, field, boxes } = render(blouse);
		type('chest', '36');
		type('chest', '');
		expect(form.form.get('chest')?.value).toBeNull();
		expect(form.form.get('chest')?.hasError('required')).toBe(true);
		expect(form.outOfRange(field('chest'))).toBeNull();
		expect(boxes()[1]).toBe('');
		form.showUnit('cm');
		expect(boxes()[1]).toBe('');
	});

	it('keeps what was typed when the page hands over the same fields again', () => {
		const { fixture, form, type, boxes } = render(blouse);
		type('chest', '36');
		fixture.componentRef.setInput(
			'fields',
			blouse.map((f) => ({ ...f })),
		);
		fixture.detectChanges();
		expect(boxes()[1]).toBe('36');
		expect(form.form.get('chest')?.value).toBe(36);
	});

	it('starts afresh when the fields really change', () => {
		const { fixture, form, type } = render(blouse);
		type('chest', '36');
		fixture.componentRef.setInput('fields', mixed);
		fixture.detectChanges();
		expect(Object.keys(form.form.controls)).toEqual(['chest', 'waist']);
		expect(form.form.get('chest')?.value).toBeNull();
		expect(form.entries()).toEqual({});
	});

	it('shows a prefilled value in either unit, and a centimetre field in inches', () => {
		const { form, field } = render(mixed, { chest: 10, waist: 25.4 });
		expect(form.boxText(field('chest'))).toBe('10');
		form.showUnit('cm');
		expect(form.boxText(field('chest'))).toBe('25.4');
		expect(form.boxText(field('waist'))).toBe('25.4');
		form.showUnit('in');
		expect(form.boxText(field('waist'))).toBe('10');
	});

	it('uses default limits and step for a field that names none, and ignores a code it does not hold', () => {
		const { form, type, field } = render(mixed);
		type('waist', '70');
		expect(form.form.get('waist')?.value).toBe(178);
		form.showUnit('cm');
		type('waist', '70');
		expect(form.form.get('waist')?.value).toBe(70);
		type('waist', '999');
		expect(form.outOfRange(field('waist'))).toEqual({ min: '1', max: '200', unit: 'cm' });
		form.showUnit('in');
		expect(form.outOfRange(field('waist'))).toEqual({ min: '0.4', max: '78.7', unit: 'in' });
		const stray = { code: 'other', label: 'Other', unit: 'in' } as never;
		expect(form.boxText(stray)).toBe('');
		expect(() => form.onInput(stray, '10')).not.toThrow();
		expect(form.boxText(stray)).toBe('10');
		expect(form.keptNote(stray)).toBe('');
	});

	it('shows no kept note for text typed in the field unit, or while the other unit shows', () => {
		const { form, type, field } = render(blouse);
		type('chest', '36');
		expect(form.keptNote(field('chest'))).toBe('');
		form.showUnit('cm');
		type('chest', '200');
		expect(form.keptNote(field('chest'))).toBe('');
		form.showUnit('in');
		expect(form.keptNote(field('chest'))).toBe('');
	});
});
