import { describe, expect, it } from 'vitest';

import { hashtags, shareTargets, tagged } from './share-targets';

const subject = {
	name: 'Katan Saree',
	url: 'https://shop.test/en/product/katan?variant=K-1',
	message: '✨ Katan Saree\n₹4,680',
	short: 'Katan Saree · ₹4,680 #Katan',
};

const every = {
	apps: ['whatsapp', 'instagram', 'facebook', 'telegram', 'email', 'x', 'linkedin', 'pinterest'] as const,
	xHandle: '',
};

describe('share targets', () => {
	it('gives phones the lean menu: two direct apps and three share-sheet pictures, no Facebook Story', () => {
		const targets = shareTargets(subject, true, every);
		expect(targets.map((target) => target.id)).toEqual(['wa', 'fb', 'ig-post', 'wa-status', 'ig-story']);
		expect(targets.filter((target) => target.picture).map((target) => [target.id, target.picture])).toEqual([
			['ig-post', 'photo'],
			['wa-status', 'tall'],
			['ig-story', 'tall'],
		]);
		expect(targets.every((target) => (target.picture ? Boolean(target.hint) : Boolean(target.href)))).toBe(true);
	});

	it('gives computers every app’s own share address, each tagged with its destination', () => {
		const targets = shareTargets(subject, false, every);
		expect(targets.map((target) => target.id)).toEqual(['wa', 'tg', 'mail', 'fb', 'x', 'li', 'pin']);
		const link = (id: string) => targets.find((target) => target.id === id)?.href ?? '';
		expect(decodeURIComponent(link('wa'))).toContain(
			'✨ Katan Saree\n₹4,680\nhttps://shop.test/en/product/katan?variant=K-1&ref=wa',
		);
		expect(decodeURIComponent(link('x'))).toContain('text=Katan Saree · ₹4,680 #Katan');
		expect(decodeURIComponent(link('fb'))).toContain('variant=K-1&ref=fb');
		expect(link('mail')).toMatch(/^mailto:\?subject=Katan%20Saree/);
		expect(link('x')).not.toContain('via=');
	});

	it('lists only the apps admin chose, and names the shop on X', () => {
		const phone = shareTargets(subject, true, { apps: ['whatsapp', 'facebook'], xHandle: '' });
		expect(phone.map((target) => target.id)).toEqual(['wa', 'fb', 'wa-status']);
		const computer = shareTargets(subject, false, { apps: ['x', 'instagram'], xHandle: 'SahaTextile' });
		expect(computer.map((target) => target.id)).toEqual(['x']);
		expect(computer[0]?.href).toMatch(/&via=SahaTextile$/);
	});

	it('tags an address with or without a query', () => {
		expect(tagged('https://a.test/p', 'wa')).toBe('https://a.test/p?ref=wa');
		expect(tagged('https://a.test/p?variant=1', 'wa')).toBe('https://a.test/p?variant=1&ref=wa');
	});

	it('makes at most three hashtags from the facts', () => {
		expect(hashtags(['Katan silk', 'Black', 'wedding wear', 'Extra'])).toBe('#KatanSilk #Black #WeddingWear');
		expect(hashtags(['', '—'])).toBe('');
	});
});
