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
7. **Frame rate CAN be measured here** — `tools/perf.js`. This said the opposite
   for the project's whole life, and the reason was specific rather than
   fundamental: the automation pane runs hidden, so Chrome throttles
   requestAnimationFrame and the callback never fires. RAF is not the only clock.
   A canvas draw returns once the command is QUEUED, but a pixel readback cannot
   return until every queued command has COMPLETED, so `render() ->
   getImageData(1x1)` bounds real frame cost. Validated against ground truth:
   holding the scene fixed and changing only canvas size gives 1.8 / 3.0 / 5.9 ms
   at 0.36 / 1.44 / 3.24 Mpx — flat submission cost, rasterisation scaling with
   area, which is the signature of the real thing.

   Two traps, both hit and both now guarded in the tool: flushing every frame
   makes Chrome DE-ACCELERATE the canvas (3.1ms on a fresh page, 41.7ms after a
   few dozen benches — it looked exactly like a load cliff at 60s of match time
   and was purely the instrument), and flushing once per batch is unsound because
   intermediate frames are never observable and the driver need not produce them
   (it reported 0.06ms/frame, 16,000 FPS). Answer: flush per frame, keep `iters`
   modest, few benches per page load, and watch `degraded` — `jsMs` jumps two
   orders of magnitude when the canvas falls back to software.

   Still worth an owner reading off `` ` ``/F3 for the real composited number;
   this is a hidden tab on one machine. But it is a repeatable millisecond figure
   for comparing two builds, which is what it is for.
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
- The far parallax band is **done**. `treeline`, `villageSil` and `paddy` are now
  drawn procedurally — `_treeBand`, `_villageBand`, `_paddyStrip` — and their
  slices are gone from `assets/manifest.js` (108 terrain slices -> 99).

  The paddies were the real find: **isometric 3/4-view tiles**, drawn looking
  DOWN at the field from an angle, in a game whose every other element is a
  strict side view. That is precisely the collage the prop pipeline was built to
  end, and it survived only because it was squashed to 55% and drawn at half
  alpha — which hides a wrong projection without fixing it. Edge on, a paddy is
  a bright sliver of reflected sky between two low bunds.

  `mtn` STAYS. It is the one piece of the old set that earns its place: a
  distant ridge silhouette, now pushed back into the sky colour, at a size where
  the line work does not read.

  Two things worth keeping: built from `brush` alone the new treeline came out
  uniformly mid-green and read as a row of shrubs where the inked slices read as
  a wall of jungle — it needs `tree` for the mass and `brush` for the lit
  surface, which is the relationship those palette entries already describe. And
  `ctx.ellipse()` CONTINUES the current subpath, so opening the band with a
  `moveTo` to the far corner ran a visible spike from the bottom-left of the
  frame into the first lobe. One `moveTo` per lobe.

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

**Buildings brought into the palette.** They measured Lmean 108-120 and
saturation up to 0.49 against 57-91 / 0.20-0.37 for everything else — sunlit
thatch and timber SHOULD be the light accent in a frame of olive foliage, and
that part is kept, but at those values they had stopped being an accent and
become the brightest, most saturated thing on screen. The stone in `hut_c` and
`village_row` read as poured concrete. Re-rendered from source with their own
FIXUP entries: now Lmean 53-80, sat 0.28-0.39, still lighter than the foliage
they stand against. **The prop set now has zero palette outliers.**

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

### 1.4 Gunfights *(impact + suppression done; heavy weapons partly)*
Measured before the first fix: 31 men produced **0.56 muzzle flashes per frame**
and **51% of frames showed nothing firing**. Gunsmoke now spawns on every shot,
so 100% of frames show combat.

**Suppression is now drawn.** It was the mechanic the whole sim turns on —
accuracy halved, advances stopped, the stance machine driven to prone — and the
only thing on screen saying so was the word PINNED in 8px type. Two sources now:
a round cracking within 46px of a man throws dust off the ground on the side the
fire came from, and a pinned squad keeps a low trickle going between rounds
(impact dust alone made it flicker — suppressed on frames something landed, idle
on frames nothing did, when the STATE is continuous).

**Impact had emitters and no weight.** `dirtKick` was four dots of 1.5-3px and
`splinters` five of 1-2.4px, which at lane scale is invisible: the calls were
all wired and a round striking earth still read as nothing happening. Both now
lead with a DUST PUFF — the part the eye actually catches — and throw clods
after it, scaled by lane depth, with belt-fed weapons throwing visibly more than
a rifle.

**Dust is not smoke.** Drawn in gunsmoke's neutral grey it vanished into the
ground it was rising from; kicked earth is warmer and lighter than the field,
which is what makes it read against grass. `color: 'dust'` in the particle draw.

**Particles now cull by PRIORITY, not by age.** `add()` was unbounded with one
backstop at 900 that spliced away the OLDEST — exactly the wrong end, since the
oldest are the smoke and dust giving a fight its body and the newest are the
flashes and tracers telling the player who is shooting at whom. Ground dust and
debris carry `prio: 0` and stop being added above 260; flashes, tracers, blood
and explosions always get through.

Cost of all of it, measured with `tools/perf.js`: **+0.2 to +0.8 ms/frame**,
worst map 5.0 → 5.8ms. Everything still holds 60 with 3-5x headroom.

**Heavy weapons now read as heavy.** `muzzle()`'s `heavy` flag changed exactly
one number — flash height, 26px against 19 — so an M60 burst and a single rifle
shot were the same event at the muzzle, on weapons costing 5 CP and 3 CP that
are supposed to feel different. Belt-fed now gets a longer, wider flash, seven
sparks instead of three, brass in a stream rather than one shell at a time, and
half again as much smoke: a gun position firing bursts fogs itself in, and that
fog is most of how you find one on real footage.

**Shell and rocket impact got the cue that says weight.** Everything the
explosion did threw material UP — flash, column, ejecta, smoke — which is what a
firework does. What separates a shell from a firework is the low sheet of dust
running OUTWARD along the ground, because the blast has nowhere else to go once
it meets earth. Measured spreading 250px+ from the burst.

**Recoil.** The vector rig has swapped recoil frames off `muzzleT` since it was
written; the 3D sprite path never got anything, so men fired without moving at
all — most of why a firefight read stiff even with the muzzle and smoke work
done. There is no recoil clip and the donor has none to borrow, so it is
positional: the man rides back along his own facing and settles over the 0.11s
the shot already lasts. 3px at 84px tall; 6px reads as a man being shoved.

Still missing:
- **Weapon report** still does not distinguish an M60 from a rifle by ear.
- A first cut gated the pinned-squad trickle on `particles.length < 150`, which
  switched the dust OFF in exactly the heavy firefights it exists to describe.
  Saturation belongs in `add()` and nowhere else.

### 1.5 Animation and soldier variety

**Per-man appearance.** `gaitK` has varied each man's animation SPEED and
`gaitOff` his clip PHASE for a long time, so a squad never marched in lockstep —
but every man was the same pixels in the same colours, and at squad size that
reads as one soldier stamped five times. Each man now carries a small brightness
and hue shift keyed off `gaitOff` (a `Math.random()` fixed at spawn, so a man's
colour never changes frame to frame). Kept narrow on purpose: it has to break up
a rank without breaking the side's identity, which the player reads by colour
before anything else.

**Cost matters here and was measured, not assumed.** `ctx.filter` with THREE
functions chained (brightness + hue-rotate + saturate) roughly DOUBLED frame
cost — iadrang 3.2 -> 7.2ms, cuchi 3.3 -> 8.6ms. One function costs +1.0ms and
two cost about the same as one, so `saturate` was carrying nearly all of it.
Shipping brightness + hue-rotate: +1.0 to +1.9 ms, every map still holds 60.

**Idle drift.** The two at-rest poses were split on a fixed `gaitOff < 0.45`, so
a man played the same idle from spawn to death and a squad holding a position
showed two poses frozen in whatever proportion the spawn rolls gave. A slow
per-man oscillator now drifts men between them. Measured over 30s: both variants
in use (41 / 66 samples) with 8 switches — movement, not thrash.

**Recoil** is done (see §1.4).

**The prone CLIP is broken at source and is not used.** It was synthesised by
pitching the body 84 degrees about the pelvis, but the arms hang off the chest
and the rifle rides the right wrist, so the tip-over drove the weapon into the
ground behind the man and folded his legs back through his torso. Three Blender
attempts each made it worse and are worth not repeating: counter-rotating the
shoulders slid the rifle off the hands entirely (the weapon is bound to the
wrist by a Child-Of whose inverse was captured at the original pose); a shallower
58-degree pitch gave a diagonal version of the same tangle; and the donor has no
prone or crouch action to borrow — all 24 of its clips are upright. The game
draws prone men with the **aim** pose dropped 26px instead, and the height
difference is what reads as "down" at 84px anyway.

### 1.5b Atlas memory *(reclaimed — the wall is down)*

Adding soldier art used to be impossible: atlases 96 MB + props 31 = **127 of a
130 MB cap**, and one more body costs about eight. That gate is now open, and
the first half needed **no Blender at all** — every per-frame PNG was still on
disk under `assets/sprites3d/*/`, so it was a repack, minutes not an hour.

| step | atlas MB |
|---|---|
| was | 96 |
| cells 128x112 instead of 128x128 | 84 |
| drop `melee` + `prone` | 79 |
| spend it: walk 14->28, run 18->24, runfire 18->20 | **89** |

**Total now 120.3 of 130, 9.7 MB spare** — and the jank is fixed with it.

**Two clips were rendered for every unit and never drawn.** `melee` appeared
only as a key in the `URGENT` table in `js/sprite3d.js`; nothing selected it.
`prone` was rendered and then explicitly routed around because its source clip
is broken. 12 frames per unit of 125.

**A quarter of every cell was empty air.** Measured across ALL TWELVE units with
those two excluded, content spans y 18-122 of 128. The crop is a FIXED band
applied identically to every frame of every unit, so the shared anchor survives —
per-frame tight-bboxing is what makes sprites flicker and stays banned. Measure
across the whole set before touching `CROP_Y`: rifleman is the tightest unit at
92 rows and using it alone would have decapitated `rpgman` and `marksman`, which
need 105.

**Three traps hit on the way, all now guarded in the tools:**

1. **The repack silently destroyed the muzzle data.** `index.json` is gitignored
   and a partial re-render had left it holding muzzle points for `prone` alone,
   while the COMPLETE set survived only inside the tracked `atlas.json`. Packing
   from that stale index emitted empty muzzle lists — every flash would have
   detached from its barrel. Recovered from the atlases, and
   `tools/pack_sprites3d.py` now REFUSES to write when any frame lacks a muzzle
   point rather than overwriting good art with bad.
2. **The frame-count raise blew the budget before a single frame rendered.**
   `runfire` is a SEPARATE clip from `run` and scales with it; forgetting that
   turned a planned +20 frames/unit into +30 and 130.7 MB. Recompute with
   `MB = 0.0581 * frames_per_unit * 12` before changing `CLIP_FRAMES`.
3. **`tools/render_all_sprites.sh` was missing `rpgman`**, so "rebuild
   everything" silently left one unit on stale frame counts.

### 1.5c The jank, measured and fixed

"Very janky, animations aren't smooth" was exactly reproducible from the
constants. Frame index comes off DISTANCE TRAVELLED — `frame = (dist/cycle)*n` —
so animation fps is set by speed, stride and frame count, never by the game's
frame rate.

| | before | after |
|---|---|---|
| rifleman walk | 9.7 fps | **19.4** |
| sniper walk | 7.2 fps | **14.4** |
| rifleman run | 23.3 fps | **31** |

The stride was never the bug: 60 world-px per cycle for an 84px man is a real
1.4m stride, and shortening it to win frames would make men mince and skate.
There were simply not enough frames in it.

### 1.5d Soldier variety

- **Per-man colour.** `gaitK` varied each man's animation speed and `gaitOff`
  his phase, but every man was the same pixels in the same colours. Each now
  carries a brightness and hue shift keyed off `gaitOff`. Measured: three chained
  `ctx.filter` functions DOUBLED frame cost (3.2 -> 7.2ms); one costs +1.0ms and
  two cost about the same as one, so `saturate` carried nearly all of it.
  Shipping brightness + hue-rotate.
- **Idle drift.** Men drift between the two at-rest poses instead of being
  assigned one for life. Measured over 30s: both in use, 8 switches, no thrash.
- **Still open — donors are doubled up.** `soldier` serves rifleman AND sniper,
  `adventurer` m60 AND recon, `farmer` guerrilla AND marksman. `worker.glb` is
  already downloaded (Quaternius CC0, same pack) and unused, so breaking one tie
  costs ZERO memory — the same 135 frames off a different body. Cheapest
  remaining variety win.


## 2. Open, ranked

**Done since the last pass**
- **Terrain blending.** Soldiers had contact shadows since the sprite rig
  landed; props never did, so every hut, palm and sandbag wall ended on a hard
  cut curve and read as a sticker on grass. Props now ground from one place in
  `Props.draw`, gather litter at the base, and the LANE EDGE — a ruled line
  across the whole battlefield where one slab met the next — is broken by growth
  straddling the join.
- **Ground colour.** Every terrain pass worked in VALUE, so the field came out
  beautifully lit and monochrome. Nine soft hue-shifted patches per 1280px
  (dry / lush / scuffed / damp) drawn EARLY so the lighting lands on top and
  unifies them. Ground pixels >12 degrees off the dominant hue: 20.7% -> 38.8%.
- **Lane switching.** `V` or the CROSS button. Lane was fixed at spawn, so the
  largest positional choice on the board did not exist. The cost is what makes
  it a decision: out of cover, holding fire, unrecallable for ~1.9s. `lane`
  flips immediately (targeting, covers and the render pass all key off it) while
  the drawn y and the depth SCALE ease across — without the scale easing a man
  jumped 17% in size on the first frame.
- **The AI flanks with it**, moving surplus out of a lane it has already won
  into one it is losing — without which it can win a lane decisively, lose the
  other, and lose the match with no way to move the difference.

| # | Item | Why it is here |
|---|---|---|
| 1 | Attrition | Ammo and reload as a resource. The last of the four depth directions asked for. Touches every unit's balance, so it wants care. |
| 2 | HUD group rails | The design's BASIC INFANTRY / HEAVY WEAPONS / SPECIALISTS rails need a category field on the 13 squads; none exists. |
| 3 | Death variety | One death clip per unit, so a squad wiped by one burst falls in unison. ~9 MB spare would cover it. |
| 4 | Real weapon meshes | Proportions fixed; still donor stand-ins. |
| 5 | A real prone clip | Needs mocap or hand-posed arms; three Blender attempts have failed. |
| 6 | CSS duplicate cleanup | `#hud-controls button` is declared four times in `css/style.css` and `#hud-bottom` twice, so the cascade is currently the only reliable way to land a HUD change. |


**Checked and NOT a gap: audio.** It was about to go on this list as "an M60 and
an M16 are indistinguishable by ear, no distance falloff, no crack-thump" — all
three false. `js/audio.js` already gives m16/ak/mg their own spectra, pans off
camera-relative world x, attenuates with distance, rolls sharpness into a
muffled thump as `far` rises, DELAYS the report so a shot across the map arrives
late, and slaps an echo back off the treeline past 0.25 far. Verify before
ranking.

## 3. Blocked on the owner

- **An FPS reading** off `` ` ``/F3 — now a nice-to-have rather than a blocker.
  `tools/perf.js` gives a real millisecond cost (see rule 7); the owner's number
  would confirm it against a composited display.
- **Does it feel right?** Mechanics are verified; feel is not something I can
  measure.
- **The HUD design** (`design/hud/`, published as a canvas). Item 3 above does
  not start until the owner has looked at it — wiring the wrong plates into
  `ui.js` and `style.css` is a day spent on something they may not want.
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

**FRAME COST**, measured with `tools/perf.js` at 1600x900, ~35 men, 70s in,
60 samples:

| map | frameMs | p95 | ceiling |
|---|---|---|---|
| iadrang | 2.9 | 3.7 | 345 fps |
| cuchi | 3.1 | 3.7 | 323 fps |
| mekong | **5.6** | 6.6 | 179 fps |
| khesanh | 4.4 | 6.4 | 227 fps |
| hill937 | 4.2 | 6.1 | 238 fps |

Nowhere near frame-limited — 3-5x headroom against the 16.7ms that 60fps allows,
and the whole TAIL is inside budget too.

**Quote no p95 taken from fewer than 50 samples.** At `iters: 18` the same
scenes reported medians of 6.1 and p95s of 17.7-18.5, which read as the FX work
pushing the tail over the 60fps line. It had not: a p95 over 18 samples is
"second worst frame", and the worst frames are warm-up and GC. At 70 samples the
same scene gives 3.1 and 3.7. This was one edit away from being recorded here as
a regression that did not exist. The tool now warms up ten frames and defaults
to 60.

**These are STEADY-STATE figures.** `Capture.budget()` used to measure the
first render after staging, which bakes every lane layer — a one-time map-load
cost, not a per-frame one. That made it report 16-17 Mpx where the truth is
7.5-8.3, and several numbers quoted earlier in this project were inflated for
that reason. It now renders a warm-up frame before instrumenting.
