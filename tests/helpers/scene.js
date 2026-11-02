import { readFile } from 'node:fs/promises';
// Load the actual Scene methods; replace only Phaser's browser-only base/import.
const source = (await readFile(new URL('../../src/game/PoolScene.js', import.meta.url), 'utf8'))
  .replace("import Phaser from 'phaser';", 'const Phaser = { Scene: class {} };')
  .replace("'../character.js'", JSON.stringify(new URL('../../src/character.js', import.meta.url).href))
  .replace("'./art.js'", JSON.stringify(new URL('../../src/game/art.js', import.meta.url).href));
export const { PoolScene } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
export function adapter() {
  const textures = new Map();
  const state = { textures, made: 0, destroyed: 0, fail: -1 };
  const graphics = () => {
    let color; const boxes = [];
    return { clear() {}, fillStyle(c) { color = c; }, fillRect(...args) { boxes.push([color, ...args]); },
      generateTexture(key) { textures.set(key, boxes); if (++state.made === state.fail) throw new Error('render failed'); }, destroy() { state.destroyed++; } };
  };
  const sprite = (x, y, key) => ({ x, y, key, angle: 0, setTexture(key) { this.key = key; return this; }, setAngle(a) { this.angle = a; return this; }, setScale() { return this; }, setPosition(x, y) { this.x = x; this.y = y; return this; } });
  return { state, textures: { exists: key => textures.has(key), remove: key => textures.delete(key) }, make: { graphics }, add: { graphics, sprite, text: () => ({ setOrigin() { return this; }, setPosition() {} }) } };
}
