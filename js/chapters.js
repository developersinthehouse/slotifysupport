// Chapters. Every section marked data-scene + data-pose is one arrangement of the pills seen from one camera pose.
// Around the edge between two sections the stage hands over from one chapter to the next; elsewhere it holds still.

export function createChapters(scope = document) {
  let list = [];
  const state = { a: null, b: null, t: 0, index: 0, ref: 0 };

  function measure() {
    const y = window.scrollY || 0;
    list = Array.from(scope.querySelectorAll('[data-scene][data-pose]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, id: el.id, scene: el.dataset.scene, pose: el.dataset.pose, top: r.top + y, h: r.height, anchor: el.querySelector('[data-anchor]') };
    });
  }

  /**
   * Which chapter (or which pair, mid hand-over) the middle of the viewport is in.
   * The returned object is reused between calls.
   */
  function at(y, vh) {
    const ref = y + vh * 0.5;
    state.ref = ref;
    if (!list.length) return state;
    for (let i = 0; i < list.length - 1; i++) {
      const A = list[i], B = list[i + 1], edge = A.top + A.h;
      const w = Math.min(0.32 * vh, 0.45 * Math.min(A.h, B.h));
      if (ref > edge - w && ref < edge + w) {
        state.a = A; state.b = B; state.t = (ref - (edge - w)) / (2 * w); state.index = i;
        return state;
      }
    }
    let k = list.length - 1;
    for (let i = 0; i < list.length; i++) if (ref < list[i].top + list[i].h) { k = i; break; }
    state.a = state.b = list[k]; state.t = 0; state.index = k;
    return state;
  }

  return { measure, at, byId: (id) => list.find((c) => c.id === id), get list() { return list; } };
}
