import { describe, expect, it } from 'vitest';

import { rupeesInWords } from '../src/documents';

describe('rupeesInWords', () => {
	it('writes rupees in the Indian system, with paise when there are any', () => {
		expect(rupeesInWords(10_000)).toBe('Rupees Ten Thousand Only');
		expect(rupeesInWords(52_475)).toBe('Rupees Fifty Two Thousand Four Hundred Seventy Five Only');
		expect(rupeesInWords(44_900.5)).toBe('Rupees Forty Four Thousand Nine Hundred and Fifty Paise Only');
		expect(rupeesInWords(1_25_00_000)).toBe('Rupees One Crore Twenty Five Lakh Only');
		expect(rupeesInWords(3_00_07_011)).toBe('Rupees Three Crore Seven Thousand Eleven Only');
		expect(rupeesInWords(0)).toBe('Rupees Zero Only');
		expect(rupeesInWords(-120)).toBe('Rupees One Hundred Twenty Only');
	});
});
