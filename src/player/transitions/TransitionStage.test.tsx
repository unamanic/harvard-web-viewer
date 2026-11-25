import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TransitionStage, phaseLayers, type TransitionLayers } from "./TransitionStage";

const layers: TransitionLayers = { current: <b>new</b>, currentTransparent: <s>new-clear</s>, previous: <i>old</i> };
const wipe = { effect: "wipe", direction: "left", durationMs: 750 } as const;

describe("TransitionStage", () => {
  it("stacks the old slide under the clipped new one mid-transition", () => {
    const html = renderToStaticMarkup(<TransitionStage transition={wipe} runId={1} finished={false} layers={layers} progress={0.5} />);
    expect(html).toBe(
      '<div class="transition-stage"><div class="transition-layer transition-previous"><i>old</i></div>' +
        '<div class="transition-layer transition-current" style="clip-path:inset(0% 0% 0% 50%)"><b>new</b></div></div>',
    );
  });

  it("starts at progress 0 and draws only the new slide once finished", () => {
    const start = renderToStaticMarkup(<TransitionStage transition={wipe} runId={1} finished={false} layers={layers} />);
    expect(start).toContain("clip-path:inset(0% 0% 0% 100%)");
    const end = renderToStaticMarkup(<TransitionStage transition={wipe} runId={1} finished layers={layers} />);
    expect(end).toBe('<div class="transition-stage"><div class="transition-layer transition-current"><b>new</b></div></div>');
  });

  it("overlay keeps the old slide under the new one drawn without background", () => {
    const html = renderToStaticMarkup(
      <TransitionStage transition={{ effect: "overlay", durationMs: 0 }} runId={1} finished layers={layers} />,
    );
    expect(html).toContain("<i>old</i>");
    expect(html).toContain("<s>new-clear</s>");
  });

  it("erase phase: the old slide goes to black; draw phase: the new one comes in over the black", () => {
    const slides = { current: <b>new</b>, currentTransparent: <s>new-clear</s>, old: <i>old</i> };
    const blank = <u>black</u>;
    const erase = phaseLayers("erase", true, slides, blank);
    expect(erase).toEqual({ current: blank, currentTransparent: blank, previous: slides.old });
    const fade = { effect: "fade", durationMs: 1500 } as const;
    const mid = renderToStaticMarkup(<TransitionStage transition={wipe} runId={2} finished={false} layers={erase} progress={0.5} />);
    expect(mid).toContain("<i>old</i>");
    expect(mid).toContain("<u>black</u>");
    expect(mid).not.toContain("<b>new</b>");
    const draw = phaseLayers("draw", true, slides, blank);
    expect(draw).toEqual({ current: slides.current, currentTransparent: slides.currentTransparent, previous: blank });
    const drawMid = renderToStaticMarkup(<TransitionStage transition={fade} runId={3} finished={false} layers={draw} progress={0.5} />);
    expect(drawMid).toContain("<u>black</u>");
    expect(drawMid).toContain("<b>new</b>");
    expect(drawMid).not.toContain("<i>old</i>");
  });

  it("without an erase the new slide is drawn over the old; at the start there is no old slide", () => {
    const slides = { current: <b>new</b>, currentTransparent: <s>new-clear</s>, old: <i>old</i> };
    expect(phaseLayers("draw", false, slides, <u />).previous).toBe(slides.old);
    expect(phaseLayers("erase", true, { ...slides, old: null }, <u />)).toEqual({
      current: slides.current,
      currentTransparent: slides.currentTransparent,
      previous: null,
    });
  });
});

