// AnalogJS file-based route → /terms-conditions. Renders the shared StaticPage,
// which derives its slug from the URL and reads terms-conditions from the API (`GET /catalog/pages/terms-conditions`).

import { StaticPage } from '@features/page/static-page/static-page';

export default StaticPage;
