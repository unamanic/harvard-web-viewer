# Harvard Graphics 1.0 and 2.x File Format Spec (clean room)

Nov 25, 2026 · @William Witt

## 1. Scope and method

This spec covers chart files (.CHT) and slide show files (.SHW, §5) from four DOS releases: Harvard Presentation Graphics **A.00** (shown as "Version A 27 Feb 1986", called 1.0 here), Harvard Graphics **2.10**, **2.12** and **2.30** (2.301). Version 1.0 uses a fixed 4716-byte layout with the signature `PCOK`; all 2.x versions use a tagged record container with the signature `Falc`. Neither is the 3.05 format (`HGB3`), which has its own spec.

Method (clean room): every field here comes from files the programs saved and what their screens show. Each program was installed from William's disks and run in an emulator (DOSBox-X for 2.x; PCE with GLaBIOS and FreeDOS for 1.0, run from its original copy-protected floppy, protection untouched). For each option a base chart was saved, one setting changed, the chart saved again, and the two files diffed. No program code was disassembled or read. The 2.10 manual PDF was used as background for option names only.

Confidence marks:

- **[C]** confirmed by one-setting test pairs.
- **[I]** inferred from samples, defaults or a pattern (not individually tested).
- **[?]** seen but not understood.

Conventions: offsets are decimal bytes from the start of the file (1.0) or the start of a record's data (2.x). All integers are little-endian. `u8`/`u16` are unsigned; `f32` is an IEEE single. A **pstring** is a length byte followed by that many characters (code page 437) inside a fixed-size field; bytes after the length are leftover memory and must be ignored. The value **1e30** (bytes `ca f2 49 71`) means missing data or "auto" for an axis setting, in every version.

## 2. Version 1.0 (HPG A.00): the PCOK layout

A 1.0 chart is a fixed 4716-byte block, optionally followed by an annotation trailer. Every chart type uses the same header; the body layout depends on the class. Test files: 50 charts in `hg2x/v100/`, plus the 5 samples on the A.00 utility disk.

### 2.1 Header

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | char[4] | `PCOK` signature | C |
| 4 | u16 | 1 (format version?) | I |
| 6 | pstring, 41-byte field | Description (defaults to the first title line) | C |
| 48 | u16 | Class: 1 text, 2 graph, 3 org | C |
| 50 | u16 | Subtype. Text: 0 title, 1 simple list, 2 bullet list, 3 two columns, 4 three columns, 5 free form. Graph: 0 pie, 1 bar/line, 2 area, 3 high/low/close. Org: 0 | C for title, free form, pie, bar, area, HLC, org; I for the rest |
| 56 | u16 | 4716 when a trailer follows, else 0 (offset of the trailer) | I |
| 58 | u16 | Trailer length in bytes (0 = none) | C |
| 60 | u8 | 1 | ? |

### 2.2 Text charts (class 1)

| Offset | Layout | Meaning | Mark |
| --- | --- | --- | --- |
| 160 + 42k | pstring, 42-byte field | Line k text, k = 0..50 | C |
| 2302 + 40k | u8[40] | Line k attributes, one byte per character | C |
| 4342 + 4k | f32 | Line k size | C |
| 4546 + k | u8 | Line k place: 1 left, 2 centre, 3 right | C |
| 4598 | u8 | 1 or 3 in samples; bullet style? | ? |

Attribute byte (same bits as 2.x): 0x01 no fill, 0x02 bold, 0x04 italic, 0x08 underline, high nibble = colour minus 1. Default 0x02 (colour 1, filled, bold). [C]

Title chart: lines 0 to 2 are the top block (size 8), 3 to 5 the middle (6), 6 to 8 the bottom (4). [C] List charts put the title, subtitle and footnote on fixed lines like 2.x; columns are stored as separate lines. [I]

### 2.3 Graph charts (class 2)

Text records are 90 bytes at 160 + 90r: pstring (42-byte field), attributes u8[40], f32 size at +82, place u16 at +88 (1 left, 2 centre). [C]

| r | Text | Default size |
| --- | --- | --- |
| 0 | Title | 8 |
| 1, 2 | Subtitle | 6 |
| 3 to 5 | Footnote (left) | 2.5 |
| 6 | X axis title | 4 |
| 7 | Y axis title | 3 |
| 8 | Pie 1 title | 5 |
| 9 | Pie 2 title | 5 |

Series (8 of them, s = 0..7):

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 1060 + 22s | pstring, 22-byte field | Series name (default "Series A" to "Series H"; HLC "High", "Low", "Close", "Open") | C |
| 1236 + s | u8 | Display: 1 yes, 0 no | C |
| 1244 + s | u8 | Type: 1 bar, 2 line, 3 trend, 4 curve, 5 point. Area and HLC store 1 and take the look from the subtype | C (1 to 4), I (5) |
| 1252 + s | u8 | Cumulative: 1 yes, 0 no | C |
| 1260 + s | u8 | Colour (defaults 2 to 9) | C |
| 1268 + s | u8 | Line style: 1 solid, 2 double, 3 dotted, 4 dashed | C |
| 1276 + s | u8 | Marker or fill pattern, 1 to 8 | C |
| 1284 | u8 | Copy of the graph subtype (1 bar, 2 area, 3 HLC) | I |
| 1302 | u16 | Number of X points | C |
| 1304 | u16 | X data type (1 = Name; other types untested) | C (Name) |
| 1306 + s | u8 | Points entered per series | I |
| 1314 + 240s + 4p | f32 | Value of series s at point p, p = 0..59 | C |
| 3330 + 22p | pstring, 22-byte field | X label for point p | C |

Options:

| Offset | Meaning | Values | Mark |
| --- | --- | --- | --- |
| 4650 | Value labels | 1 yes, 2 no | C |
| 4651 | Horizontal | 1 yes, 2 no | C |
| 4652 | Fill | 1 colour, 2 pattern, 3 both | C |
| 4653 | Bar style | 1 normal, 2 overlap, 3 stack, 4 100% | C |
| 4654 | Grid | 1 dotted, 2 solid, 3 vertical, 4 cross, 5 none | C |
| 4655 | Legend justify | 1 left/top, 2 centre, 3 right/bottom | C |
| 4656 | Legend location | 1 top, 2 bottom, 3 left, 4 right, 5 none | C |
| 4657 | Frame | 1 full, 2 half, 3 quarter, 4 none | C |
| 4658 | Y labels | 1 value, 2 dollars, 3 percent, 4 none | C |
| 4664 | 3D (bar and pie) | 1 yes, 0 no | C |
| 4668 to 4688 | f32 X min, X max, X increment, Y min, Y max, Y increment | 1e30 = auto | C |
| 4659 to 4663, 4665 to 4667 | Unknown |  | ? |

Area charts (subtype 2) have no bar style, 3D or value labels on their options screen; HLC (subtype 3) is similar. Series 1 to 4 of an HLC chart are High, Low, Close, Open by position; 5 to 8 default to lines. [C]

### 2.4 Pie charts (graph subtype 0)

Pie 1 takes its values from series A and its labels from the X labels. [C] Pie 2 uses series B. [I]

| Offset | Meaning | Mark |
| --- | --- | --- |
| 3238 + 12k + p | Slice colour, pie k (0 or 1), slice p (defaults 2 to 13) | C (pie 1) |
| 3262 + 12k + p | Slice pattern (1 to 12) | C (pie 1) |
| 3288 + p | Pie 1 slice cut out: 1 yes, 0 no | C |
| 3300 + p | Pie 2 slice cut out | I |
| 4692 | Pie 1 style: 1 pie, 2 column | C |
| 4693 | Pie 2 style: 1 pie, 2 column, 3 none | C |
| 4694 | Pie 1 labels: 1 value, 2 percent, 3 dollars, 4 none | C |
| 4695 | Pie 2 labels | I |
| 4696 | Link pies: 1 yes, 0 no | C |
| 4698 | Pie 1 sort: 1 yes, 0 no | C |
| 4699 | Pie 2 sort | I |
| 3234 to 3237, 3286 to 3287 | Unknown (3286-3287 = 01 02) | ? |

### 2.5 Org charts (class 3)

The chart title is the pstring at 160 [I]. 32 nodes of 130 bytes start at 410 + 130(n-1), node numbers counting from 1. The node record and the options tail have exactly the same layout as 2.x (section 4.6); only the node count and base offsets differ. The options tail starts at 4570 (2.x: 10770 inside tag 62). [C]

### 2.6 Annotation trailer

Charts with drawn objects carry a trailer at offset 4716 whose length is in the header at 58. Decoded statically from the three samples that have one, so mostly [I]:

| Offset in trailer | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | u16 | 1, 3 or 4 in samples (colour?) | ? |
| 2 | f32 | 10.0 or 5.5 (size or line width?) | ? |
| 6 | u8 | Object kind: 1 polyline, 2 polygon | I |
| 7 | u8 | 0 or 1 (fill or closed flag?) | ? |
| 8 | u8 | Point count n | I |
| 9 | u16 x, u16 y, repeated n times | Points in a 0..~32767 page space (samples run x 2687 to 24115, y 1951 to 15199) | I |
| 9 + 4n | u16 | Length of this object (lets a reader walk backwards) | I |

Each sample holds one object, so how several objects chain is open. Text annotations were not seen.

## 3. Versions 2.10, 2.12 and 2.30: the Falc container

A 2.x chart is the 4-byte signature `Falc` followed by records of `u16 tag, u16 length, data[length]`. The file ends with tag 31 (length 0) and then tag 1 (length 0). All 42 shipped 2.x sample charts and all test charts parse exactly to end of file with this rule. [C] A reader should skip tags it does not know, using the length.

### 3.1 Records

| Tag | Length | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | 4 | Version: `00 02 vv 01`, vv = 2 from 2.30, 0 from 2.10 and 2.12 | C |
| 30 | 4 | u16 class (1 text, 2 graph, 3 org, 4 multiple), u16 subtype (as 1.0; multiple: 1 = "Two" layout, others I) | C |
| 2 | var | Description pstring | C |
| 10 | 21 | Unknown settings block (`00 01 01 01 00 01 ... 10 27 ...`) | ? |
| 316 | 30 | Written only by 2.30; holds the pstring `hg23` (palette name?) | C (presence), ? (meaning) |
| 15 | 2 | Unknown, `00 00` | ? |
| 33 | var | One text line (section 4.1) | C |
| 34 | var | Series name or legend title: u16 index (0 legend title, 1 to 8 series), pstring, 3 bytes | C |
| 50 | 7 | Text chart layout: [0] 0 for title charts, 1 otherwise; [1] u16 2000 for column and free-form charts | I |
| 100 | 10 | Per-series options (section 4.2) | C |
| 120 | 55 | Graph options (section 4.2) | C |
| 121 | 75 | Axis scales and formats (section 4.2) | C |
| 150, 151, 153 | var | Pie slice colour, pattern, cut (section 4.4) | C |
| 160 | 53 | Per-pie options (section 4.4) | C |
| 200 | 8 | u16 point count, u16 X data type (1 = Name), rest unknown | C (first 4 bytes) |
| 201 | 16 | u16 point count, rest unknown | ? |
| 205 | var | X label: u16 series (1), u16 point index (from 1), pstring | C |
| 207 | var | Present when the X data type is not Name | ? |
| 208 | var | Values: u16 series, u8 count, u8 unused, then f32 per point (1e30 = missing) | C |
| 62 | 10826 | Org chart body (section 4.6) | C |
| 90 | var | One multiple-chart slot (section 4.7) | I |
| 300 | var | Drawn annotations (Draw/Annotate), large; not decoded | ? |
| 31 | 0 | End of chart data | C |
| 1 | 0 | End of file | C |

### 3.2 Differences between 2.10, 2.12 and 2.30

The three versions share one layout. 2.10 and 2.12 load 2.30 files of every chart type and save them back byte for byte, except for three things [C]:

1. Tag 0 byte 2 is 0 in 2.10 and 2.12, 2 in 2.30.
2. Tag 316 is written only by 2.30 (2.10 and 2.12 drop it).
3. Tag 33 byte 14 is set to 1 by 2.30 after a chart has been drawn or loaded; 2.10 and 2.12 always write 0.

Options that look new (paired bars, error bars) are kept by 2.10 and 2.12 and also appear on their screens, so a reader can treat all 2.x files the same way. [C] Version 2.12 (the WinWorld disk set) was confirmed from its sign-on screen and overlay names (HG212_*).

## 4. 2.x chart records

Test files: 160 charts from 2.30 in `hg2x/v230/`, and resaves from 2.10 (`v210/`, Z-prefixed) and 2.12 (`v212/`, W-prefixed).

### 4.1 Text lines (tag 33)

| Offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | u16 | Group: 0 text chart body (lines 0 to 50), 1 title and subtitle (lines 0 to 2), 2 footnote (lines 1 to 3), 3 axis titles (0 X, 1 Y1, 2 Y2), 5 pie titles (lines 1 to 4) | C |
| 2 | u16 | Line number in the group | C |
| 8 | f32 | Size | C |
| 12 | u8 | Unknown | ? |
| 13 | u8 | Place: 1 left, 2 centre (3 right, I) | C |
| 14 | u8 | 0 when new, 1 once drawn (2.30 only, section 3.2) | C |
| 22 | pstring | Text | C |
| after text | u8 + pairs | Attributes, run-length: u8 field width (60 text charts, 40 graph titles), then (attribute, count) pairs | C |

Attribute byte: 0x01 no fill, 0x02 bold, 0x04 italic, 0x08 underline, high nibble = colour minus 1; default 0x02. Default sizes: title chart top 8, middle 6, bottom 4; list title 8, subtitle 6, footnote 3.5; graph footnote 2.5, X axis title 4, Y axis titles 3, pie titles 5. [C] Columns in column charts are stored as separate lines. [I]

### 4.2 Bar and line charts (graph subtype 1)

Tag 100, one per series:

| Offset | Meaning | Values | Mark |
| --- | --- | --- | --- |
| 0 | u16 series number | 1 to 8 | C |
| 2 | Display | 1 yes, 2 no | C |
| 3 | Type | 1 bar, 2 line, 3 trend, 4 curve, 5 point, 6 area | C |
| 4 | Cumulative | 1 yes, 2 no | C |
| 5 | Axis | 1 Y1, 2 Y2 | C |
| 6 | Colour |  | C |
| 7 | Line style | 1 solid, 2 double, 3 dotted, 4 dashed | C |
| 8 | Marker or pattern |  | C |
| 9 | Y label | 1 yes, 2 no | C |

Tag 120 (55 bytes):

| Offset | Meaning | Values | Mark |
| --- | --- | --- | --- |
| 0 | Enhancement | 1 3D, 2 shadow, 3 link, 4 none; HLC: 5 area, 6 error bar. Choosing 3D also sets [18] to [20] to 2 | C |
| 1 | Value labels | 1 all, 2 select, 3 none | C |
| 2 | Horizontal | 1 yes, 2 no | C |
| 3 | Fill | 1 colour, 2 pattern, 3 both | C |
| 4 | Bar style | 1 cluster, 2 overlap, 3 stack, 4 100%, 5 step, 6 paired | C |
| 8 | Legend justify | 1, 2 centre, 3 | C |
| 9 | Legend location | 1 top, 2 bottom, 3 left, 4 right (5 none, I) | C |
| 10 | Legend placement | 1 inside, 2 outside | C |
| 11 | Legend frame | 1 single, 2 shadow, 3 none | C |
| 12 | Frame | 1 full, 2 half, 3 quarter, 4 none | C |
| 13, 14 | Frame colour, frame background |  | C |
| 15, 16, 17 | Grid X, Y1, Y2 | 1 dotted, 2 solid, 3 none | C |
| 18, 19, 20 | Ticks X, Y1, Y2 | 1 in, 2 out, 3 both, 4 none (the Y field sets 19 and 20) | C |
| 21 | X labels | 1 normal, 2 vertical, 3 %, 4 none | C |
| 22, 23 | Y1, Y2 labels | 1 value, 2 currency, 3 %, 4 none | C |
| 25, 26 | X, Y1 scale | 1 linear, 2 log | C |
| 27 | f32 bar width | 1e30 auto; 30 stored as 0.3 | C |
| 31 | f32 overlap | default 0.5 | C |
| 35 | f32 3D depth | default 0.25 | C |
| 45 | Data table | 1 normal, 2 framed, 3 none | C |
| 5 to 7, 24, 39 to 44, 46 to 54 | Unknown (Y2 scale is probably among them) |  | ? |

Tag 121 (75 bytes): f32 minimum X/Y1/Y2 at 4/8/12, maximum X/Y1 at 16/20, increment X/Y1 at 28/32 (1e30 = auto) [C: BXMIN, BXMAX, BXINC, BY1MIN, BY1MAX, BY1INC, BY2MIN]; Y2 maximum at 24 and increment at 36 follow the pattern [I]. 13-byte format pstrings: X at 49, Y1 at 62 [C: BXFMT, BY1FMT]. Offset 0 is an f32 that BY2FMT set to 0.3 (meaning unknown) [?]. (An earlier version of this spec put the minimums at 0/4/8; the test files show them one field later.)

Data: tag 200 gives the point count; one tag 205 per X label; one tag 208 per series with its values. [C]

### 4.3 Area and high/low/close (subtypes 2 and 3)

Same records as bar charts. Area series show type 6. HLC series 1 to 4 are High, Low, Close, Open by position, and tag 120 [0] adds the area and error-bar enhancements. [C]

### 4.4 Pie charts (graph subtype 0)

Tag 160, one per pie (53 bytes):

| Offset | Meaning | Mark |
| --- | --- | --- |
| 0 | u16 pie number; [2] u8 pie number again | C |
| 3 | 3D | C |
| 4 | Link pies | C |
| 5 | Proportional: 1 yes, 2 no (global, copied to both) | C |
| 6 | Style: 1 pie, 2 column (3 none, I) | C |
| 7 | Sort | C |
| 8 | f32 start angle | C |
| 12 | f32 pie size (default 50) | C |
| 16 | Show label; [17] f32 label size (default 3) | C |
| 21 | Show value; [22] place value: 1 below, 2 adjacent, 3 inside | C |
| 23 | Currency | C |
| 24 | Show percent; [25] place percent | C |
| 26 | 13-byte pstring value format | C |
| 39 | 13-byte pstring percent format | C |
| 52 | Fill: 1 colour, 2 pattern, 3 both (global) | C |

Tags 150 (colour), 151 (pattern) and 153 (cut out: 1 yes, 2 no) are each `u16 pie number` then one byte per slice for slices 1 to 12. Defaults: colours 2 to 13, patterns 1 to 12. Slice values and labels use tags 208 and 205 as in bar charts; pie titles are tag 33 group 5. [C]

### 4.5 Text charts (class 1)

All lines are tag 33 group 0 (lines 0 to 50) with tag 50 for the layout. Bullet, column and free-form charts were saved and differ only in the subtype, tag 50 and the line contents. [C]

### 4.6 Org charts (class 3, tag 62)

Tag 62 is a 10826-byte block. It starts with the title pstring (other text before 370 is I). 80 nodes of 130 bytes follow at 370 + 130(n-1), node numbers from 1; unused bytes hold leftover memory. [C]

| Node offset | Type | Meaning | Mark |
| --- | --- | --- | --- |
| 0 | pstring, 24-byte field | Name | C |
| 24 | pstring, 24 | Title | C |
| 48 | pstring, 24 | Comment | C |
| 72 | pstring | Abbreviation (default two spaces) | C |
| 108 | u16 | Parent node (0 = none) | C |
| 110 | u16 | First child | C |
| 112 | u16 | Next sibling; also links the free list | C |
| 114 | u16 | Previous sibling | C |
| 116 | u16 | Number of children | C |
| 126 | u16 | Depth (root 0) | C |

The options tail starts at 10770 in tag 62 (4570 in a 1.0 file); offsets below are relative to it:

| Offset | Meaning | Values | Mark |
| --- | --- | --- | --- |
| 0 | u16 root node | 1 | I |
| 2 | u16 head of the free-node list |  | C |
| 4 | u16 levels to show | 1 all; n+1 shows n levels | C |
| 6, 10, 14 | f32 name, title, comment sizes | 6.0, 4.0, 2.5 | I |
| 18 to 21 | Unknown (`02 02 01 00`) |  | ? |
| 22 | Text lines per box (upper levels) | 1 to 3 | C |
| 23 | Text lines per box (last level) |  | C |
| 24, 25 | Show titles (upper, last level) | 1 yes, 0 no | C |
| 26, 27 | Show comments (upper, last level) | 1 yes, 0 no | C |
| 28, 29, 30 | Style of names, titles, comments | 0 light, 2 bold, 4 italic (titles default 4) | C |
| 36, 37, 38 | Colour of names, titles, comments | default 1 | C (36), I (37, 38) |
| 40 | Abbreviations | 1 yes, 0 no | C |
| 41 | Last-level arrangement | 1 vertical, 0 horizontal | C |
| 42 | Start chart at | 1 top, 0 current manager | C |
| 44 | 1 by default; cleared with a box-line change in 2.30 |  | ? |
| 54 | Shadow | 1 yes, 0 no | C |

### 4.7 Multiple charts (class 4)

Six tag 90 records, one per slot: u16 slot number (1 to 6), four u16 values that look like the slot's box (for example 0, 0, 12684 and 20000 for slot 1 of a "Two" layout), a 13-byte pstring 8.3 filename, a u8 then class and subtype bytes (filled only after the chart is loaded), 8 bytes, then the description pstring. Empty slots are all zero. [I]

## 5. Show and directory files

Shows were decoded from one-setting saves in 2.30 (`samples/hg1-hg2/shows/`, see its README), checked against the shipped samples of 1.0, 2.10, 2.12 and 2.30. Values marked [I] are inferred; the rest were confirmed by a test save.

**Directory file (HPG.DIR in 1.0, HG.DIR in 2.x).** The program keeps one per data directory to list charts with their descriptions. 1024 bytes: `pdir`, a u8 1, then 60-byte entries from offset 5. Both versions use the same entry: [0] u8 flag (0, 3 or `S` seen), [1] u8 1, [2] u8 class, [3] u8 subtype, [4] u8 unknown, [5] 13-byte pstring 8.3 filename, [18] description pstring. Class and subtype match the chart's own header, which a viewer should prefer.

### 5.1 How a show keeps its charts together

A show file holds no pictures. It names each slide's file (8.3 name only, no folder) and the program looks for it in the current data directory, so a show only works with its charts beside it. Both versions keep a **slot table** (one slot per file) and a separate **play order** that lists slot numbers. Moving a slide rewrites only the play order; deleting one frees its slot, and the next slide added takes the lowest free slot (S2MOVE, S3DELADD).

When a chart is missing, 2.30 skips it without a message in the middle of a show, and shows "PROBLEM: Cannot find the file. Press any key" when it is the last slide, then returns to the menu.

### 5.2 2.x layout (`SHOW`)

2.10, 2.12 and 2.30 use the same layout (the 2.10 and 2.12 SAMPLE.SHW files read the same way). 8192 bytes, little-endian.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | `SHOW` |
| 4 | u16 | Slide count |
| 6 | u16 | Always 16 (unknown) |
| 8 | 41 | Show description, pstring |
| 49 | u8 | 0 |
| 50 | u8 | Default time, minutes (ff with 51 = ff: none) |
| 51 | u8 | Default time, seconds |
| 52 | u8 | Default draw effect (sample shows: 1 when the row is blank [I]) |
| 53 | u8 | Default draw direction |
| 54 | u8 | Default erase effect |
| 55 | u8 | Default erase direction |
| 56 | u16 x 90 | Play order: 1-based slot numbers |
| 236 | 88 x 90 | Slots: slot n at 236 + 88 x (n - 1) |

Slot (88 bytes):

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 13 | File name, pstring, padded 8.3 (`HWV01   .CHT`) |
| 13 | u8 | Leftover memory |
| 14 | u8 | Class (as in the chart header): 0 file, 1 text, 2 graph, 3 org |
| 15 | u8 | Subtype. For class 0: 0 template `.TPL`, 1 show `.SHW`, 2 chart not in the directory cache, 3 bitmap `.PCX` [I] |
| 16 | 41 | Description, pstring (leftover memory after the text) |
| 57 | u8 | Leftover memory |
| 58 | 2 | 0 |
| 60 | u8 | Time, minutes; 60 and 61 both ff = blank (use the default; wait for a key when that is blank too) |
| 61 | u8 | Time, seconds (0:00 is stored 00 00) |
| 62 | u8 | Draw effect (0 = blank: use the default) |
| 63 | u8 | Draw direction (0 = blank) |
| 64 | u8 | Erase effect (0 = blank) |
| 65 | u8 | Erase direction |
| 66 | 2 | 0 |
| 68 | 10 | HyperShow keys for buttons 1 to 10, the character as typed (case kept; 0 = none) |
| 78 | 10 | HyperShow "Go To" for buttons 1 to 10: a play position, 1-based. The program renumbers these when slides move (S8MOVEHYP) |

**Effects** (draw and erase use one list, the F6 choices in order): 1 Replace, 2 Overlay, 3 Wipe, 4 Scroll, 5 Fade, 6 Weave, 7 Open, 8 Close, 9 Blinds, 10 Iris, 11 Rain. **Directions:** 1 Left, 2 Right, 3 Up, 4 Down, 5 In, 6 Out. There is no speed field.

Times are minutes and seconds in two bytes (0:05 is `00 05`, 1:30 is `01 1e`). The Default row's time and effects apply to slides whose own field is blank [I: read from the screen, not tested in playback].

A slot can name another show (`.SHW`, class 0/1), which plays in place, or a PCX bitmap (class 0/3); the 2.30 samples ANIMATOR.SHW and WPICK.SHW use both. WPICK.SHW's HyperShow menu binds keys 1 to 9 and H to Go To positions 3 to 12.

### 5.3 1.0 layout (`show`)

Decoded from the 1.0 sample (5120 bytes) and the 1.0 story show (23552 bytes, 20 slides); no one-setting tests, so [I] throughout.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | `show` (lower case) |
| 4 | u16 | Slide count |
| 6 | u16 x 49 | Play order; read as 1-based slot numbers like 2.x (both samples are in slot order, so this is untested) |
| 104 | 60 x 49 | Slots: slot n at 104 + 60 x (n - 1) |

Slot (60 bytes): [0] 13-byte pstring file name, [13] leftover byte (0x51 seen), [14] class, [15] subtype, [16] description pstring to 56, [57] leftover byte, [58] u16 that equals 2 x n + 4 for slot n, used or not, and 0 in the last slot (a chain of some kind [?]). There are no times, effects or keys: a 1.0 show waits for a key on every slide.

### 5.4 How the viewer plays a show

Slide 0 is a placeholder and slides 1 to n are the play positions, so HyperShow Go To numbers index the slides directly. Charts are found beside the show, case-insensitively, also inside a `.zip`. A missing file shows a note naming it (the program itself skips it). Weave and Rain have no equivalent in the viewer and are drawn as Blinds and Fade [I]. A letter key is matched in either case [I].

## 6. How 1.0 and 2.x compare with 3.05

The three generations share their option values and attribute bits but not their containers, so a viewer needs three readers that feed one chart model.

| Topic | 1.0 (A.00) | 2.10 / 2.12 / 2.30 | 3.05 |
| --- | --- | --- | --- |
| Signature | `PCOK` | `Falc` | `HGB3` (charts), others for shows |
| Container | Fixed 4716-byte block + annotation trailer | u16 tag, u16 length records, ends 31 then 1 | Tag/length records with different tag numbers (1304, 1306, 1310...) |
| Version field | u16 1 at 4 | Tag 0 `00 02 vv 01` | Tag 0 `00 03 00 type` |
| Chart kind | Class + subtype at 48/50 | Tag 30, same numbering | One document type code (0x01 XY, 0x15 pie, 0x1A org, 0x1F title, 0x20 bullet, 0x21 table, 0x29 drawing...) |
| Series | 8 series, 60 points, fixed arrays | 8 series, records per series | More series and points; see the 3.05 spec |
| Missing value / auto | 1e30 | 1e30 | 1e30 |
| Text attributes | One byte per character | Run-length (attribute, count) pairs | See 3.05 spec |
| Option values | 1-based codes, "no" is 0 or 2 | Same codes; "no" is always 2 | See 3.05 spec |
| Org chart | 32 nodes x 130 B | 80 nodes x 130 B, identical node and options layout | Different structure |
| Annotations | Trailer after 4716 (partly decoded) | Tag 300 (not decoded) | Drawing records (in 3.05 spec) |

One trap when porting values: 1.0 stores many yes/no options as 1/0, while 2.x stores 1/2 (display, cumulative, cut slices). Graph option codes otherwise carry over from 1.0 to 2.x unchanged where both have the option.

## 7. Open questions, test files and sources

Open questions, most useful first for a viewer:

1. **2.x annotations (tag 300)** and **1.0 annotation objects** beyond one polyline or polygon: text, arrows and several objects per chart need Draw/Annotate test pairs.
2. **Shows**: 1.0 play order with slides out of slot order, the 1.0 slot word at 58, the 2.x u16 at 6, and whether the program applies the Default row in playback exactly as the viewer does.
3. **X data types** other than Name (days, months, numbers) and tags 201 and 207 in 2.x, and the X type field at 1304 in 1.0.
4. Unknown bytes: 1.0 graph options 4659 to 4663 and 4665 to 4667; 2.x tag 120 bytes 5 to 7, 24, 39 to 44, 46 to 54 (including where the Y2 scale lives); tags 10 and 15; org tail 18 to 21 and 44.
5. 1.0 text byte 4598, and 1.0 subtypes 1, 3 and 4 (numbering assumed from 2.x and the directory file).
6. Multiple-chart slot geometry in tag 90.

No disk set had problems: all four installed and ran, and version 1.0 ran from its original floppy with the copy protection untouched.

**Test files** are in the project folder under `harvard-graphics/hg2x/`: `v100/` (50 charts from 1.0), `v230/` (160 from 2.30), `v210/` and `v212/` (resaves from 2.10 and 2.12), and `tools/` (the record parser and diff scripts used). Names say what changed, for example `B3` = one bar option changed from `BBASE`.

**Sources:** the four disk sets William supplied; the 2.10 manual PDF for option names only; PCE emulator built from jsdf/pce commit b2e4b44; GLaBIOS 0.4.0 ROM from the 86Box/roms repository (commit de5a7d21); a FreeDOS 1.4 720K boot floppy; DOSBox-X for 2.x. Companion spec: [Harvard Graphics 3.05 spec](SPEC.md).
