// Render one panel to a standalone canvas (for export and print).

import { buildScene, U } from '../shared/scene.js';
import { drawScene } from './draw.js';
import { measure } from './fonts.js';

export async function renderPanelCanvas(art, panel, size, prefs) {
  await art.ensurePanel(panel);
  const scene = buildScene(panel, {
    characters: art.manifests,
    measure,
    autoExpressions: prefs.autoExpress,
    fontPx: prefs.bigText ? 54 : 46,
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(size / U, 0, 0, size / U, 0, 0);
  drawScene(ctx, scene, { backdrop: art.backdrops.get(panel.backdrop) ?? null, atlases: art.atlases }, {
    names: prefs.showNames, halo: prefs.halo,
  });
  return canvas;
}
