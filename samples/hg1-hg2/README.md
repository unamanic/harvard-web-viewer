# Harvard Graphics 1.0 and 2.x test charts

Charts saved by the real programs, one setting changed at a time, used to write
[docs/SPEC-HG1-HG2.md](../../docs/SPEC-HG1-HG2.md) and to test the viewer
(`src/formats/hg2/hg2.samples.test.tsx`).

- `v100/`: saved by Harvard Presentation Graphics A.00 (1.0) in the PCE emulator. `*BASE` is a base chart; each other file changes one setting from the file before it (see the spec).
- `v230/`: saved by 2.30 in DOSBox-X. One-setting test pairs: `BBASE`/`BB2` bar, `ABASE` area, `HBASE` high/low/close, `PBASE`/`PB2` pie, `T*` text, `OBASE`/`OB2` org, `MBASE` multiple (it shows `BB2.CHT` and `PB2.CHT`).
- `v210/`: 2.10 resaves (`Z*` = a 2.30 file loaded and saved again by 2.10).
- `v212/`: 2.12 resaves (`W*` = the same with 2.12).

Clean room: built only from saved files and the programs' screens; no program code was read.
