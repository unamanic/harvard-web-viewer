# Page size and text size tests (Harvard Graphics 3.05)

Made in Harvard Graphics 3.05 under DOSBox-X to answer one question: are the different pie sizes and text sizes between the Letter test charts and the 10 × 7.5 in gallery samples caused by the page size? They are not (see docs/SPEC.md 5.5, "Layout rules measured in 3.05").

Each "M" file is a copy of a Letter test chart from ../pie or ../xy with only the chart proportions changed (Options > Appearance > Chart proportions, list entry "IBM Monitor 7.5 × 10"). Only record 816 differs from the original before the drawing layer. `screens/` holds a screenshot of Harvard Graphics' own screen (F2) for each file, 640 × 480.

| File | Copy of | Change |
| --- | --- | --- |
| PMBASE, PM3D, PMCUT, PMVADJ, PMLEG, PMPCT | pie PBASE, P3DSE2, PCUT2, PVALADJ, PLEG, PPCT | page 10 × 7.5 in (816 byte 1 = 14) |
| XMBASE, XMLEGNO, XMDLBL | xy XBASE, XLEGNO, XDLBL | page 10 × 7.5 in |
| PT6, PT12, PT25 | pie PBASE (Letter) | title size 6, 12 and 2.5 (Options > Text attributes > Title size) |
| PMT6, PMT12, PMT25 | PMBASE (10 × 7.5 in) | title size 6, 12 and 2.5 |

What they show:

- Pie radius as a share of the plot area height is the same on both pages: 0.34 with two label lines, 0.40 with one, 3-D 0.44, and 0.7 × 0.34 with a cut slice.
- Text em = size % × the page's short side (25321 units on Letter, 24576 on 10 × 7.5), rounded down; the stored ems are 1519, 3038 and 632 on Letter and 1474, 2948 and 614 on 10 × 7.5 for sizes 6, 12 and 2.5.
