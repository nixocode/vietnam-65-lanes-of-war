# VIETNAM '65 — LIVING PLAN

**This is the single running plan. Update it as work lands.** The other docs are
references, not plans:

| doc | what it is |
|---|---|
| `PLAN.md` | ← you are here. Mechanics register, priorities, standing rules |
| `SPRITE_PIPELINE.md` | How character + scenery art is made. Read before touching art |
| `FIX_PLAN.md` | Post-mortem of the "no shots / low fps / no variety" report |
| `V1_PLAN.md` | The original AAA-gap diagnosis. Phases 2–3 still partly open |
| `V3_PLAN.md` | Warfare 1944 research and the squad/cover/orders design |

---

## 0. Standing rules

1. **Never deploy without explicit approval.**
2. **No change is done until it is play-tested through `App._frame()`** with a
   monotonic clock, both sides deploying, asserting on outcomes. Run
   `tools/selftest.js`. Stepping a paused sim by hand has twice hidden real bugs.
3. **Frame rate cannot be measured from the automation pane** — it reports
   `document.hidden`, so rAF never fires and rasterisation is skipped. Any FPS
   number from there is fiction. The in-game overlay (`` ` `` / F3) is the source
   of truth and needs the owner to read it.
4. Do not revisit AI-generated per-frame sprite sheets, or auto-cut cutout rigs.
   Both are proven dead ends (see `SPRITE_PIPELINE.md` §1).
5. **Render on the owner's laptop, not a farm.** A full 11-unit rebuild is ~1300
   Blender renders and cooked an M4 Pro. `tools/render_all_sprites.sh` now runs one
   unit at a time at `nice -n 10`, 16 EEVEE samples (was 64 — visually identical
   for a flat-shaded 256px sprite that gets a hard outline anyway), with a pause
   between units. Prefer re-rendering a SINGLE unit; only run the full batch when
   the owner is away from the machine.
6. Direction given: **sandboxy over feature-list**, documentary tone, no side
   glorified. Animations are the standing #1 priority.

### Looking at the game

The automation pane never composites, so `computer{screenshot}` times out on it.
`tools/devserver.py` accepts `POST /__shot` with a data: URL and writes the image
to `assets/debug/` — the page hands its own canvas back:

```js
Renderer.render(g, null, t);
fetch('/__shot', { method:'POST', headers:{'X-Shot-Name':'ingame'},
                   body: Renderer.canvas.toDataURL('image/jpeg', 0.9) });
```

**Use it.** The palms shipped at physically-correct height (6-9 m ≈ 300px on a
900px canvas) and swamped the entire frame, hiding the soldiers. Every metric was
green. Only looking at a frame caught it.

### How to test

```bash
# in the browser console, or an automation eval
fetch('tools/selftest.js').then(r=>r.text()).then(eval).then(()=>SelfTest.run(50))
```

Every map × both sides: no console errors, shots fired, casualties taken, CP never
negative, no NaN, nobody below their lane, muzzle points on the man, both sides
fielded. Plus asset integrity — every unit atlas, every clip, every frame's muzzle
point, every prop's metrics. **Current: 10/10 pass.**

Always enter through `SelfTest.ready()` — atlases load asynchronously, and running
straight after a reload once reported every asset missing while the gameplay checks
passed on the fallback renderer. A false failure that could as easily be a false pass.

---

## 1. MECHANICS REGISTER

Everything asked for across the project, with honest status.
✅ done · 🟡 partial · ⬜ not started

### 1.1 Squad & tactical layer  *(the Warfare 1944 model)*
| # | Mechanic | Status | Notes |
|---|---|---|---|
| 1.1.1 | Squads of 3–4 men, not lone soldiers | ✅ | `SQUADS` table, squad anchor + slots |
| 1.1.2 | Whole squad engages — no queueing on the front man | ✅ | randomised target scoring |
| 1.1.3 | Select a squad and give it orders | ✅ | click-select, order keys |
| 1.1.4 | Frag grenades as a squad action | ✅ | `_squadGrenade`, cooldown, throw animation |
| 1.1.13 | **Smoke grenades** | ✅ | screens LOS, lets a pinned squad cross open ground |
| 1.1.14 | **Vehicles — M113 APC** | ✅ | armoured, `.50` suppressive; sappers/mines kill it |
| 1.1.15 | **RPG team — the answer to armour** | ✅ | rocket ignores armour; AI buys it on sight of a vehicle |
| 1.1.5 | Suppressive fire as a squad action | ✅ | `_squadSuppress`, MG only |
| 1.1.6 | Post up in advantageous positions | ✅ | cover occupancy, one squad per spot |
| 1.1.7 | Squad pinning / suppression state | ✅ | `pin`, `underFireT`, prone under fire |
| 1.1.8 | Bounding advance — don't cross open ground under fire | ✅ | needs a friendly firing, or cover |
| 1.1.9 | Close fights resolve faster | ✅ | 0.70 pause multiplier + range-scaled cover |
| 1.1.10 | Squad veterancy — XP and ranks | ✅ | 4 ranks, earned by kills; accuracy + steadiness |
| 1.1.11 | Frontline control bar HUD | ✅ | per-lane held ground, contested seam marked |
| 1.1.12 | **Persistent perk tree between missions** | ✅ | 6 perks, CMD points earned per match, localStorage |

### 1.2 Terrain, cover & emplacements
| # | Mechanic | Status | Notes |
|---|---|---|---|
| 1.2.1 | Trenches | ✅ | flank every flag |
| 1.2.2 | Towns / villages / buildings | ✅ | hamlet, village, stilt settlements |
| 1.2.3 | Destructible structures (napalm etc.) | ✅ | 3 states, burn, rubble |
| 1.2.4 | Designated sniper spots — watchtowers, hills | ✅ | `towerpos`, class-locked to sniper |
| 1.2.5 | Equivalent spots for other classes | ✅ | `nestpos` MG-locked; `hide` VC-only |
| 1.2.6 | VC jungle hiding spots | ✅ | conceal zones, `hide` cover |
| 1.2.7 | **Firing ports in cabins** | ✅ | `window` cover + cut opening behind the man |
| 1.2.8 | Lane levels / undulation | ✅ | `ELEV_PX` 96→230 + rolling relief; hill937 climbs 202px |
| 1.2.9 | Ground texture variety | ✅ | slope-aware turf / scour / hollow water |
| 1.2.10 | Bigger scrolling maps | ✅ | `WORLD_W` 2560, camera |

### 1.3 Combat feel
| # | Mechanic | Status | Notes |
|---|---|---|---|
| 1.3.1 | Shots miss visibly | ✅ | rounds go long/short, dirt kicks |
| 1.3.2 | Slower, sandboxy pace | ✅ | economy, AI cadence, walks |
| 1.3.3 | Burst fire with pauses | ✅ | per-weapon burst/pause tables |
| 1.3.4 | Suppression dives | ✅ | |
| 1.3.5 | Gore — restrained, persistent | ✅ | gibs, blood decals, corpses bake |
| 1.3.6 | Muzzle flash at the real barrel | ✅ | tracked per frame from Blender |
| 1.3.7 | Dynamic muzzle light | ✅ | additive, lights the shooter |
| 1.3.8 | Contact shadows | ✅ | |
| 1.3.9 | Hit-stop, screen shake, impact debris by material | ✅ | see P2 below |
| 1.3.11 | Footfall dust | ✅ | emitted per STEP, so it stays locked to the stride |
| 1.3.10 | Reload beat between bursts | ✅ | rifle comes down between bursts, blends back up |

### 1.4 Characters & animation
| # | Mechanic | Status | Notes |
|---|---|---|---|
| 1.4.1 | Sprites rendered from 3D models | ✅ | the whole `SPRITE_PIPELINE` |
| 1.4.2 | Appropriate, period characters | ✅ | 6 donor bodies, faces, period kit |
| 1.4.3 | Variety — not one man cloned | ✅ | bodies spread across roles + per-man gait |
| 1.4.4 | Real weapons | ✅ | AK, SMG, scoped rifles, M60 meshes |
| 1.4.5 | Run properly at the same pace | ✅ | run cycle, compressed stride |
| 1.4.6 | No flicker / disappearing men | ✅ | one model, one camera, shared anchor |
| 1.4.7 | No foot-skate | ✅ | gait driven by ground covered |
| 1.4.8 | Expansive animation set | ✅ | 14 clips, **125 frames/unit** |
| 1.4.9 | Smooth transitions between states | ✅ | 0.18s cross-fade, coverage never dips |
| 1.4.10 | Crouch stance | ⬜ | sim has no crouch state either |
| 1.4.11 | Turn-around when reversing | ✅ | scale eases through zero — he pivots |
| 1.4.12 | Aim breathing / weapon settle | ✅ | sub-pixel sway on aim and prone |

### 1.5 World & presentation
| # | Mechanic | Status | Notes |
|---|---|---|---|
| 1.5.1 | One art language — profile camera throughout | ✅ | soldiers, buildings, palms, cover, MG nests, **towers, wells, carts, vehicles** |
| 1.5.2 | Parallax depth layers | ✅ | |
| 1.5.3 | Ambient life — birds, patrols, smoke | ✅ | |
| 1.5.4 | Title / campaign / briefing screens from concept art | ✅ | |
| 1.5.5 | Lane selector — whole lane glows translucent | ✅ | 15% opacity |
| 1.5.6 | Choppers fly forwards | ✅ | |
| 1.5.7 | Responsive UI, phone + desktop | ✅ | `--uiK` transform scale |
| 1.5.8 | DPI-correct rendering | ✅ | capped at 2 |
| 1.5.9 | Depth haze + colour grade | ✅ | per-lane aerial perspective; warm/cool grade |
| 1.5.12 | **Night operations** | ✅ | Khe Sanh is dark; muzzle flash is the only light |
| 1.5.10 | Layered audio with distance falloff | ✅ | distance colouring + lag, treeline echo, ricochets, rocket |
| 1.5.11 | **Squad selector decals (US/VC)** | ⬜ | look bad — owner flagged, low priority |

---

## 2. PRIORITY LIST

Owner's brief: *animations, and gameplay still feels laggy and arcade — make it
more realistic and immersive through expansive animations, assets.*

"Arcade" here is diagnosable. The sim is sound; what reads as cheap is that
**every state change pops**. A man goes run → aim in one frame with no settle, and
a 12-frame run cycle stepping off distance runs at roughly 10 animation-fps. That
is the tell, and it is fixable without touching gameplay.

### P1 — Animation smoothness  *(the "arcade" fix)*
1. ✅ **Cross-fade between clips.** Blends over 0.18s, outgoing pose at full alpha
   under the incoming one so coverage never dips mid-fade. → 1.4.9
2. ✅ **Raised frame counts** — run 12→18, runfire 12→18, walk 10→14, death 9→12,
   aim 4→6, fire 5→7, throw 7→9, dive 7→9, melee 6→8. **92 → 125 frames per unit.**
   Atlas cell dropped 160→128, so the richer sheets are *smaller* on disk than the
   old ones (10.1 MB total). Rebuild now takes **3 minutes, not 15**. → 1.4.8
3. ✅ **Breathing while aiming** — sub-pixel sway on aim and prone.
4. ✅ **Reload beat** — the rifle comes down between bursts and back up. → 1.3.10
5. ✅ **Turn-around** — horizontal scale eases through zero, so he pivots
   instead of teleporting. → 1.4.11

### P2 — Weight and impact  ✅ *(makes hits feel real)*
6. ✅ **Hit-stop** — sim runs at 0.16x for ~50 ms on a kill, 85 ms on a gib. Drained
   against REAL time so it cannot stretch its own recovery into a stutter, and only
   fires when the camera can see it — freezing the clock for something off-screen
   is just a hitch.
7. ✅ **Directional screen shake** — 62% biased along the blast direction, 38%
   noise, so a shell landing left shoves the camera left. Kills add a small kick.
8. ✅ **Impact debris by material** — a round that misses now reports what it hit:
   timber splinters off buildings, sparks off towers and MG nests, water plumes in
   the paddies, dirt everywhere else. Verified per biome: 121 splinter hits on the
   village map, 40 water plumes on the paddy map, 0 splinters where there are no
   buildings.
9. ✅ **Footfall dust** — emitted per STEP (accumulated distance), not per second,
   so it stays locked to the stride at any speed.

### P3 — Immersion assets
10. ✅ **Profile conversion finished.** Village buildings, palms, sandbag cover,
    MG nests, **watchtowers, wells, carts and the APC** all come off the same
    camera now. → 1.5.1

    **Correction to an earlier call.** I previously parked towers/wells/carts and
    said procedural box geometry "reads as a pile of loose sticks" and the
    approach was wrong. It was not the approach — it was a one-line bug.
    `bmesh.ops.create_cube(size=1)` spans −0.5…0.5, so the scale IS the span, and
    I was setting `scale = (x1-x0)/2`. **Every box was half its intended size**,
    so nothing touched anything. With that fixed the tower, well and cart came out
    clean on the first try. Worth remembering: "the technique doesn't work" is a
    conclusion that needs the same evidence as any other.
11. ✅ **Palms placed** — 4 profile-rendered variants mixed into the treeline,
    mirrored and height-varied so a stand is not a row of clones. 54 on the paddy
    map, 49 in jungle, 0 on grassland.
12. **Lighting pass** — time of day, haze by depth, colour grade. → 1.5.9

### P4a — Grenades and vehicles  ✅
15. ✅ **Smoke grenades** (`S` on a selected squad). Screens line of sight —
    `smokeAt()` returns density and `canSee()` fails above 0.55 — and, crucially,
    counts as cover for the bounding-advance rules, so a squad that would not
    cross open ground *will* cross behind its own smoke. That makes it a decision
    rather than another damage button. Clouds build over ~1.1s, drift, spread and
    thin, so popping smoke is not instant cover.
16. ✅ **M113 APC** (`apc`, 40 CP). A vehicle is a unit like any other — it
    inherits targeting, morale, cover and damage for free — plus `vehicle: true`,
    which makes the renderer draw a prop instead of a soldier and keeps it off the
    ground (never prone, never dives). Measured balance:

    | | effect |
    |---|---|
    | rifle round | 2.5 dmg — **105 rounds to kill** |
    | satchel / mine / shell | full damage ×2.4 — **2 to kill** |
    | infantry, same round | 9 dmg (unchanged) |

    Armour is near-immune to small arms and dies to the right tool, which keeps
    sappers relevant instead of making the APC a wall. It brews up with an
    explosion rather than leaving a corpse.

### P4b — This stretch  ✅
17. ✅ **RPG team** (VC, 26 CP). Adding the APC created a gap: the only counter was
    a sapper closing to satchel range, which is not a counter, it is a hope. The
    rocket detonates as area damage flagged `heavy`, so armour is no defence —
    **3 rockets kill an APC in 5s** — and `_aiPickUnit` now buys RPG teams the
    moment it sees a vehicle (measured: 6 bought in a 110s match).
18. ✅ **Audio depth.** Distance no longer only lowers volume: air eats the highs
    first, so a far rifle is a dull thump, not a small crack. Shots arrive **late**
    (up to 130 ms), and anything beyond a quarter-map slaps back off the treeline
    on the opposite pan. Plus **ricochets** off towers and hard cover, and a
    dedicated **rocket** launch. → 1.5.10
19. ✅ **Night operations.** `map.tod === 'night'` (Khe Sanh — its own briefing
    promised "nine minutes of darkness"). The world is washed to dark blue, then
    every light source is replayed on top: muzzle flashes, burning wreckage,
    ground fire. The additive muzzle light built earlier barely registered in
    daylight; after dark it carries the entire scene. → 1.5.12

### P4 — Depth
13. ✅ **Perks / XP / frontline HUD** — the original brief's progression, complete.
    → 1.1.10, 1.1.11, 1.1.12

    ✅ **Squad veterancy.** Four ranks (GREEN → SEASONED → VETERAN → HARDENED) at
    3 / 8 / 16 kills by that squad. A rank buys accuracy (+8% per step) and
    *steadiness* — pin builds slower and decays faster, so veterans keep their
    heads where green troops go to ground. Deliberately small: this should reward
    pulling a hurt squad back, not make a rank-3 squad unkillable. Shown as
    chevrons over the squad, with a promotion floater, because veterancy the
    player cannot see is worth nothing. Measured: 7 promotions in a 2-minute
    match, rank 2 reachable in ~4 min, rank 3 genuinely rare.

    ✅ **Frontline control bar.** One strip per lane under the minimap. The
    minimap shows where men *are*; this shows who owns the ground between them,
    filled from each base to that lane's contested point, with the seam marked.
    A lane being lost now reads without counting dots.

    ✅ **Persistent perk tree** (`js/perks.js`). Veterancy is progression *within*
    a match; this is progression *across* them. Commendation points are earned by
    how a fight actually went — kills/6, +3 for a win, +1 for taking no losses —
    and spent on six standing perks kept to one rank each with a single stated
    effect. A deep tree would be a lot of UI for a game whose decisions live on
    the field, and an unreadable tree is worse than none.

    | perk | CMD | effect |
    |---|---|---|
    | Veteran Cadre | 3 | squads arrive SEASONED |
    | Ample Ammunition | 2 | shorter pause between bursts |
    | Entrenching Tools | 2 | cover protects ~28% better |
    | Field Surgeons | 3 | losses cost 28% less morale |
    | Fire Direction | 3 | call-ins cost a quarter less CP |
    | Pathfinders | 2 | +18% speed in the open, +25% detection |

    Effects are read through `Perks.on(game, side, id)`, which checks the side is
    the **player** — verified that a bought perk gives the player's squads rank 1
    while the AI's stay at 0. A perk leaking to the enemy would silently buff them.
14. **Audio** — weapon tails, ricochets, distance falloff. → 1.5.10

### P5 — Cosmetic  *(explicitly deprioritised by the owner — gameplay first)*
15. **Redo the US/VC squad selector decals.** They look bad. Low priority; the
    foundations come first. → 1.5.11

### P6 — Performance  ✅ *(owner reported frame-rate trouble)*
20. ✅ **Profiled instead of guessed.** Counted destination and source megapixels
    per frame rather than draw calls, which is the metric that actually matters
    here: a frame is ~9 full-screen layer blits (sky, two parallax, three lane,
    three decal) plus the atmosphere fills, so cost tracks the backing store.
    Measured at 1600x900 with ~55 units: **14.5 source Mpx/frame**.
21. ✅ **Parallax layers were blitted whole.** The far and mid layers are wider
    than the screen and were drawn in full, so the driver sampled ~2.5 Mpx a frame
    that was then clipped away off-screen. Source-rect them to the visible window,
    as the lane layers already did.
22. ✅ **Props sampled 512x512 sources to draw ~150px.** Each size is now
    pre-scaled once into a small canvas, bucketed to 8px so a hundred slightly
    different palm heights do not each mint a texture.
23. ✅ **Empty decal layers cost a full-screen blit for nothing.** Skipped until
    something is actually baked into them — worth ~2.8 Mpx for the opening minute
    of every match.

    **Result: source sampling 14.5 → 10.9 Mpx (-25%), and 6.85 Mpx early-game.**

24. ✅ **Adaptive resolution** (`Renderer.renderScale`). Rather than guess at any
    one machine, measure and adjust: sustained frames over 21 ms drop the backing
    store in 12% steps to a floor of 0.62 (**38% of the pixels**); comfortable
    frames under 13.2 ms give the sharpness back in smaller steps. Deliberately
    sluggish — it needs a second of consistent evidence and holds 1.1 s after any
    change, because a resolution that visibly pumps is worse than one that is
    simply a little soft. The current scale is shown in the `` ` ``/F3 readout so
    the choice is visible rather than mysterious.

    Verified by feeding the controller synthetic frame times: 34 ms drives it to
    the 0.62 floor and holds; 9 ms returns it to 1.0 and holds. **The loop itself
    cannot be validated here** — the automation pane never rasterises, so measured
    frame times are fiction. It needs a real number off the overlay.

25. ✅ Favicon (was a 404 on every load).

### Blocked
- **Real frame-rate numbers.** Everything above is measured work-per-frame, not
  wall-clock. The `` ` ``/F3 overlay now reports FPS, ms, p95 and the current
  render scale — that reading has to come from the owner's machine.

---

## 3. Known limitations

- No crouch stance between standing and prone; the sim has no crouch state either.
- Separate squads still overlap where they converge — spacing is enforced within a
  squad, not between them.
- `js/rig.js` and `tools/cut_figures.py` are dead weight once the 3D path is
  trusted in play.
