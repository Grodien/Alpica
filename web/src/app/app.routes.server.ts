import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // Render on the server for every request so the `q` search param is always
    // resolved server-side (no prerendered static shell).
    path: '**',
    renderMode: RenderMode.Server,
  },
];
