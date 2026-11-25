import { memo, useEffect, useMemo, useRef } from "react";
import type { Presentation, PresentationSlide } from "../formats/types";
import { type DisplayMode, applyDisplayMode } from "../render/displayMode";
import { SceneRenderer } from "../render/SceneRenderer";
import { useSeenOnce } from "../ui/hooks";

export interface SlideStripProps {
  presentation: Presentation;
  /** Index (in `presentation.slides`) of the slide shown, highlighted. */
  current: number;
  displayMode: DisplayMode;
  /** Jump to the slide at this index. */
  onJump: (index: number) => void;
  /** A thumbnail was built (building may find missing files). */
  onBuilt?: () => void;
}

/** Strip items: the slides from `firstSlide` on, with their indices. */
export function stripSlides(presentation: Presentation): { index: number; slide: PresentationSlide }[] {
  const first = Math.max(presentation.firstSlide, 0);
  return presentation.slides.slice(first).map((slide, i) => ({ index: first + i, slide }));
}

/**
 * A row of slide thumbnails. Each builds its picture only once it scrolls
 * near the view; click (or Enter) one to jump to that slide.
 */
export function SlideStrip({ presentation, current, displayMode, onJump, onBuilt }: SlideStripProps) {
  const first = Math.max(presentation.firstSlide, 0);
  return (
    <nav className="slide-strip" aria-label="Slides">
      <ol className="slide-strip-list">
        {stripSlides(presentation).map(({ index, slide }) => (
          <SlideThumb
            key={index}
            index={index}
            number={index - first + 1}
            slide={slide}
            current={index === current}
            displayMode={displayMode}
            onSelect={onJump}
            onBuilt={onBuilt}
          />
        ))}
      </ol>
    </nav>
  );
}

interface SlideThumbProps {
  index: number;
  number: number;
  slide: PresentationSlide;
  current: boolean;
  displayMode: DisplayMode;
  onSelect: (index: number) => void;
  onBuilt?: () => void;
}

function kindNote(slide: PresentationSlide): string | null {
  switch (slide.kind) {
    case "picture":
      return null;
    case "nested":
      return "Nested show";
    case "sound":
      return "Sound";
    default:
      return "Empty";
  }
}

const SlideThumb = memo(function SlideThumb({
  index,
  number,
  slide,
  current,
  displayMode,
  onSelect,
  onBuilt,
}: SlideThumbProps) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeenOnce(ref);
  const scene = useMemo(() => {
    if (!seen || slide.kind !== "picture") return null;
    const raw = slide.scene();
    return raw && applyDisplayMode(raw, displayMode);
  }, [seen, slide, displayMode]);

  const built = scene !== null;
  useEffect(() => {
    if (built) onBuilt?.();
  }, [built, onBuilt]);

  // Keep the current thumbnail in view inside the strip (without scrolling the page).
  useEffect(() => {
    const el = ref.current;
    const list = el?.parentElement;
    if (!current || !el || !list) return;
    const left = el.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = left - (list.clientWidth - el.offsetWidth) / 2;
    }
  }, [current]);

  const note = kindNote(slide);
  const label = `Slide ${number}${slide.label ? `: ${slide.label}` : ""}${note ? ` (${note.toLowerCase()})` : ""}`;
  return (
    <li ref={ref} className="slide-thumb">
      <button
        type="button"
        onClick={() => onSelect(index)}
        aria-current={current ? "step" : undefined}
        aria-label={label}
        title={label}
      >
        <span className="slide-thumb-picture" aria-hidden="true">
          {scene ? <SceneRenderer scene={scene} /> : <span className="slide-thumb-note">{note ?? ""}</span>}
        </span>
        <span className="slide-thumb-number" aria-hidden="true">
          {number}
        </span>
      </button>
    </li>
  );
});
