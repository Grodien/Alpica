import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { SEARCH_BACKEND } from './reports.service';
import { HttpSearchBackend } from './reports.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Only the server gets a real search backend. The browser build has none,
    // so the fetch/URL/API-key code stays out of the client bundle.
    { provide: SEARCH_BACKEND, useClass: HttpSearchBackend },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
