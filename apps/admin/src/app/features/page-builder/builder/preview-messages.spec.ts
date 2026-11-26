import {
	PREVIEW_MESSAGE_SOURCE as CONTRACT_SOURCE,
	PreviewAdminMessage,
	PreviewShopMessage,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { PREVIEW_MESSAGE_SOURCE, outlineMessage, shopMessage } from './preview-messages';

describe('preview messages (Page Builder step 6, C41)', () => {
	it('uses the contract’s senders', () => {
		expect(PREVIEW_MESSAGE_SOURCE).toEqual(CONTRACT_SOURCE);
	});

	it('accepts exactly the frame messages the contract accepts', () => {
		const cases: unknown[] = [
			{ source: 'st-preview', type: 'ready' },
			{ source: 'st-preview', type: 'select', sectionId: 'product_row_2' },
			{ source: 'st-preview', type: 'select', sectionId: '"]<img onerror>' },
			{ source: 'st-preview', type: 'select', sectionId: 'x'.repeat(41) },
			{ source: 'st-preview', type: 'select' },
			{ source: 'st-preview', type: 'ready', extra: 1 },
			{ source: 'pb-admin', type: 'ready' },
			{ source: 'st-preview', type: 'outline', sectionId: 'a' },
			null,
			'ready',
			[],
		];
		for (const data of cases) {
			const contract = PreviewShopMessage.safeParse(data);
			expect(shopMessage(data), JSON.stringify(data)).toEqual(contract.success ? contract.data : undefined);
		}
	});

	it('sends outline requests the contract accepts, and never an id it would refuse', () => {
		expect(PreviewAdminMessage.parse(outlineMessage('banner_arrangement'))).toEqual({
			source: 'pb-admin',
			type: 'outline',
			sectionId: 'banner_arrangement',
		});
		expect(outlineMessage(null).sectionId).toBeNull();
		expect(outlineMessage('a b').sectionId).toBeNull();
	});
});
