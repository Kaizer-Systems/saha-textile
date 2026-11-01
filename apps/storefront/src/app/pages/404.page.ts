// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { notFoundRouteMeta } from '@core/i18n/locale-seo';
import { Error404 } from '@features/page/error404/error404';

// Answers 404 on the server and keeps the page out of search indexes (see LocaleSeo).
export const routeMeta = notFoundRouteMeta;

export default Error404;
