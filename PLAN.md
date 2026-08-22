# VIETNAM '65 — PLAN

One document. When something is done it is deleted from here, not annotated —
the history lives in git. If a claim in here is not backed by a measurement,
it is a guess and is marked as one.

**Companion docs:** `SPRITE_PIPELINE.md` (how character art is made — read
before touching it), `docs/ASSET_PROMPT.md` (brief for generating new props).

---

## 0. Rules that have earned their place

1. **Never deploy without explicit approval.** Pushing `main` auto-publishes to
   GitHub Pages, so a push *is* a deploy.
2. **Look at a frame — then MEASURE what you think you saw.** Every art mistake
   this project has made passed its metrics and was caught by eye, and four
   confident diagnoses read off a screenshot have now been wrong. The latest:
   "some palms have gone vivid green again" — the frame contains ZERO pixels
   where green exceeds red by more than 18, and olive simply reads as green
   against a saturated orange sky. Look to find the problem; measure to confirm
   it exists. Past examples caught by eye: 300px palms that swamped the screen, weapons
   that were 40–60% black outline, a night map washed to an unreadable 18 points
   of contrast, Cu Chi turned into a red quarry. Use
   `Capture.shot({map:'mekong'})` and open the image.
3. **An x-overlap test is not an occlusion test.** Nearly shipped two false
   findings this way. Always include vertical extent.
4. **Measure the tail, not the mean.** The stance bug read as median 0 with a
   worst man at 34 flips/min. An average would have shrugged at it.
5. **No change is done until `SelfTest.run(60)` passes** both sides on all five
   maps. The suite does NOT seed `Math.random`, so it is a fresh match every
   run — one failure is a sample, not a verdict. Re-run before believing it, and
   before touching a threshold, work out whether the METRIC is sound: the
   worst-man stance-churn limit had already been walked 22 -> 28 for "flake"
   when the real fault was a per-minute rate divided by a 9-second lifetime, so
   five ordinary stance changes scored 33/min. Raising a bar to silence a bad
   statistic blunts the detector and leaves the statistic bad.
6. **Measure each map on a FRESH PAGE LOAD.** Staging five maps in one page
   inflates the figure badly — this pass first read mekong at 12.32 and cuchi at
   12.55 against a cap of 13, and panicked at an apparent +4.9 regression. Both
   are 8.5-8.9 measured one per load; the truth was +0.8. Decal layers and
   accumulated state from earlier stagings add full-screen blits. This is the
   second time a `Capture` figure has misled this project, after the bake-frame
   problem below.
7. **Frame rate cannot be measured here.** The automation pane never
   rasterises. Everything measured is work-per-frame; the `` ` ``/F3 overlay is
   the only source of truth and needs the owner to read it.
8. Do not revisit AI-generated frame sheets or auto-cut cutout rigs. Both are
   proven dead ends (`SPRITE_PIPELINE.md` §1).

---

## 1. THE PROBLEM: it still looks mid

Owner's verdict, and it is correct. Diagnosed from a captured firefight rather
than from taste. **Ranked by how much each one is costing the look:**

### 1.1 Atmosphere and light *(rebuilt — the maps now share one system)*
The five maps did not read as one game, and none of them read as lit. Measured
on captured frames rather than guessed:

| map | L range | sky detail | hue >30° off dominant |
|---|---|---|---|
| iadrang | 164 → **180** | 7.3 → 8.2 | **0.0% → 4.6%** |
| cuchi | 170 → **185** | 12.5 → 13.0 | 11.1% → 14.4% |
| khesanh | **38 → 51** | 1.0 → 1.7 | night, see below |
| hill937 | 102 → **129** | 7.2 → 7.3 | 12.9% → 9.2% |

**What was actually wrong, in order of damage:**

1. **Six stacked full-screen veils were eating the palettes.** `_drawFar` washed
   flat `hillFar` over the whole far layer at 0.42; `_laneHaze` veiled each lane;
   `pal.haze` filled the ENTIRE frame at its full 0.13-0.20; then a grade
   multiply, a grade gradient and a 0.28 vignette. Ia Drang and Mekong arrived
   with **0.0%** of their saturated pixels more than 30 degrees off the dominant
   hue — on palettes deliberately built with 195 and 125 degree spreads. All that
   care in `data.js` never reached the screen. Haze is now keyed to DEPTH and is
   zero in the foreground.
2. **`_laneHaze` still indexed a three-lane world.** `[0.5, 0.22, 0][lane]` — the
   entry that zeroed haze on the nearest lane was index 2, unreachable since the
   drop to `LANE_N = 2`. The foreground lane had been sitting under a permanent
   0.22 veil ever since.
3. **The far band was tinted toward its own hill colour**, which cannot make
   anything recede. Distance washes things toward the colour of the air, so it
   now blends toward `skyBot` — which is what stopped the ridges reading as
   cut-outs pasted on the sky, worst of all at night.
4. **Nothing in the scene read the sun.** Every map declares `sun: {x, y, r}` and
   it lit nothing; the ground had texture but no FORM. Ground now takes warm lit
   faces and cool shaded ones from its own slope — and cooling shifts BLUE UP
   rather than just darkening, which is where a frame with no hue variety can
   honestly get some.
5. **The sky was eight pairs of ellipses** over 35-45% of the frame. Now three
   parallax depths of multi-lobe banks with a shaded base and a lit crown, plus a
   horizon glow centred under the sun and a real bloom.
6. **Night was a chain of compressive washes**: multiply ×0.39, navy ×0.86, map
   haze ×0.80, grade ×0.90 — four reasonable veils composing to 0.24, so 164
   points of range arrived as 39. Measured 38. Fixed by removing veils rather
   than softening them: no map haze at night, half the navy, a neutral `overlay`
   to push the range back, and a lighter vignette.

**Two mistakes worth not repeating:**
- The slope shading was first drawn as one rect per column, which striped the
  field with a seam every 6px — periodic power at that pitch went 5.9 → 74. The
  seams were never the alpha steps, they were ANTIALIASED RECT EDGES, and
  smoothing the input barely moved it (74 → 61). It is now one clipped fill with
  one horizontal gradient: 7.6, back to baseline. **This is the third time this
  file has been striped by per-column fills** — the value ramp did it too.
- A BLUE `overlay` for the night contrast restore turned the grey massif into
  vivid blue triangles: overlay saturates whatever sits near mid-grey. The
  restore is neutral now; cooling is the multiply's job.

7. **Cloud shadow** — broken overcast laid across the field, the one scale
   nothing worked at (grit is 1-6px, incident 30-150px, slope shading is
   terrain-wide). Worth knowing: the metric said it did nothing (16.44 → 16.13)
   and the eye says otherwise, because the measurement averages over exactly the
   scale the pass operates at. Looked at, it reads as weather.
8. **Vector trees rebuilt.** `_tree()` drew the jungle canopy as a stick plus
   three filled ellipses — a lollipop — and the grass-map tree as a stick plus
   one wide ellipse, a mushroom. Both were flat single-colour silhouettes
   standing next to props with fully lit-and-shaded canopies. They now use the
   same three-value treatment as the clouds and the props, so all three finally
   agree where the sun is.
9. **Puddles were reading as tan stains** on Mekong, because the map's `water` is
   a warm sunset `#d78a5e` and the body was filled at only -30 off it. Standing
   water is DARK — it transmits, and only the rim returns the sky. Body now -86,
   flatter, with the lit rim kept.

**Still open here**
- Buildings measure Lmean 108-120 against 57-91 for everything else. Sunlit
  thatch SHOULD be the light accent, but `hut_a` at saturation 0.49 is louder
  than the palette wants.
- The far parallax band (`mtn`, `treeline`, `villageSil`, `paddy`) is still inked
  line art. It recedes properly now, which buys time, but it is still the odd
  system out.

### 1.2 One art language *(done — the inked art is gone)*
All small vegetation now draws from the 3D prop set through `drawVeg()` in
`js/render.js`. The `TEX` entries for `tuft` `fern` `bush` `plant` `palm`
`banana` are deleted, and so are the painted palm/banana groves that used to mix
into the treeline — the prop scatter's share went up from 0.26/0.16 to 0.46/0.30
to cover it. What still draws from `TEX` is the far parallax band (`mtn`,
`treeline`, `villageSil`, `paddy`), the buildings, and `dike`/`stonewall` cover.

**What the measurements actually showed, none of which was the original theory:**

1. **Eight props had never been toned.** `tools/tone_props.py` had only ever run
   on the 21 downloaded props; every procedurally-built one — grass, bamboo,
   banana, dead tree and the four new ones — was raw Blender output at Lmean
   115-126 and Lstd 11 against `palm_a`'s 63/23. Flat and pale, which is the
   cardboard-cutout read. There were two art languages *inside the prop set*.
2. **The tone ledger keyed on mtime**, which git does not preserve, so after a
   clone every prop looked untoned and the next run would have double-graded all
   21 — 0.80 twice is 0.64, and a second 4 px rim on top of the first is an 8 px
   black border. Now keyed on a content hash.
3. **`palm_b/c/d` were never properly graded**: saturation 0.66-0.68 against
   0.25-0.37 for every other prop, green running 14-17 points over red. They were
   the loudest thing in the frame. Re-rendered with their own FIXUP; now 0.33.
4. **The sandbags were the brightest props in the set** at Lmean 120 — brighter
   than sky-lit palm fronds — and read as heaps of eggs. Now 61.
5. **The foreground band's darkening was dead code.** `globalCompositeOperation`
   was set *after* the draw and immediately before `restore()`, so the band that
   the comment describes as "out of the light" rendered at full brightness and
   read as bleached straw across the bottom of every frame. Props now take a
   `shade` option, baked once per size into the existing scale cache.

**Shape lessons, learned by looking rather than measuring:** props built from
MANY thin elements read (grass at 44 blades, bamboo culms); props built from a
FEW big ones do not. The first bush was a heap of boxes and looked like a heap of
boxes; the first fern was two bare arcs and read as a croquet hoop; the banana
was six narrow ribbons tracing an outline with nothing inside. All three are now
built on `_curve`/`_blade`/`_frond` — a leaf has blade area and a curve, a frond
has leaflets. Bamboo was rebuilt too: dead-straight parallel culms with square
nodes bridging them read as electricity pylons.

6. **The tone ledger was gitignored**, so the hash fix alone would not have
   helped a fresh clone: the prop PNGs are committed ALREADY GRADED, and with no
   ledger the next `tone_props.py` run would have graded them again. The ledger
   is now tracked, with the reasoning written into `.gitignore` beside it.
   Verified: `touch assets/props/*.png && python3 tools/tone_props.py` re-grades
   nothing and every checksum is unchanged.

**Also done in this pass**
- `deadtree_a` rebuilt — was a totem pole of stacked blocks; now a continuously
  tapered leaning trunk with unequal limbs and a splintered crown.
- `bamboo_a` rebuilt — dead-straight parallel culms with square nodes bridging
  them read as electricity pylons; now leaning curved canes with ring nodes and
  real leaf mass.
- `banana_a` rebuilt twice more. Three narrow strips per leaf merged into a dark
  arch; one wide `_blade` scalloped at every bend (a chain of square-ended boxes
  cannot draw a leaf) and read as an armadillo shell. It now uses `_leafpoly`,
  which builds each leaf as ONE polygon, with the leaves spread from upright at
  the crown to drooping at the base so there is daylight between them.
- `dike_a` and `stonewall_a` built and wired — the last inked *gameplay* art.
- `grass_a` pulled down from Lmean 83 to 68; it was the palest thing on the
  ground and scattered bright straw across the field at random.

**Still open here**
- `sandbags_row` (0.27 x 0.11 m) and `sandbag_one` (0.15 x 0.06 m) have authored
  real heights that cannot be right for sandbags.
- The far parallax band is still inked (`mtn`, `treeline`, `villageSil`,
  `paddy`), and so are the buildings. At 0.5-0.9 alpha and far back the clash may
  not read; judge it in a frame before touching it.
- Props are framed in a SQUARE sized by real height, so a short wide prop wastes
  most of its blit — `bush_low` at 280 px tall is a 769x769 draw, two thirds
  empty. Fine at current sizes; it would need non-square frames (`resW`/`resH`
  plus a content offset in `Props.draw`) before ground cover gets much bigger.

### 1.2b Ground incident *(partly done)*
The lane had plenty of detail and none of it was visible, because all of it
worked at 1-6 px and hugged the ground LINE: speckles at alpha 0.22, strata at
0.13, turf blades drawn at `y0+1`, scour only where the slope exceeds 0.14. The
lower two thirds of each band — the part the player looks at — was bare fill.
Detail at grit scale cannot fix a problem at field scale.

There is now a pass at field scale: puddles that take the sky (the one thing on
the ground allowed to be brighter than the ground), churned earth, dry patches,
and vehicle ruts cutting ACROSS the band rather than along it. Baked into the
lane layer, so it costs nothing per frame — src Mpx is unchanged at 8.88.

**Two things the first cut got wrong, both worth remembering:**
- Feature depth was measured against `CANVAS_H`. Lane layers blit full-screen in
  order, so lane 1's slab paints over everything lane 0 drew below lane 1's
  ground line — most of lane 0's features were buried. Depth is now measured to
  the NEXT lane's ground line.
- The alphas (0.08-0.26) sat under the map's 0.16 haze and vanished. Raised to
  0.16-0.56. Ground local detail moved 8.79 -> 9.60; the first cut moved it 0.6
  of a grey level in the WRONG direction, which is to say it did nothing.

Still open: shell scars and churn that ACCUMULATE where fighting actually
happened, rather than being scattered at bake time. Large open stretches of the
band are still flat.

### 1.3 Foliage variety *(done — keep an eye on it)*
Was four palm silhouettes tiled evenly across every lane, which reads as
wallpaper because every tree is the same shape family the same distance from
its neighbour. Now eight silhouettes arriving in **clumps of 1-4** with a much
wider height spread (0.58-1.30x rather than 0.72-1.12x).

The four new ones — bamboo, banana, dead trunk, elephant grass — are **built
procedurally** in `tools/render_props.py`, not downloaded. poly.pizza's search
page is client-rendered and its API needs a key, so the only way to get models
was to pull unidentified UUIDs with no name, no licence and no preview, which
does not belong in a public repo. Box geometry suits these anyway: bamboo IS a
bundle of tapered culms, a burnt trunk IS a pole with broken stubs.

Still worth doing: the banana renders paler than everything around it, and a
palm from a real model still reads better than anything built from boxes — if
a properly licensed nature pack turns up, the pipeline takes it unchanged.

### 1.4 Gunfights *(partly fixed — keep going)*
Measured before the fix: 31 men in a battle produced **0.56 muzzle flashes per
frame** and **51% of frames showed nothing firing at all**. Gunsmoke now spawns
on every shot and lives ~1.4s, so 100% of frames show combat is happening.

Still missing:
- **Impact.** Rounds hitting cover should throw splinters, dust and chips with
  real weight; hits on men need more than a small spark.
- **Suppression made visible** — dust kicking off the ground in front of a
  pinned squad is the clearest read there is.
- **Weight on the heavy weapons.** An M60 burst and a rifle shot look nearly
  identical.
- **Shell and rocket impact** — currently underplayed for what it does.

### 1.5 Animation *(prone and transparency fixed; recoil still open)*

**The prone CLIP is broken at source and is no longer used.** It was synthesised
by pitching the body 84 degrees about the pelvis, but the arms hang off the
chest and the rifle rides the right wrist, so the tip-over drove the weapon into
the ground behind the man and folded his legs back through his torso. At game
size: a tangle of limbs, barrel in the dirt, no visible head.

Three Blender attempts each made it worse, and they are worth not repeating:
counter-rotating the shoulders slid the rifle off the hands entirely (the weapon
is bound to the wrist by a Child-Of whose inverse was captured at the original
pose); a shallower 58-degree pitch gave a diagonal version of the same tangle;
and the donor has no prone or crouch action to borrow — all 24 of its clips are
upright.

The game now draws prone men with the **aim** pose dropped 26px toward the
ground. Clean art, and the height difference is what reads as "down" at 84px
anyway. A proper prone clip needs either a real mocap source or hand-posed
arms in Blender; until then this is the honest option.

Still open:
- Recoil: a per-shot kick on the upper body, not just a flash.
- A real crouch, between standing and prone.
- Death variety — one death clip per unit.

---

## 2. Open, ranked

| # | Item | Why it is here |
|---|---|---|
| 1 | Value structure (§1.1) | Biggest single cause of "mid" |
| 2 | Ground detail (§1.2) | Second biggest; the eye spends most time here |
| 3 | Impact + suppression FX (§1.4) | Makes fights *feel* like fights |
| 4 | Recoil + crouch (§1.5) | Fights still read stiff |
| 5 | HUD rebuild | Frame/plate art now DESIGNED (`design/hud/`, published canvas) but NOT implemented — the CSS still ships the old plates. Awaiting the owner's read on the design before wiring it. |
| 6 | Real weapon meshes | Proportions fixed; still donor stand-ins |
| 7 | A real prone clip | Needs mocap or hand-posed arms; see §1.5 |

## 3. Blocked on the owner

- **An FPS reading** off `` ` ``/F3. Everything else is work-per-frame.
- **Does it feel right?** Mechanics are verified; feel is not something I can
  measure.
- **Nothing, for art.** Corrected: §1.3 needs CC0 models run through the
  existing Blender pipeline, not generated images. `docs/ASSET_PROMPT.md` §A has
  the steps. Claude Design is the right tool only for the HUD (§B there), which
  is DOM and CSS and so translates almost directly.

## 4. Current numbers

Budget, measured at 1600×900 with ~35 live units, against caps of 13 src Mpx /
220 particles / 130 MB decoded:

| map | src Mpx before | after props |
|---|---|---|
| iadrang | 7.93 | — |
| cuchi | 7.64 | 8.47 |
| mekong | 8.05 | 8.85 |
| khesanh | 7.68 | 8.73 |
| hill937 | 7.74 | — |

The vegetation swap costs a consistent **+0.8 to +1.0 src Mpx**, against a cap of
13. The foreground band is 1.27 of the frame's total.

Memory 121 MB decoded against a 130 MB cap. Roughly 5 Mpx spare per frame.

**These are STEADY-STATE figures.** `Capture.budget()` used to measure the
first render after staging, which bakes every lane layer — a one-time map-load
cost, not a per-frame one. That made it report 16-17 Mpx where the truth is
7.5-8.3, and several numbers quoted earlier in this project were inflated for
that reason. It now renders a warm-up frame before instrumenting.
