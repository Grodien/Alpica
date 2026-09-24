import { Routes } from '@angular/router';
import { Home } from './home';
import { searchResolver } from './reports.resolver';

export const routes: Routes = [
  {
    path: '',
    component: Home,
    resolve: { search: searchResolver },
    // Re-run the resolver when only the query params change.
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  { path: '**', redirectTo: '' },
];
