import { memo, type ReactNode, type Ref, type RefObject, useEffect, useMemo, useRef } from "react";
import type { Presentation, PresentationSlide } from "../model/presentation";
import type { Scene } from "../model/scene";
import { type DisplayMode, applyDisplayMode } from "../render/displayMode";
import { blendPatterns } from "../render/dither";
import { SceneRenderer } from "../render/SceneRenderer";
import { useSeenOnce } from "../ui/hooks";

/** Card items of a show: the slides from `firstSlide` on, with their indices. */
export function stripSlides(presentation: Presentation): { index: number; slide: PresentationSlide }[] {
  const first = Math.max(presentation.firstSlide, 0);
  return presentation.slides.slice(first).map((slide, i) => ({ index: first + i, slide }));
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

export interface SlideCardsProps {
  presentation: Presentation;
  /** Index (in `presentation.slides`) of the slide shown, highlighted. */
  current: number;
  /** Where the player is inside a nested show ("nested slide 2 of 5"), shown on the current card. */
  nestedNote?: string | null;
  displayMode: DisplayMode;
  /** Jump to the slide at this index. */
  onJump: (index: number) => void;
  /** A thumbnail was built (building may find missing files). */
  onBuilt?: () => void;
}

/**
 * The slides of a show as cards: a thumbnail of the slide (built once it
 * scrolls near the view) with its label. Click (or Enter) a card to jump to
 * that slide. Nested shows are indented and marked.
 */
export function SlideCards({ presentation, current, nestedNote, displayMode, onJump, onBuilt }: SlideCardsProps) {
  const first = Math.max(presentation.firstSlide, 0);
  return (
    <ol className="slide-cards">
      {stripSlides(presentation).map(({ index, slide }) => (
        <ShowSlideCard
          key={index}
          index={index}
          number={index - first + 1}
          slide={slide}
          current={index === current}
          nestedNote={index === current ? (nestedNote ?? null) : null}
          displayMode={displayMode}
          onSelect={onJump}
          onBuilt={onBuilt}
        />
      ))}
    </ol>
  );
}

interface ShowSlideCardProps {
  index: number;
  number: number;
  slide: PresentationSlide;
  current: boolean;
  nestedNote: string | null;
  displayMode: DisplayMode;
  onSelect: (index: number) => void;
  onBuilt?: () => void;
}

const ShowSlideCard = memo(function ShowSlideCard({
  index,
  number,
  slide,
  current,
  nestedNote,
  displayMode,
  onSelect,
  onBuilt,
}: ShowSlideCardProps) {
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

  const note = kindNote(slide);
  const label = `Slide ${number}${slide.label ? `: ${slide.label}` : ""}${note ? ` (${note.toLowerCase()})` : ""}`;
  return (
    <SlideCard
      itemRef={ref}
      current={current}
      label={label}
      onSelect={() => onSelect(index)}
      nested={slide.kind === "nested"}
      scene={scene}
      note={note}
      title={slide.label || slide.fileName || `Slide ${number}`}
      sub={nestedNote ?? (slide.kind === "nested" ? "Nested show" : null)}
    />
  );
});

interface SlideCardProps {
  itemRef?: Ref<HTMLLIElement>;
  current: boolean;
  /** Accessible name. */
  label: string;
  onSelect: () => void;
  nested?: boolean;
  scene: Scene | null;
  /** Shown in place of the thumbnail when there is no picture. */
  note: string | null;
  title: string;
  sub?: string | null;
}

/** One card: navy, thumbnail on top, serif title under it; the current one outlined in the accent colour. */
function SlideCard({ itemRef, current, label, onSelect, nested, scene, note, title, sub }: SlideCardProps) {
  // Dithers drawn as the colour they blend to: at this size a screen pixel is a fraction of a device pixel,
  // and the browser draws a tile that small in the wrong colour (dither.ts, blendPatterns).
  const thumb = useMemo(() => scene && blendPatterns(scene), [scene]);
  // Keep the current card in view inside the list (without scrolling the page).
  const own = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = own.current;
    const list = el?.parentElement;
    if (!current || !el || !list) return;
    const horizontal = list.scrollWidth > list.clientWidth;
    if (horizontal) {
      const left = el.offsetLeft - list.offsetLeft;
      if (left < list.scrollLeft || left + el.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = left - (list.clientWidth - el.offsetWidth) / 2;
      }
    } else {
      const top = el.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = top - (list.clientHeight - el.offsetHeight) / 2;
      }
    }
  }, [current]);

  const setRef = (el: HTMLLIElement | null) => {
    own.current = el;
    if (typeof itemRef === "function") itemRef(el);
    else if (itemRef && typeof itemRef === "object") (itemRef as RefObject<HTMLLIElement | null>).current = el;
  };

  return (
    <li ref={setRef} className={`slide-card${nested ? " slide-card-nested" : ""}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={current ? "step" : undefined}
        aria-label={label}
        title={label}
      >
        <span className="slide-card-picture" aria-hidden="true">
          {thumb ? <SceneRenderer scene={thumb} /> : <span className="slide-card-note">{note ?? ""}</span>}
        </span>
        <span className="slide-card-title" aria-hidden="true">
          {title}
        </span>
        {sub && (
          <span className="slide-card-sub" aria-hidden="true">
            {sub}
          </span>
        )}
      </button>
    </li>
  );
}

export interface PageCardsProps {
  /** The chart's pages (display mode applied). */
  scenes: readonly Scene[];
  /** Title of the chart (its description, else the file name). */
  title: string;
  current: number;
  onSelect: (index: number) => void;
}

/** A chart's pages as cards (one card for a single chart). */
export function PageCards({ scenes, title, current, onSelect }: PageCardsProps) {
  return (
    <ol className="slide-cards">
      {scenes.map((scene, i) => {
        const name = scenes.length > 1 ? `${title}, page ${i + 1}` : title;
        return (
          <SlideCard
            key={i}
            current={i === current}
            label={name}
            onSelect={() => onSelect(i)}
            scene={scene}
            note={null}
            title={name}
          />
        );
      })}
    </ol>
  );
}

/** The left column: an optional file switcher, the "Slides" heading and the cards. */
export function SlidesColumn({ fileSwitcher, children }: { fileSwitcher?: ReactNode; children: ReactNode }) {
  return (
    <nav className="slides-column" aria-labelledby="slides-heading">
      {fileSwitcher}
      <h2 id="slides-heading" className="column-label">
        Slides
      </h2>
      {children}
    </nav>
  );
}
