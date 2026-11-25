# Legend, stacked-order and clean-save tests (Harvard Graphics 3.05)

Made in Harvard Graphics 3.05 under DOSBox-X. Each file changes one setting from the base named in the table: XBASE is in ../xy (bar chart, Series 1 = 10, 20, 30, Series 2 = 5, 15, 25), PLEGL3 is in ../pie (pie with the legend at location 8). `screens/` holds a screenshot of Harvard Graphics' own screen for each file (F2, 640 × 480). The findings are in docs/SPEC.md 5.4 (1306 and 1418) and 5.5.

Diff a file against its base by record tag and occurrence, skipping the drawing layer (tags 516, 517, 608, 610, 612).

| File | Base | Change | Bytes that changed |
| --- | --- | --- | --- |
| XDTAB2 | XBASE | Data table: Show With chart (clean replacement for xy/XDTAB) | 1410[0] 1 -> 2 |
| XLEGIN | XBASE | Legend placement Inside (clean replacement for xy/XLEGPL) | 1418[1] 2 -> 1, areas 806 and 810 |
| XSTK, XOVL, XPCT1, XSTEP | XBASE | Bar style Stack, Overlap, 100 %, Step | 1408[0] 1 -> 3, 2, 4, 5 |
| XSTKIN, XOVLIN | XSTK, XOVL | Legend placement Inside | 1418[1] 2 -> 1 |
| XSTKL8 | XSTK | Legend location 8 (bottom middle) | 1418[2] 5 -> 8 |
| XLOC1 to XLOC4, XLOC6 to XLOC12 | XBASE | Legend location 1 to 12 (5 is the default) | 1418[2], areas 806 and 810 |
| PLOC1 to PLOC4, PLOC9 to PLOC12 | PLEGL3 | Legend location (5 to 8 are pie/PLEG, PLEGL1 to PLEGL3) | 1306[2], areas 806 and 810 |
| PLFS3 to PLFS10 | PLEGL3 | Legend frame style 3 to 10 | 1306[3] |
| XLFS3 to XLFS12 | XBASE | Legend frame style 3 to 12 | 1418[3] |

What they show:

- Column legends list series bottom-up when the bar style is Stack or 100 %, whatever the placement (XSTK, XSTKIN, XPCT1); Cluster, Overlap and Step list top-down. A row legend (XSTKL8) lists left to right even for Stack.
- Frame styles in the menu: 1 None, 2 Plain, 3 Frame, 4 Rounded, 5 Octagonal, 6 to 9 3-D (four shadow directions), 10 and up Page (folded corner, several directions).
