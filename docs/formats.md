# File format notes

Working notes on the binary formats this project decodes. Record only what has
been **verified against real sample files**, and cite the file you checked.

Keep this file in sync with the code: any change that confirms, corrects or
adds to what we know about a format updates this file in the same commit.

## Harvard Graphics 3 (DOS)

The full clean-room specification is [SPEC.md](SPEC.md); the implementation
plan is [RENDERER_TASKS.md](RENDERER_TASKS.md). This file records what the
viewer's own code has verified so far.

### Status

| Area | Spec section | Implemented | Verified against samples |
| --- | --- | --- | --- |
| Record container | §3 | Yes (task 2) | Yes: all 287 sample documents parse to the last byte with no warnings |
| Palettes (.PL3, .PC3) | §6.2 | Yes (task 6) | Yes: all 36 sample palettes parse with no warnings |
| Font index (HG3.FGF) | §2 | Yes (task 7); text drawn with the original fonts or our clones (task 7f) | Yes: the sample HG3.FGF parses with no warnings |
| Charts (.CH3) | §5 | Parsed and drawn from the object layer, embedded charts included (tasks 9, 10, 12, 13, 13b, 13c); layout from data not yet | All 238 sample charts parse and render; visually checked by type |
| Shows (.SH3) | §4 | Parsed and played (tasks 21, 22); transitions with a guessed mapping, off by default (23); WAV sound plays, MIDI not (24); button charts drawn and clickable (20) | Yes: all 13 sample shows play to the end |
| PCX bitmaps | §6.3 | Yes (task 8) | Yes: all 69 sample .PCX/.PCC decode with no warnings |
| Speedo fonts (.SPD) | §2 | Reader (task 7b); draws chart text when loaded (task 7f) | Yes: all 15 sample fonts decode with no warnings |
| FN3 stroke fonts | §7.2 item 8 | Not yet documented | No |

### Verified findings

Add entries as `- finding (sample file checked, task number)`.

- The record container rules of §3 hold for every sample document: 238 .CH3,
  13 .SH3, 31 .PL3 and 5 .PC3 (287 files; SPEC.md counts 32 .PL3, so one
  palette is missing from our sample copy). None is damaged, none lacks the
  end record, none has trailing data. (all samples, task 2)
- Tag 608 (group open) carries 16 bytes of data in every occurrence (213
  records in 178 files), not 0 as SPEC.md first said; SPEC.md §3 is updated.
  The meaning is not yet known. (all samples, task 2)
- Open tags 500, 504, 508, 520 and 524 always have 0 bytes of data; 516
  always has 16 (237 records). (all samples, task 2)
- The 69 sample PCX/PCC bitmaps are all version 5, RLE encoded: 65 are
  monochrome (1 bit, 1 plane, header palette entries 0 and 1 are black and
  white) and 4 are 16-colour (1 bit, 4 planes). (all samples, task 8)

- Not every palette has 64 colours: 8COLOR.PL3 has 50 and BASICB.PC3 has
  57. The other 29 .PL3 files have 64 with role = index + 1. (all
  palettes, task 6)
- .PC3 files are plain colour lists: role byte 0xFF in every 1552 record,
  names without "|role", no 1554 or 1555. (5 .PC3 files, task 6)
- Role names for entries 0 to 41 follow the §6.2 table in 26 of 31 .PL3
  files; NUMBER.PL3, SAMPLE.PL3 and the two MONOCHR files name them
  differently. Names have junk bytes after the NUL. (all palettes, task 6)
- 1555 is 16 entries of 0xFF R G B; 25 files (including HG3, 16COLOR and
  both MONOCHR) hold the same 16 colours, so it is not a display mapping.
  Task 6b uses a nearest-colour rule for EGA instead. (all palettes, task 6)
- 1554 is u16 mode (1 plain, 2 in shaded palettes), two 0xFF R G B colours,
  u16 (90 almost everywhere), u16 (always 12). Meaning inferred only.
  (all palettes, task 6)
- Every palette a sample chart references is in the sample set: 23 charts
  name a palette file and 215 use HG3.PL3 by default, so the missing-palette
  fallback is covered only by synthetic tests. ("12.PL3" appears only in
  description text.) (all charts, tasks 6 and 12)
- Orientation: 232 sample charts are landscape, 6 portrait. (all charts,
  task 12)
- All 238 sample charts parse: XY 141, drawing 67, pie 10, bullet 8,
  organization 7, title 3, table 2. There are exactly 2,588 text lines and
  every declared length matches. (all charts, task 9)
- Text slots per chart type match §5.3. No XY chart has a footnote. (all
  charts, task 9)
- 800 offset 6 is a row count, not 0 to 7; offset 7 is 0x10, 0x11 (table
  cells) or 0x12 (XY series names). SPEC.md §5.3 updated. (all charts, task 9)
- Justification values are only 1 and 2; flag 0x2000 only on table cells.
  (all charts, task 9)
- Style tables are per text role, not per slot. The parser's mapping of
  entries to roles is documented in src/formats/hg3/chart.ts. No sample line
  is missing a value, so the style fallback is never used. (all charts, task 9)
- Only two font keys appear: (3, 3, 0x4268) on 2,582 lines and
  (3, 13, 0x42A8) on 6 title-chart lines. (all charts, task 9)
- 816 values: landscape screen 10×7.5 in (217), landscape Letter 11×8.5
  (12), landscape paper 1 at 10×7.5 (3), portrait Letter 8.5×11 (6). Every
  chart has one. (all charts, task 9)
- Where records live: 802–810 and 824 in every data chart, never in
  drawings; 1700 only in drawings; 814 in 504 outside 508. One drawing has
  no 516 object layer. Kind 4 references can repeat (up to 4) in small
  template drawings, all naming PORTRAIT.CH3 or LANDSCAP.CH3. XY record 1420
  appears in 2 files and is not in §5.4. (all charts, task 9)
- HG3.FGF has 22 entries (15 Speedo, 7 stroke), exactly 6 + 22 × 588
  bytes. Every font file it names is in the sample FONT folder; names are
  stored in lower case. (HG3.FGF, task 7)
- Style words match §2: bit 0 italic, high byte 0x42 Speedo / 0x58 stroke,
  low byte the weight, except HG Gothic Bold which uses 0x78 (medium).
  (HG3.FGF, task 7)
- The 4 classification bytes decode as family flags, a generic family, a
  weight class and a constant 0x08; SPEC.md §2 updated. Not used in code.
  (HG3.FGF, task 7)
- Character maps: every Speedo font lacks only code 0; every stroke font
  lacks the same 90 codes: control pictographs, 0x0D, 0xFF, the code page
  850 box-drawing positions and symbols such as × ® © ½ ¼ “ ” ‘ ’ ‰ ± ≥ ≤ ¶
  ÷ ►. Both font kinds use the same Harvard Graphics character set.
  (HG3.FGF, tasks 7 and 7e)
- Object layer (§5.6, rewritten from these findings; all charts, task 10):
  - A 612 is a display list: attributes set state, each shape draws with
    the current state. 427 of 3,712 objects have 2 or more shapes.
  - 616 is optional; data-chart objects have none (identity transform).
  - 614 continues a 612 whose list lacks 0x1FFF (3 cases), not a prefix.
  - 616/618 can precede a 608 group and apply to it. 608 data = union of
    member bounding boxes, then 8 zero bytes (201 of 201 non-empty groups).
  - Point lists have a part count: u16 n, u16 k, k part sizes, n points.
  - About 375 transforms rotate by 90°; b = c = 0 is not universal.
  - Attribute colours: byte 0 = 0xFF means direct RGB in bytes 1–3.
  - Text block header layout worked out; strings are padded to even length.
  - Justification 3 (right) appears 78 times in text blocks.
  - Objects per type: drawing 3,248, XY 373, bullet 40, pie 21, org 15,
    title 11, table 4. No unknown sub-tags.
- The 15 .SPD files are Bitstream Speedo format "D1.0", 1000 ORUs per em,
  encrypted with per-file keys that the reader recovers from the file
  itself. FGF character ids are indexes into the Speedo character
  directory; the code stored in each glyph is ASCII-like (space 32, 'A' 65).
  Monospace 821 has 45 empty directory slots. (all .SPD files, task 7b)
- Every sample data chart (171 of 171) stores a drawn copy of itself in its
  object layer, so drawing the object layer reproduces the chart. Visual
  check on PIETUT, ORGTUT, a table and a bullet chart: all correct except
  unfilled pie slices and tiny bullet markers. (all data charts, task 13)
- 0x1080/0x1091/0x1098 are cubic Bézier control points (3k + 1 points);
  0x10A0/0x10A1 pass through their points. (37 curves, task 13)
- Shape sub-tag low digit: 0/2 outline only, 1 fill, 7 direct fill without
  line, 8 gradient. (all objects, task 13)
- Text block: the box at offset 62 is the tight text extent; lines are about
  1.28 × size apart; run colour is 4 bytes (tail colour u16 plus the next
  u16). (all text blocks, task 13)
- The 12 "empty bitmap groups" are embedded charts: 616 + 404 kind 4 + an
  empty 608 (LDOUBLEP, LFOURL, PDOUBLEL, PFOURP). Not drawn yet. (task 13)
- Shows (all 13 shows, task 21; SPEC.md §4 updated):
  - 430 slides, as the spec says: XY 140, drawing 62, bullet 25, pie 9,
    org 6, table 2, title 1, empty 155, show 22 (13 slide 0s, 9 nested),
    MIDI 6, sound 1, unknown kind 0x9F 1.
  - Every chart slide's kind equals its chart's document type (245 of 245).
    All 261 referenced files exist beside the show; no show nests itself.
  - Offsets 11/12 do not fit the transition guess; transitions are unknown.
    Offset 14 is 0 only on sound and MIDI slides.
  - Destination 0 means "none". Key tables also appear on chart slides,
    nested-show slides and sound/MIDI slides.
  - Button names match a 618 name in the button chart (1,837) or the slide's
    own chart (83); "edit" and "editcler" have no object. Names differ in
    case, so matching must ignore case.
  - 708 is "01 01 01" in 3 shows; 710 looks like six 323-byte entries.
- Character set: the upper half of the byte codes is not CP437. Rendering
  each code's glyph from the Speedo fonts shows a set close to code page 850
  with Harvard-specific codes (curly quotes, ≤ ≥ ‰ ¶ § ►, minus). Table in
  src/formats/hg3/charset.ts; SPEC.md §1 and §6.4 updated. All parsers now
  decode text with it (task 7e). In the samples it changes only object-layer
  text: line breaks, 12 bullets (0xFA •) and 4 ► markers. (HG3.FGF and all
  .SPD, tasks 7d-2 and 7e)
- 0x1031 arcs all have style 1 and are pie slices (closed through the
  centre, filled). 0x112A is fill brightness for 3-D shading. Bullet markers
  are one-character text blocks (0xFA bullet, 0xF9 ►). Each 404 kind 4 in
  LDOUBLEP, LFOURL, PDOUBLEL, PFOURP is an embedded chart placed by its
  group's 616 (scale 0.5 to 0.647). (all charts, task 13b/13c)
- Player walk: all 13 sample shows load and play to the end with no
  missing files; GALLERY.SH3 walks 218 slides through 9 nested shows.
  TUTOR.SH3 holds only an unknown-kind slide, so it has nothing to show.
  The gallery's HELP slides bind F3/F4/F5 to destination 0 in their own key
  table, which only makes sense as switching off the show-wide keys; the
  player treats a key bound to "none" that way. (all shows, task 22)
- Sound: PLAY_ALL.SH3 is the only sample show with sound slides (1 WAV,
  6 MIDI). RIMSHOT.WAV is RIFF/WAVE PCM, mono, 11025 Hz, 8-bit; the MIDI
  files start with "MThd". Its menu jumps past all 7 sound slides and off
  the end of the show, so sounds must keep playing after the show ends.
  (PLAY_ALL.SH3, task 24)
- Button charts: 199 sample charts name one (GALBUTN1 or GALBUTN2); both
  are full-page drawings with no palette, placed without a transform.
  GALBUTN1's nine squares frame GALA1's nine pictures exactly. In GALLERY
  and its nested shows, 1,913 of 2,159 button-table entries now have a
  clickable object; the rest are 214 empty names and 32 "edit"/"editcler".
  (all charts and shows, task 20)
- Open question: on the 163 data charts using GALBUTN2, its black bar
  (page y 10170 to 12194) covers most of the title, whose area 804 runs
  8995 to 12041. Either the original draws the bar under the chart, or
  shows these charts smaller below it. Needs a screenshot of GALD111 from
  the original program (SPEC §7.3). (task 20)
- Chart data (all 171 data charts, task 11; SPEC.md §5.3–5.4 updated):
  parsed with no warnings and checked against the drawn copies. Pie
  slices sweep exactly value / total × 360° (76 of 76) and the explode code
  matches; bar heights are proportional to values (122 series; 94 more as
  100% stacked bars); org names, table cells and bullet markers all match.
  Corrections: pie titles are keyed by column; 914 has stored tree links
  and the order rule was wrong; 1108 is one entry per row; 1208/1214 are
  page-percentage columns and row bands; 1212 is a value-range colour table.
- Displays (research from the 3.0 and 3.05 installer scripts and SPC's
  1991 hardware requirements; no driver code examined): EGA, EGA
  Monochrome and VGA in 3.0; Hercules added by 3.05; no CGA, MCGA, 8514/A
  or SVGA; a 256-colour VGA driver was planned but not shipped. The
  Projector supports the same displays. How colour charts were drawn on
  the monochrome drivers is undocumented. MONOCHRB/MONOCHRW are greyscale
  palettes (13 and 16 greys) for authors to pick, not a screen mapping.
  The sample set has no .SC3/.CLR/.B&W files. (CGA research)

### Samples

Shareable samples go in `samples/`. Samples that may not be shared go in
`samples-private/`, which git ignores; the regression suite (task 26) uses
them when present.
