// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { BlogDetails } from '@features/blog/blog-details/blog-details';

// Blog now loads by slug via injectBlogBySlugQuery inside BlogDetails (was BlogResolver).
export const routeMeta = {
	canActivate: [ScrollPositionGuard],
};

export default BlogDetails;
