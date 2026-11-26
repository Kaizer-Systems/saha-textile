// AnalogJS file-based route → /shipping-policy. Renders the shared StaticPage,
// which derives its slug from the URL and reads shipping-policy from the API (`GET /catalog/pages/shipping-policy`).

import { StaticPage } from '@features/page/static-page/static-page';

export default StaticPage;
