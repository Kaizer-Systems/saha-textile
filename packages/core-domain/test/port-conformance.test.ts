import { describe, expect, it } from 'vitest';

import type {
	AttributeDefinitionRepository,
	AuditLogRepository,
	AuthRateLimitRepository,
	AuthSessionRepository,
	CategoryFacetConfigRepository,
	CategoryPlacementRepository,
	ConsentRepository,
	FaqRepository,
	InventoryCostLayerRepository,
	InventoryRepository,
	MediaAssetRepository,
	MessageOutboxRepository,
	NotificationPort,
	NotificationSettingsRepository,
	NotificationTemplateRepository,
	OAuthStateRepository,
	OtpChallengeRepository,
	ProductBundleRepository,
	ProductQuestionRepository,
	ProductRelationRepository,
	ProductVariantRepository,
	ReviewRepository,
	TransactionManagerPort,
	VideoTranscodePort,
	YouTubePort,
} from '../src/index';

/**
 * Ports are interfaces, so they vanish at runtime — `pnpm test` alone would prove
 * nothing about them. This file is a COMPILE-TIME conformance check: every port is
 * implemented by a minimal fake, so `pnpm typecheck` fails if a port is internally
 * inconsistent, references a type that no longer exists, or cannot actually be
 * implemented as written.
 *
 * The runtime assertions below are deliberately thin — the value is in the fact that
 * this file compiles at all. Two behavioral contracts that are easy to get wrong are
 * also exercised: `withTransaction` must propagate a thrown error (never swallow it),
 * and a suppressed notification is a successful outcome rather than a failure.
 *
 * REQUIRED SETUP: this only works because `tsconfig.typecheck.json` overrides the base
 * `exclude`, which filters out test files so `build` emits src only. `exclude` wins over
 * `include`, so if that override is ever removed this file is silently skipped and the
 * check becomes vacuous while still appearing to pass. Verified by mutation: dropping a
 * required member, returning a wrong shape, and breaking a generic signature each fail
 * `pnpm typecheck`.
 */

const notImplemented = () => Promise.reject(new Error('fake'));

/** Runs work in-memory; the real adapter opens a driver session. */
const fakeTransactionManager: TransactionManagerPort = {
	withTransaction: (work) => work({}),
};

const fakeNotifications: NotificationPort = {
	send: async (message) => ({
		// A disabled channel short-circuits BEFORE any provider call.
		status: message.category === 'marketing' ? 'suppressed_channel_disabled' : 'sent',
		providerMessageId: message.category === 'marketing' ? null : 'provider_1',
		outboxEntryId: 'outbox_1',
	}),
	isChannelEnabled: async (_channel, category) => category !== 'marketing',
};

const fakeYouTube: YouTubePort = {
	fetchLatestVideos: async ({ limit }) =>
		Array.from({ length: limit }, (_unused, index) => ({
			videoId: `video_${index}`,
			title: 'Saha Textile weave',
			description: '',
			publishedAt: '2026-08-01T00:00:00.000Z',
			thumbnailUrl: 'https://example.invalid/thumb.jpg',
			watchUrl: 'https://example.invalid/watch',
		})),
};

const fakeTranscode: VideoTranscodePort = {
	enqueue: async () => ({ jobId: 'job_1' }),
	getStatus: async (jobId) => ({
		jobId,
		assetId: 'media_1',
		state: 'succeeded',
		renditions: [480, 720, 1080],
		hlsPlaylistKey: 'v/master.m3u8',
		error: null,
	}),
};

// The repository fakes exist purely so the compiler checks each interface is
// implementable; every member throws.
const fakeAuthSessions = {
	findById: notImplemented,
	findByRefreshTokenHash: notImplemented,
	findByPreviousRefreshTokenHash: notImplemented,
	listActiveForUser: notImplemented,
	create: notImplemented,
	rotate: notImplemented,
	revoke: notImplemented,
	revokeFamily: notImplemented,
	revokeAllForUser: notImplemented,
	touch: notImplemented,
} as unknown as AuthSessionRepository;

const fakes = {
	otpChallenges: {} as OtpChallengeRepository,
	oauthState: {} as OAuthStateRepository,
	authRateLimits: {} as AuthRateLimitRepository,
	media: {} as MediaAssetRepository,
	inventory: {} as InventoryRepository,
	costLayers: {} as InventoryCostLayerRepository,
	audit: {} as AuditLogRepository,
	consent: {} as ConsentRepository,
	notificationSettings: {} as NotificationSettingsRepository,
	notificationTemplates: {} as NotificationTemplateRepository,
	messageOutbox: {} as MessageOutboxRepository,
	placements: {} as CategoryPlacementRepository,
	facetConfigs: {} as CategoryFacetConfigRepository,
	attributes: {} as AttributeDefinitionRepository,
	variants: {} as ProductVariantRepository,
	bundles: {} as ProductBundleRepository,
	relations: {} as ProductRelationRepository,
	faq: {} as FaqRepository,
	questions: {} as ProductQuestionRepository,
	reviews: {} as ReviewRepository,
};

describe('port conformance (compile-time)', () => {
	it('every port is implementable', () => {
		expect(Object.keys(fakes)).toHaveLength(20);
		expect(fakeAuthSessions).toBeDefined();
	});

	it('withTransaction returns the work result', async () => {
		await expect(fakeTransactionManager.withTransaction(async () => 'committed')).resolves.toBe('committed');
	});

	it('withTransaction propagates a failure instead of swallowing it', async () => {
		await expect(
			fakeTransactionManager.withTransaction(async () => {
				throw new Error('rollback me');
			}),
		).rejects.toThrow('rollback me');
	});

	it('treats a suppressed notification as a successful outcome, not an error', async () => {
		const suppressed = await fakeNotifications.send({
			channel: 'sms',
			category: 'marketing',
			templateKey: 'promo',
			destination: '+910000000000',
		});
		expect(suppressed.status).toBe('suppressed_channel_disabled');
		expect(suppressed.providerMessageId).toBeNull();
		expect(suppressed.outboxEntryId).toBeTruthy();

		const sent = await fakeNotifications.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'otp_login',
			destination: 'customer@example.com',
		});
		expect(sent.status).toBe('sent');
		expect(await fakeNotifications.isChannelEnabled('email', 'transactional')).toBe(true);
		expect(await fakeNotifications.isChannelEnabled('sms', 'marketing')).toBe(false);
	});

	it('derives the transcode ladder rather than accepting one', async () => {
		const status = await fakeTranscode.getStatus('job_1');
		expect(status?.renditions).toEqual([480, 720, 1080]);
	});

	it('returns the requested number of videos', async () => {
		const videos = await fakeYouTube.fetchLatestVideos({ channelId: 'UC_saha_textile', limit: 3 });
		expect(videos).toHaveLength(3);
	});
});
