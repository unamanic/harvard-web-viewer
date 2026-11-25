import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TransitionStage, type TransitionLayers } from "./TransitionStage";

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
});
