# XY test charts (Harvard Graphics 3.05)

Made in Harvard Graphics 3.05 under DOSBox-X. XBASE.CH3 is a bar chart: title Test, X labels Jan, Feb, Mar, Series 1 = 10, 20, 30, Series 2 = 5, 15, 25. Each other file changes one option. The findings are in docs/SPEC.md, section 5.4 (XY) and 5.5.

Early pairs differ from XBASE by one setting. From the data table pairs on, each file was saved right after one change and should be diffed against the file saved just before it (the XS... "R" files are the reverts). Compare records by tag and occurrence, skipping the drawing layer (tags 516, 517, 608, 610, 612).

| File | Change (menu > row) | Bytes that changed |
| --- | --- | --- |
| XLOG | Axis options > Y1 scale type Log | 1402 axis 1 [1] 1->2 |
| XSCALE | Y1 scale factor 2 | 1402 axis 1 f64 at [2] |
| XMIN5 / XMAX50 | Y1 minimum 5 / maximum 50 | 1402 axis 1 f64 at [10] / [18] |
| XXMAX9 / XY2MAX | X maximum 9 / Y2 maximum 70 | 1402 axis 0 / axis 2 f64 at [18] |
| XGRIDS / XGRIDN | Y1 grid Solid / None | 1402 [26] 1->2 / 1->3 |
| XMAJIN / XMAJOUT / XMAJBOT | Y1 major ticks In / Out / Both | 1402 [27] 4->1 / 2 / 3 |
| XMINBOT | Y1 minor ticks Both | 1402 [28] 4->3 |
| XMAJI10 / XMINI2 | Y1 major increment 10 / minor 2 | 1402 f64 at [29] / [37] |
| XGOALMN / XGOALMX / XGOALC | Y1 goal min 12 / max 22 / colour Draw1 | 1402 f64 at [45] / [53], [61] 27->29 |
| XLBLNO, XPCT, XCUR, XSCI | Format > Y1 show labels No, percent, currency, scientific | 1402 [62], [63], [64], [65] |
| XDEC2 / XTHOUN | Y1 decimals 2 / thousands No | 1402 f64 at [66] / [74] |
| XLEAD / XTRAIL | Y1 leading "AB" / trailing "CD" | 1402 string at [75] / [88] |
| XDTGRID, XDLBL, XDTNO, XDTONLY | Data table/labels | 1410 [1], [2], [0] |
| XLEGNO, XLEGPL, XLEGFR, XLEGOC, XLEGFC | Legend | 1418 [0] to [5], areas 806/810 |

XDTAB and XLEGPL turned out to be the same as XBASE; clean saves of those two changes (XDTAB2, XLEGIN) are in ../legend.
| XFRST, XFROC, XFRFC, XFRSHF | Axis frame | 1404 [0] to [2], 1405 [0] |
| XSBSTY to XSOUT (XSR0 to XSRC reverts) | Style, rows 0 to 12 | 1408 |
| XS6SH to XS6MK (XS6R0 to XS6RD reverts) | Series 1, rows 0 to 13 | 1406 series 0 [1] to [14] |
| XREV1 to XREV9, XBASE2 | Checks that undoing a change gives the base again | |
