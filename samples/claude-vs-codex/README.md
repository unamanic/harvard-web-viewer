# Claude vs. Codex: a Harvard Graphics 3.05 show

A 20-slide ScreenShow made in the real Harvard Graphics 3.05 (DOSBox-X, VGA ScreenShow display, 640x480, 16 colours)
on 2026-11-25. Original content written for this project, so it can go in the public repo as a test file for the viewer.
All numbers in the charts are joke metrics, not benchmarks. The ten picture slides use art William generated
for the show (text-free); Harvard Graphics draws every title and line of dialogue as its own text.

## Files

- `CLAUDEVX.SH3`: the show. Every slide entry points at `C:\CVC\<name>.CH3` (everything was saved in C:\CVC).
- `CVC01.CH3` ... `CVC10.CH3`: the ten chart and text slides.
- `CVCP01.CH3` ... `CVCP10.CH3`: the ten picture slides. Each is a TITLE chart (title on top, two dialogue lines at the
  bottom, bottom text set to size 6, colour "Cyn LL") with a Draw-layer bitmap object sent to the back.
- `CVCPIC01.PCX` ... `CVCPIC10.PCX`: the bitmaps. They are **linked, not embedded**: each CVCPnn.CH3 stores the path
  `C:\CVC\CVCPICnn.PCX`, so a viewer has to load the PCX from beside the chart. Format: PCX v5, 4 planes x 1 bit,
  RLE, 530x290, standard EGA 16-colour header palette. They are the art cropped (x 55-584, y 30-319 of the 640x350
  originals) so the figures fill more of the slide. HG fits the bitmap to the page width and keeps EGA pixel aspect.
- `extras/CVCX1.CH3` ... `CVCX5.CH3`: five more charts built along the way and **not in the show**: an "Intermission"
  title, a "Common Failure Modes" bullet list, a vertical clustered bar ("Words per Answer"), a pie with a cut slice
  ("How Codex Spends Its Time") and a 3-series **area** chart ("What's in the Context Window"). Handy extra test files.
- `screenshots/CLAUDEVX_slideNN.png`: each slide as F2-Preview in the show editor, DOSBox-X raw capture
  (640x480, 8-bit indexed with the VGA DAC palette as HG set it).
- `screenshots/CVC_editor_effects.png`, `CVC_editor_descriptions.png`: the Edit Presentation screen (720x400 text mode).
- `screenshots/contact-sheet.png`: all 20 slides on one page (scaled, quick look only).

Note on colour: HG's VGA ScreenShow palette is its own fixed 16 colours, so the bitmap's EGA colours come out as HG's
nearest entries (for example EGA light magenta 255,85,255 shows as 255,0,255). The raw captures show what HG drew.

## Slides

Every slide has a display time of 0:15.

| # | File | Type | Content | Draw | Dir | Speed | Erase |
|---|---|---|---|---|---|---|---|
| 1 | CVC01 | TITLE | "Claude vs. Codex: A Totally Unbiased Showdown" | Fade | | Slow | |
| 2 | CVC02 | BULLET | Meet the Contestants | Wipe | Right | Medium | |
| 3 | CVCP01 | TITLE + bitmap | Plan Mode | Iris | Out | Medium | |
| 4 | CVC03 | XY bar, horizontal | The Politeness Index | Blinds | Down | Fast | |
| 5 | CVCP02 | TITLE + bitmap | Fix One Thing | Scroll | Left | Medium | Wipe Right Fast |
| 6 | CVC04 | PIE | Anatomy of a Claude Response (cut slice) | Iris | In | Medium | |
| 7 | CVCP03 | TITLE + bitmap | The Test Suite | Open | Up | Medium | |
| 8 | CVC05 | BULLET | Codex, Explained | Scroll | Up | Medium | |
| 9 | CVCP04 | TITLE + bitmap | Code Review | Close | In | Fast | |
| 10 | CVC06 | XY line, 3 series | Confidence vs. Correctness | Open | Right | Medium | |
| 11 | CVCP05 | TITLE + bitmap | Merge Conflict | Wipe | Down | Medium | Blinds Up Fast |
| 12 | CVC07 | TABLE | Feature Comparison Matrix | Close | In | Medium | |
| 13 | CVCP06 | TITLE + bitmap | Context Window | Fade | | Medium | |
| 14 | CVC08 | ORG | Who's Really in Charge | Overlay | | | |
| 15 | CVCP07 | TITLE + bitmap | Time to Ship | Wipe | Left | Fast | Scroll Down Medium |
| 16 | CVCP08 | TITLE + bitmap | Agent Swarm | Blinds | Right | Slow | |
| 17 | CVC09 | BULLET | How to Choose | Wipe | Left | Fast | Blinds Up Fast |
| 18 | CVCP09 | TITLE + bitmap | Repo Archaeology | Open | Out | Medium | |
| 19 | CVCP10 | TITLE + bitmap | Final Boss | Iris | Out | Slow | Fade (Medium) |
| 20 | CVC10 | TITLE | "And the Winner Is... Whoever's quota resets first" | Fade | | Slow | |

Slide 0 (background) is left at Replace with no file.

Picture slide dialogue (Claude line / Codex line):

| Slide | Picture | Source art | Claude | Codex |
|---|---|---|---|---|
| Plan Mode | CVCPIC01 | 01-typo | "First, a 14-step plan." | "It was a typo." |
| Fix One Thing | CVCPIC02 | 02-one-screw | "Touch one file, please." | "I touched the concept of files." |
| The Test Suite | CVCPIC03 | 04-review (smoking box, thumbs up) | "What did you test?" | "The command returned zero." |
| Code Review | CVCPIC04 | 03-green-test (magnifier, green tick) | "Thirty-two minor notes." | "LGTM. I saw a green thing." |
| Merge Conflict | CVCPIC05 | 05-merge | "I preserved both sides." | "I picked the one named HEAD." |
| Context Window | CVCPIC06 | 06-wrong-branch | "I read the entire repo." | "Cool. Wrong branch." |
| Time to Ship | CVCPIC07 | 07-ship-it | "Let's define 'done.'" | "Too late. It's in prod." |
| Agent Swarm | CVCPIC08 | 08-agent-swarm | "I assembled a review panel." | "I spawned eight interns." |
| Repo Archaeology | CVCPIC09 | 09-legacy | "This comment is from 1997." | "So is the production server." |
| Final Boss | CVCPIC10 | 10-final-boss | "I brought the architecture." | "I brought the patch." |

(The 03 and 04 pictures were swapped to fit the jokes better.)

## Byte check against the slide-entry layout (tag 702)

Offset 5 Draw (1 Replace, 2 Overlay, 3 Wipe, 4 Scroll, 5 Fade, 6 Open, 7 Close, 8 Blinds, 9 Iris), 6 direction
(1 Left, 2 Right, 3 Up, 4 Down, 5 In, 6 Out, 0 none), 7 speed (1 Slow, 2 Medium, 3 Fast, 0 none), 8-10 erase
effect/direction/speed (same codes), 14 time u16 (seconds). All 20 entries in CLAUDEVX.SH3 match the table above,
in order, each with time 15. For example slide 5 = `04 01 02 03 02 03`, slide 14 = `02 00 00 00 00 00`,
slide 19 = `09 06 01 05 00 02`.
