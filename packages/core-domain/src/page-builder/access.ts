/**
 * Who may change a page (Page Builder SG-19, Q10 A). Two codes cover every page: `theme_option.edit` builds drafts and
 * `page_builder.go_live` goes live. Each page type adds one code of each kind for that page alone, so the owner can let
 * a role build or go live on Home without the rest. They are ordinary permission codes, granted in Admin › Roles.
 */
export const DRAFT_EVERY_PAGE = 'theme_option.edit';
export const GO_LIVE_EVERY_PAGE = 'page_builder.go_live';

/** The code that lets a role build drafts of this page type only. */
export const pageDraftCode = (pageType: string): string => `page_builder.draft_${pageType}`;
/** The code that lets a role go live, schedule and put back on this page type only. */
export const pageGoLiveCode = (pageType: string): string => `page_builder.go_live_${pageType}`;

export const mayDraftPage = (permissions: readonly string[], pageType: string): boolean =>
	permissions.includes(DRAFT_EVERY_PAGE) || permissions.includes(pageDraftCode(pageType));

export const mayGoLivePage = (permissions: readonly string[], pageType: string): boolean =>
	permissions.includes(GO_LIVE_EVERY_PAGE) || permissions.includes(pageGoLiveCode(pageType));
