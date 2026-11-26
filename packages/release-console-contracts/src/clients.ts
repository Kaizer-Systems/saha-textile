import { z } from 'zod';

/**
 * Client versions (brief 26gq3NbcbBESea6abRtsa3, screen 4): which builds of the shop and the admin
 * people are running, from the `x-client-build` header the edge logs as `client_build`. The build and
 * whether it is the installed app only; nothing about the person.
 */
export const clientBuildsQuerySchema = z.object({
	hours: z.coerce.number().int().min(1).max(168).default(24),
});
export const clientBuildsViewSchema = z.object({
	source: z.enum(['edge', 'none']),
	since: z.string(),
	apps: z.array(
		z.object({
			service: z.string(),
			builds: z.array(
				z.object({
					build: z.string(),
					requests: z.number().int(),
					/** Requests from the installed app, out of `requests`. */
					installed: z.number().int(),
					lastHour: z.number().int(),
					firstAt: z.string(),
					lastAt: z.string(),
				}),
			),
		}),
	),
});
export type ClientBuildsView = z.infer<typeof clientBuildsViewSchema>;
