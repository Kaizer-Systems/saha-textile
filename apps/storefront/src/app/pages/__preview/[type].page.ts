// The Page Builder's preview address, /{locale}/__preview/{pageType} (step 6). The server middleware
// (server/middleware/preview.ts) swaps the builder's one-time code for a session first; without one the address is 404.
import { PagePreview } from '@features/page-builder/page-preview';

export const routeMeta = { data: { preview: true } };

export default PagePreview;
