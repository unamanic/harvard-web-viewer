# File format notes

Working notes on the binary formats this project decodes. Record only what has
been **verified against real sample files**, and cite the file you checked.

Keep this file in sync with the code: any change that confirms, corrects or
adds to what we know about a format updates this file in the same commit.

## Harvard Graphics 1.0 and 2.x (DOS)

The clean-room specification is [SPEC-HG1-HG2.md](SPEC-HG1-HG2.md); the
reader and layout code is `src/formats/hg2/`, and the test charts are
`samples/hg1-hg2/` (checked by `src/formats/hg2/hg2.samples.test.tsx`).

### Status

| Area | Spec section | Implemented | Verified against samples |
| --- | --- | --- | --- |
| 1.0 charts (`PCOK`, fixed 4716 bytes) | §2 | Read and laid out from data: text, bar/line, pie, org | All 50 1.0 test charts read and draw with no unexpected warnings |
| 2.x charts (`Falc` records) | §3, §4 | Read and laid out from data: title, list, bullet, column, free form, bar/line, area, high/low/close, pie, org, multiple | All 201 2.x test charts read and draw; 2.10 and 2.12 resaves read the same as their 2.30 originals |
| Text | none (fonts not decoded) | Drawn with our HWV Sans clone faces (regular, bold, italic, bold italic by the character attributes), measured from their advances; CSS Helvetica/Arial with a 0.6 em width estimate until the faces load | Not against the programs: there are no reference renders of 1.x/2.x screens |
| Annotations (1.0 trailer, 2.x tag 300) | §2.6, §3.1 | Not decoded; a warning says so | No test chart has any |
| 1.0 and 2.x slide shows (`.SHW`) | §5 | Read and played: play order, times, default row, draw/erase effects (Weave and Rain drawn as Blinds and Fade), HyperShow keys, nested shows, PCX slides; a missing file shows as a note | The eight one-setting 2.30 test shows in `samples/hg1-hg2/shows/` (`src/formats/hg2/show.test.ts`); the 1.0 and 2.30 story shows play as 20 slides |
| `HG.DIR` / `HPG.DIR` | §5 | No (not needed: charts carry their own class) | No |

### Verified findings

- 2.x tag 121 holds the axis minimums at 4/8/12 (X/Y1/Y2), maximums at 16/20 and increments at 28/32 for X/Y1, one field later than the first version of the spec said (BXMIN, BXMAX, BXINC, BY1MIN, BY1MAX, BY1INC, BY2MIN).
- 2.x tag 120 byte 45 is the data table (1 normal, 2 framed, 3 none) and byte 14 the plot background colour; both are drawn (BDT1, BDT2, BFRB).
- The org chart options tail bytes +22/+23 limit the text lines in each box (OB2); +4 is the number of levels shown (1.0 O1).

### Assumptions [I]

Listed in `src/formats/hg2/assumptions.ts`: the colour set (no file stores
colours), text size as percent of page height, the black screen, the
average character width used for layout, the pie direction
(counter-clockwise from the start angle), column-chart cells read row by
row, and multiple-chart slot boxes as (x, width, y, height) with y up.

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
| Charts (.CH3) | §5 | Parsed and drawn from the object layer, embedded charts included (tasks 9, 10, 12, 13, 13b, 13c); laid out from data when they have no drawn copy (tasks 14 to 19; XY task 17) | All 238 sample charts parse and render; visually checked by type |
| Shows (.SH3) | §4 | Parsed and played (tasks 21, 22); transitions decoded and drawn from the file (erase then draw, directions, speeds, timed slides); WAV sound plays, MIDI not (24); button charts drawn and clickable (20) | Yes: all 13 sample shows play to the end |
| PCX bitmaps | §6.3 | Yes (task 8) | Yes: all 69 sample .PCX/.PCC decode with no warnings |
| Speedo fonts (.SPD) | §2 | Reader (task 7b); draws chart text when loaded (task 7f) | Yes: all 15 sample fonts decode with no warnings |
| FN3 stroke fonts | §7.2 item 8 | Not yet documented | No |
| ZIP archives (not an HG format) | — | Unpacked in the browser (src/files/zip.ts): stored and deflated entries, ZIP64, CP437 or UTF-8 names; encrypted entries and other methods are skipped with a note. An archive's files join the set under its path, so references resolve inside it | Unit tests, and the claude-vs-codex show zipped by Info-ZIP and Python (streamed and ZIP64 too) opens with every chart and picture found |

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
- 1555 is 16 entries of 0xFF R G B: the 16 colours the VGA ScreenShow
  driver loads into the DAC for charts with this palette (confirmed by the
  reference renders; the earlier reading "not a display mapping" was
  wrong). 25 palettes share HG3's set; 1HDW, 6HDW, 8HDW and 12HDW change
  some slots (e.g. 1HDW slot 12 = dark blue). Palette colours are matched
  against the standard set, then shown with the chart's DAC, so an entry
  such as 12HDW's "Blue-gray D" stored as (255,0,255) means "slot 12".
  (all palettes, task 6; reference renders)
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
  src/formats/charset.ts; SPEC.md §1 and §6.4 updated. All parsers now
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
- Resolved from the reference renders: a data chart with a button chart
  is shrunk uniformly to fit the page below the button bar (scale
  22458 / 24576 = 0.914 for GALBUTN2's bar bottom at y 10170), centred
  horizontally, and the button chart is drawn unscaled on top. Drawings
  (all 35 GALBUTN1 hosts) are not shrunk. 652 of 656 measured box edges
  land within 3 px of the reference. The page frame (802, role 14) is not
  drawn in any reference. (all button-chart samples, task 20 follow-up)
- 0x1120 is an outline width in page units (294 → about 6 px). 0x10A0/
  0x10A1 trailer u16 at offset 4: 1 straight, 0 smooth; a curve right
  after a 0x1050 polyline in the same object duplicates it (the polyline
  is the drawn line). The trailer u16 at 2 (0–4) is likely a point marker
  shape (markers are not drawn yet). (reference renders, task 20 follow-up)
- Sound is a 3.05 feature: the 3.0 installer has no sound drivers; the 3.05
  installer offers SoundBlaster and "all sound drivers" and installs
  RIMSHOT.WAV; its READ.ME adds Pro AudioSpectrum drivers. Previewing a
  sound slide without a driver shows "The sound driver has not been
  loaded." (installer scripts, READ.ME, reference renders)
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
- Layout from data (title, bullet, table charts; task 14/15/19) matches the
  stored copies: slot 1/2 text dx 0, dy ≤ 45 units on all 171 data charts;
  GALD151 and GALD171 within 2 units; bullets within 75. Fitted rules:
  text box height floor(1.285 × em / 100) × 100; rows overlap by 0.15 of
  the next row's height, a blank row is 1 em; non-title data charts draw a
  role 18 line under the title area; bullet marker column + 0.143 em gap +
  widest line are centred as one block; table numeric cells right-aligned,
  inset 0.1 em, a role 18 rule under the header band, range backgrounds
  outlined in role 32. Unexplained: LANDSCAP/PORTRAIT middle line sits 1.5
  blank rows higher; GALD181 cells drawn at size 6.19 though stored as 10;
  HELP1's copy is laid out at 8/9 scale though its runs say size 3 (its
  stored copy overlaps when drawn as stored). (task 14/15/19)
- Letter pages: units are square. The long side is 32768 units and the
  short side 32768 × short/long inches (25321 on Letter), so drawing reaches
  y ±12406 to ±12660; text sizes are a percentage of that short side.
  Fixed in task 12b: the viewBox comes from 816, nothing on the Letter
  samples is clipped beyond label glyphs touching the edge (18 to 37
  units), and the 220 charts with 10 × 7.5 in pages are unchanged. The
  gallery button bars start 171 units left of the page on every page size.
  Open: the 1214 table percentages on a portrait page are unverified (no
  portrait table in the samples). (tasks 14/15/19 and 12b)
- Pie and organization charts from data (tasks 16, 18) match the stored
  copies: slice centres, radii and angles within 1 unit / 0.1°, 3-D bands
  exact, walls within 9 units; org boxes and connectors within 1 unit.
  Decoded [I]: 1304 byte 5 = slice outline role, byte 6 = column connector
  role; 1310 byte 17 = 2 shows percentages only; labels "name / NN%"; 3-D
  wall brightness trunc(90·|cos a|) (× 0.75 on the far half), bands 50%;
  912 = box width and height as % of the short side; 910 byte 0 = box
  style (2 square, 4 rounded, 6 drop shadow, size 0.1 × box height),
  bytes 1–3 fill, outline and line roles; 904 u16 at 2 = 3 boxes the last
  level, else it is a name list. Org text uses one chart-wide size factor
  (rule not fully known). (pie and org samples, tasks 16, 18)
- XY charts from data (task 17) match the stored copies of the 141 sample
  XY charts: 92 exactly (every text within 40 units, every shape's
  bounding box within 40), 18 more within 400 units, 17 partly, 14 not
  (paired bars, horizontal 3-D drop-shadow bars, a time-of-day X axis,
  one hidden Y2 axis, one 3-D 100 % chart's depth). Decoded [I]: 1408
  bytes 0, 1, 10, 11, 12, 13 and f32 at 2, 6, 15, 19 (see SPEC §5.4); 1406
  byte 10 line style (straight, trend, curve) and byte 13 line colour;
  1402 byte 1 = 2 log scale; 1410 byte 0 data table, byte 2 value labels;
  1414 byte 0 = 13 numeric X; 1418 byte 1 bottom-up legend. Rules: frame
  margins 9 % of the plot (4.5 % at the bottom) plus label sizes; axis
  step = range / 5 rounded to 1, 2, 5 × 10^k (geometric midpoints), top
  the next step above max + 3 % of the range; label boxes are each
  character's advance rounded up to 50 units; bars fill 85 % (1408) of
  the slot; 3-D walls offset up-right by depth % × frame height, one depth
  lane per line, bar group (per series if overlapped) and area (one for
  stacked areas), front to back lines, bars, areas, the solid part
  centred in its lane at 1408 f32 at 15 %; 0x1070 style 6 boxes are the
  3-D bars. Copy quirks not reproduced: 3-D pyramids show a left face on
  the first bar only (more in overlapped lanes); I-bar high/low marks are
  stored twice. (all XY samples, task 17)
- Pie fallback from the 3.05 option records (task 16; test charts in
  samples/option-tests/pie, checked with `yarn copycheck`): records 1304
  to 1316 are parsed as SPEC §5.4 gives them, and the layout uses the
  starting angle, sort (largest first, ties in data order, colours kept),
  pie size as a share of area (radius × √(size/100)), cut slices (0.5 r
  out), show pie, show as column, slice pointer None/Short/Long, show
  slice labels, slice values and percents (show, place, currency,
  decimals, scale, leading and trailing text), the outline and link-line
  roles, and the legend for locations 5 to 8. Pixel difference from the
  drawn copy: about 4 to 20 % before, 0.2 to 1.8 % after on every test
  chart except PFILLP/PFILLB (the copy's 0x1032 pattern arcs are not
  drawn yet); the 10 sample pies are unchanged. Label text [C]: line 1 is
  the name, plus Adjacent items after two spaces ("Alpha  40"); line 2
  is the Below items joined by two spaces ("40  40%"); Inside items form
  their own block at 2/3 r. A value is leading text, "$", value ÷ scale
  with its decimals, trailing text; a percent is leading text, the
  number, trailing text, then "%" ("40XY%"). 1310 byte 17 is Show slice
  labels, not "percentages only": GALD291 shows percents because its 1312
  says so. Long pointers add a horizontal tail 0.3 r long [C]; Medium is
  drawn like Short [?]. Label boxes are placed by the slice middle in
  eight sectors (beside at 333–18° and 162–198°, centred above at
  72–108°, centred below at 260–280°, a corner at the leader end
  otherwise) [I]. Sizes fitted to the test charts, used on Letter pages
  only [I]: flat radius 0.34 × min(h, column) with two label lines and
  0.40 with one, 3-D rx 0.44 h, a cut slice shrinks the pie to 0.7. The
  10 × 7.5 in samples need 0.32, 0.42 and 0.85, so those stay for other
  page sizes (an older layout build; see below). Legend [C for PLEG to
  PLEGL3]: the box is area 810 in the 1306 byte 4 and 5 roles, one entry per slice of
  the first pie (swatch and name), a column for locations 5 and 6, a row
  for 7 and 8. (pie option tests, task 16)
- XY fallback from the 3.05 option records (task 17; test charts in
  samples/option-tests/xy): 1402 to 1418 are parsed as SPEC §5.4 gives
  them, and X labels are read from 1426 (3.05) before 1422. Mean pixel
  difference from the drawn copy over the 105 test charts went from
  5.8 % to 2.6 %; over the 141 sample XY charts from 4.0 % to 3.7 %, none
  worse. Number format [C]: labels show value ÷ scale factor with the
  axis unchanged; percent is value × 100 then "%"; currency puts "$"
  first; scientific is "3.500E+01" (3 decimals when blank); set decimals
  are fixed, blank decimals use what the value needs; the thousands
  separator is ","; leading text first and trailing text last; the minus
  sign goes before "$" [I]. Formatted labels count at full width when the
  frame is placed. Axes [C]: a set major increment changes only the tick
  step; the X maximum has no effect on a category axis; major ticks are
  0.02 × the frame width, minor 0.01, In/Out/Both as named; labels move
  out by an outward tick; "show axis labels" No frees the room. Minor
  ticks every fifth of the major step when blank [I]; outward major ticks
  move the frame edge in by 299/26615 of the plot width [I, one value].
  Dotted grids are stored as dashes 0.309 × pitch long every pitch, pitch
  0.013542 × the page's short side, none where a frame edge is [I].
  Frame [C]: 1404 outline role colours edges, grid, ticks and table
  lines; the fill role fills the frame, and 1405 No leaves it unfilled.
  Series [C]: hidden series are not drawn and give up their cluster
  width but keep their legend row; cumulative series are running sums;
  in a cluster Y1 bars come before Y2 bars. Data labels need both 1410
  byte 2 and the series byte 5 [I]; the table lists a series only when
  its byte 6 is Yes [I]. Style: byte 24 outlines bars and legend swatches
  [C]. Data table [C]: series swatches appear in it exactly when the
  legend is off; without them the box starts at the plot's left edge,
  unfilled, gap 0.0225 × H under the X labels; grid 1 draws column lines,
  grid 2 row lines; Table only fills the plot area down to 0.05 × H above
  its bottom. The legend always sits in area 810, which the original
  sizes from placement and location. Read from the drawn copy of a "next
  choice" value, so [I]: frame style 2 draws only the left and bottom
  edges (XFRST); 2D style 2 adds drop shadows 0.15 × the bar width right
  and 0.15 × its height down in role Shadow (XS2DST); legend frame style
  1 draws no box with items flush left (XLEGOC). (XY option tests,
  task 17)
- Answered by the later 3.05 test charts (SPEC §5.5, "Layout rules
  measured in 3.05"): the larger text on the Letter test charts, the title
  sitting 100 units high, and the pie shares 0.32/0.42/0.85 in the
  10 × 7.5 in samples all come from the samples being laid out by an older
  build, not from page size; the bottom-up legend order follows Stack and
  100 % bar styles, not 1418 byte 1; fill style Pattern with pattern 0 and
  the data table with swatches are given there too. (option tests)
- The fallback follows those 3.05 rules on every page size (task 3.05
  layout): text em = size % of the short side rounded down, ascent the em
  rounded up to 100, line box (1.25 × em + 50) rounded up to 100, which
  puts title, label and table rows where 3.05 puts them (the sample-fitted
  1.285 rule stays only for object-layer text without line entries); pie
  shares 0.34 / 0.40 / 3-D 0.44 / cut 0.7 whatever the page; a column
  legend (and the data table) lists the series bottom-up only for Stack and
  100 % bars; a goal range draws its band only with both bounds set (it was
  not drawn before); fill style Pattern draws pattern 0 as a solid white
  shape with a white outline and Both as a solid shape in the slice or
  series colour, while other pattern numbers leave the shape unfilled with
  its outline, because the patterns themselves are not drawn yet [?]; the
  data table with swatches starts at the plot's left edge, unfilled, with
  the same gap above it as a table without swatches (its name padding is
  fitted to XMLEGNO and comes out about 125 units wide on Letter). Pie
  labels already put the value before the percent. Not covered yet: axis
  frame styles X, Y and None (3 to 5), 2D styles Link and Horizontal, the
  patterns, and record 1414. (3.05 layout)
- Stored-copy drawing corrections (task 13d, fixed): each text line entry
  stores the copy's own line box and em, so lines are drawn there (79
  multi-line blocks: error 240 → 0 units); HELP1's 8/9 scale is its
  stored em (675 vs 760), and the overlap is gone. Box style 5 is a drop
  shadow and style 6 a 3-D box (the 3-D bar style); the 126 boxes whose
  bounding boxes looked "off" are that extent. PLAY_ALL stores taller line
  boxes than the stacking rule gives. Open: GALC37's 3-D bars are deeper
  than wide (c = 1797); unconfirmed without a reference render. (task 13d)
- Reference renders from the real program (samples-private/renders/,
  private; HG 3.05 in DOSBox-X, VGA ScreenShow driver, 640×480; every
  chart and every show row; see its NOTES.md):
  - The VGA ScreenShow driver loads 16 colours into the DAC (the
    palette's 1555 record; for most palettes black, white, red, orange,
    yellow, yellow-green, green, spring green, cyan, azure, blue, violet,
    magenta, rose, grey 85, grey 170). Every other colour is dithered on
    a screen-aligned 4×4 Bayer matrix in 8 levels, up to three colours per
    tile: white share round(8·min/63), black share round(8·(63−max)/63),
    the rest one of 24 hues (odd steps split between neighbours), grey
    when white and black meet. Text and lines are dithered too; the page
    background is cleared to one solid colour. The rule reproduces 99.71%
    of fill pixels in the references (src/render/vgaScreenShow.ts).
  - GALD111: the gallery key bar does not cover the chart title (the
    button chart's box is not drawn over the slide).
  - GALC37: the deep 3-D bars (c = 1797) are correct.
  - Transitions: the sample shows use only Draw = Replace and Overlay;
    direction, speed and erase are blank everywhere; Time only on
    PLAY_ALL's sound rows (0:00). Decoding other values needs files made
    with one setting changed at a time.
  - Show context does not change drawing (221 of 240 slides
    pixel-identical to the standalone chart; the rest differ only on
    glyph edges).
- Fixes from the reference renders (harness median per-chart difference
  3.28% → 1.04%, p90 6.25% → 1.88%): palette 1554 is the page background
  (mode 1 plain / 2 shaded, colour 1 at the top); 0x1110 gradient angle in
  tenths counter-clockwise from up, across the bounding box; VGA gradients
  dither in 64 levels on an 8×8 matrix; monochrome bitmaps draw black
  pixels in the 0x110C colour and white in 0x110B, at native pixel size,
  tiled from the 0x1140 hot spot on the box centre; box style 5 is an extruded 3-D box (faces 25%
  and 50%), style 2 a double outline; paper code 1 with a 10×7.5 in page
  shows the Letter area at 0.971; button-bar fit 440/480 rows; baseline =
  line top − stored ascent; glyph advances round up to screen pixels;
  0x112B = line style (1 dotted); 0x10A0 trailer = marker size and shape.
  Open: PLANET's sphere, PALVIEW's dot period, partly
  yellow titles in GALD721/852. (reference renders)
- Transitions decoded (renders/transition-tests, 52 shows saved with one
  setting changed at a time): 702 offsets 5–7 Draw effect/direction/speed,
  8–10 Erase (plus Keep), 11/12 key and button counts, 14 display time in
  seconds (0xFFFF wait); 708 byte 2 = HyperShow recalculation. All 52 test
  shows decode to their README settings; the 13 sample shows use only
  Replace (373 slides) and Overlay (44). SPEC.md §4 updated. (test shows)
- Monochrome and EGA, fitted to renders/hercules and renders/ega (harness
  median per-chart difference: Hercules 8.36% → 2.16%, EGA 5.14% → 2.45%):
  - Hercules (720×348, pixels about 1.55× taller than wide): each colour
    becomes one of 9 patterns on the 4×4 Bayer matrix by brightness only,
    level floor((floor(luma/4) + 3) / 8), level L lighting 2·L of 16 cells,
    aligned to the screen; hue and the palette's screen colours don't
    matter. Thin lines and outlines (up to about 1.5 px) are solid white,
    or black at level 0; thicker strokes are patterned. Gradients use 64
    levels on the 8×8 matrix. Flat fills match 99.98% of pixels.
  - EGA (640×350, pixels 1.37× taller): dithers exactly like VGA
    ScreenShow (same 16 slots and rules), each slot shown as the nearest
    of the 64 EGA colours.
  - Bitmaps are now drawn at native screen pixels, tiled, with each pixel
    dithered as a fill (FLOOR VGA 23.9% → 0.09%, EGA 8.3% → 0.6%). Open:
    1-px page-mapping offsets on the 348/350-row screens (Hercules FLOOR
    still 19.8%; text 2–3 px off); EGA PLANET's colours; ROCKTOP's
    (255,255,211) shows 4/16 yellow on white where the fill rule gives 2/16.
    (Hercules and EGA reference renders)
- Fitted bitmaps (samples/claude-vs-codex, real HG 3.05 screenshots,
  shareable): 0x1140 byte 3 = 2 draws the bitmap once, stretched to its
  box, not tiled (byte 3 = 0 in all four disk bitmap samples: native,
  tiled). Nearest-neighbour at screen pixels, box pixel i → bitmap pixel
  round(i·n/D), halves down; matches all 10 picture slides pixel for pixel
  in the picture area (CVCP01–10: 11.8–18.2% → 0.8–2.3%, the rest is
  text). The show stores bare chart names; the charts link their PCX by
  full DOS path, resolved by base name.
- Line widths: a 0x1120 width over half a screen pixel is drawn at least
  2 px (CVC06). 1406 byte 12 ≈ 0x1120 width / 25.
- Open: text in a dithered colour uses a dither aligned to each glyph,
  not the screen (explains the partly yellow titles in GALD721/852 and
  CVC01/07); small-size glyph advances are 1–4% wider than HG's
  (CVC02/05/09); CVC07's table text looks bold with the same font key as
  thin text.

### Samples

Shareable samples go in `samples/`. Samples that may not be shared go in
`samples-private/`, which git ignores; the regression suite (task 26) uses
them when present.
