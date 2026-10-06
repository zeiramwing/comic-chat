export class Emitter {
  #h = new Map();
  on(evt, fn) {
    if (!this.#h.has(evt)) this.#h.set(evt, new Set());
    this.#h.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this.#h.get(evt)?.delete(fn); }
  emit(evt, data) {
    for (const fn of [...(this.#h.get(evt) ?? [])]) {
      try { fn(data); } catch (e) { console.error(`handler for ${evt} failed`, e); }
    }
  }
}
