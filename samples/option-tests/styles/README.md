# Axis frame, bar style, goal range, pie label and fill tests (Harvard Graphics 3.05)

Made in Harvard Graphics 3.05 under DOSBox-X. Each file changes one setting from the base named in the table. Bases are in ../xy and ../pie, except XSTK, which is in ../legend. `screens/` holds a screenshot of Harvard Graphics' own screen for each file and for the bases (F2, 640 × 480). The findings are in docs/SPEC.md 5.4 and 5.5.

| File | Base | Change | Bytes that changed |
| --- | --- | --- | --- |
| XAF3, XAF4, XAF5 | XBASE | Axis frame style X, Y, None (xy/XFRST is style 2, XY) | 1404[0] 1 -> 3, 4, 5 |
| XS2D2, XS2D3, XS2D4 | XBASE | Style > 2D style Shadow, Link, Horizontal | 1408[13] 1 -> 2, 3, 4 |
| XSTKLK | XSTK | 2D style Link on stacked bars | 1408[13] 1 -> 3 |
| XGOALB | xy/XGOALMN | Y1 goal range maximum 22 (minimum 12 already set) | 1402 axis 1 f64 maximum |
| XFSP, XFSB | XBASE | Series 1 fill style Pattern, Both (clean replacements for xy/XS6FS) | 1406 series 0 [7] 1 -> 2, 3 |
| XFSPP, XFSBP | XFSP, XFSB | Series 1 fill pattern 6 | 1406 series 0 [8] 0 -> 5 |
| XFSBC | XFSBP | Series 1 fill colour Series3 | 1406 series 0 [9] 21 -> 23 |
| XFSP2 | XFSP | Series 2 fill style Pattern | 1406 series 1 [7] 1 -> 2 |
| PPCTADJ | pie/PPCT | Percents placed Adjacent | 1312[2] 1 -> 2 |
| PVPADJ | PPCTADJ | Values placed Adjacent too | 1314[2] 1 -> 2 |
| PBOTHIN | pie/PPCTPI | Values placed Inside too | 1314[2] 1 -> 3 |
| PPAT5 | pie/PFILLP | Slice 1 pattern 5 (Pattern column of the data screen) | 1316 slice 0 [4] 0 -> 5 |
| PPATC | PPAT5 | Slice 2 colour Draw1 | 1316 slice 1 [3] 22 -> 28 |
| PBPAT5 | pie/PFILLB | Slice 1 pattern 5 | 1316 slice 0 [4] 0 -> 5 |
| PBCOL | PBPAT5 | Slice 1 colour Draw1 | 1316 slice 0 [3] 21 -> 29 |

What they show:

- Axis frame styles are Full, XY (left and bottom edges), X (bottom edge), Y (left edge) and None.
- 2D styles are Normal, Shadow, Link (lines joining the tops of each stacked segment from bar to bar; no change on clustered bars) and Horizontal.
- A goal range with both bounds draws a filled band across the frame between them, in the goal colour, under the grid and bars. With one bound only, nothing is drawn.
- Pie labels always give the value before the percent, joined by two spaces, in whichever place they share (Below, Adjacent or Inside).
- Fill styles are Color, Pattern and Both, for pie slices and XY series alike. Pattern 0 (shown as 1 in the XY Series menu) is a solid fill. Pattern draws white patterns with white outlines and ignores the slice or series colour; Both draws the pattern in the slice or series colour.
