import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import type {
	AuditLog,
	MediaProfile,
	MediaProfileListItem,
	MediaProfileUpdate,
	MediaProfileWrite,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type MediaProfileRepository,
	type ProfileRefusal,
	applyProfileUpdate,
	newProfile,
	profileDeleteRefusal,
	profileKeyFromName,
	reconcileBuiltInProfiles,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import { AUDIT_LOG_REPOSITORY, MEDIA_PROFILE_REPOSITORY } from '../infra/tokens';

/** English fallbacks; Settings › Image profiles names each refusal in its own words. */
const REFUSALS: Readonly<Record<ProfileRefusal, string>> = {
	built_in: 'A built-in profile cannot be deleted; switch it off instead',
	built_in_name: 'A built-in profile keeps its name',
	in_use: 'Photos use this profile; switch it off instead',
	keep_shape_fills: 'A profile that keeps the photo’s own shape has nothing to fill',
	fill_for_icons_only: 'Brand colour is for icon profiles only',
	too_large: 'The upload limit cannot be more than 25 MB',
	unknown_family: 'Sizes are given for a size family the profile does not make',
};

/**
 * Image profiles (media build step 2, Settings › Image profiles F01–F03). The release migration adds the starting
 * profiles once; each start puts back a built-in profile that has gone missing, and never touches an admin's edits
 * or re-adds a profile an admin deleted. Edits apply to versions made afterwards; every change is audited.
 */
@Injectable()
export class MediaProfilesService implements OnApplicationBootstrap {
	private readonly logger = new Logger(MediaProfilesService.name);

	constructor(
		@Inject(MEDIA_PROFILE_REPOSITORY) private readonly profiles: MediaProfileRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

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

	async get(key: string): Promise<MediaProfileListItem> {
		const profile = await this.require(key);
		const photos = (await this.profiles.countPhotosByProfile())[key] ?? 0;
		return { profile, photos };
	}

	async create(actor: string, write: MediaProfileWrite): Promise<MediaProfile> {
		const taken = new Set((await this.profiles.list()).map((row) => row.key));
		const key = profileKeyFromName(write.name, taken);
		const made = newProfile(write, key);
		if ('refusal' in made) throw domainRefusal(made.refusal, REFUSALS[made.refusal]);
		await this.profiles.save(made.profile);
		await this.record(actor, 'media.profile.create', key, { name: made.profile.name });
		return made.profile;
	}

	async update(actor: string, key: string, update: MediaProfileUpdate): Promise<MediaProfile> {
		const current = await this.require(key);
		const result = applyProfileUpdate(current, update);
		if ('refusal' in result) throw domainRefusal(result.refusal, REFUSALS[result.refusal]);
		if (!result.changed) return current;
		await this.profiles.save(result.profile);
		await this.record(actor, 'media.profile.update', key, {
			fields: Object.keys(update),
			version: result.profile.version,
			...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
		});
		return result.profile;
	}

	async remove(actor: string, key: string): Promise<void> {
		const profile = await this.require(key);
		const photos = (await this.profiles.countPhotosByProfile())[key] ?? 0;
		const refusal = profileDeleteRefusal(profile, photos);
		if (refusal) throw domainRefusal(refusal, REFUSALS[refusal]);
		await this.profiles.delete(key);
		await this.record(actor, 'media.profile.delete', key, { name: profile.name });
	}

	private async require(key: string): Promise<MediaProfile> {
		const profile = await this.profiles.findByKey(key);
		if (!profile) throw new NotFoundException('No such image profile');
		return profile;
	}

	private async record(actorId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actorId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'mediaProfile',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
