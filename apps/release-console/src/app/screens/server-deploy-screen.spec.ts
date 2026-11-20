import { describe, expect, it } from 'vitest';

import { blankEffects, requiredBlanks, togetherWith } from './server-deploy-screen';

const row = (name: string, state: string, tags: { required?: boolean; mayBlank?: boolean } = {}) => ({
	name,
	state,
	requiredForRelease: tags.required ?? true,
	mayDeployBlank: tags.mayBlank ?? false,
});
const spaces = (bucket: string) => [
	row('SPACES_KEY', 'empty', { mayBlank: true }),
	row('SPACES_SECRET', 'empty', { mayBlank: true }),
	row('SPACES_BUCKET', bucket, { mayBlank: true }),
];

describe('server deploy: deploy with these blank (screen 12)', () => {
	it('offers only blank required names tagged may-deploy-blank; the rest are greyed with a reason', () => {
		const split = requiredBlanks([
			{
				folder: 'api',
				rows: [
					row('MSG91_AUTH_KEY', 'empty', { mayBlank: true }),
					...spaces('missing'),
					row('MONGODB_PASSWORD', 'empty'),
					row('CLIENT_IP_HEADER', 'empty'),
					row('CCAVENUE_WORKING_KEY', 'empty', { required: false }),
					row('PORT', 'set'),
				],
			},
			{ folder: 'infrastructure', rows: [row('mongo-keyfile', 'empty')] },
		]);
		expect(split.offered).toEqual(['MSG91_AUTH_KEY', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET']);
		expect(split.never).toEqual([
			{ name: 'CLIENT_IP_HEADER', reason: 'every release needs it' },
			{ name: 'MONGODB_PASSWORD', reason: 'the database will not start' },
		]);
	});

	it('keeps the Spaces keys together: offered only when all three are blank, picked as one', () => {
		const partial = requiredBlanks([{ folder: 'api', rows: spaces('set') }]);
		expect(partial.offered).toEqual([]);
		expect(partial.never.map((x) => x.reason)).toEqual([
			'goes with SPACES_BUCKET, which is set: fill it too, or empty all 3',
			'goes with SPACES_BUCKET, which is set: fill it too, or empty all 3',
		]);
		const all = ['SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET', 'MSG91_AUTH_KEY'];
		expect(togetherWith('SPACES_KEY', all)).toEqual(['SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET']);
		expect(togetherWith('MSG91_AUTH_KEY', all)).toEqual(['MSG91_AUTH_KEY']);
	});

	it('says what stops working, and whether the shop still works', () => {
		expect(blankEffects(['MSG91_AUTH_KEY', 'SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET'])).toEqual({
			stops: ['sign-in codes and texts are not sent (MSG91)', 'photo uploads are off (Spaces)'],
			restWorks: true,
		});
		expect(blankEffects(['SOMETHING_ELSE'])).toEqual({
			stops: ['whatever reads SOMETHING_ELSE'],
			restWorks: false,
		});
	});
});
