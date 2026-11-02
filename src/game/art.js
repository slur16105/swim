import { CHARACTER_CATALOG, normalizeAppearance } from '../character.js';
export const CAPS = Object.freeze(Object.fromEntries(Object.entries(CHARACTER_CATALOG.cap).map(([id, option]) => [id, option.color])));
export function textureKey(value, frame) {
  const a = normalizeAppearance(value);
  if (!Number.isInteger(frame) || frame < 0 || frame > 3) throw new TypeError('Invalid swimmer frame');
  return `swimmer-${a.cap}-${a.goggles}-${a.suit}-${frame}`;
}
const color = (a, part) => CHARACTER_CATALOG[part][a[part]].color;
// Original procedural pixel sprites. Same palette serves the portrait and pool.
// Renderers return true on success and throw on invalid input/render failure.
// The destination is touched only after the offscreen portrait is complete.
export function drawAvatar(canvas, value = 'orange') {
  const a = normalizeAppearance(value);
  const buffer = canvas.ownerDocument.createElement('canvas');
  buffer.width = 64; buffer.height = 64;
  const c = buffer.getContext('2d');
  if (!c) throw new Error('Portrait canvas unavailable');
  const box = (color, x, y, w, h) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  box('#b3cbb7', 15, 55, 34, 3);
  box(color(a, 'suit'), 23, 27, 20, 24);
  box('#edb78f', 22, 15, 22, 19);
  box('#f8cfa5', 24, 17, 18, 15);
  box(color(a, 'cap'), 20, 10, 24, 12); box(color(a, 'cap'), 24, 7, 16, 4);
  box('#fff3c8', 24, 11, 4, 7);
  box(color(a, 'goggles'), 20, 22, 26, 6);
  box('#b9e8db', 23, 23, 7, 3); box('#b9e8db', 35, 23, 7, 3);
  box('#edb78f', 17, 33, 6, 13); box('#edb78f', 43, 33, 6, 13);
  box('#f7c79f', 18, 33, 3, 10); box('#f7c79f', 44, 33, 3, 10);
  box('#edb78f', 24, 49, 7, 7); box('#edb78f', 35, 49, 7, 7);
  box('#5c9476', 25, 34, 14, 3);
  const target = canvas.getContext('2d');
  if (!target) throw new Error('Portrait destination unavailable');
  target.save();
  try {
    target.globalCompositeOperation = 'copy';
    target.drawImage(buffer, 0, 0);
  } finally { target.restore(); }
  return true;
}
// A failed batch removes only textures created by this invocation, permitting retry.
export function makeSwimmer(scene, value = 'orange') {
  const a = normalizeAppearance(value);
  const created = [];
  try {
    for (let frame = 0; frame < 4; frame++) {
      const key = textureKey(a, frame);
      if (scene.textures.exists(key)) continue;
      created.push(key);
      const g = scene.make.graphics({ x: 0, y: 0 });
      try {
        const rect = (color, x, y, w, h) => { g.fillStyle(color); g.fillRect(x, y, w, h); };
        rect(a.suit === 'dark' ? 0x194f51 : parseInt(color(a, 'suit').slice(1), 16), 9, 13, 9, 12);
        rect(0xe6ad85, 9, 8, 10, 8);
        rect(parseInt(color(a, 'cap').slice(1), 16), 8, 4, 12, 9);
        rect(0xffe4ac, 11, 5, 3, 3);
        rect(a.goggles === 'dark' ? 0x234e50 : parseInt(color(a, 'goggles').slice(1), 16), 8, 11, 12, 3);
        rect(0xa2e9ef, 10, 11, 3, 2); rect(0xa2e9ef, 16, 11, 3, 2);
        const arms = [[5, 2, 19, 16], [4, 8, 21, 11], [5, 16, 19, 2], [3, 11, 20, 8]][frame];
        rect(0xf6c79f, arms[0], arms[1], 4, 11); rect(0xf6c79f, arms[2], arms[3], 4, 11);
        rect(0xe6ad85, 9, 25, 4, frame % 2 ? 6 : 8); rect(0xf6c79f, 15, 25, 4, frame % 2 ? 8 : 6);
        g.generateTexture(key, 28, 36);
        if (!scene.textures.exists(key)) throw new Error(`Texture generation failed: ${key}`);
      } finally { g.destroy(); }
    }
    return true;
  } catch (error) {
    for (const key of created) if (scene.textures.exists(key)) scene.textures.remove(key);
    throw error;
  }
}
