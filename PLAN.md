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
2. **Look at a frame.** Every art mistake this project has made passed its
   metrics and was caught by eye: 300px palms that swamped the screen, weapons
   that were 40–60% black outline, a night map washed to an unreadable 18 points
   of contrast, Cu Chi turned into a red quarry. Use
   `Capture.shot({map:'mekong'})` and open the image.
3. **An x-overlap test is not an occlusion test.** Nearly shipped two false
   findings this way. Always include vertical extent.
4. **Measure the tail, not the mean.** The stance bug read as median 0 with a
   worst man at 34 flips/min. An average would have shrugged at it.
5. **No change is done until `SelfTest.run(60)` passes** both sides on all five
   maps.
6. **Frame rate cannot be measured here.** The automation pane never
   rasterises. Everything measured is work-per-frame; the `` ` ``/F3 overlay is
   the only source of truth and needs the owner to read it.
7. Do not revisit AI-generated frame sheets or auto-cut cutout rigs. Both are
   proven dead ends (`SPRITE_PIPELINE.md` §1).

---

## 1. THE PROBLEM: it still looks mid

Owner's verdict, and it is correct. Diagnosed from a captured firefight rather
than from taste. **Ranked by how much each one is costing the look:**

### 1.1 The frame has no value structure  ← biggest
Everything sits in a narrow mid-tone band. Sky is bright, ground is mid-olive,
soldiers are mid-olive, foliage is mid-olive. Nothing is dark, nothing is
bright, so nothing draws the eye and the image reads as flat wash.

Measured on the daylight maps: the whole frame occupies roughly a third of the
available range. Reference art of this genre puts **deep shadow under and
behind the action** and lets the sky blow out, so the fight sits in a bright
pocket surrounded by dark.

- Push a dark ground-shadow gradient into the bottom third and behind the
  treeline, so the lanes sit in a trough of shade.
- Deepen `tree` and `laneBody` further; lift `skyTop`.
- Add a per-lane ambient occlusion band where terrain meets vegetation.
- **Target: p95−p5 luminance ≥ 95 on daylight maps** (mekong currently ~113 but
  concentrated in the sky; the *ground* band is far flatter — measure the lower
  two thirds separately).

### 1.2 The ground is an empty green field
Large uniform areas with no incident. The texture passes exist and are drawn at
alpha 0.22 — present, and still not enough at this scale.

- Mud, puddles, wheel ruts, burnt patches, shell scars near contested ground.
- Churned earth that *accumulates* where fighting has happened, using the decal
  layer that already exists.
- Crop stubble and paddy rows with real contrast, not a same-hue whisper.

### 1.3 Palms repeat
Four palm variants tiled across every map. Reads as wallpaper.

- More silhouettes (banana, bamboo, dead/burnt trunk, scrub). **No image
  generation involved** — grab CC0 `.glb` models from poly.pizza, drop them in
  `art/props/`, and run `tools/render_props.py`, which renders them through the
  same camera and lighting as the soldiers so the style match is structural.
  Simple shapes (crates, fence runs, drying racks) need no model at all: `BUILT`
  in that file makes them from boxes in code. See `docs/ASSET_PROMPT.md` §A.
- Vary height far more aggressively; overlap them into clumps rather than
  spacing them evenly.

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

### 1.5 Animation reads stiff in contact
Men snap between aim and prone with little transitional weight.

- Recoil: a per-shot kick on the upper body, not just a flash.
- Crouch — the sim has *no* crouch state at all, only standing and prone, so a
  man at close range has nothing between "upright" and "flat".
- Reload/bolt beats that are visible at 84px.
- Death variety — currently one death clip per unit.

---

## 2. Open, ranked

| # | Item | Why it is here |
|---|---|---|
| 1 | Value structure (§1.1) | Biggest single cause of "mid" |
| 2 | Ground detail (§1.2) | Second biggest; the eye spends most time here |
| 3 | Impact + suppression FX (§1.4) | Makes fights *feel* like fights |
| 4 | Foliage variety (§1.3) | Brief is written; needs generated assets |
| 5 | Crouch stance (§1.5) | Sim work; closes a real gap |
| 6 | HUD rebuild | Stat pips and info panel are in; frame/plate art is not |
| 7 | Real weapon meshes | Proportions fixed; still donor stand-ins |

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

| map | src Mpx | particles |
|---|---|---|
| iadrang | 8.08 | 65 |
| cuchi | 8.21 | 76 |
| mekong | 9.11 | 114 |
| khesanh | 8.11 | 58 |
| hill937 | 8.00 | 87 |

Comfortable headroom — roughly 4 Mpx spare per frame to spend on §1.1 and §1.2.
