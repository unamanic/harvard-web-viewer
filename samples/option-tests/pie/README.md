# Harvard Graphics 3.05 pie test charts (2026-11-25)

Made in Harvard Graphics 3.05 under DOSBox-X, installed from William's disk images. Each file is the base pie with one setting changed, then saved. Saving the same chart twice gives identical bytes (PBASE vs PBASE2). Findings are in docs/SPEC.md, sections 5.4 (pie records) and 5.5 (stored drawing).

Base: PBASE.CH3. Title "Test"; slices Alpha 40, Beta 30, Gamma 20, Delta 10; everything else default.

Compare each file with PBASE record by record (same tag, same occurrence); only the bytes in the right-hand column should differ outside the drawing layer.

| File | Change from base | Bytes that changed |
| --- | --- | --- |
| P3DSE2 | Style: 3D effect Yes | 1304[1] |
| PSHARE | Style: Share Pie 1 labels Yes | 1304[0] |
| PLINK | Style: Link pies 1&2 Yes | 1304[2] |
| PPROP | Style: Proportional pies Yes | 1304[3] |
| PFILLP / PFILLB | Style: slice fill Pattern / Both | 1304[4] = 2 / 3 |
| POUTL | Style: slice outline colour next role | 1304[5] 32 -> 33 |
| PLINKC | Style: link line colour next role | 1304[6] 18 -> 19 |
| PNOPIE | Pie options: Show pie No | 1310[1]; drawn group dropped |
| PCOLUMN | Pie options: Show as Column | 1310[2] |
| PSIZE50 | Pie options: Pie size 50 | 1310[13..16] f32 |
| PANG45 | Pie options: Starting angle 45 | 1310[9..12] f32 |
| PSORT | Pie options: Sort slices Yes (data already sorted) | 1310[3] |
| PPTRN / PPTRL | Pie options: Slice pointer None / Long | 1310[4] = 1 / 4 |
| PDEPTH6 | Pie options: 3D slice depth 60 | 1310[5..8] f32 |
| PNOLAB | Pie options: Show slice labels No | 1310[17] |
| PVALNO | Values: Show values No | 1314[1] |
| PVALADJ / PVALIN | Values: Place Adjacent / Inside | 1314[2] = 2 / 3 |
| PVSCALE | Values: Scale factor 10 | 1314[9..16] f64 |
| PVCURR | Values: Currency Yes | 1314[3] |
| PVDEC2 | Values: Decimal places 2 | 1314[4..7] f32 (blank = NaN) |
| PVTHOU | Values: Thousands separator Yes | 1314[8] |
| PVLEAD / PVTRAIL | Values: Leading "AB" / Trailing "XY" | 1314[17..] / [30..] |
| PPCT | Percents: Show percents Yes | 1312[1] |
| PPCTPI, PPCTD1, PPCTL, PPCTT | Compare with PPCT: Place Inside, Decimal places 1, Leading "AB", Trailing "XY" | 1312[2], [3], [5..], [18..] |
| PLEG | Legend: Show legend Yes (base state: PREV11 in the session, same as PBASE apart from leftover bytes after the NULs in 1312/1314 pie 0) | 1306[0], 806, 810 |
| PLEGL1..3 | Legend location stepped with Space from PLEG | 1306[2] = 6, 7, 8 |
| PCUT2 | Data: Beta's Cut = Yes | 1316 slice 1 [2] |
| PUNS / PUNSSRT | Data: values 10, 40, 20, 30, then Sort slices Yes | 1310[3]; wedge order |

Not tested yet: 1306 byte 1 and legend frame bytes 3 to 5, slice colour and pattern changes, two or more pies, XY charts.
