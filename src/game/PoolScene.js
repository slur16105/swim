import Phaser from 'phaser';
import { normalizeAppearance } from '../character.js';
import { makeSwimmer, textureKey } from './art.js';
export class PoolScene extends Phaser.Scene {
  constructor({ appearance, cap = 'orange', onReady = () => {}, onProgress = () => {}, onComplete = () => {} } = {}) {
    super('pool'); Object.assign(this, { cap, onReady, onProgress, onComplete });
    this.appearance = normalizeAppearance(appearance ?? cap); this.cap = this.appearance.cap; this.currentFrame = 0;
    this.motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.session = null; this.speed = 1; this.paused = false; this.elapsed = 0;
  }
  create() {
    const g = this.add.graphics();
    const rect = (color, x, y, w, h) => { g.fillStyle(color); g.fillRect(x, y, w, h); };
    rect(0xe4e7d7, 0, 0, 800, 460);
    for (let x = 0; x < 800; x += 24) for (let y = 0; y < 460; y += 24) {
      rect(0xd5ddce, x, y, 24, 1); rect(0xd5ddce, x, y, 1, 24);
    }
    rect(0xc2d0c2, 64, 72, 674, 333); rect(0xf9f9e9, 58, 64, 680, 332);
    rect(0x769b8e, 70, 76, 656, 308); rect(0x3a9eae, 76, 82, 644, 296);
    rect(0x65c4c8, 82, 88, 632, 284);
    for (let y = 90; y < 374; y += 8) for (let x = 84; x < 714; x += 8) {
      if ((x * 17 + y * 13) % 11 < 3) rect(0x70cbce, x, y, 5, 2);
    }
    for (let lane = 0; lane < 5; lane++) {
      const y = 116 + lane * 57;
      rect(0x3f9eaf, 113, y, 567, 3); rect(0x3f9eaf, 113, y - 11, 3, 25); rect(0x3f9eaf, 677, y - 11, 3, 25);
      this.add.text(32, y - 5, `0${lane + 1}`, { fontFamily: 'monospace', fontSize: 12, color: lane === 2 ? '#275c47' : '#7e9483' });
      rect(0xc2d0c2, 742, y - 12, 23, 24); rect(0xf6f7e9, 738, y - 15, 23, 22); rect(0x819d8b, 744, y - 11, 11, 12);
      if (lane < 4) for (let x = 84; x < 713; x += 9) {
        rect(0x3c9aab, x, y + 29, 8, 6);
        rect((Math.floor(x / 9) % 6 < 3) ? 0xf2e7c2 : 0xe67e66, x, y + 27, 7, 4);
      }
    }
    // Pool ladders, pennant flags, bench, life ring and planters.
    for (const x of [150, 610]) {
      rect(0xf3f7dc, x, 72, 4, 28); rect(0xf3f7dc, x + 16, 72, 4, 28);
      rect(0xd2e2d2, x, 86, 20, 3); rect(0xd2e2d2, x, 94, 20, 3);
    }
    rect(0x829a85, 90, 46, 620, 1);
    for (let x = 103; x < 710; x += 24) {
      rect(x % 48 === 7 ? 0xe49172 : 0x78aa92, x, 47, 12, 4);
      rect(x % 48 === 7 ? 0xe49172 : 0x78aa92, x + 2, 51, 8, 4);
      rect(x % 48 === 7 ? 0xe49172 : 0x78aa92, x + 4, 55, 4, 3);
    }
    for (const x of [34, 750]) {
      rect(0xb18464, x, 26, 16, 14); rect(0x477b54, x - 4, 15, 24, 13); rect(0x75a16b, x + 1, 9, 14, 18);
    }
    rect(0x9b7c55, 89, 421, 7, 14); rect(0x9b7c55, 173, 421, 7, 14);
    rect(0xc79864, 82, 409, 104, 15); rect(0xe1b780, 82, 410, 104, 3); rect(0x9b7c55, 82, 418, 104, 2);
    rect(0xe7a277, 199, 411, 13, 21); rect(0xf6efd1, 199, 416, 13, 4);
    rect(0x618c72, 639, 412, 64, 20); rect(0x83ac8c, 644, 412, 4, 20);
    this.add.text(325, 418, 'SLOW LAPS, GOOD DAYS.', { fontFamily: 'monospace', fontSize: 10, color: '#718b78' });
    this.ripples = this.add.graphics(); this.wake = this.add.graphics();
    this.initializeSwimmer();
    this.marker = this.add.text(116, 199, 'YOU', { fontFamily: 'monospace', fontSize: 9, color: '#234d43', backgroundColor: '#f8f7d8', padding: { x: 5, y: 3 } }).setOrigin(0.5);
    this.onReady();
  }
  // Throws on rendering failure; callers can retry without altering the session.
  initializeSwimmer() {
    makeSwimmer(this, this.appearance);
    const sprite = this.add.sprite(116, 230, textureKey(this.appearance, this.currentFrame));
    try { sprite.setAngle(90).setScale(0.95); }
    catch (error) { sprite.destroy(); throw error; }
    this.swimmer = sprite;
  }
  setAppearance(value) {
    const next = normalizeAppearance(value);
    if (this.swimmer) {
      makeSwimmer(this, next);
      const previous = textureKey(this.appearance, this.currentFrame);
      try { this.swimmer.setTexture(textureKey(next, this.currentFrame)); }
      catch (error) { this.swimmer.setTexture(previous); throw error; }
    }
    this.appearance = next; this.cap = next.cap;
    return true;
  }
  setCap(cap) { return this.setAppearance(cap); }
  stop() {
    this.session = null; this.paused = false; this.currentFrame = 0;
    this.wake?.clear();
    this.swimmer?.setPosition(116, 230).setAngle(90).setTexture(textureKey(this.appearance, 0));
    this.marker?.setPosition(116, 201);
  }
  play(record, context) {
    this.session = { id: record.id, distance: record.distance, travelled: 0, context };
    this.paused = false; this.swimmer.setPosition(116, 230).setAngle(90);
  }
  update(time, delta) {
    if (!this.swimmer) return;
    const reducedMotion = this.motionPreference?.matches ?? false;
    this.elapsed += delta;
    this.ripples.clear(); this.ripples.fillStyle(0xd2f3dc, 0.28);
    for (let i = 0; !reducedMotion && i < 32; i++) {
      const x = 94 + ((i * 79 + time * 0.004) % 600), y = 99 + ((i * 47) % 260);
      this.ripples.fillRect(Math.floor(x), y, 6 + (i % 3) * 3, 1);
    }
    let moving = !!this.session && !this.paused;
    if (moving) {
      const session = this.session;
      session.travelled = Math.min(session.distance, session.travelled + Math.min(delta, 80) / 1000 * 25 / 0.8 * this.speed);
      const position = session.travelled / 25, leg = Math.floor(position), part = position - leg;
      this.swimmer.x = 116 + (leg % 2 === 0 ? part : 1 - part) * 563;
      this.swimmer.angle = leg % 2 === 0 ? 90 : -90;
      this.onProgress(session.travelled, session.distance, session.context);
      if (session.travelled >= session.distance) {
        const id = session.id; this.session = null; moving = false; this.onComplete(id, session.context);
      }
    }
    const frame = moving ? Math.floor(time / (100 / this.speed)) % 4 : 0;
    this.swimmer.setTexture(textureKey(this.appearance, frame));
    this.currentFrame = frame;
    this.marker.setPosition(this.swimmer.x, this.swimmer.y - 29);
    this.wake.clear();
    if (moving && !reducedMotion) {
      const dir = this.swimmer.angle > 0 ? -1 : 1;
      for (let i = 0; i < 10; i++) {
        const phase = (time / 150 + i) % 10;
        this.wake.fillStyle(0xe2fff2, (1 - phase / 10) * 0.8);
        this.wake.fillRect(Math.round(this.swimmer.x + dir * (15 + phase * 3)), Math.round(230 + Math.sin(i * 7 + time / 90) * (4 + phase)), 3, 2);
      }
    }
  }
}
export function createPool(options) {
  const scene = new PoolScene(options);
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 800, height: 460, backgroundColor: '#e4e7d7', pixelArt: true, roundPixels: true, audio: { noAudio: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [scene] });
  return { game, scene };
}
