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
			stripText: '',
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
				stripText: ' Saha Textile, Kolkata ',
				apps: ['x', 'x', 'email'],
			},
			'a1',
		);
		expect(saved).toEqual({
			xHandle: 'SahaTextile',
			hashtags: false,
			stripText: 'Saha Textile, Kolkata',
			apps: ['x', 'email'],
		});
		expect(settings.set).toHaveBeenCalledWith('storefront.share', saved);
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

	it('refuses an X account that X would not accept', async () => {
		await expect(
			new ShareSettingsService(repository() as never).save(
				{ xHandle: 'not a handle!', hashtags: true, stripText: '', apps: [] },
				null,
			),
		).rejects.toThrow();
	});
});
