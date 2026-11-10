import { describe, expect, it, vi } from 'vitest';

import { ShareSettingsService } from '../src/catalog/share-settings.service';

const repository = (stored: unknown = null) => ({
	get: vi.fn(async () => stored),
	set: vi.fn(async () => undefined),
});

describe('ShareSettingsService', () => {
	it('answers every app, hashtags on and no X account before anything is saved', async () => {
		expect(await new ShareSettingsService(repository() as never).get()).toEqual({
			xHandle: '',
			hashtags: true,
			apps: ['whatsapp', 'instagram', 'facebook', 'telegram', 'email', 'x', 'linkedin', 'pinterest'],
		});
	});

	it('saves without the @ or repeated apps, and audits who saved', async () => {
		const settings = repository();
		const audit = { append: vi.fn(async () => undefined) };
		const service = new ShareSettingsService(settings as never, audit as never);
		const saved = await service.save(
			{
				xHandle: '@SahaTextile',
				hashtags: false,
				apps: ['x', 'x', 'email'],
			},
			'a1',
		);
		expect(saved).toEqual({
			xHandle: 'SahaTextile',
			hashtags: false,
			apps: ['x', 'email'],
		});
		expect(settings.set).toHaveBeenCalledWith('storefront.share', { ...saved, xHandle: '' });
		// The X account lives in the Brand Kit, as the profile address.
		expect(settings.set).toHaveBeenCalledWith(
			'brand',
			expect.objectContaining({ socials: expect.objectContaining({ x: 'https://x.com/SahaTextile' }) }),
		);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'storefront.settings.share',
				actorUserId: 'a1',
				entityId: 'storefront.share',
			}),
		);
		await new ShareSettingsService(settings as never).save(saved, null);
		expect(audit.append).toHaveBeenCalledOnce();
	});

	it('reads the X account from the Brand Kit, and an older handle saved here until the Brand Kit has one', async () => {
		const stores = (brand: unknown, share: unknown) => ({
			get: vi.fn(async (key: string) => (key === 'brand' ? brand : share)),
			set: vi.fn(async () => undefined),
		});
		const fromBrand = stores({ socials: { x: 'https://x.com/saha_textile' } }, { xHandle: 'Old' });
		expect((await new ShareSettingsService(fromBrand as never).get()).xHandle).toBe('saha_textile');
		const older = stores(null, { xHandle: 'Old' });
		expect((await new ShareSettingsService(older as never).get()).xHandle).toBe('Old');
	});

	it('leaves the Brand Kit alone when the X account did not change, and clears it when emptied', async () => {
		const brand = { socials: { x: 'https://x.com/saha_textile' } };
		const settings = {
			get: vi.fn(async (key: string) => (key === 'brand' ? brand : null)),
			set: vi.fn(async () => undefined),
		};
		const service = new ShareSettingsService(settings as never);
		await service.save({ xHandle: 'saha_textile', hashtags: true, apps: [] }, null);
		expect(settings.set).not.toHaveBeenCalledWith('brand', expect.anything());
		await service.save({ xHandle: '', hashtags: true, apps: [] }, null);
		expect(settings.set).toHaveBeenCalledWith(
			'brand',
			expect.objectContaining({ socials: expect.objectContaining({ x: '' }) }),
		);
	});

	it('refuses an X account that X would not accept', async () => {
		await expect(
			new ShareSettingsService(repository() as never).save(
				{ xHandle: 'not a handle!', hashtags: true, apps: [] },
				null,
			),
		).rejects.toThrow();
	});
});
