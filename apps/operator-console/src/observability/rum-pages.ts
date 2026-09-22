import { configResourceKeys } from '@/lib/configuration/schemas';

export const RUM_PAGES = [
  '/',
  '/backtesting',
  '/configuration',
  ...configResourceKeys.map((resource) => `/configuration/${resource}`),
  '/execution',
  '/execution/live',
  '/execution/paper',
  '/execution/promotions',
];
