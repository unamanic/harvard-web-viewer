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
  it("draws the first slide in the stage panel with a counter and controls", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} />);
    expect(html).toContain("<svg");
    expect(html).toContain('<div class="stage-panel"><div class="player-stage">');
    expect(html).toContain("Slide 1 of 2 · first");
    expect(html).toContain('aria-label="Previous slide"');
    expect(html).toContain('aria-label="Next slide"');
    // Entering presentation mode is the viewer's job; the player has no Present button.
    expect(html).not.toContain(">Present</button>");
    expect(html).not.toContain("Exit (Esc)");
    // The slide list is the viewer's (SlideCards).
    expect(html).not.toContain('class="slide-cards"');
    // Slide warnings moved to the viewer's diagnostics panel.
    expect(html).not.toContain("<li>w1</li>");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Sound on");
    expect(html).not.toContain("Click to enable sound");
  });

  it("applies the display mode and draws the first slide alone in a transition stage", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} displayMode="mono" transitionMode="demo" />);
    expect(html).toContain('class="transition-stage"');
    expect(html.match(/class="transition-layer/g)).toHaveLength(1);
    expect(html).toContain("transition-current");
    expect(html).not.toContain("#ff0000");
  });

  it("starts at initialPosition when it fits the presentation, else at the start", () => {
    const at = (indices: number[], counts: number[]) =>
      renderToStaticMarkup(<ShowPlayer presentation={presentation} initialPosition={{ indices, counts, ended: false }} />);
    expect(at([2], [3])).toContain("Slide 2 of 2 · second");
    expect(at([2], [4])).toContain("Slide 1 of 2 · first");
  });

  it("takes the mute setting from the parent when given, offering it only for shows that may play sound", () => {
    const withSound: Presentation = {
      ...presentation,
      slides: [...presentation.slides, { ...pictureSlide("tune", "#000"), kind: "sound", scene: () => null }],
    };
    const html = renderToStaticMarkup(<ShowPlayer presentation={withSound} muted onMutedChange={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Sound off");
    const silent = renderToStaticMarkup(<ShowPlayer presentation={presentation} muted onMutedChange={() => {}} />);
    expect(silent).not.toContain("Sound off");
  });

  it("names the file in the counter", () => {
    const html = renderToStaticMarkup(<ShowPlayer presentation={presentation} fileLabel="DEMO.SH3" />);
    expect(html).toContain("DEMO.SH3 · Slide 1 of 2 · first");
  });

  it("marks presentation mode with a compact bar and the file label", () => {
    const html = renderToStaticMarkup(
      <ShowPlayer presentation={presentation} presenting onPresentingChange={() => {}} fileLabel="DEMO.SH3" transitionMode="demo" />,
    );
    expect(html).toContain('class="player presenting"');
    expect(html).toContain("Exit (Esc)");
    expect(html).toContain(">1 / 2<");
    expect(html).toMatch(/<p class="present-label">DEMO.SH3( · Transition: [a-z ]+)?<\/p>/);
  });

  it("says so when there is nothing to show", () => {
    const empty: Presentation = { ...presentation, slides: presentation.slides.slice(0, 1) };
    expect(renderToStaticMarkup(<ShowPlayer presentation={empty} />)).toContain("This show has no slides to show.");
  });
});
