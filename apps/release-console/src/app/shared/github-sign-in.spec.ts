import { oneTimeCode } from './github-sign-in';

describe('GitHub sign-in terminal', () => {
	it('finds the one-time code gh prints, in either wording', () => {
		expect(oneTimeCode([{ text: '! One-time code (AB12-CD34) copied to clipboard' }])).toBe('AB12-CD34');
		expect(oneTimeCode([{ text: '! First copy your one-time code: wxyz-9876' }])).toBe('WXYZ-9876');
		expect(
			oneTimeCode([{ text: 'Open this URL to continue in your web browser: https://github.com/login/device' }]),
		).toBeNull();
	});
});
