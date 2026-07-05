import { Routes } from '@angular/router';

import { AboutUs } from './about-us/about-us';
import { ContactUs } from './contact-us/contact-us';
import { Error404 } from './error404/error404';
import { Faq } from './faq/faq';
import { Offer } from './offer/offer';
import { Search } from './search/search';

export default [
  {
    path: 'faq',
    component: Faq,
  },
  {
    path: '404',
    component: Error404,
  },
  {
    path: 'contact-us',
    component: ContactUs,
  },
  {
    path: 'offer',
    component: Offer,
  },
  {
    path: 'about-us',
    component: AboutUs,
  },
  {
    path: 'search',
    component: Search,
  },
] as Routes;
