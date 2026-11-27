/**
 * The colours Harvard Graphics 1.0 (A.00) and 2.x show on screen.
 *
 * Neither format stores colours: a chart holds colour numbers 1..16 and the
 * program's screen driver decides what each looks like. The drawing code
 * paints colour n as CLASSIC_PALETTE[n - 1]; `toClassicScreen` then turns
 * those into the program's screen, the way an HG3 document's palette does
 * (Scene.screenColors): every colour number becomes one of the 16 standard
 * screen slots (SCREENSHOW_NOMINAL in src/render/vgaScreenShow.ts), and
 * screenColors says what each slot shows. Display modes then draw them like
 * any other document, and the CGA mode can tell colour numbers apart
 * (Scene.classicSlots).
 *
 * Measured on the story show's A.00 and 2.3 screens (harvard-graphics/story-v2):
 * - 2.x on VGA and EGA: background navy (0,0,85); colours 1..6 white, teal (0,170,170),
 *   blue (0,85,170), light blue (85,170,255), pale cyan (170,255,255), pale yellow
 *   (255,255,170). Colours 7..16 were not on any captured chart and keep the
 *   viewer's earlier stand-ins [I].
 * - A.00 graph and pie charts: the CGA's 320 × 200 four-colour mode, palette 0 on a
 *   blue background: colour n shows as CGA colour ((n - 1) mod 4 + 1) mod 4, so 1 green,
 *   2 red, 3 brown, 4 the background, 5 green again. The 2.3 CGA screen uses the same rule.
 * - A.00 text and org charts: white on black (the CGA's 640 × 200 two-colour mode).
 */
import type { Scene, SceneElement } from "../../model/scene";
import type { ClassicKind, ClassicVersion } from "./model";
import { CLASSIC_PALETTE } from "./assumptions";

/** The 16 standard screen slots (vgaScreenShow.ts SCREENSHOW_NOMINAL), as CSS. */
export const NOMINAL_SLOTS: readonly string[] = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#ff8000",
  "#ffff00",
  "#80ff00",
  "#00ff00",
  "#00ff80",
  "#00ffff",
  "#0080ff",
  "#0000ff",
  "#8000ff",
  "#ff00ff",
  "#ff0080",
  "#555555",
  "#aaaaaa",
];

/** 2.x screen: background, then colours 1..15 (colour 16, black, shows as the background [I]). */
export const SCREEN_2X: readonly string[] = [
  "#000055",
  "#ffffff",
  "#00aaaa",
  "#0055aa",
  "#55aaff",
  "#aaffff",
  "#ffffaa",
  ...CLASSIC_PALETTE.slice(6, 15).map((c) => c.toLowerCase()),
];

/** The CGA's palette 0 with a blue background: background, green, red, brown. */
export const CGA_PALETTE_0: readonly string[] = ["#0000aa", "#00aa00", "#aa0000", "#aa5500"];

/** CGA colour (0..3, 0 the background) of colour number n, as A.00 and 2.3 show it. */
export function cgaIndex(n: number): number {
  if (!(n >= 1)) return 0;
  return (((Math.floor(n) - 1) % 4) + 1) % 4;
}

export interface ClassicScreen {
  /** Screen slot of colour number n (index n - 1); the background is slot 0. */
  slotOf: (n: number) => number;
  /** What the 16 slots show. */
  screenColors: string[];
  /** The CGA mode the program uses for it (Scene.classicSlots). */
  cga: "cga4" | "cga2";
}

/** The screen a chart of this version and kind is shown on. */
export function classicScreen(version: ClassicVersion, kind: ClassicKind): ClassicScreen {
  if (version === "1.0") {
    if (kind === "bar" || kind === "area" || kind === "hlc" || kind === "pie") {
      return { slotOf: cgaIndex, screenColors: [...CGA_PALETTE_0, ...NOMINAL_SLOTS.slice(4)], cga: "cga4" };
    }
    return { slotOf: (n) => (n === 16 ? 0 : 1), screenColors: [...NOMINAL_SLOTS], cga: "cga2" };
  }
  return { slotOf: (n) => (n >= 1 && n <= 15 ? Math.floor(n) : 0), screenColors: [...SCREEN_2X], cga: "cga4" };
}

const hex = (css: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
};
const css = (rgb: readonly number[]) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/**
 * The colour drawn for `color` on `screen`: a colour number's palette colour
 * becomes its slot's standard colour, and a shade of one (3-D sides, shadows)
 * the same shade of that slot. Anything else is unchanged.
 */
function mapper(screen: ClassicScreen): (color: string) => string {
  const palette = CLASSIC_PALETTE.map(hex);
  const cache = new Map<string, string>();
  return (color) => {
    const hit = cache.get(color);
    if (hit !== undefined) return hit;
    let out = color;
    const rgb = hex(color);
    if (rgb) {
      const exact = palette.findIndex((p) => p !== null && p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]);
      if (exact >= 0) out = NOMINAL_SLOTS[screen.slotOf(exact + 1)]!;
      else {
        for (let i = 0; i < palette.length - 1; i++) {
          const p = palette[i]!;
          const big = p.indexOf(Math.max(...p));
          const f = rgb[big]! / p[big]!;
          if (f > 0 && f < 1 && p.every((v, c) => Math.abs(v * f - rgb[c]!) <= 1.5)) {
            const slot = hex(NOMINAL_SLOTS[screen.slotOf(i + 1)]!)!;
            out = css(slot.map((v) => v * f));
            break;
          }
        }
      }
    }
    cache.set(color, out);
    return out;
  };
}

function mapElement(el: SceneElement, map: (c: string) => string): SceneElement {
  switch (el.kind) {
    case "group":
      return { ...el, children: el.children.map((c) => mapElement(c, map)) };
    case "image":
      return el;
    case "text":
      return { ...el, fill: map(el.fill) };
    default:
      return { ...el, fill: el.fill === null ? null : map(el.fill), stroke: el.stroke === null ? null : map(el.stroke) } as SceneElement;
  }
}

/** The scene on the program's own screen (see the file comment). */
export function toClassicScreen(scene: Scene, version: ClassicVersion, kind: ClassicKind): Scene {
  const screen = classicScreen(version, kind);
  const map = mapper(screen);
  return {
    ...scene,
    background: map(scene.background),
    elements: scene.elements.map((e) => mapElement(e, map)),
    screenColors: screen.screenColors,
    classicSlots: screen.cga,
  };
}
