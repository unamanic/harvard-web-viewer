# Harvard Graphics 3.05 file format spec

Nov 24, 2026 · @William Witt

## 1. Scope and how to read this spec

This document describes the files read by the Harvard Graphics 3.05 (1992, DOS) Screen Show Projector, and how a viewer should present them, so that a new viewer (for example in a browser) can be written without reference to the original program code.

**What it covers**

- The record container shared by every Harvard Graphics 3 document file.
- Show files (.SH3): the slide list, file references, keys and HyperShow buttons.
- Chart files (.CH3): page setup, text, chart data for each chart type, and the drawn object layer.
- Palette files (.PL3, .PC3): colour roles and RGB values.
- The coordinate system, colour model, and font and bitmap dependencies.

**What it does not cover**

- The installer, the editor (HG3.EXE) and its own file types, and output drivers.
- Exact pixel output of the original program. No reference renders were available, so drawing rules are given at the level the data supports.

**How this spec was written**

This is the clean side of a clean-room process. The analyst examined the original program and its sample files, and wrote down only behaviour and data layout, in their own words. No program code, disassembly or decompiled code appears here, and none should be sought by the implementer. Enumeration names listed here are the user-visible names the program shows in its menus.

**Confidence marks**

- **\[C\] Confirmed:** checked against every relevant sample file supplied (238 charts, 13 shows, the palettes), or verified by recomputing one field from another (for example a bounding box from geometry).
- **\[I\] Inferred:** consistent with the samples but not proven; a reasonable reading that a viewer can start from and adjust.
- **\[?\] Unknown:** the field exists and its size is known, but its meaning is not. A viewer should read and skip it.

**Conventions**

- All integers are little-endian. u8/u16/u32 are unsigned; i16 is signed 16-bit.
- f32 and f64 are IEEE 754 single and double precision, little-endian.
- A "string" is NUL-terminated 8-bit text. Codes 0x20 to 0x7E are ASCII; the upper half is the Harvard Graphics character set, which is close to code page 850 but not the same (see 6.4). Earlier drafts said code page 437; the font index shows otherwise. A "padded string\[n\]" occupies exactly n bytes, NUL-terminated, with the rest filled with NUL or spaces.
- Offsets are in bytes from the start of the record's data, not counting its 4-byte header.
- Tag numbers are given in decimal; sub-tags inside objects are given in hexadecimal (0x1050), because they are easier to read that way.

## 2. The Projector and the files it uses

The Projector (HG3SHOW) plays a screen show: it opens a show file, then displays each slide in turn, with a transition, until the show ends or the viewer quits. Each slide is normally a chart file; a slide may also be another show, a sound file or a bitmap. Keys and HyperShow buttons can jump between slides.

**Files a viewer needs** \[C\]

| File | What it is | Needed by a modern viewer? |
| --- | --- | --- |
| \*.SH3 | Show: ordered list of slides plus key and button tables | Yes |
| \*.CH3 | Chart: one page of text, chart data and drawn objects | Yes |
| \*.PL3 | Palette: named colour roles and their RGB values | Yes (charts name one, usually HG3.PL3) |
| \*.PC3 | Custom palette, same layout as PL3 | Yes, if referenced |
| HG3.FGF | Font index: maps a font key to a font file and a character table | Yes, or an equivalent built-in table |
| BX\*.SPD | Bitstream Speedo outline fonts (Swiss 721, Dutch 801, Geo Slab 712, Monospace 821) | Yes, or substitute fonts |
| HG?LITE.FN3, HG?BOLD.FN3 | Harvard Graphics stroke fonts (Roman, Sans serif, Script, Gothic), descended from the public-domain Hershey fonts | Yes, or substitute fonts |
| \*.PCX, \*.PCC | ZSoft PCX bitmaps used as backgrounds, patterns and logos | Yes, if referenced |
| \*.WAV, \*.MID | Sounds a show can play | Optional |
| \*.SY3 | Symbol libraries for the editor | Not needed for playback (symbols are copied into charts) \[I\] |
| \*.SC3, \*.CLR, \*.B&W, \*.IN3 | Screen drivers (EGA, EGA Monochrome, VGA, VGA ScreenShow, and Hercules from 3.05; no CGA), per-resolution screen colour setups for the program's interface (640X350.CLR, 640X350.B&W, 640X480.CLR, 720X348.B&W; likely icon artwork), input-device drivers for DOS | No |
| HG3SHOW.CF3 | Plain-text settings (work, font and data directories, memory use) | No; a viewer can take paths from its own settings |
| HG3.ERR | Message text for errors | No; see section 7 for the error cases |

File names inside documents are stored in upper or lower case without a directory. Resolve them case-insensitively, first beside the file that names them, then in a configured data directory, then in the font or palette directory. \[I\]

**Font index (HG3.FGF)** \[C\]

- Starts with the 4 ASCII bytes "IDXF" and a u16 entry count (22 in the sample). Entries follow immediately, at offset 6.
- Each entry is 0x24C (588) bytes long. Within an entry:
  - offset 0: u16 font source: 3 = Bitstream Speedo outline font, 2 = Harvard Graphics stroke font.
  - offset 2: u16 font number (for Speedo fonts, the number in the file name BX000nnn.SPD).
  - offset 4: u16 style word (see below).
  - offset 6: 4 bytes of classification \[I\]: byte 0 flags (bit 0 italic, also set for HG Script; 0x04 serif, 0x02 monospace, 0x08 Gothic), byte 1 a generic family (0x02 serif, 0x04 sans, 0x08 monospace, 0x10 script, 0x20 decorative), byte 2 the weight class (always the style word's low byte shifted right by 4), byte 3 always 0x08.
  - offset 10: padded string\[48\], the display name, "Family|Style" (for example "Dutch 801|Bold").
  - offset 58: padded string\[18\], the font file name.
  - offset 76: 256 u16 values, one per character code 0 to 255, giving the font's own character identifier; 0xFFFF means the font has no glyph for that code. \[I\]
- The style word: bit 0 set means italic; the low byte encodes weight (0x28 thin, 0x48 light, 0x58 bold for stroke fonts, 0x68 regular, 0x78 medium, 0xA8 bold; HG Gothic Bold is the one entry whose name disagrees, using 0x78); the high byte is 0x42 for Speedo fonts and 0x58 for stroke fonts. \[I for the meaning of individual bits, C that the triple identifies the entry\]

A document names a font by the triple (source, number, style word), called the **font key** in this spec. A viewer finds the matching FGF entry and draws with that font. The sample charts use two keys: (3, 3, 0x4268) = Swiss 721 Roman, used almost everywhere, and (3, 13, 0x42A8) = Dutch 801 Bold. \[C\]

The FGF character map values for Speedo fonts are indexes into the Speedo file's character directory. The sample .SPD files are format "D1.0" with 1000 outline units per em, and their character data is encrypted with keys that can be recovered from the file itself (the header stores the file size both plainly and encrypted). \[C\] Speedo font files follow Bitstream's published Speedo format, which open-source font libraries (for example FreeType's historical Speedo driver and the X11 Speedo rasteriser) can read. The FN3 stroke fonts start with the ASCII signature "FNTF" and a name and credit line; their glyph layout has not been documented here (see section 7).

## 3. Common file structure

Every Harvard Graphics 3 document (chart, show, palette) has the same outer form. This section is confirmed against all 288 document samples (238 .CH3, 13 .SH3, 32 .PL3, 5 .PC3): each one parses exactly to its last byte with the rules below. \[C\]

**Signature**

The first 4 bytes are ASCII:

| Signature | File kind |
| --- | --- |
| HGB3 | Chart (.CH3) |
| HGB1 | Show (.SH3) |
| HGA2 | Palette (.PL3 and .PC3) |

**Records**

After the signature comes a sequence of records, each:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 | Tag: what the record is |
| 2 | u16 | Length of the data that follows, in bytes (may be 0) |
| 4 | bytes\[length\] | Data |

Read records one after another. The stream ends with a record of tag 1 and length 0, which is also the end of the file. A reader should skip any tag it does not know, using the length, so that unknown records never stop playback. \[C\]

**Version record (tag 0)** \[C\]

Always the first record, 4 bytes: u8 major version (0), u8 3, u8 0, u8 document type. Read the first three bytes together as "version 3.0". The document type byte says what the file holds:

| Type | Document |
| --- | --- |
| 0x01 | XY chart (bar, line, area, high/low/close, point and their mixtures) |
| 0x15 | Pie chart (pie, column, proportional pies) |
| 0x1A | Organization chart |
| 0x1F | Title chart |
| 0x20 | Bullet (list) chart |
| 0x21 | Table chart |
| 0x29 | Drawing (free-form drawn objects only) |
| 0x2E | Show |
| 0x33 | Palette (.PL3) |
| 0x34 | Custom palette (.PC3) |

The chart type names are confirmed by which data records appear in each file and by the tutorial and gallery file names (for example PIETUT.CH3 is type 0x15 and ORGTUT.CH3 is type 0x1A). Gallery templates of other kinds (area, high/low, multiple pies) use the same codes with different style settings. \[C for the listed codes; I that no other codes exist\]

**Block markers** \[C\]

Some tags come in pairs that open and close a block, with no data of their own. Blocks nest. A reader can treat them as grouping only.

| Open | Close | Encloses |
| --- | --- | --- |
| 500 | 501 | Document header (description and header data) |
| 504 | 505 | Chart page: everything drawn on the page |
| 508 | 509 | Chart text and chart data (inside 504/505) |
| 516 | 517 | Drawn object layer (inside 504/505), see 5.6 |
| 520 | 521 | Show body: the slide list |
| 524 | 525 | Palette body |
| 608 | 610 | A group of drawn objects (may nest) |

Two open tags are exceptions and carry 16 bytes of data: \[C for the lengths, from all 237 516 records and all 213 608 records in the samples\]

- 516 opens the object layer: two bounding boxes of four i16 each (x1, y1, x2, y2) \[I: the first is the extent of all objects, the second is the canvas\].
- 608 opens a group of drawn objects: 16 bytes \[? meaning; likely the group's bounding box, as for 516\].

**Header records (inside 500/501)**

| Tag | Data | Meaning |
| --- | --- | --- |
| 400 | string | Document description as typed by the author; may be empty \[C\] |
| 402 | 684 bytes | Present in charts only; all zero in every sample \[?\] |

**File reference (tag 404)** \[C\]

Used in charts and shows to name another file:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 | Reference kind |
| 2 | u16 | Index (slide number for kind 20, otherwise 0) |
| 4 | string | File name, no directory |

| Kind | Found in | Names |
| --- | --- | --- |
| 1 | Charts | A chart drawn as a button face \[I\] (galbutn1.ch3, galbutn2.ch3) |
| 2 | Charts | The chart's palette file (HG3.PL3, MONOCHRW.PL3 and so on) |
| 4 | Charts | Another chart embedded in this one: in the object layer, a 616 transform, a 404 kind 4 and an empty 608 group place that chart, scaled, on the page (LDOUBLEP, LFOURL, PDOUBLEL, PFOURP embed PORTRAIT.CH3 and LANDSCAP.CH3) \[I\] |
| 5 | Charts | A bitmap used by a drawn object, such as a background or pattern fill (.PCX, .PCC) |
| 20 | Shows | The file for one slide; the index is the slide number |

When a chart has no kind 2 reference, use HG3.PL3 as its palette. \[I\]

**Number formats seen in data** \[C\]

- Page coordinates and point lists: i16.
- Chart values and text sizes: f32 in some records and f64 in others, as given per record.
- An f64 with the bit pattern 0xFFF0000000000000 (negative infinity) means "not set; choose automatically", for example an axis minimum. \[I\]

## 4. Show files (.SH3)

### 4.1 Layout

A show is signature HGB1, version record type 0x2E, a header block (500, 400, 501), then the show body (520 ... 521), then the end record. \[C\]

The show body starts with four settings records, then one group of records per slide, in slide order:

| Tag | Size | Meaning |
| --- | --- | --- |
| 708 | 3 | Show settings. Byte 2 (file offset 0x23): HyperShow automatic recalculation, 1 = Yes, 2 = No \[C\]. Byte 0 went from 1 to 0 after the first edit of a show \[?\]; byte 1 \[?\]. "00 01 02" in 10 sample shows, "01 01 01" in 3 |
| 710 | 1941 | Show settings; mostly zero. Non-zero only at offsets 0 to 2 (value 2) and at 4 + 323k (value 16), suggesting six 323-byte entries, 1 to 6 in use \[?\] |
| 712 | 52 | 4 bytes (02 02 02 00 in every sample) \[?\], then three 16-byte text style entries (format in 5.3) \[I: styles for show-level text\] |
| 714 | 2 | Show settings; 02 02 in every sample \[?\] |
| 702 | variable | Slide entry: starts a slide's group |
| 404 | variable | File reference, kind 20: the slide's file (optional) |
| 704 | variable | Key table for the slide (optional) |
| 706 | variable | Button table for the slide (optional) |

A slide's group is its 702 record and every 404, 704 and 706 record after it up to the next 702 or the end of the body. \[C\]

### 4.2 Slide entry (tag 702)

Length is 103 bytes when the description is empty, longer otherwise. \[C\]

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | u16 | Slide number, counting from 0 in file order | C |
| 2 | u8 | Kind of slide (table below) | C |
| 3 | u8 | 0, or 1 on sound and MIDI slides \[?\] | ? |
| 4 | u8 | 0; 3 on every slide 0 and some chart slides; 255 on sound and MIDI slides \[?\] | ? |
| 5 | u8 | Draw effect (4.5). 0 = blank: use the show default, which slide 0 holds in this byte (1 = Replace in a new show) | C |
| 6 | u8 | Draw direction: 0 blank, 1 Left, 2 Right, 3 Up, 4 Down, 5 In, 6 Out | C |
| 7 | u8 | Draw speed: 0 blank, 1 Slow, 2 Medium, 3 Fast | C |
| 8 | u8 | Erase effect: the Draw codes, plus 10 Keep | C |
| 9 | u8 | Erase direction (codes as offset 6) | C |
| 10 | u8 | Erase speed (codes as offset 7) | C |
| 11 | u8 | Number of HyperShow key entries (704) for this slide. Equals the 704 table length, except in 10 sample tables that hold one entry with neither a character nor a scan code, which is not counted | C |
| 12 | u8 | Number of HyperShow button entries: the 706 length / 14 in every sample | C |
| 13 | u8 | Zero in samples | ? |
| 14 | u16 | Display time in seconds (the editor shows m:ss; 0:05 = 5, 1:30 = 90, 5:59 = 359). 0xFFFF = blank: wait for a key or click. 0 = continue at once (the 7 sample sound and MIDI slides) | C |
| 16 | u8 | Almost always 0 | ? |
| 17 | u8 | 0; 1 on most slide 0s; 3 on sound and MIDI slides; 128 once; 0x17 in shows saved by HG 3.05 \[?\] |
| 18 | 84 bytes | Zero in samples | ? |
| 102 | string | Slide description, as shown in the slide list | C |

Kind of slide (offset 2):

| Value | Slide holds | File reference |
| --- | --- | --- |
| 0x2E (46) | A show. Slide 0 is always this kind and has no file: it stands for the show itself. A later slide of this kind names a nested .SH3. | none for slide 0, .SH3 otherwise |
| 0x2D (45) | An empty slide (a placeholder in the list) | none |
| 0x01, 0x15, 0x1A, 0x1F, 0x20, 0x21, 0x29 | A chart of that document type (section 3) | .CH3 |
| 0x09 | A digital sound | .WAV |
| 0x0A | A MIDI music file | .MID |

The kind of a chart slide always equals the document type in the chart file's own version record, so a viewer can trust either. One sample has value 0x9F with no file \[?\]; treat unknown kinds as empty slides. \[C for the table, from 430 slide entries\]

### 4.3 Key table (tag 704)

A list of 4-byte entries; the count is length / 4. \[C for the size\] Each entry assigns a key to a destination:

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | u8 | ASCII character of the key, or 0 for an extended key | I |
| 1 | u8 | PC keyboard scan code for an extended key (0x3B = F1 through 0x44 = F10), or 0 | I |
| 2 | u8 | Destination (4.6) | I |
| 3 | u8 | Not meaningful (varies at random) | I |

An entry whose first two bytes are both 0 (whatever bytes 2 and 3 hold), or whose first byte is 0xFE, is unused. \[I, consistent with the samples\] The key table straight after slide 0 applies to the whole show; a key table after any other slide applies while that slide is showing. \[I\]

Example from the gallery: keys "1" to "9" go to slides 2 to 10, F2 goes to the last slide viewed, F3 to the previous slide and F4 to the next.

### 4.4 Button table (tag 706)

A list of 14-byte entries; the count is length / 14. \[C for the size\]

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | padded string\[13\] | Button name (may be padded with spaces before the NUL) | C |
| 13 | u8 | Destination (4.6) | I |

A button is a drawn object in the slide's chart that carries a name (record 618, see 5.6). When the viewer clicks inside a button object, compare its name with the slide's button table, ignoring case and trailing spaces, and go to the destination. \[I\] Charts can take their buttons from a separate button chart named by a 404 kind 1 reference (the gallery uses galbutn1.ch3 and galbutn2.ch3); draw that chart's objects on top of the slide and use them as buttons. \[I\] A chart that defines buttons also lists their names in record 814 (14-byte entries, same layout). \[C\]

### 4.5 Transitions

The Projector offers these effects, by these names: Replace, Overlay, Wipe, Scroll, Fade, Open, Close, Blinds, Iris, Keep. Some take a direction (Left, Right, Up, Down, or In, Out) and a speed (Slow, Medium, Fast). \[C for the names, which the program shows\]

The drawing editor also animates the objects of one chart, with Draw and Erase steps using Replace, Wipe, Fade, Open, Close and Blinds, and a "Wait for key" or a delay in tenths of a second between steps. \[C for the names\] How these are stored is not yet mapped (see section 7).

Each slide entry stores a Draw setting (offsets 5 to 7) and an Erase setting (offsets 8 to 10): an effect, a direction and a speed (4.2). Effect codes are 1 Replace, 2 Overlay, 3 Wipe, 4 Scroll, 5 Fade, 6 Open, 7 Close, 8 Blinds, 9 Iris, and for Erase only, 10 Keep. Directions are 1 Left, 2 Right, 3 Up, 4 Down, 5 In, 6 Out; speeds are 1 Slow, 2 Medium, 3 Fast. 0 is blank in every field. The editor offers every direction and speed for every effect and fills in none by itself. A blank Draw effect uses the show's default, which is slide 0's offset 5. \[C, from test shows saved by Harvard Graphics 3.05 with one setting changed at a time\] Whether slide 0's offsets 6 to 10 also act as defaults is not known (they are 0 in every sample). \[I\] When the show moves on, the current slide is erased with its Erase effect (Keep leaves it on screen), then the next slide is drawn with its Draw effect. \[I for the order\] In the samples, offset 5 is only ever 0, 1 or 2 (blank, Replace, Overlay) and offsets 6 to 10 are 0. \[C\]

Suggested drawing of each effect, for a viewer, with the old slide A and new slide B:

| Effect | Behaviour |
| --- | --- |
| Replace | Show B at once |
| Overlay | Draw B on top of A without clearing \[I\] |
| Wipe (direction) | A straight edge moves across the screen in the given direction, revealing B behind it |
| Scroll (direction) | B slides in from the opposite side, pushing A out |
| Fade | Dissolve from A to B in small pieces |
| Open | B is revealed from the centre line outwards |
| Close | B is revealed from the edges inwards to the centre line |
| Blinds | B is revealed in stripes, all stripes opening at once |
| Iris (In, Out) | B is revealed through a growing (Out) or shrinking (In) rectangle centred on the screen \[I\] |
| Keep (Erase only) | Leave A on screen; B is drawn over it \[I\] |

Erase effects use the same drawing, changing A into the empty (black) screen; a viewer may treat Overlay as an erase like Replace. \[I\]

Slow, Medium and Fast are the overall duration of the effect; about 1.5 s, 0.75 s and 0.3 s are reasonable. \[I\]

### 4.6 Destinations

A destination byte in a key or button table means: \[I for all rows\]

| Value | Go to |
| --- | --- |
| 0 | No destination (slide 0 is the show itself; many unused key entries point here) \[I\] |
| 1 to below the slide count | That slide number (counting from 0) |
| 0xF3 | The slide viewed before this one (button name "lastview") |
| 0xF4 | The next slide ("nextpal") |
| 0xF5 | The previous slide ("prevpal") |
| 0xF6 | Named "edit"; leave the Projector for the editor. A viewer can ignore it. |
| 0xF7 | Named "editcler"; as 0xF6 \[?\] |
| 0xF8 | The top of the show ("main menu"): back to the outermost show's first slide |
| 0x96, 0x97 | Named "home" \[?\]; treat as 0xF8 until confirmed |

### 4.7 Playing a show

1. Read the show. Build the slide list from the 702 groups. Slide 0 holds no picture; its key table is the show-wide key table.
2. Start at slide 1. For each slide:
   - Empty slide: skip it.
   - Chart: erase the previous slide with that slide's Erase effect (4.5), then draw this one (section 5) with its Draw effect. Wait for its display time in seconds (702 offset 14), or for a key or click if it is blank (0xFFFF).
   - Nested show: play that show from its slide 1, then continue with the next slide of this show. Destinations inside the nested show refer to its own slides.
   - Sound or MIDI: start playing and continue at once to the next slide. \[I\] The sample MIDI files are standard MIDI files in Microsoft's dual format (each part on channels 1-10 and again, arranged for FM cards, on channels 13-16); the FM sound cards HG 3.05 supported played channels 13-16 only, with 16 as the drum channel. \[I\]
3. Keys and clicks: first check the slide's button table (for clicks) and key table, then the show-wide key table. If nothing matches, Enter, Space, right arrow or Page Down go to the next slide; Backspace, left arrow or Page Up go back; Esc ends the show. \[I: common Projector controls, not checked\]
4. After the last slide, end the show, or loop to slide 1 if the show is set to loop (where that setting lives is not yet known).

## 5. Chart files (.CH3)

### 5.1 Layout

Signature HGB3, version record (type = chart type), header block (500, 400, 402, 501), then the page block 504 ... 505, then the end record. Inside the page block, in this order: \[C\]

1. Optional 814 (button name list, see 4.4).
2. The object layer 516 ... 517 (5.6). Present in almost every chart (one sample drawing has none); often empty or holding a few annotations in data charts, and holding everything in drawings.
3. The chart block 508 ... 509: text lines (800), page areas (802 to 810), page setup (816), file references (404), colour settings (820, 822, 824), and the records of the chart type (5.4).

Charts of type XY, pie, organization, title, bullet and table store their **data**, and every sample data chart (171 of 171) also stores **a drawn copy of the chart as objects** in its object layer: title, axes, bars, slices, boxes, labels and legend. Drawing the object layer alone reproduces the chart. A viewer can draw the stored copy and lay out the chart from its data (5.5) only when no copy is present. Drawings (type 0x29) store only objects. \[C for the copies; I that a chart without a copy can exist\]

### 5.2 Page records

| Tag | Size | Meaning | Mark |
| --- | --- | --- | --- |
| 802 | 10 | Page frame area: i16 x1, y1, x2, y2, then u16 0 | C size, I meaning |
| 804 | 10 | Title area, same layout | I |
| 806 | 10 | Chart (plot) area, same layout | I |
| 808 | 10 | Footnote area, same layout | I |
| 810 | 10 | Legend area, same layout; all zero when the legend is off (C by test pair, see 5.4) | I |
| 816 | 10 | u8 orientation (1 landscape, 2 portrait), u8 paper size (index into the paper size list, 1 = Letter 8.5 × 11 in, 14 = screen 10 × 7.5 in), f32 page width in inches, f32 page height in inches | C |
| 820 | 12 | 12 colour role numbers for chart parts, e.g. 02 02 02 12 01 01 12 12 12 0F 0F 0F \[?\] | ? |
| 822 | 19 | Chart options \[?\] | ? |
| 824 | 2 | Always 0x55, 0x00 \[?\] | ? |
| 1700 | 8 | In drawings only; zero in samples \[?\] | ? |

Records 802 to 810 appear in every data chart and never in drawings; 824 appears in every data chart and never in drawings; 1700 appears only in drawings; 814 sits in the 504 block, outside 508. \[C\]

An area of all zeros means the chart has no such area. The areas use page coordinates (6.1). The tutorial pie chart, for example, has its title area across the top quarter of the page, its plot area below it and its footnote area in the bottom left corner. \[C for the values\]

### 5.3 Text

**Text line (tag 800)** \[C for the layout, from all 2,588 text lines\]

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | u16 | Text slot: which part of the chart the line belongs to (table below) | C |
| 2 | u16 | Line or row number within the slot, from 0 | C |
| 4 | u16 | Column number (tables), else 0 | C |
| 6 | u8 | Number of rows this line's group spans, 0 to 33 in the samples: 3 on title line 0, the total row count on the first bullet line (0 on the others), 4/8/4 on the title chart's section starts, rows to the next stored row in tables, 1 on XY axis titles and series names | I |
| 7 | u8 | 0x10 in general, 0x11 on every table cell, 0x12 on every XY series name \[?\] | ? |
| 8 | string | The text | C |
| then | u16 | Length of the text, not counting the NUL | C |
| +2 | u16 | Text colour: a colour role number (6.2) | C |
| +4 | u16 | 0 | ? |
| +6 | u16 | Second colour role, usually equal to the text colour (shadow or fill colour \[I\]) | ? |
| +8 | u16 | 0 | ? |
| +10 | f32 | Text size (6.4) | C size, I unit |
| +14 | u16 | Justification: 1 = left, 2 = centre, 3 = right \[I for 3; never seen in the samples\]; bit 0x2000 is set only on some table cells \[?\] | I |
| +16 | 6 bytes | Font key (section 2) | C |

Text slots: \[C for which chart types use them, I for the names\]

| Slot | Used in | Holds |
| --- | --- | --- |
| 1 | All data charts | Title (line 0) and subtitles (lines 1, 2) |
| 2 | Pie, organization | Footnote |
| 3 | XY | Axis titles |
| 4 | XY | Series names, one line per series (the row number is the series number); used in the legend |
| 5 | Pie | Title of each pie (the column is the pie number; the row is 0) \[C, GALD291\] |
| 6 | Table | Cell text (row, column) |
| 7 | Title chart | The title chart's lines, top to bottom |
| 8 | Bullet | The bullet list's lines, in order |

The colour roles in the samples match their names: titles use role 1 (Title), subtitles role 2 (SubTitl1), footnotes role 7 (Footnote), and the default title size is 9 while subtitles are 5 and footnotes 3.5. \[C\]

**Text style tables** \[C for the layout\]

Tags 906 (organization), 1002 (title), 1102 (bullet), 1202 (table), 1308 (pie), 1412 (XY) and part of 712 (show) hold a list of 16-byte entries, one per text role (not per slot number), with the defaults used for new text. In every table the first three entries are title, subtitle 1 and subtitle 2; the meaning of the rest depends on the chart type and is given by their default colour roles (for example footnote, pie titles, slice labels, axis titles, series names) \[I\]:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | f64 | Text size (0 = not used) |
| 8 | u8 | Colour role |
| 9 | u8 | Justification (as above) |
| 10 | 6 bytes | Font key |

A viewer should draw each 800 line with the colour, size, justification and font stored in that line, and use the style table only when a line's own values are missing. \[I\]

### 5.4 Data records by chart type

**Pie (type 0x15).** Up to 6 pies; records 1310 to 1314 are always stored for all six. Every C below is confirmed by a test pair made in Harvard Graphics 3.05: a base pie (PBASE.CH3: title Test, slices Alpha 40, Beta 30, Gamma 20, Delta 10) and a copy with one setting changed (file names in brackets, see 7.3). Yes/No bytes are 1 = Yes, 2 = No throughout. Strings are NUL-terminated; bytes after the NUL can hold leftovers of older text and must be ignored. \[C\] In every sample the drawn copy's slice angles are exactly value / total × 360°, from the starting angle counter-clockwise. \[C\]

| Tag | Size | Meaning |
| --- | --- | --- |
| 1304 | 7 | Pie style (Options > Style), one per chart; bytes below \[C\] |
| 1306 | 6 | Legend options (Options > Legend), one per chart; bytes below \[C for bytes 0 and 2\] |
| 1308 | 320 | Text style table (5.3) |
| 1310 | 18 | One per pie (pie 0 to 5): pie options (Options > Pie options); bytes below \[C\] |
| 1312 | 31 | One per pie: slice percent options (Options > Slice percents); bytes below \[C\] |
| 1314 | 43 | One per pie: slice value options (Options > Slice values); bytes below \[C\] |
| 1316 | 32 | One per slice, in data order: u8 pie number, u8 slice number, u8 cut out 1/2 (PCUT2), u8 colour role (21 = Series1 for the first slice, then 22 and so on), u8 pattern number (the Pattern column, 0 to 11 by default; PPAT5), f32 value, padded string\[23\] label \[C\]. Sorting never reorders these records. \[C\] |

1304, pie style:

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Share Pie 1 labels | 1/2, default 2 (PSHARE) \[C\] |
| 1 | 3D effect | 1/2, default 2 (P3DSE2) \[C\] |
| 2 | Link pies 1 and 2 | 1/2, default 2 (PLINK) \[C\] |
| 3 | Proportional pies | 1/2, default 2 (PPROP) \[C\] |
| 4 | Slice fill style | 1 Color (default), 2 Pattern, 3 Both (PFILLP, PFILLB) \[C\] |
| 5 | Slice outline colour role | default 32 = Outlines (POUTL) \[C\] |
| 6 | Link line colour role | default 18 = Lines (PLINKC) \[C\] |

1306, legend:

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Show legend | 1/2, default 2 (PLEG) \[C\] |
| 1 | Placement | 1 = Inside, 2 = Outside (the default) \[C in the XY copy 1418 (XLEGIN); the pie Legend menu has no Placement row\] |
| 2 | Location: one of 12 places around the plot area | 1 to 12 clockwise from the top left: 1 top left, 2 top middle, 3 top right, 4 right side top, 5 right side middle (the default), 6 right side bottom, 7 bottom right, 8 bottom middle, 9 bottom left, 10 left side bottom, 11 left side middle, 12 left side top (PLEGL1 to PLEGL3, PLOC1 to PLOC12) \[C\]; where each goes is in 5.5 |
| 3 | Frame style | 1 None, 2 Plain (the default), 3 Frame, 4 Rounded, 5 Octagonal, 6 to 9 3-D (a shadow toward each of four corners), 10 and up Page (a folded corner, in several directions), as the menu names them (PLFS3 to PLFS10) \[C\] |
| 4 | Frame outline colour role | default 14 = Frame \[I\] |
| 5 | Frame fill colour role | default 20 = Legend \[I\] |

1310, pie options:

| Offset | Type | Meaning | Values |
| --- | --- | --- | --- |
| 0 | u8 | Pie number | 0 to 5 |
| 1 | u8 | Show pie | 1/2 (PNOPIE) \[C\] |
| 2 | u8 | Show as | 1 Pie, 2 Column (PCOLUMN) \[C\] |
| 3 | u8 | Sort slices | 1/2, default 2 (PUNSSRT) \[C\] |
| 4 | u8 | Slice pointer | 1 None, 2 Short (default), 3 Medium, 4 Long (PPTRN, PPTRL) \[C, 3 by order\] |
| 5 | f32 | 3D slice depth | default 30 (PDEPTH6) \[C\] |
| 9 | f32 | Starting angle in degrees | default 0 (PANG45) \[C\] |
| 13 | f32 | Pie size in percent | default 100 (PSIZE50) \[C\] |
| 17 | u8 | Show slice labels | 1/2, default 1 (PNOLAB) \[C\] |

1312, slice percents:

| Offset | Type | Meaning | Values |
| --- | --- | --- | --- |
| 0 | u8 | Pie number | 0 to 5 |
| 1 | u8 | Show percents | 1/2, default 2 (PPCT) \[C\] |
| 2 | u8 | Place percents | 1 Below (default), 2 Adjacent, 3 Inside (PPCTADJ, PPCTPI) \[C\] |
| 3 | u16 | Decimal places | default 0 (PPCTD1) \[C\] |
| 5 | string\[13\] | Leading text | (PPCTL) \[C\] |
| 18 | string\[13\] | Trailing text | (PPCTT) \[C\] |

1314, slice values:

| Offset | Type | Meaning | Values |
| --- | --- | --- | --- |
| 0 | u8 | Pie number | 0 to 5 |
| 1 | u8 | Show values | 1/2, default 1 (PVALNO) \[C\] |
| 2 | u8 | Place values | 1 Below (default), 2 Adjacent, 3 Inside (PVALADJ, PVALIN) \[C\] |
| 3 | u8 | Currency | 1/2, default 2 (PVCURR) \[C\] |
| 4 | f32 | Decimal places; NaN (bytes 00 00 F0 FF) = blank, which means automatic | (PVDEC2) \[C\] |
| 8 | u8 | Thousands separator | 1/2, default 2 (PVTHOU) \[C\] |
| 9 | f64 | Scale factor | default 1 (PVSCALE) \[C\] |
| 17 | string\[13\] | Leading text | (PVLEAD) \[C\] |
| 30 | string\[13\] | Trailing text | (PVTRAIL) \[C\] |

**XY (type 0x01).** Up to 16 series; rows are the X categories. Every C below is confirmed by a test pair made in Harvard Graphics 3.05: a base bar chart (XBASE.CH3: title Test, X labels Jan, Feb, Mar, Series 1 = 10, 20, 30 and Series 2 = 5, 15, 25) and a copy with one setting changed (file names in brackets, see 7.3). Yes/No bytes are 1 = Yes, 2 = No, as for pies. An f64 of 00 00 00 00 00 00 F0 FF (NaN) means blank, so Harvard Graphics picks the value itself. Strings are NUL-terminated, and bytes after the NUL can hold leftovers of older text and must be ignored. \[C\]

| Tag | Size | Meaning |
| --- | --- | --- |
| 1402 | 102 | Axis options and label format, three records: axis 0 = X, 1 = Y1, 2 = Y2; bytes below \[C\] |
| 1404 | 3 | Axis frame (Options > Axis frame): u8 frame style (1 = Full, the default, all four edges; 2 = XY, left and bottom edges; 3 = X, bottom edge; 4 = Y, left edge; 5 = None) (XFRST, XAF3 to XAF5), u8 outline colour role (14 = Frame) (XFROC), u8 fill colour role (15 = FrameBkg) (XFRFC) \[C\] |
| 1405 | 1 | Show frame fill colour, Yes/No (XFRSHF) \[C\] |
| 1406 | 15 | One per series (0 to 15): series options; bytes below \[C\] |
| 1408 | 25 | Chart style (Options > Style); bytes below \[C\] |
| 1410 | 3 | Data table and data labels; bytes below \[C\] |
| 1412 | 256 | Text style table (5.3) |
| 1414 | 4 | Byte 0 = 13: a numeric X axis, rows placed by the value of their X label \[I, matched against the samples' drawn copies\]. 01 82 00 00 in every test chart, and no option tried changed it \[?\] |
| 1418 | 6 | Legend options, same layout as pie 1306; bytes below \[C\] |
| 1420 | var | Calculated series: u8, then a string formula such as "@n(#3,5,5)" \[I\]; 2 sample charts |
| 1426 | 33 | One per row in charts saved by 3.05: u16 row number, string\[31\] X label \[C\]. Older sample files store the same thing as 1422, 25 bytes: u16 row number, padded string\[23\] \[C\] |
| 1424 | 11 | One per data value: u8 series number, u16 row number, f64 value. A missing record means no value at that point, and a value holding the NaN f64 is a blank cell \[C\] |

1402, axis options (Options > Axis options) and label format (Options > Format), per axis:

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Axis | 0 = X, 1 = Y1, 2 = Y2 (XXMAX9, XY2MAX) \[C\] |
| 1 | Scale type | 1 = Linear, 2 = Log (XLOG) \[C\]; GALD481's log Y1 is drawn over whole decades \[I\] |
| 2 | f64 scale factor | NaN = blank (XSCALE) \[C\] |
| 10 | f64 minimum axis value | NaN = automatic (XMIN5) \[C\] |
| 18 | f64 maximum axis value | NaN = automatic (XMAX50, XXMAX9, XY2MAX) \[C\] |
| 26 | Grid line style | 1 = Dotted, 2 = Solid (XGRIDS), 3 = None (XGRIDN); default X = 3, Y1 and Y2 = 1 \[C\] |
| 27 | Major tick mark style | 1 = In (XMAJIN), 2 = Out (XMAJOUT), 3 = Both (XMAJBOT), 4 = None (the default) \[C\] |
| 28 | Minor tick mark style | Same values (XMINBOT) \[C\] |
| 29 | f64 major tick increment | NaN = automatic (XMAJI10) \[C\]; on the X axis the samples' drawn copies use it as the label step, every nth row \[I\] |
| 37 | f64 minor tick increment | NaN = automatic (XMINI2) \[C\] |
| 45 | f64 goal range minimum | NaN = none (XGOALMN); Y axes only, the X column shows a dash \[C\] |
| 53 | f64 goal range maximum | NaN = none (XGOALMX) \[C\] |
| 61 | Goal range colour role | 27 = GoalY1, 28 = GoalY2, 29 = Draw1 and so on (XGOALC); the X record holds 28 but has no goal range \[C\] |
| 62 | Show axis labels | Yes/No (XLBLNO) \[C\] |
| 63 | Percent | Yes/No (XPCT) \[C\] |
| 64 | Currency | Yes/No (XCUR) \[C\] |
| 65 | Scientific notation | Yes/No (XSCI) \[C\] |
| 66 | f64 decimal places | NaN = automatic (XDEC2) \[C\] |
| 74 | Thousands separator | Yes/No, default Yes (XTHOUN) \[C\] |
| 75 | string\[13\] leading text | (XLEAD) \[C\] |
| 88 | string\[13\] trailing text | (XTRAIL) \[C\] |
| 101 | Unused | 0 \[?\] |

1406, series options (Options > Series), one per series:

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Series | 0 to 15 \[C\] |
| 1 | Show series | Yes/No (XS6SH) \[C\] |
| 2 | Show as | 1 = Bar, 2 = Line (XS6AS) \[C\]; 3 = Area \[C, from the samples' drawn shapes\]; 4 = High, 5 = Low, 6 = Close, 7 = Open, 8 = Point in the order the menu lists them \[I\]. The samples draw type 8 as a curve through the points \[I\] |
| 3 | Y axis | 1 = Y1, 2 = Y2 (XS6Y2) \[C\] |
| 4 | Cumulative | Yes/No, default No (XS6CU) \[C\] |
| 5 | Data labels | Yes/No, default Yes; shown only when 1410 byte 2 is Yes \[C for the byte (XS6DL), I for the rule\] |
| 6 | Data table | Yes/No, default Yes (XS6DT) \[C\] |
| 7 | Fill style | 1 = Color, 2 = Pattern, 3 = Both (XFSP, XFSB) \[C\]; how each is drawn is in 5.5 |
| 8 | Fill pattern | The number the menu shows minus 1, so 0 to 11 for series 1 to 12 (XS6FP) \[C\] |
| 9 | Fill colour role | 21 = Series1 for series 0, then 22 and so on, repeating every 6 series (XS6FC) \[C\] |
| 10 | Line fit | 1 = Normal, 2 = the next choice (XS6LF) \[C\]; the samples draw 2 as a least-squares trend line and 3 as a smoothed curve \[I\] |
| 11 | Line style | 1 = solid, 2 = the next style (XS6LS) \[C\] |
| 12 | Line width | As shown, default 0 (XS6LW) \[C\] |
| 13 | Line colour role | Same roles as the fill colour (XS6LC) \[C\]; lines and points are drawn in this colour, which is usually the same as byte 9 (GALD411 differs) \[I\] |
| 14 | Marker style | As shown: 1 to 13, then repeating from 1 (XS6MK) \[C\] |

Bar heights in the samples' drawn copies are proportional to the values, or to row shares for 100 % stacked bars. \[C\]

1408, chart style (Options > Style):

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Bar style | 1 = Cluster (the default), 2 = Overlap, 3 = Stack, 4 = 100 %, 5 = Step (XSBSTY, XOVL, XSTK, XPCT1, XSTEP) \[C\]; 6 = Paired \[I, from the samples' drawn copies\] |
| 1 | Bar shape | 1 = Rectangle (the default), 2 = Pyramid (XSBSHP) \[C\]; 3 = Octagon, 4 = Cylinder \[I, from the samples\] |
| 2 | f32 bar width | Percent of the category slot, 85 by default (XSBW60) \[C\] |
| 6 | f32 bar overlap | Percent, 50 by default (XSBO30) \[C\] |
| 10 | Area style | 2 = Stack (the default), 3 = 100 % (XSAREA) \[C\]; 1 = Overlap \[I, from the samples\] |
| 11 | High/Low style | 1 = Bar (the default), 2 = the next choice (XSHILO) \[C\]; the samples draw 1 as a box, 2 as a band and 3 as an I bar \[I\] |
| 12 | Chart style | 1 = 2D, 2 = 3D (XS3D) \[C\] |
| 13 | 2D style | 1 = Normal, 2 = Shadow, 3 = Link, 4 = Horizontal (XS2D2 to XS2D4) \[C\] |
| 14 | 3D style | 1 = Normal, 2 = Horizontal (XS3DST) \[C, names from the menu\] |
| 15 | f32 3D object depth | 40 by default (XSOD60) \[C\]; percent of the bar's depth lane \[I\] |
| 19 | f32 3D floor depth | 20 by default (XSFD30) \[C\]; percent of the frame height \[I\] |
| 23 | Link line colour role | 18 = Lines (XSLINK) \[C\] |
| 24 | Outline colour role | 32 = Outlines (XSOUT) \[C\] |

1410, data table and data labels (Options > Data table/labels):

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Show data table | 1 = No, 2 = With chart, 3 = Table only (XDTAB2, XDTONLY); Table only empties the legend area 810 \[C\]. With 2 the samples draw series names and values in a grid under the chart \[I\] |
| 1 | Table grid lines | 1 = Vertical, 2 = Horizontal (XDTGRID) \[C\]; 3 = Both, 4 = None in menu order \[I\] |
| 2 | Show data labels | Yes/No, default No (XDLBL) \[C\]; the samples print values at the bar ends \[I\] |

1418, legend options (Options > Legend), the same bytes as pie 1306:

| Offset | Meaning | Values |
| --- | --- | --- |
| 0 | Show legend | Yes/No, default Yes; No zeroes area 810 and widens the plot area 806 (XLEGNO) \[C\] |
| 1 | Placement | 1 = Inside, 2 = Outside (the default) (XLEGIN) \[C\]. Inside puts the legend inside the axis frame and leaves the plot area its full size. It does not change the order of the entries (see 5.5) |
| 2 | Location | 1 to 12 clockwise from the top left: 1 top left, 2 top middle, 3 top right, 4 right side top, 5 right side middle (the default), 6 right side bottom, 7 bottom right, 8 bottom middle, 9 bottom left, 10 left side bottom, 11 left side middle, 12 left side top (XLEGFR, XLOC1 to XLOC12) \[C\] |
| 3 | Legend frame style | 1 None, 2 Plain (the default), 3 Frame, 4 Rounded, 5 Octagonal, 6 to 9 3-D (a shadow toward each of four corners), 10 and up Page (a folded corner, in several directions), as the menu names them (XLEGOC, XLFS3 to XLFS12) \[C\] |
| 4 | Frame outline colour role | 14 = Frame (XLEGOC) \[C\] |
| 5 | Frame fill colour role | 20 = Legend (XLEGFC) \[C\] |

**Organization (type 0x1A).** \[I\]

| Tag | Size | Meaning |
| --- | --- | --- |
| 900, 902, 904, 910, 912 | 8 to 17 | Chart options: box style, colours, levels to show |
| 906 | 144 | Text style table |
| 914 | 190 | One per box (person), not necessarily in tree order. Byte 0 is always 3. Then three 47-byte fields (name, title, comment), each a u8 field width (18), padded string\[23\], the 22-byte text tail of 5.3 and a u8 0, ending at offset 142. At 142: i16 box centre x, y; subtree x extent; 4 u16 \[?\]; u16 level at 158; u16 number of subordinates at 160; own index at 168; flag + index pairs for parent (170), first child (174), next sibling (178) and previous sibling (182) \[C for the links, which match the drawn copies; I for the rest\] |

The tree is given by the stored links in each 914 record. (An earlier reading, "each box is a subordinate of the nearest earlier box one level higher", disagrees with the links for 30 of 58 sample boxes; records can be in reverse order.) Box centres match the drawn boxes, except that in some charts every box is shifted by one constant, likely a shadow style. \[C\]

**Title (type 0x1F) and bullet (type 0x20).**

- Title charts use only text slot 7 and the style table 1002. \[C\] Their lines fall in three sections starting at rows 0, 4 and 12 (top, middle, bottom), matching the three 1002 entries. \[I\]
- Bullet charts use slot 8 for lines, 1102 for styles, 1106 (22 bytes: a default 1108 entry in bytes 0 to 3, then options) and 1108: one 192-byte record of 48 four-byte entries, one per row: bullet shape (1 •, 4 ►, 7 "1.", 8 "I.", 9 none; 0 on continuation rows, 100 unused), a byte \[?\] (2), colour role 16 = Bullet, paragraph number counting from 1. \[C for the layout and shapes, from the drawn markers\] No indent level was found.

**Table (type 0x21).** Slot 6 holds the cell text by row and column. 1202 is the style table; 1206 and 1210 are options \[?\]. 1208 is 24 column entries of 39 bytes (f64 left, f64 right — not set when unused — u8 justification, u8 \[?\], filler); 1214 is 24 row bands (f64 top, f64 bottom). Both are percentages of the page: x = p/100 × 32768 − 16384, y = H/2 − p/100 × H with H = 32768 × height / width from 816. Drawn cell texts sit in these columns and bands. \[C\] 1212 is a value-range colour table: a 3-byte head (byte 0 = 1 when on), then 10 entries of 40 bytes with f64 low, f64 high and a colour role (33 to 42, Range1 to Range10); each numeric cell's background is the colour of the range holding its value. \[C, GALD181\]

### 5.5 Drawing a data chart

**Parts of the drawn copy.** The drawn copy (5.1) is one 608 group in the object layer. The first flag byte of each object in it names the chart part: 2 = titles, 3 = plot, 4 = footnote, 5 = legend; their bounding boxes match the areas 804 to 810. Objects the user drew themselves have first flag byte 0, and text charts use flag bytes 1 to 4 for their own parts \[I\]. Every option change tried in 5.4 changed the drawn copy the way the chart looks on screen. \[C, by test pair\]

How the stored pie is built, for checking a viewer's own drawing against the original \[C, by the test pair named\]:

- One 0x1031 arc per slice, all with the same centre and radius. The first slice starts at the starting angle (1310) and the slices go counter-clockwise; each sweep is the slice's share of 3600 tenths of a degree. Angles are not wrapped: with a 45° start the last slice ends at 4050 (PANG45).
- Unsorted pies draw slices in data order. Sorted pies draw the largest first; each slice keeps its own colour (PUNSSRT).
- Pie size is a percentage of area, not radius: at 50 the radius is the full radius × √0.5 (PSIZE50).
- A cut slice is moved out along its middle angle by half the radius, and the whole pie shrinks to 70% of its radius to make room (PCUT2, one test).
- 3D: the pie becomes an ellipse with height 0.6 × width, the edge is 0.15 × the width radius deep at depth 30, and the sides (0x1061 polygons and 0x1041 bands) are drawn back to front before the top arcs (P3DSE2, one test).
- Each slice label is one text block holding the label, a line feed and the value, with an 0x1050 leader line from the rim; slice pointer Long adds a horizontal second segment, None removes the line. With slice labels off, only the value remains (PPTRL, PPTRN, PNOLAB).
- Show as Column draws the slices as stacked 0x1071 boxes, bottom to top in data order, each as tall as its share (PCOLUMN).
- Fill style Pattern or Both turns the arcs into 0x1032 (and XY bars into 0x1072 boxes) with the attributes given under "Fill styles" below (PFILLP, PFILLB, PPAT5, PBPAT5, PBCOL) \[C\].
- With the legend on, the plot area (806) shrinks to make room and the legend area (810) holds the legend box; with it off, 810 is all zero (PLEG, PLEGL1 to PLEGL3).

How the stored XY chart is built \[C, by the test pairs named in 5.4\]: the plot object (flag byte 3) holds one 0x1071 box per bar, 0x1050 polylines for the axes, grid lines and tick marks, and 0x10B0 text blocks for the tick labels and X names. Every XY option tried changed this geometry as on screen: no grid lines (XGRIDN) and no axis labels (XLBLNO) shrink it, a log scale (XLOG) redraws the ticks, 3D (XS3D) adds 0x1061 polygons for the bar sides and the floor, and a series shown as a line (XS6AS) replaces its three boxes with one polyline plus a 0x10A1 record, likely its markers \[I\], and changes its legend key.

**Layout rules measured in 3.05.** These come from one-setting test charts saved by Harvard Graphics 3.05 and screenshots of its own screen (samples/option-tests/page-size, legend and styles). They hold on both Letter (11 × 8.5 in) and 10 × 7.5 in pages. \[C unless marked\]

- **Text metrics.** A line's em is the text size as a percent of the page's short side, rounded down (25321 units on Letter, 24576 on 10 × 7.5; sizes 6, 12 and 2.5 give 1519, 3038 and 632 on Letter, 1474, 2948 and 614 on 10 × 7.5; one Letter value is a unit lower than the rule gives) (PT6 to PT25, PMT6 to PMT25). For Swiss 721 Roman the stored ascent is the em rounded up to a multiple of 100 and the descent is 0.275 × em rounded up to a multiple of 50; the line box height is (1.25 × em + 50) rounded up to a multiple of 100 \[I, fitted to every test line from em 614 to 3038\]. Lines after the first are 0.85 × the line box apart (Line spacing 85 in Setup > Chart default settings).
- **Areas.** The page margin (802) is 1 % of the short side (253 on Letter, 246 on 10 × 7.5). The title area (804) runs from the 802 top down by the title's line box; the plot area (806) starts 1 % of the short side below that, and the title rule is drawn on the line between them.
- **Pie size.** The radius is a share of the plot area height: 0.34 with two label lines, 0.40 with one, 3-D width radius 0.44, and a cut slice shrinks the pie to 0.7 × 0.34 (PMBASE, PM3D, PMCUT, PMVADJ, with their Letter originals). The page size does not change these shares.
- **Older samples.** The 10 × 7.5 in gallery samples were laid out by an earlier build: their stored drawings round the ascent down and make the line box 1.25 × em rounded up to a multiple of 100 \[I\] (a title line box of 2800, not 2900, so their 804 and 806 sit 100 units higher, and label lines of 1100, not 1200), pie shares 0.32, 0.42 and 0.85, and data tables with an 1100-unit row pitch. When 3.05 lays one of them out again (any edit, then save), it gives the rules above (checked on GALD211, 221, 241, 317 and 367; those copies stay private with the samples). A viewer drawing a chart with no stored drawing should use the 3.05 rules.
- **Legend place.** The legend box (810) is sized by its entries and sits inside the band left by the page margin and the title. Locations on the sides (4 to 6, 10 to 12) align its top, middle or bottom with that band; the plot area then loses the box width plus 1 % of the short side on that side. Locations on the top and bottom (1 to 3, 7 to 9) align its left, centre or right; the plot area loses the box height plus 1 %. Placement Inside leaves the plot area whole and puts the box inside the axis frame against its right edge (XLEGIN). On Letter with two XY series the box is 5392 × 3772 in a column and 10252 × 2212 in a row (XLOC1 to XLOC12, PLOC1 to PLOC12).
- **Legend order.** In a column legend, series are listed bottom-up when the bar style is Stack or 100 % and top-down otherwise, whatever the placement (XSTK, XSTKIN, XPCT1, XOVL, XOVLIN, XSTEP). A row legend always lists left to right (XSTKL8).
- **Data table with swatches** (legend off). The table spans from the plot area's left edge to the axis frame's right edge, its bottom 4.5 % of the plot area height above the plot area's bottom, one row per series at the label line box (1200 on 10 × 7.5 at size 3.5). Each swatch is an 840-unit square ending 240 units left of the frame, inset 180 from its row. XMLEGNO and the 3.05 layout of GALD317 follow the same rule.
- **Axis frame styles** (1404 byte 0). XY draws only the left and bottom edges, X only the bottom, Y only the left, None no edges. Where the top edge is missing, the top grid line is drawn as an ordinary grid line (XAF3 to XAF5).
- **2D styles** (1408 byte 13). Shadow adds a drop shadow to each bar (0.15 × the bar width to the right and 0.15 × its height down, role Shadow) \[I, from the drawn copy\]. Link draws a line (role Lines, 1408 byte 23) from the top right corner of each stacked segment to the top left corner of the same series' segment in the next bar; on clustered bars it changes nothing (XS2D3, XSTKLK). Horizontal turns the bars sideways, first category at the top, values along the bottom (XS2D4).
- **Goal range.** With both minimum and maximum set, a box spans the axis frame's width between the two values, filled and outlined in the goal colour role (1402 byte 61), drawn after the frame fill and before the grid lines and bars. With only one bound set, nothing is drawn (XGOALB, XGOALMN, XGOALMX).
- **Pie labels.** The value always comes before the percent, joined by two spaces, in whichever place they share: "40  40%" on line 2 when both are Below, "Alpha  40  40%" when both are Adjacent, and one "40  40%" block at 2/3 of the radius when both are Inside (PBOTHIN, PPCTADJ, PVPADJ).
- **Fill styles** (pie 1304 byte 4, XY 1406 byte 7). Patterned shapes are 0x1032 arcs and 0x1072 boxes, with 0x112E = the pattern number (0 = the first; XY menus show it plus 1), 0x110C byte 0 = the pattern colour role and 0x110B byte 0 = the fill colour role. Pattern number 0 is a solid fill in the pattern colour (0x110B = that colour); any other number is the pattern drawn over role 0, the background (0x110B = 0). With Pattern, the pattern colour is FF, which draws white, the outline is white too, and the slice or series colour is ignored (PPATC). With Both, the pattern colour is the slice or series colour and the outline is the usual outline role (PFILLP, PFILLB, PPAT5, PBPAT5, PBCOL, XFSP, XFSPP, XFSB, XFSBP, XFSBC). Patterns seen: 1 thin diagonal lines, 2 dots, 3 dense diagonal lines, 5 vertical lines.

The original lays out data charts itself; the stored areas (5.2) tell a viewer where each part goes. For a data chart without a drawn copy, use this method: \[I unless marked\]

1. Fill the page with the background colour (palette role FrameBkg). The page frame area (802) is not drawn as a line in any reference render. If the chart has a button chart forming a band at the top or bottom, the chart is shrunk uniformly into the rest of the page and centred horizontally; the button chart is drawn unscaled on top. \[C, from the reference renders\]
2. Draw slot 1 text in the title area, centred lines from the top, each line's height taken from its text size.
3. Draw slot 2 text (footnote) in the footnote area.
4. Draw the chart in the plot area:
   - **Pie:** add up the slice values of each pie; each slice's angle is its share of 360°. Start at the pie's starting angle (1310, default 0° = 3 o'clock) and go counter-clockwise \[C\], which matches the angle convention of drawn arcs (5.6). Fill each slice with its colour role, outline it with role Outlines, and place the label outside the slice on the line from the centre through the middle of the slice, with the value or percentage if the options ask for it. Several pies are spaced evenly across the plot area, each titled with its slot 5 text.
   - **XY:** work out each axis range from the data where 1402 says "not set", choosing round tick intervals. Draw the frame, grid and tick labels (X labels from 1426 or 1422, Y labels from the range). Draw each series by its type: bars side by side in each category (Cluster), stacked, or overlapping; lines through the points; areas filled down to the axis; points as markers. Use the series colour roles from 1406 and the series names (slot 4) in the legend area.
   - **Organization:** draw one box per 914 record, top level at the top, children spread evenly below their parent, connected by lines (role Lines); write name, title and comment in the box.
   - **Title, bullet:** stack the lines vertically in the plot area with their own sizes and justification; bullets get a marker (role Bullet) before each line.
   - **Table:** draw a grid in the plot area with columns and rows as stored, and write each cell's text.
5. Draw the object layer (5.6) on top.

### 5.6 Object layer

The object layer (between 516 and 517) is a list of drawn objects, optionally grouped with 608 ... 610. Each object is a sequence of records: \[C\]

1. Optional 616 (24 bytes): the object's transform, six f32 values a, b, c, d, e, f. Objects in data charts have none; use the identity transform. \[C\]
2. Optional 618: the object's button name (string; see 4.4).
3. Optional 404 kind 5: the bitmap the object draws (always present for bitmap objects, between 616 and 612). \[C\]
4. 612: the object itself.
5. Optional 614: a continuation of the 612. When a 612's sub-record list does not reach 0x1FFF, the next 614 carries the rest of the sub-records and ends with 0x1FFF; drawing state carries over. \[C, from the 3 occurrences in the samples\]

A 616 and 618 may also come straight before a 608 group, and then apply to the whole group (7 button groups and 12 empty bitmap groups in the samples). The 608 data is the union of the members' bounding boxes as four i16 (x1, y1, x2, y2), then 8 zero bytes. \[C\]

**Transform (616)** \[C\] Each point (x, y) inside the object is mapped to page coordinates by:

- page x = a · x + c · y + e
- page y = b · x + d · y + f

This was checked by recomputing the stored bounding box of many objects from their points. About 375 drawing objects are rotated by 90° (a = d = 0, b < 0, c > 0), so a viewer must apply the full formula. \[C\]

**Object record (612)** \[C for the layout\]

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 4 × i16 | Bounding box on the page after the transform: x1, y1, x2, y2 |
| 8 | 8 bytes | Object flags; usually zero. In a data chart's drawn copy the first byte names the chart part (5.5) \[C\]; the rest \[?\] |
| 16 | sub-records | Each: u16 sub-tag, u16 length, data. The list ends with sub-tag 0x1FFF. |

The sub-records are a **display list**, not one shape: attribute sub-records set the current drawing state, and each shape sub-record is drawn with the state at that point. For example 0x112D, 0x1100, 0x110B, 0x1071, 0x110B, 0x1071, 0x10B0 draws two boxes with different fills and then a text block. 427 of the 3,712 sample objects have two or more shapes, 217 have ten or more. \[C\]

The 516 extent box contains every object's bounding box but is not a tight fit. \[C\]

**Shape sub-records.** Point lists are i16 pairs in the object's own coordinates (before the transform). The low hex digit of the sub-tag varies (for example 0x1070, 0x1071, 0x1072, 0x1077, 0x1078); it selects how the shape is painted: 0 or 2 = outline only (0x1072 boxes carry a meaningless fill byte), 1 = filled, and outlined if a line is set, 7 = direct fill without a line, 8 = gradient fill (always with 0x1110). \[I, consistent with every sample\]

| Sub-tag | Shape | Data | Mark |
| --- | --- | --- | --- |
| 0x1021, 0x1022, 0x1028 | Ellipse | i16 centre x, centre y, radius x, radius y | C |
| 0x1031 | Elliptical arc | centre x, centre y, radius x, radius y, u16 arc style, start angle, end angle. Style 1 (every sample, all filled) is a pie slice: the arc closed through the centre \[I for the meaning\] | C |
| 0x1041 | Elliptical band (the side of a cylinder or a 3-D pie edge): the arc from start to end angle, extruded straight down by the depth | centre x, centre y, radius x, radius y, start angle, end angle, u16 depth | C |
| 0x1050 | Open polyline, possibly in several parts | u16 point count n, u16 part count k, k × u16 points per part (summing to n), then n points. Most have k = 1; 160 sample polylines have k from 5 to 19 | C |
| 0x1061, 0x1068 | Polygon (closed) | same as 0x1050 | C |
| 0x1070 to 0x1078 | Box | u16 box style, u16 size c, i16 x1, y1, x2, y2. Styles: 1 square; 3 rounded with radius c; 5 extruded 3-D box, c to the right and down, the bottom face at 25% and the right face at 50% of the fill (reference renders; an earlier draft read it as a drop shadow); 2 double outline with the inner one c inside; 6 3-D box c deep up and to the right (the 3-D bar style). The bounding box includes the shadow or 3-D extent. \[C for the extents, I for the drawing\] | C for the rectangle |
| 0x1080 | Cubic Bézier curve: points are P0, C1, C2, P1, C1, C2, P2 … (3k + 1 points) | same as 0x1050 | C |
| 0x1091, 0x1098 | Closed cubic Bézier curve, same point order (pie slices use circle handles of 0.552 × radius) | same as 0x1050 | C |
| 0x10A0, 0x10A1 | Smooth curve through its points (data series lines) \[I\] | u16 point count n, n points, then 6 bytes: u16 about 500 to 630 (perhaps marker size) \[?\], u16 0 to 4 (likely the point marker shape) \[I\], u16 1 = straight segments, 0 = smooth \[I, from the reference renders\]. When it follows a 0x1050 polyline in the same object it repeats that line (the polyline is what is drawn) | I |
| 0x10B0 | Text block | see below | I |

Angles are in tenths of a degree, measured counter-clockwise from the positive x axis (0 = 3 o'clock, 900 = 12 o'clock). \[C\]

**Text block (0x10B0).** Starts with u16 (offset of the first text run: 82 + 28 × number of wrapped lines, so 110, 138 or 166 in the samples), then u16 (length of the sub-record − 22, correct in every sample). Known header fields: offset 14 u16 total text length, 16 u16 run count (always 1), 38 the text frame box (4 × i16), 62 a second box that equals the object's bounding box for most text-only objects (likely the actual text extent), 80 u16 line count, then one 28-byte entry per line with a u32 start offset at +4, a u8 length at +8, and the line's stored layout relative to the top of the box at 62: i16 top of the line box at +14, i16 bottom at +18, negated ascent at +20 and descent at +22 (multiples of 50), u16 glyph size (em) at +26. Drawing lines at these stored positions and sizes reproduces every sample block within 1 unit; the em matches the run's size except where the copy was shrunk (HELP1). \[I for the field meanings, C for the run offset\] The text colour of a run is the 4-byte value formed by the tail's colour u16 and the u16 after it (byte 0 = 0xFF means direct RGB, else the low byte is a role). Lines are about 1.28 × the text size apart. \[I\] The runs follow: each is the string, padded with a NUL to an even length, followed by the 22-byte text tail of 5.3 (length, colours, size, justification, font key). Draw each run in the text box with its justification; right justification (3) does occur here. \[I\] Bullet markers in bullet charts are separate one-character text blocks: colour role 16, right-justified in a narrow box left of the line, same font and size as the line; the character is 0xFA (round bullet) or 0xF9 (►), or text such as "1." for numbered styles. \[C\] Header byte 34 varies with the text's role (9 normal, 10 titles, 19 bullet markers, 20 or 25 axis labels, 146 in drawings) and byte 32 is 1 for titles and bullet markers \[?\].

**Attribute sub-records** \[? unless marked\]

| Sub-tag | Size | Notes |
| --- | --- | --- |
| 0x1100 | 4 | Line (outline) settings: byte 0 is a colour (see below; roles seen most: 32 Outlines, 14 Frame, 26, 18 Lines, 23, 24, 15) \[I\]; byte 1 is 0, 1, 2 or 255 mostly, likely line width or style \[I\]; bytes 2 and 3 are not meaningful unless byte 0 is 0xFF |
| 0x110B | 4 | Fill colour, byte 0 (see below) \[I\] |
| 0x110C | 4 | Fill colour for bitmap objects (always before 0x1140; often FF 55 55 55) \[I\]; also on 3-D pie faces with byte 0 = 0 \[?\] |
| 0x1110 | 10 | Gradient fill across the shape's bounding box: colour 1, colour 2 (FF R G B each), u16 angle in tenths of a degree, counter-clockwise from up \[C, from the reference renders\] |
| 0x1120 | 2 | u16 outline width in page units (294 draws about 6 px on a 640 × 480 screen); small values (0, 1, 25) leave the 0x1100 width \[I, from the reference renders\] |
| 0x112A | 2 | Fill brightness in percent: 100 on flat faces, lower only on 3-D faces (bar sides, cylinder walls, pyramid faces, 3-D pie walls and edges), varying with the face's direction like a lighting model. Scale the fill towards black by it \[I\] |
| 0x112B | 2 | Line style: 0 solid, 1 dotted (2 px on in a 6.5 px period at screen scale) \[C, from the reference renders\] |
| 0x112D | 2 | u16 0 or 1 \[?\] |
| 0x112E, 0x112F | 2 | u16 (0 or 3; 1) \[?\] |
| 0x1140 | 8 | Bitmap: bytes 0 to 2 are 0 \[?\]; byte 3 is the fit mode: 0 = drawn at the bitmap's own pixel size, tiled over the 612 box from the hot spot; 2 = drawn once, stretched to the 612 box (each axis independently; the hot spot is ignored) \[I, from real-program screenshots\]. u16 at 4 and u16 at 6: the hot spot in bitmap pixels from the top left (half the bitmap size when HG fits it). The bitmap is the 404 kind 5 reference before the 612 |

**Colours in attributes** \[C\]: a colour is 4 bytes. If byte 0 is 0xFF, bytes 1 to 3 are a direct red, green, blue value (as in palette record 1555); otherwise byte 0 is a colour role.

Until the attributes are fully decoded, a viewer can draw every closed shape filled with the current 0x110B colour (or the 0x1100 colour when no 0x110B has been set) and outlined with the current 0x1100 colour.

## 6. Rendering model

### 6.1 Page coordinates

- Page coordinates are i16. The longer side of the page runs from −16383 to +16383 and the shorter side from −12287 to +12287, with (0, 0) at the centre of the page. In landscape, x is the long side; in portrait (816 orientation 2), y is. \[C: every stored area and bounding box lies in this range; the landscape and portrait template charts fill it\]
- y increases upwards. \[C: titles have the largest y values and footnotes the smallest\]
- The ratio 4:3 matches the default 10 × 7.5 in screen page; 32767 units span 10 in, about 3277 units per inch. Units are square: the long side is always 32768 units and the short side is 32768 × short/long inches, so a Letter page (11 × 8.5 in) has a short side of about 25321 units and is drawn out to y ±12406 to ±12660, beyond ±12287. \[C, from the Letter sample charts' frames and text box heights\] (An earlier draft guessed the 4:3 range was stretched; it is not.)
- To show a page on a screen of width W and height H pixels (landscape, 4:3): screen x = (x + 16384) · W / 32768 and screen y = (12288 − y) · H / 24576. Keep the 4:3 shape and add bars on wider screens. \[I\]

### 6.2 Colours and palettes

Every colour in a chart is a **colour role number**, not an RGB value. The palette file the chart names (404 kind 2, default HG3.PL3) turns roles into RGB. Changing a chart's palette recolours it completely, which is how the gallery shows the same chart in several colour schemes. \[C\]

**Palette file (.PL3, .PC3)** \[C for 1551 to 1553\]

Signature HGA2, version type 0x33 (.PL3) or 0x34 (.PC3), header block, palette body 524 ... 525:

| Tag | Size | Meaning | Mark |
| --- | --- | --- | --- |
| 1551 | 2 | u16 number of colours: 64 in .PL3 files, but some have fewer (50 and 57 in the samples) | C |
| 1553 | 18 | One per colour: u16 index (0 to 63), padded string\[16\] name | C |
| 1552 | 6 | One per colour: u16 index, u8 role number (index + 1 in .PL3; 0xFF in every .PC3), u8 red, u8 green, u8 blue, each 0 to 255 | C |
| 1554 | 14 | Page background \[C, from the reference renders; role 15 FrameBkg is not used for it\]: u16 mode (1 plain, 2 in the shaded palettes, likely a gradient), two colours each stored as 0xFF R G B, u16 (90 in almost all files, possibly an angle), u16 (12 in all files, possibly a step count). Absent in .PC3 | I |
| 1555 | 64 | 16 entries of 4 bytes, each 0xFF R G B. The same 16 colours (black, white, a 12-step hue wheel, two greys) in most files, monochrome palettes included, so this is not a 16-colour display mapping; likely the colour editor's custom swatches \[I\]. Absent in .PC3 | C layout, I meaning |

Custom palettes (.PC3) are plain colour lists, not role palettes: every role byte is 0xFF and the names have no "|role" part ("White", "Gray LL"). No sample chart names a .PC3. \[C\]

A role number r refers to palette entry r − 1. Role 0 means "none" (do not draw). \[C for r − 1, I for 0\]

Entries 0 to 41 are roles with fixed meanings; their names are usually "colour description|role", for example "Yel  L|Title" (26 of the 31 sample .PL3 files; a few use other naming, such as "1. Title"). Names may have junk bytes after the NUL. Entries 42 to 63 are extra named colours for drawings. The role names, by role number: \[C\]

| Role | Name | Role | Name |
| --- | --- | --- | --- |
| 1 | Title | 17 | BulletDm (dimmed bullet) |
| 2 | SubTitl1 | 18 | Lines |
| 3 | SubTitl2 | 19 | Shadow |
| 4 | Text | 20 | Legend |
| 5 | TextHigh | 21 to 26 | Series1 to Series6 |
| 6 | TextDim | 27, 28 | GoalY1, GoalY2 |
| 7 | Footnote | 29 to 31 | Draw1 to Draw3 |
| 8 | XLabel | 32 | Outlines |
| 9 | Y1Label | 33 to 42 | Range1 to Range10 |
| 10 | Y2Label | 43 to 64 | Extra named colours |
| 11 | XTitle |  |  |
| 12 | Y1Title |  |  |
| 13 | Y2Title |  |  |
| 14 | Frame |  |  |
| 15 | FrameBkg (page background) |  |  |
| 16 | Bullet |  |  |

Series beyond the sixth reuse Series1 to Series6 in turn. \[C from the series records\]

**On screen** \[C from renders made in Harvard Graphics 3.05 in VGA ScreenShow, EGA and Hercules modes\]. On a 16-colour display the original never shows the palette's RGB as such. In VGA ScreenShow mode it loads one fixed set of 16 display colours for every chart: black, white, red, orange, yellow, yellow-green, green, spring green, cyan, azure, blue, violet, magenta, rose, dark grey and light grey. Every other palette colour is drawn as a one-pixel checkerboard of two of these. EGA (640 × 350) draws with its own 16 colours the same way; Hercules (720 × 348) is black and white, with colours turned into fill patterns. A viewer that draws the palette's true RGB will not match a screenshot pixel for pixel: compare after a 2 × 2 blur, or by colour role.

### 6.3 Fills, patterns and bitmaps

- Solid fills use a colour role (5.6). \[I\]
- Pattern fills use the PATT\*.PCC bitmaps shipped with the program, named by a 404 kind 5 reference; gradient and "special effects" fills exist in the editor (named Gradient, Bitmap, Shadow, Emboss, Hilight) but their storage is not yet decoded. \[C for the names, ? for the storage\]
- Backgrounds and logos are PCX bitmaps (.PCX, or .PCC for a cut-out piece) named by a 404 kind 5 reference and drawn by an object with a 0x1140 attribute: one bitmap pixel per screen pixel, the hot spot (0x1140) on the centre of the object's bounding box (the bitmap starts at screen pixel floor(centre − hot spot)), repeated in both directions and clipped to the box (fit mode 0). With fit mode 2 the bitmap is drawn once over the box: on screen the box covers the pixels whose centres lie inside it (D across), and box pixel i shows bitmap pixel round(i·n/D) with halves rounded down, so the first and last box pixels show the first and last bitmap pixels; HG makes the box on import so the bitmap spans the page width at EGA pixel aspect (480/350). Each pixel is drawn as the screen's fill dither of its colour; monochrome bitmaps use the 0x110C colour for black pixels and the 0x110B colour for white. \[C, from the reference renders\] \[I\] PCX is a documented ZSoft format readable by many open-source libraries.

### 6.4 Text

- Each text line names its font by font key (section 2) and its size as an f32.
- The size is a **percent of the page's shorter side** in page units (24576 on a 10 × 7.5 in page, 25321 on Letter): the stored em of a line is that share, rounded down, and a size-9 title on a 7.5 in page is about 0.68 in (49 points) tall. \[C, by test charts at sizes 2.5, 6 and 12 on both pages\] Ascent, descent and line spacing are in 5.5, "Layout rules measured in 3.05".
- Lines are laid out as the sum of the glyph advances; kerning is not applied. \[I\]
- Justification is relative to the area the text belongs to (title area, plot area, or the text box of a text object). \[I\]
- Characters are 8-bit codes in the Harvard Graphics character set; the font index maps them to glyphs (section 2). Its upper half is close to code page 850 (for example 0xB5 Á, 0xC6 ã, 0xD0 ð, 0xE0 Ó, 0x9B ø, 0x9E ×, 0xB8 ©, 0xA9 ®), with codes of its own: 0xB9 Œ, 0xCA and 0xCB curly double quotes, 0xEE and 0xEF curly single quotes, 0xF0 ‰, 0xF2 ≥, 0xF3 ≤, 0xF4 ¶, 0xF5 §, 0xF9 ►, 0xFD minus sign, and 0xFF a pictograph with no Unicode equivalent. \[C, from the glyphs the Speedo fonts draw for each code\] The full table is in the viewer's src/formats/charset.ts; 0xFA is a medium round bullet (•) and 0x07 a larger one (●).
- If a font file is missing, substitute a similar modern font: Swiss 721 ≈ Helvetica or Arial, Dutch 801 ≈ Times, Geo Slab 712 ≈ Rockwell or Memphis, Monospace 821 ≈ a sans-serif monospace, HG Roman/Sans/Script/Gothic ≈ single-stroke Hershey fonts. \[I\]

### 6.5 Drawing order

For each chart: background, then the data chart (5.5), then the object layer in file order (later objects on top), then the button chart's objects if any. Within a group (608 ... 610), draw members in order. \[I\]

## 7. Errors, open questions, samples needed and sources

### 7.1 Error cases a viewer should handle

| Situation | Suggested behaviour |
| --- | --- |
| Signature is not HGB3, HGB1 or HGA2, or the version record is not first | Reject the file: "not a Harvard Graphics 3 file". Harvard Graphics 2 files (.CHT, .SHW) are a different format. |
| A record's length runs past the end of the file | Stop reading at that record; draw what was read and report the file as damaged. |
| No end record (tag 1) | Treat the end of file as the end; warn. |
| Unknown tag or sub-tag | Skip it by its length. |
| An object's sub-record list has no 0x1FFF | Stop at the end of the 612 record. |
| A referenced file is missing | Slide file: show an empty slide with the file name and carry on. Palette: use HG3.PL3, or a built-in copy of its colours. Bitmap: draw nothing for that fill. Font: substitute (6.4). |
| Empty palette or role out of range | The original refuses to draw a chart with an empty palette; a viewer should fall back to the default palette. |
| Negative pie value | The original treats this as an error; skip that slice. |
| A show nests shows | The original allows one level of nesting only (a nested show may not contain another show). A viewer should allow nesting but guard against a show that includes itself. |
| More than 100 buttons | The original only makes 100 buttons available; a viewer need not limit this. |

The original program's limits seen in its messages: at most 10 changes of text attributes within one text line; at most 100 buttons per chart; one level of nested shows. \[C that the program states these limits\]

### 7.2 Open questions

In rough order of how much they matter to a viewer:

1. **Remaining slide-entry bytes:** 702 offsets 3, 4, 13, 16 and 17 (3 and 4 look like sound options) and 708 bytes 0 and 1. The transition and timing bytes are decoded (4.2, 4.5).
2. **Data chart layout.** How the original places axes, tick marks, labels, legends, pie slices (start angle, direction, 3-D depth, exploded slices) and organization boxes. Largely answered for pie and XY charts: the drawn copy holds the original's own layout (5.1, 5.5), and the pie and XY option records are decoded (5.4). Still open: the original's layout for a chart without a drawn copy, and organization charts.
3. **Series types and chart styles:** decoded by test pairs for pie (1304 to 1316) and XY (1402 to 1418) in 5.4. Still open: XY 1414 (no setting tried changes it), the High/Low styles and line fits past the second choice, and Paired bars, which are known only from the samples.
4. **Object attributes** 0x1100 to 0x1140: line width and style, fill kinds, gradients, shadows, patterns.
5. **Text block** 0x10B0 header fields and text record 800 offsets 6 and 7.
6. **Text metrics** for fonts other than Swiss 721 Roman (the size unit itself is confirmed, 6.4).
7. **Animated drawings**: where the Draw/Erase animation steps of a drawing are stored.
8. **FN3 stroke fonts**: glyph layout.
9. The remaining small records: 402, 516 boxes, 708 to 714, 820, 822, 824, the 1554 fields, 614, 1700, and the meaning of destinations 0x96 and 0x97.

### 7.3 Samples and evidence still needed

- **Reference pictures from the original program** for a handful of the sample files (GALD111 in particular, to see where GALBUTN2's button bar sits relative to the chart title): the tutorial charts (PIETUT, XYTUT, ORGTUT, DRAWTUT), a few gallery charts of each type, and GALLERY.SH3 played through. Screenshots taken in DOSBox at 640 × 480 are enough. These would settle chart layout, text size, line widths and fills. Done: every sample chart and show slide is rendered in VGA, EGA and Hercules modes, kept privately with the samples; the layout rules themselves are still to be derived from them.
- **The show editor's slide list for GALB1.SH3 and PLAY\_ALL.SH3**, showing each slide's transition, direction, speed and time. Done: captured for all 13 shows, and the 702 fields are pinned down (4.5).
- **Pairs of files that differ in one setting**, made in Harvard Graphics 3 (for example the same pie with the start angle changed, or the same slide with only the transition changed). These are the fastest way to decode the remaining option bytes. Done for transitions, timing, pie and XY options: the test files are in samples/option-tests. Still needed for organization charts.
- The Harvard Graphics 3 user manual, if available, for the meaning of options and limits.

All of this can be gathered by running the original program in an emulator; nothing more is needed from its code.

### 7.4 Sample set

The findings here were checked against the files on the supplied Harvard Graphics 3.05 disks (projector disk and install disks 1 to 5): 238 charts of all seven chart types, 13 shows including nested shows, sound and MIDI slides and HyperShow buttons, 37 palettes, the font index and the program's own message and menu text. The installer stores its files in Knowledge Dynamics LIF archives; a viewer never needs to read those.

### 7.5 Sources

- Deark, by Jason Summers: its Knowledge Dynamics ("kdc") module documents the LIF installer archive header. It was used only to understand how the installer stores files, not for any Harvard Graphics document format. https://github.com/jsummers/deark
- Bitstream Speedo font format: published by Bitstream; implemented in the X11 Speedo rasteriser and formerly in FreeType. Needed for the BX\*.SPD fonts.
- ZSoft PCX format: widely documented; needed for backgrounds, patterns and logos.
- Public file-format registries (PRONOM, file-extension sites) identify .CH3 and .SH3 as Harvard Graphics 3 chart and show files but give no internal layout, so nothing here is drawn from them. RECOIL, dexvert and the Just Solve wiki were not checked in detail for this version.
- The style of this document follows William's earlier ExecuVision Picture Command specification (github.com/unamanic/execuvision-picture-command).
