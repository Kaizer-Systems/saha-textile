// AnalogJS file-based route → /privacy-policy. Renders the shared StaticPage,
// which derives its slug from the URL and reads privacy-policy from the API (`GET /catalog/pages/privacy-policy`).

import { StaticPage } from '@features/page/static-page/static-page';

export default StaticPage;
