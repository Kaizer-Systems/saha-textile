import { describe, expect, it } from 'vitest';

import { englishNameOrNothing } from '../src/auth/english-name';

describe('englishNameOrNothing', () => {
	it('keeps a name in English letters, cleaned', () => {
		expect(englishNameOrNothing('  Soumitra   Das ')).toBe('Soumitra Das');
		expect(englishNameOrNothing("Ann-Marie D'Souza")).toBe("Ann-Marie D'Souza");
	});

	it('drops a name in another script, or none', () => {
		expect(englishNameOrNothing('সৌমিত্র দাস')).toBeUndefined();
		expect(englishNameOrNothing('Soumitra দাস')).toBeUndefined();
		expect(englishNameOrNothing(null)).toBeUndefined();
		expect(englishNameOrNothing('')).toBeUndefined();
	});
});
