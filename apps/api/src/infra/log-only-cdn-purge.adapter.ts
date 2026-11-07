import { Logger } from '@nestjs/common';
import type { CdnPurgePort } from '@saha-textile/core-domain';

/**
 * The dev `CdnPurgePort`. Dev reads the Spaces CDN directly with no Cloudflare in front, and
 * the DigitalOcean layer's 60-second TTL corrects itself, so there is nothing to purge — but
 * the purge still happens as a queued job, and logging it shows the job ran with the right
 * URLs. Staging and prod bind the Cloudflare adapter when its zone and token are set.
 */
export class LogOnlyCdnPurgeAdapter implements CdnPurgePort {
	private readonly logger = new Logger(LogOnlyCdnPurgeAdapter.name);

	async purgeUrls(urls: readonly string[]): Promise<void> {
		this.logger.log(`CDN purge (log only, no Cloudflare configured): ${urls.length} URL(s)`);
	}
}
