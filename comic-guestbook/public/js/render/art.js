// Loads converted Comic Chat art on demand and caches it.

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`failed to load ${url}`));
  img.src = url;
});

export class Art {
  constructor(base = '/art/') {
    this.base = base;
    this.index = null;
    this.manifests = new Map(); // id -> character manifest (what buildScene wants)
    this.atlases = new Map(); // id -> { ink, halo }
    this.backdrops = new Map(); // id -> Image
    this.pending = new Map();
    this.emotionImg = null;
    this.failed = new Set();
  }

  async init() {
    const res = await fetch(`${this.base}index.json`);
    this.index = await res.json();
    this.v = this.index.version ? `?v=${this.index.version}` : '';
    return this.index;
  }

  /** URL of an art file; the version makes it safe to cache for a long time. */
  url(path) {
    return `${this.base}${path}${this.v ?? ''}`;
  }

  once(key, fn) {
    if (!this.pending.has(key)) {
      this.pending.set(key, fn().finally(() => this.pending.delete(key)));
    }
    return this.pending.get(key);
  }

  /** Make sure a character's manifest and atlases are ready. Never throws. */
  character(id) {
    if (this.atlases.has(id) || this.failed.has(id)) return Promise.resolve(this.atlases.get(id) ?? null);
    return this.once(`c:${id}`, async () => {
      try {
        const m = await (await fetch(this.url(`characters/${id}.json`))).json();
        const [ink, halo] = await Promise.all([
          loadImage(this.url(`characters/${m.atlas}`)),
          m.halo ? loadImage(this.url(`characters/${m.halo}`)) : null,
        ]);
        this.manifests.set(id, m);
        const entry = { ink, halo };
        this.atlases.set(id, entry);
        return entry;
      } catch {
        this.failed.add(id);
        return null;
      }
    });
  }

  backdrop(id) {
    if (!id) return Promise.resolve(null);
    if (this.backdrops.has(id)) return Promise.resolve(this.backdrops.get(id));
    return this.once(`b:${id}`, async () => {
      try {
        const meta = this.index.backdrops.find((b) => b.id === id);
        if (!meta) return null;
        const img = await loadImage(this.url(`backdrops/${meta.file}`));
        this.backdrops.set(id, img);
        return img;
      } catch {
        return null;
      }
    });
  }

  async emotions() {
    if (this.emotionImg) return this.emotionImg;
    const meta = this.index?.ui?.emotions;
    if (!meta) return null;
    this.emotionImg = await loadImage(this.url(meta.file));
    return this.emotionImg;
  }

  async icons() {
    if (this.iconImg) return this.iconImg;
    const meta = this.index?.ui?.icons;
    if (!meta) return null;
    this.iconImg = await loadImage(this.url(meta.file));
    return this.iconImg;
  }

  /** Source rectangle of a character's 40x40 icon in the shared sheet. */
  iconRect(id) {
    const c = this.index?.characters.find((x) => x.id === id);
    const cell = this.index?.ui?.icons?.cell ?? 40;
    return c?.icon ? { x: c.icon.x, y: c.icon.y, w: cell, h: cell } : null;
  }

  /** Draw a character icon into a canvas (used by menus, lists and pickers). */
  drawIcon(canvas, id) {
    const img = this.iconImg;
    const r = this.iconRect(id);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img && r) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    }
  }

  /** Load everything a panel needs. */
  async ensurePanel(panel) {
    const ids = new Set(panel.cast.map((m) => m.character));
    await Promise.all([...[...ids].map((id) => this.character(id)), this.backdrop(panel.backdrop)]);
  }
}
