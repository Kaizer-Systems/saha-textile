import {
	MongoAdminUserRoleAssignmentRepository,
	MongoMediaAssetRepository,
	MongoMediaFolderRepository,
	MongoMediaRoleRepository,
	MongoRoleRepository,
	MongoSiteSettingsRepository,
	MongoStorageLedgerRepository,
} from '@saha-textile/adapters-db-mongo';
import type { AuditLogRepository, MediaJobQueuePort, StoragePort } from '@saha-textile/core-domain';

import type { LanguageStore } from '../languages/language-store';
import { MediaStorageService } from './media-storage.service';
import { MediaService } from './media.service';

/**
 * The media service outside Nest, for local scripts that upload demo pictures: the same uploads
 * the admin makes, with the same storage check, on the Mongo repositories.
 */
export function composeMongoMediaService(input: {
	storage: StoragePort;
	queue: MediaJobQueuePort;
	audit: AuditLogRepository;
	languages: LanguageStore;
}): MediaService {
	const assets = new MongoMediaAssetRepository();
	const storageCheck = new MediaStorageService(
		assets,
		new MongoStorageLedgerRepository(),
		new MongoSiteSettingsRepository(),
		new MongoRoleRepository(),
		new MongoAdminUserRoleAssignmentRepository(),
		input.audit,
	);
	return new MediaService(
		assets,
		new MongoMediaRoleRepository(),
		input.storage,
		input.queue,
		input.audit,
		input.languages,
		assets,
		new MongoMediaFolderRepository(),
		storageCheck,
	);
}
