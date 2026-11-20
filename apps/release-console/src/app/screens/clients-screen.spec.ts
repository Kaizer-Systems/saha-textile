import { describe, expect, it } from 'vitest';

import { share } from './clients-screen';

describe('Client versions', () => {
	it('shows the installed app’s share as a whole percent', () => {
		expect(share(31, 100)).toBe('31%');
		expect(share(1, 3)).toBe('33%');
		expect(share(0, 0)).toBe('—');
	});
});
