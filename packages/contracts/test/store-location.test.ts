import { describe, expect, it } from 'vitest';

import {
	StoreHours,
	StoreLocationWrite,
	closedWeek,
	displayPhone,
	isGoogleMapsUrl,
	normalisePhone,
	summariseStoreHours,
	type StoreDayHours,
	type Weekday,
	WEEKDAYS,
} from '../src/store-location';

const week = (pattern: Partial<Record<Weekday, [string, string] | null>>, fallback: [string, string] | null = null) =>
	WEEKDAYS.map((day): StoreDayHours => {
		const value = day in pattern ? pattern[day] : fallback;
		return value
			? { day, open: true, opens: value[0], closes: value[1] }
			: { day, open: false, opens: null, closes: null };
	});

describe('summariseStoreHours', () => {
	it('joins neighbouring days with the same hours and names closed days', () => {
		expect(summariseStoreHours(week({ sun: null }, ['10:00', '20:30']), 'en')).toBe(
			'Mon–Sat 10:00–20:30, Sun closed',
		);
	});

	it('reads one pattern for the whole week as every day', () => {
		expect(summariseStoreHours(week({}, ['10:00', '21:00']), 'en')).toBe('Every day 10:00–21:00');
		expect(summariseStoreHours(closedWeek(), 'en')).toBe('Every day closed');
	});

	it('keeps matching days apart when they are not next to each other', () => {
		const hours = week({ sat: ['10:30', '21:00'], sun: ['11:00', '18:00'] }, ['10:30', '20:00']);
		expect(summariseStoreHours(hours, 'en')).toBe('Mon–Fri 10:30–20:00, Sat 10:30–21:00, Sun 11:00–18:00');
		expect(summariseStoreHours(week({ tue: null, thu: null }, ['10:00', '20:00']), 'en')).toBe(
			'Mon 10:00–20:00, Tue closed, Wed 10:00–20:00, Thu closed, Fri–Sun 10:00–20:00',
		);
	});

	it('writes Bengali weekday names with English digits, and falls back to English', () => {
		expect(summariseStoreHours(week({ sun: null }, ['10:00', '20:30']), 'bn')).toBe(
			'সোম–শনি 10:00–20:30, রবি বন্ধ',
		);
		expect(summariseStoreHours(week({}, ['10:00', '21:00']), 'bn')).toBe('প্রতিদিন 10:00–21:00');
		expect(summariseStoreHours(week({}, ['10:00', '21:00']), 'xx')).toBe('Every day 10:00–21:00');
	});
});

describe('StoreHours', () => {
	it('needs seven days, Monday first, and closing after opening', () => {
		expect(StoreHours.safeParse(week({}, ['10:00', '20:00'])).success).toBe(true);
		expect(StoreHours.safeParse(week({}, ['10:00', '20:00']).slice(1)).success).toBe(false);
		expect(StoreHours.safeParse([...week({}, ['10:00', '20:00'])].reverse()).success).toBe(false);
		expect(StoreHours.safeParse(week({ mon: ['20:00', '10:00'] }, ['10:00', '20:00'])).success).toBe(false);
		expect(StoreHours.safeParse(week({ mon: ['25:00', '26:00'] })).success).toBe(false);
		const missing = week({}, ['10:00', '20:00']).map((day, index) =>
			index === 0 ? { ...day, closes: null } : day,
		);
		expect(StoreHours.safeParse(missing).success).toBe(false);
	});

	it('drops the times of a closed day', () => {
		const parsed = StoreHours.parse(week({}, null).map((day) => ({ ...day, opens: '10:00', closes: '20:00' })));
		expect(parsed.every((day) => day.opens === null && day.closes === null)).toBe(true);
	});
});

describe('Google Maps links', () => {
	it('accepts share, short, listing and google.com/maps links over https', () => {
		for (const url of [
			'https://maps.app.goo.gl/AbC123',
			'https://goo.gl/maps/AbC123',
			'https://maps.google.com/?cid=7310727910860297646',
			'https://www.google.com/maps/place/Barasat+Store/@22.72,88.48,17z',
			'https://google.co.in/maps/place/x',
		]) {
			expect(isGoogleMapsUrl(url)).toBe(true);
		}
	});

	it('refuses other sites, other Google pages, plain http and nonsense', () => {
		for (const url of [
			'https://example.com/maps',
			'https://www.google.com/search?q=sarees',
			'https://goo.gl/abc',
			'http://maps.app.goo.gl/AbC123',
			'not a link',
		]) {
			expect(isGoogleMapsUrl(url)).toBe(false);
		}
	});
});

describe('phone numbers', () => {
	it('turns typed numbers into E.164', () => {
		expect(normalisePhone('098366 63137')).toBe('+919836663137');
		expect(normalisePhone('98366 63137')).toBe('+919836663137');
		expect(normalisePhone('91-98366-63137')).toBe('+919836663137');
		expect(normalisePhone('+91 98366 63137')).toBe('+919836663137');
		expect(normalisePhone('০৩৩ ২৫৫২ ১৫৯৫')).toBe('+913325521595');
		expect(normalisePhone('12345')).toBe('12345');
	});

	it('groups Indian mobiles and metro landlines for reading and leaves others as stored', () => {
		expect(displayPhone('+919836663137')).toBe('+91 98366 63137');
		expect(displayPhone('+913325521595')).toBe('+91 33 2552 1595');
		expect(displayPhone('+913812345678')).toBe('+91 3812345678');
		expect(displayPhone('+441234567890')).toBe('+441234567890');
	});
});

describe('StoreLocationWrite', () => {
	const base = {
		name: { en: 'Saha Textile, Barasat' },
		address: { en: 'No. 29, KB Basu Rd, Barasat' },
		pinCode: '৭০০১২৪',
		mapUrl: 'https://maps.google.com/?cid=7310727910860297646',
		phone: '033 2552 1595',
		hours: week({}, ['10:00', '21:00']),
	};

	it('cleans the PIN code and phone, and fills the defaults', () => {
		const parsed = StoreLocationWrite.parse(base);
		expect(parsed.pinCode).toBe('700124');
		expect(parsed.phone).toBe('+913325521595');
		expect(parsed).toMatchObject({ landmark: {}, geo: null, photoAssetIds: [], active: false });
	});

	it('refuses a bad PIN code, phone or map link', () => {
		expect(StoreLocationWrite.safeParse({ ...base, pinCode: '7001' }).success).toBe(false);
		expect(StoreLocationWrite.safeParse({ ...base, phone: '12' }).success).toBe(false);
		expect(StoreLocationWrite.safeParse({ ...base, mapUrl: 'https://example.com' }).success).toBe(false);
	});
});
