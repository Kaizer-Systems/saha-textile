import { describe, expect, it } from 'vitest';

import {
	SEARCH_IN,
	WITHIN_OPTIONS,
	buildQuery,
	emptySearchFields,
	filterFromSearch,
	queryTerms,
	readQuery,
	type SearchFields,
} from './inbox-search';

const fields = (over: Partial<SearchFields>): SearchFields => ({ ...emptySearchFields(), ...over });

describe('Inbox search options: fields to Gmail words (redesign R3)', () => {
	it('writes nothing for empty fields', () => {
		expect(buildQuery(emptySearchFields())).toBe('');
	});

	it('writes each field as Gmail does, keeping several words together in brackets', () => {
		expect(
			buildQuery(
				fields({
					from: 'rahul',
					to: ' wecare@sahatextile.com ',
					subject: 'blouse  (alteration)',
					hasWords: ' parcel   delivered ',
					notWords: 'spam -offer',
					hasAttachment: true,
					unreadOnly: true,
				}),
			),
		).toBe(
			'from:rahul to:wecare@sahatextile.com subject:(blouse alteration) parcel delivered -spam -offer has:attachment is:unread',
		);
	});

	it('writes a size only when it is a positive number, in Gmail’s letters', () => {
		expect(buildQuery(fields({ size: '10', sizeUnit: 'MB' }))).toBe('larger:10M');
		expect(buildQuery(fields({ size: '500', sizeOp: 'smaller', sizeUnit: 'KB' }))).toBe('smaller:500K');
		expect(buildQuery(fields({ size: '0' }))).toBe('');
		expect(buildQuery(fields({ size: 'ten' }))).toBe('');
		expect(buildQuery(fields({ size: '  ' }))).toBe('');
	});

	it('writes "Date within" as after and before around the day, before being the day after the last', () => {
		expect(buildQuery(fields({ date: '2026-11-24', within: '1w' }))).toBe('after:2026/11/17 before:2026/12/02');
		expect(buildQuery(fields({ date: '2026-11-24', within: '1d' }))).toBe('after:2026/11/23 before:2026/11/26');
		expect(buildQuery(fields({ date: '24 Nov 2026' }))).toBe('');
	});

	it('writes where to look: a folder, a label by its full name, or nothing for all mail', () => {
		expect(buildQuery(fields({ searchIn: 'all' }))).toBe('');
		expect(buildQuery(fields({ searchIn: 'trash' }))).toBe('in:trash');
		expect(buildQuery(fields({ searchIn: 'starred' }))).toBe('is:starred');
		expect(buildQuery(fields({ searchIn: 'label:Orders/Returns' }))).toBe('label:Orders/Returns');
		expect(buildQuery(fields({ searchIn: 'label:General Support' }))).toBe('label:(General Support)');
		expect(buildQuery(fields({ searchIn: 'unknown' }))).toBe('');
	});

	it('offers every "Date within" span and place', () => {
		expect(WITHIN_OPTIONS).toEqual(['1d', '3d', '1w', '2w', '1m', '2m', '6m', '1y']);
		expect(Object.keys(SEARCH_IN)).toContain('trash');
	});
});

describe('Inbox search options: Gmail words read back into the fields', () => {
	it('splits a search into terms, keeping bracketed and quoted groups whole', () => {
		expect(queryTerms('from:(Rahul Ghosh) "red saree" -spam subject:"blouse fit" x')).toEqual([
			'from:(Rahul Ghosh)',
			'"red saree"',
			'-spam',
			'subject:"blouse fit"',
			'x',
		]);
		expect(queryTerms('   ')).toEqual([]);
	});

	it('reads every field the options can write, and gives back the same search', () => {
		const q =
			'from:rahul to:wecare@sahatextile.com subject:(blouse alteration) parcel -spam larger:10M after:2026/11/17 before:2026/12/02 in:trash has:attachment is:unread';
		const read = readQuery(q);
		expect(read).toEqual({
			...emptySearchFields(),
			from: 'rahul',
			to: 'wecare@sahatextile.com',
			subject: 'blouse alteration',
			hasWords: 'parcel',
			notWords: 'spam',
			size: '10',
			sizeUnit: 'MB',
			within: '1w',
			date: '2026-11-24',
			searchIn: 'trash',
			hasAttachment: true,
			unreadOnly: true,
		});
		expect(buildQuery(read)).toBe(q);
	});

	it('reads smaller sizes in KB, labels, starred, and quoted values', () => {
		const read = readQuery('smaller:500k label:(General Support) from:"Rahul Ghosh"');
		expect(read.sizeOp).toBe('smaller');
		expect(read.size).toBe('500');
		expect(read.sizeUnit).toBe('KB');
		expect(read.searchIn).toBe('label:General Support');
		expect(read.from).toBe('Rahul Ghosh');
		expect(readQuery('IS:STARRED').searchIn).toBe('starred');
	});

	it('keeps words it has no field for, so nothing typed is lost', () => {
		const read = readQuery('cc:priya larger:huge newer_than:2d - "red saree" -from:x');
		expect(read.hasWords).toBe('cc:priya larger:huge newer_than:2d - "red saree" -from:x');
		expect(read.notWords).toBe('');
	});

	it('keeps a date range the fields cannot draw as words', () => {
		expect(readQuery('after:2026/11/01 before:2026/11/05').hasWords).toBe('after:2026/11/01 before:2026/11/05');
		expect(readQuery('after:2026/11/01').hasWords).toBe('after:2026/11/01');
		expect(readQuery('after:soon before:2026/11/05').hasWords).toBe('after:soon before:2026/11/05');
		expect(readQuery('before:yesterday after:2026/11/01').hasWords).toBe('after:2026/11/01 before:yesterday');
		const twice = readQuery('after:2026/11/23 before:2026/11/26 after:2026/01/01');
		expect(twice.within).toBe('1d');
		expect(twice.date).toBe('2026-11-24');
		expect(twice.hasWords).toBe('after:2026/01/01');
	});
});

describe('Create filter from the search options', () => {
	it('keeps from, to, subject and attachment as the filter’s own fields and the rest as its words', () => {
		expect(
			filterFromSearch(
				fields({
					from: ' rahul ',
					to: 'wecare@sahatextile.com',
					subject: 'invoice',
					hasWords: 'parcel',
					notWords: 'spam',
					hasAttachment: true,
					searchIn: 'inbox',
				}),
			),
		).toEqual({
			from: 'rahul',
			to: 'wecare@sahatextile.com',
			subject: 'invoice',
			query: 'parcel -spam in:inbox',
			hasAttachment: true,
		});
	});
});
