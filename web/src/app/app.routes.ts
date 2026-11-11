import { Routes } from '@angular/router';
import { Home } from './home';
import { Impressum } from './impressum';
import { Legal } from './legal';
import { Privacy } from './privacy';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'impressum', component: Impressum },
  { path: 'legal', component: Legal },
  { path: 'datenschutz', component: Privacy },
  { path: '**', redirectTo: '' },
];
