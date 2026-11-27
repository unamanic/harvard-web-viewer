# Harvard Graphics 1.0 and 2.x test charts

Charts saved by the real programs, one setting changed at a time, used to write
[docs/SPEC-HG1-HG2.md](../../docs/SPEC-HG1-HG2.md) and to test the viewer
(`src/formats/hg2/hg2.samples.test.tsx`).

- `v100/`: saved by Harvard Presentation Graphics A.00 (1.0) in the PCE emulator. `*BASE` is a base chart; each other file changes one setting from the file before it (see the spec).
- `v230/`: saved by 2.30 in DOSBox-X. One-setting test pairs: `BBASE`/`BB2` bar, `ABASE` area, `HBASE` high/low/close, `PBASE`/`PB2` pie, `T*` text, `OBASE`/`OB2` org, `MBASE` multiple (it shows `BB2.CHT` and `PB2.CHT`).
- `v210/`: 2.10 resaves (`Z*` = a 2.30 file loaded and saved again by 2.10).
- `v212/`: 2.12 resaves (`W*` = the same with 2.12).

Clean room: built only from saved files and the programs' screens; no program code was read.
- `story/`: charts from the Harvard Web Viewer story show, saved by A.00 (`v100/`) and 2.30 (`v230/`) and checked against the real programs' screens (`src/formats/hg2/story.test.ts`): `HGV06` bar ("Room on Disk"), `HGV08` and `HGV19` org, `HGV10` pie, `HGV14` bullets with a line that carries on onto the next.
- `shows/`: slide shows saved by 2.30 in DOSBox-X, one change per file: `S1` base (HWV01-03), `S2MOVE` a slide moved, `S3DELADD` one deleted and one added, `S4TIME` times, `S5DEF` the Default row, `S6FX` effects and directions, `S7HYPER` HyperShow keys, `S8MOVEHYP` a move after keys were set. The charts they name are not included; `src/formats/hg2/show.test.ts` stands other test charts in for them.
