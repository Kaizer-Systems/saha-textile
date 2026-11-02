import type { ImageDerivative, MediaAsset, MediaWarning } from '@saha-textile/contracts';

import type { ImageCodecPort } from '../ports/image-codec.port';
import { ImageDecodeError } from '../ports/image-codec.port';
import type { MediaJobQueuePort } from '../ports/media-job-queue.port';
import type { MediaAssetRepository } from '../ports/media.repository';
import type { MediaRoleRepository } from '../ports/media-role.repository';
import type { StoragePort } from '../ports/storage.port';
import { planDerivatives } from './derivative-plan';
import { IMMUTABLE_CACHE_CONTROL, checkIngest } from './policy';
import { derivativeStorageKey } from './storage-keys';

export interface ProcessMediaAssetDeps {
	assets: MediaAssetRepository;
	roles: MediaRoleRepository;
	storage: StoragePort;
	codec: ImageCodecPort;
	queue: MediaJobQueuePort;
	now: () => Date;
}

export type ProcessOutcome =
	| { status: 'ready'; rendered: number; skipped: number }
	| { status: 'rejected'; reason: string }
	| { status: 'not_claimed' };

const FORMAT_FOR_TYPE: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/**
 * The worker's job body: turn an uploaded original into every derivative its purpose needs.
 *
 * Steps: claim the asset (a duplicate job finds it held and stops) → download the original →
 * DECODE it, which is the real trust boundary (a renamed MP4 or a PDF fails here and its
 * object is deleted) → re-check the ingest policy against the decoded size → compute the
 * placeholder → render the plan → write each file under its content-hashed key → record
 * the result. Files the new set no longer contains are deleted and purged through a queued
 * job, never inline. Review photos then drop their original (named exception to "retain
 * original").
 *
 * A thrown error leaves the asset `failed` and propagates, so the queue retries it.
 */
export const processMediaAsset = async (
	deps: ProcessMediaAssetDeps,
	input: { assetId: string; reprocess: boolean },
): Promise<ProcessOutcome> => {
	const asset = await deps.assets.claimForProcessing(input.assetId, { allowReady: input.reprocess });
	if (!asset) return { status: 'not_claimed' };

	try {
		if (!asset.originalStorageKey) {
			return await settle(deps, asset, { status: 'ready', rendered: 0, skipped: 0 }, asset.derivatives, []);
		}

		const bytes = await deps.storage.download(asset.originalStorageKey);
		let probe;
		try {
			probe = await deps.codec.probe(bytes);
		} catch (error) {
			if (error instanceof ImageDecodeError) return await reject(deps, asset, 'not_an_image');
			throw error;
		}
		if (probe.format !== FORMAT_FOR_TYPE[asset.originalFormat]) {
			return await reject(deps, asset, 'content_does_not_match_declared_type');
		}

		const ingest = checkIngest({
			purpose: asset.purpose,
			contentType: asset.originalFormat,
			byteSize: bytes.byteLength,
			width: probe.width,
			height: probe.height,
		});
		if (ingest.refusal) return await reject(deps, asset, ingest.refusal.code);

		const placeholder = await deps.codec.placeholder(bytes);
		const plan = planDerivatives({
			asset,
			source: { width: probe.width, height: probe.height },
			roles: await deps.roles.list(),
			servesAsPrimary: asset.servesAsPrimary,
		});

		const derivatives: ImageDerivative[] = [];
		for (const planned of plan.derivatives) {
			const rendered = await deps.codec.render(bytes, planned.spec);
			const storageKey = derivativeStorageKey({
				assetId: asset.id,
				slug: asset.slug,
				role: planned.role,
				width: planned.spec.width,
				sha256: rendered.sha256,
				format: planned.spec.format,
			});
			await deps.storage.upload({
				key: storageKey,
				body: rendered.bytes,
				contentType: planned.spec.format,
				visibility: asset.visibility,
				cacheControl: IMMUTABLE_CACHE_CONTROL,
			});
			derivatives.push({
				role: planned.role,
				storageKey,
				width: rendered.width,
				height: rendered.height,
				byteSize: rendered.bytes.byteLength,
				format: planned.spec.format,
				roleVersion: planned.roleVersion,
			});
		}

		const warnings: MediaWarning[] = [...ingest.warnings];
		if (plan.letterboxed) warnings.push('letterboxed');
		if (plan.skipped.length > 0) warnings.push('role_width_skipped');

		const updated: MediaAsset = {
			...asset,
			width: probe.width,
			height: probe.height,
			dominantColor: placeholder.dominantColor,
			thumbHash: placeholder.thumbHash,
		};
		return await settle(
			deps,
			updated,
			{ status: 'ready', rendered: derivatives.length, skipped: plan.skipped.length },
			derivatives,
			warnings,
		);
	} catch (error) {
		await deps.assets.update({
			...asset,
			processing: {
				...asset.processing,
				state: 'failed',
				error: error instanceof Error ? error.message.slice(0, 500) : 'processing failed',
			},
		});
		throw error;
	}
};

/** Records a successful run and retires every object the new derivative set dropped. */
const settle = async (
	deps: ProcessMediaAssetDeps,
	asset: MediaAsset,
	outcome: ProcessOutcome,
	derivatives: ImageDerivative[],
	warnings: MediaWarning[],
): Promise<ProcessOutcome> => {
	const kept = new Set(derivatives.map((derivative) => derivative.storageKey));
	const dropped = asset.derivatives.filter((derivative) => !kept.has(derivative.storageKey));
	const discardOriginal = asset.purpose === 'review' && asset.originalStorageKey !== null;

	await deps.assets.update({
		...asset,
		derivatives,
		warnings,
		originalStorageKey: discardOriginal ? null : asset.originalStorageKey,
		processing: { ...asset.processing, state: 'ready', error: null, processedAt: deps.now().toISOString() },
	});

	const keys = dropped.map((derivative) => derivative.storageKey);
	if (discardOriginal && asset.originalStorageKey) keys.push(asset.originalStorageKey);
	if (keys.length > 0) {
		await deps.queue.enqueue({
			type: 'delete-objects',
			keys,
			urls:
				asset.visibility === 'public'
					? dropped.map((derivative) => deps.storage.getUrl(derivative.storageKey))
					: [],
		});
	}
	return outcome;
};

/** An upload that is not an acceptable image: its object goes, the asset records why. */
const reject = async (deps: ProcessMediaAssetDeps, asset: MediaAsset, reason: string): Promise<ProcessOutcome> => {
	await deps.assets.update({
		...asset,
		originalStorageKey: null,
		processing: { ...asset.processing, state: 'failed', error: reason },
	});
	if (asset.originalStorageKey) {
		await deps.queue.enqueue({ type: 'delete-objects', keys: [asset.originalStorageKey], urls: [] });
	}
	return { status: 'rejected', reason };
};
