import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { MediaProfileListItem } from '@saha-textile/contracts';
import { type MediaProfileRepository, reconcileBuiltInProfiles } from '@saha-textile/core-domain';

import { MEDIA_PROFILE_REPOSITORY } from '../infra/tokens';

/**
 * Image profiles (media build step 2, Settings › Image profiles). The release migration adds the starting
 * profiles once; each start puts back a built-in profile that has gone missing, and never touches an admin's
 * edits or re-adds a profile an admin deleted.
 */
@Injectable()
export class MediaProfilesService implements OnApplicationBootstrap {
	private readonly logger = new Logger(MediaProfilesService.name);

	constructor(@Inject(MEDIA_PROFILE_REPOSITORY) private readonly profiles: MediaProfileRepository) {}

	async onApplicationBootstrap(): Promise<void> {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1') return;
		try {
			const added = await reconcileBuiltInProfiles(this.profiles);
			if (added > 0) this.logger.log(`Built-in image profiles put back: ${added}`);
		} catch (error) {
			this.logger.warn(`Image profiles not checked (${(error as Error).message})`);
		}
	}

	async list(): Promise<MediaProfileListItem[]> {
		const [profiles, photos] = await Promise.all([this.profiles.list(), this.profiles.countPhotosByProfile()]);
		return profiles.map((profile) => ({ profile, photos: photos[profile.key] ?? 0 }));
	}
}
