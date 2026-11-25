import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LANDSCAPE_VIEW_BOX, type Presentation, type PresentationSlide, type Scene } from "../formats/types";
import { ShowPlayer } from "./ShowPlayer";

function pictureSlide(label: string, background: string): PresentationSlide {
  const scene: Scene = { viewBox: LANDSCAPE_VIEW_BOX, background, elements: [] };
  return { label, kind: "picture", fileName: null, scene: () => scene, warnings: () => ["w1"], keys: [], buttons: [], waitForKey: true };
}

const presentation: Presentation = {
  id: "S.SH3",
  title: "Demo",
  firstSlide: 1,
  globalKeys: [],
  slides: [
    { ...pictureSlide("show", "#000"), kind: "empty", scene: () => null },
    pictureSlide("first", "#ff0000"),
    pictureSlide("second", "#00ff00"),
  ],
};

describe("ShowPlayer", () => {
  it("draws the first slide with a counter, controls and a slide strip", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} />);
    expect(html).toContain("<svg");
    expect(html).toContain("Slide 1 of 2 · first");
    // Entering presentation mode is the viewer's job; the player has no Present button.
    expect(html).not.toContain(">Present</button>");
    expect(html).not.toContain("Leave presentation");
    expect(html).toContain('aria-label="Slides"');
    expect(html).toContain('aria-current="step"');
    // Slide warnings moved to the viewer's diagnostics panel.
    expect(html).not.toContain("<li>w1</li>");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Sound on");
    expect(html).not.toContain("Click to enable sound");
  });

  it("applies the display mode and draws the first slide alone in a transition stage", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} displayMode="cga" transitionMode="demo" />);
    expect(html).toContain('class="transition-stage"');
    expect(html.match(/class="transition-layer/g)).toHaveLength(1);
    expect(html).toContain("transition-current");
    expect(html).not.toContain("#ff0000");
  });

  it("takes the mute setting from the parent when given", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} muted onMutedChange={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Sound off");
  });

  it("marks presentation mode and hides the strip while presenting", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} presenting onPresentingChange={() => {}} />);
    expect(html).toContain('class="player presenting"');
    expect(html).toContain("Leave presentation (Esc)");
    expect(html).not.toContain('aria-label="Slides"');
  });

  it("says so when there is nothing to show", () => {
    const empty: Presentation = { ...presentation, slides: presentation.slides.slice(0, 1) };
    expect(renderToStaticMarkup(<ShowPlayer presentation={empty} />)).toContain("This show has no slides to show.");
  });
});
