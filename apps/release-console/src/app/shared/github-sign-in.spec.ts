import { lineClass, oneTimeCode, pendingAsk } from './github-sign-in';

const line = (seq: number, text: string, event: Record<string, unknown> | null = null) => ({
	seq,
	stream: 'out' as const,
	text,
	event,
});

describe('GitHub Connect terminal', () => {
	it('finds the one-time code gh prints, in either wording', () => {
		expect(oneTimeCode([{ text: '! One-time code (AB12-CD34) copied to clipboard' }])).toBe('AB12-CD34');
		expect(oneTimeCode([{ text: '! First copy your one-time code: wxyz-9876' }])).toBe('WXYZ-9876');
		expect(
			oneTimeCode([{ text: 'Open this URL to continue in your web browser: https://github.com/login/device' }]),
		).toBeNull();
	});

	it('knows which update question waits for an answer', () => {
		const ask = { ask: 'update-gh', question: 'gh 2.106.0 is available. Update now? [y/N]' };
		expect(pendingAsk([line(1, '1 · Tools'), line(2, JSON.stringify(ask), ask)])).toEqual({
			id: 'update-gh',
			question: ask.question,
		});
		expect(pendingAsk([line(2, '', ask), line(3, '', { answered: 'update-gh', yes: false })])).toBeNull();
	});

	it('colours step titles, done, failed and skipped lines', () => {
		expect(lineClass('2 · Sign in')).toBe('i');
		expect(lineClass('✓ git 2.56.1')).toBe('p');
		expect(lineClass('✗ Stopped.')).toBe('w');
		expect(lineClass('- Continuing with gh 2.105.0.')).toBe('d');
		expect(lineClass('Checking for gh updates…')).toBe('');
	});
});
