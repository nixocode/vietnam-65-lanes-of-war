# VIETNAM '65 — V2 HANDOFF BRIEF
> **NEXT UP: see `V3_PLAN.md`** — researched Warfare 1944 core (squads, cover/trenches,
> orders, grenades, perk trees) with a 3-session build order. That plan supersedes the
> workstreams below, which are all DONE.
### For a fresh session (Fable 5). Read this top to bottom before touching code.

You are inheriting a **finished, deployed v1** of a browser war game and taking it to v2.
v1 works end-to-end and is live. Your job is a **fidelity + scale ramp**, not a rewrite.
Do not throw away the simulation — it's good. Replace the *presentation layer* and *add a
camera*, keeping everything playable at every step.

---

## 1. What this project is

**Vietnam '65: Lanes of War** — a 2.5D side-view, three-lane real-time tactics game in the
tradition of *Warfare 1944*, set in the Vietnam War (1965–69). Built as **vanilla HTML5
Canvas + WebAudio, zero dependencies, no build step, no framework.** Full design doc intent:
US/ARVN "firepower doctrine" (call-ins, air/arty) vs VC/NVA "ground doctrine" (concealment,
traps, tunnels, ambush) — an asymmetric lane war with elevation, concealment≠cover, and a
sniper duel subsystem.

**It is live in production:** https://vietnam-65.vercel.app
(Vercel project `vietnam-65`, account `nixocode`, linked via `.vercel/`. Redeploy with
`vercel deploy --prod` from the project root.)

### Systems that already work (verified, don't rebuild):
- Three-lane push/pull, CP economy, morale win condition, flag capture + income/drain.
- Full US↔VC asymmetry: 5 call-ins (Fire Mission, Napalm, Dustoff, Air Cav, Arc Light) vs
  4 VC works (punji, tripwire, spider hole, tunnel).
- Elevation (downhill range/damage bonus), concealment vs cover split, spotting/recon.
- Snipers with telegraphed aim wind-up + counter-sniper duels (range + high ground decide).
- 5 maps incl. special modes: **Khe Sanh** (siege, US turtles) and **Hill 937** (assault,
  take-all-flags uphill, timer).
- Skirmish + 5-mission alternating-side campaign with typewriter briefings, `localStorage`
  progress.
- Procedural audio, full HUD, click/keyboard input, pause/speed/mute, result screen.

---

## 2. File map (where everything lives)

| File | What's in it | v2 impact |
|------|--------------|-----------|
| `index.html` | Screens (menu/skirmish/campaign/briefing/manual/pause/result), HUD DOM | add loading screen + minimap |
| `css/style.css` | All styling, HUD, screens (military/paper theme) | minor |
| `js/data.js` | `CANVAS_W/H`, `LANE_BASE/DEPTH/BANDS`, `BASE_X`, `UNITS`, `CALLINS`, `MAPS`, `CAMPAIGN`, `elevAt()`, `groundY()` | **big:** world-width, animation metadata, asset manifest |
| `js/audio.js` | `Sound` — 100% synthesized WebAudio SFX | **big:** sample-based audio + fallback |
| `js/fx.js` | `FXManager` — particles, `decals[lane][]`, `explosion()`, `muzzle()`, `tracer()`, `blood()` | **big:** gore/gibs, decal layer, sprite VFX |
| `js/render.js` | `Renderer`, `drawSoldier()`, `_buildLane()`, `_drawUnits()`, vehicle draws, card icons | **biggest:** camera, sprite animator, textures |
| `js/game.js` | `Game` class — combat, AI, `_updateUnits()`, `_advance()` (walk phase), `_fire()`, `_kill()` | medium: death states, gib triggers, world coords |
| `js/ui.js` | `UI` — HUD, cards, ticker, `_canvasPos()`, `_laneAt()`, targeting | medium: screen↔world via camera |
| `js/main.js` | `App` — screens, `startGame()`, RAF loop `_frame()` | medium: asset preload gate, camera input |
| `assets/image-prompts.md` | Nano Banana Pro prompt kit for generating all art | your art spec |
| `README.md` | Player-facing overview | keep updated |

**Run it:** `python3 -m http.server 8931` → http://localhost:8931 (launch.json config
`vietnam65` already exists for the preview tooling).

**Headless test trick (IMPORTANT):** the RAF loop auto-advances the sim whenever
`App.state === 'playing'`, so manual `App.game.update(dt)` steps get overwritten before you
can screenshot. To freeze for deterministic stepping: set `App.state = 'paused'` *directly*
(NOT `togglePause()`, which shows the overlay) — paused still renders but stops auto-update.
Then loop `App.game.update(0.05)`, call `UI.update(0.05)` once, and screenshot. Silence the
AI with `App.game._aiUpdate = function(){}`. Seed scenarios with
`g.trySpawn(side,key,lane,{free:true,x:...})` and `g.tryCallin(...)` (call-ins still check
CP, so set `g.cp.us = 250` first). Full headless matches (`while(!g.over) g.update(0.05)`)
finish in <1s.

---

## 3. HONEST CRITIQUE — how "basic" things actually look right now

The procedural-everything approach was the correct v1 bet: it proved the whole game loop,
the asymmetry, and the five maps with zero art dependencies, and at a glance (thanks to
vignette + haze + parallax + a disciplined palette) it reads as atmospheric and coherent.
**But the fidelity ceiling of canvas primitives is low, and up close it shows.** Be blunt
with yourself about this — it's the entire reason for v2:

- **Soldiers are stick figures.** `drawSoldier()` in `render.js` draws humans out of
  `ctx` line strokes (limbs), a circle (head), and a few polygon hats. No volume, no cloth
  fold, no webbing, no boots — animated matchstick men. Readable, not believable.
- **"Animation" is a 2-frame leg swing.** Walking is `Math.sin(phase)*5` on two leg
  segments (`_advance()` bumps `phase`). No run cycle, no arm swing, no weapon recoil, no
  reload, no idle breathing. Death is a single rotate-and-fade (`deadT` in `_updateUnits`).
- **No textures anywhere.** Terrain is flat-filled polygons with procedural grass tufts and
  stroke-drawn brush/trees (`_buildLane()`). The only gradients are the sky and morale bars.
  There is **no asset-loading pipeline at all** — the engine cannot currently consume an
  image or an audio file.
- **Explosions read as "canvas particles."** `FXManager.explosion()` is flash circles +
  a shockwave ring + dot debris + procedural smoke. Punchy-ish, but obviously primitive —
  no sprite frames, no heat shimmer, no varied debris, no lingering ground fire textures.
- **Audio is filtered white noise.** `Sound.shot()` etc. are WebAudio noise bursts through
  biquad filters. The M16-vs-AK *idea* is there, but it sounds like static, not gunfire;
  explosions are a lowpass-noise + sine thump — serviceable, not visceral. No layering
  (mechanism + report + tail), no positional panning.
- **The map is one fixed screen.** Everything lives in a 1280×720 world (`CANVAS_W`), no
  camera, no scrolling. The whole battlefield fits in one view, which caps the sense of
  scale — *Warfare 1944* felt big because you scrolled a wide front. We don't.
- **Gore is four red squares.** `blood()` spits a few `#7c2418` dots. No dismemberment, no
  gibs, no ragdoll, no persistent corpses. Decals are simple crater/scorch ellipses.

None of this is a knock on v1 — it's the exact list the owner wants fixed in v2.

---

## 4. THE V2 MISSION — take it from basics to next level

Owner's targets, in their words: **running animations · realistic soldiers instead of stick
figures · load/pull textures · bigger maps you scroll left/right with the mouse (like
Warfare 1944) · better explosions · much better gunfire & explosion sounds · decals · body
dismemberment.** Below, each as a workstream with concrete direction.

> **The owner is providing image assets** (soldier sprites, VFX, textures, decals — generated
> from `assets/image-prompts.md`) and will drop them into the `assets/` folder. Build the
> pipeline to consume them, and **degrade gracefully**: if an asset is missing, fall back to
> the current procedural draw so the game is *always* playable as art trickles in.

### W1 — Asset pipeline & loading (do this FIRST; everything depends on it)
- New module `js/assets.js`: an `Assets` loader that preloads images (into `Image`/`ImageBitmap`)
  and audio (decoded `AudioBuffer`s) from a **manifest**, with progress → a loading screen in
  `index.html` shown before `startGame`.
- Manifest lives in `data.js` (or `assets/manifest.json`): maps logical names →
  files + sprite-sheet metadata (frame w/h, rows/cols, per-animation frame ranges, fps,
  anchor/baseline).
- **Graceful fallback API:** `Assets.img(name)` returns the bitmap or `null`; every draw site
  checks `null` and uses the existing procedural path. Same for `Assets.sfx(name)`.
- Suggested folders: `assets/sprites/{us,vc}/`, `assets/vfx/`, `assets/terrain/`,
  `assets/decals/`, `assets/audio/`. Naming should match the sheets `image-prompts.md`
  produces (one sheet per unit, labeled pose order: idle · walk×3 · fire · prone · hit · fallen).

### W2 — Sprite soldiers + real animation (kills the stick figures)
- Add a sprite animator that replaces `drawSoldier()` when an atlas exists. State machine:
  `idle | walk | run | fire | prone | hit | death` with frame ranges + fps from the manifest.
- Drive state from existing unit flags in `game.js`: `moving`, `suppressT`/`slowT` (→ walk vs
  run speed already differ), `aiming`/`pose==='prone'`, `muzzleT>0` (→ fire), `deadT` (→ death).
- **Running animation specifically:** give units a `running` state (e.g. when advancing
  unobstructed at full speed vs. slowed) and a distinct multi-frame run cycle; keep `phase`
  as the animation clock. Add weapon recoil kick on `_fire()`.
- Keep `SOLDIER_COLORS` + primitive `drawSoldier()` as the fallback.

### W3 — Camera & bigger maps (the Warfare 1944 feel)
- **Split world width from view width.** Introduce `WORLD_W` per map (e.g. 2400–4000) while
  the viewport stays `VIEW_W = 1280`. Audit every `CANVAS_W` in `data.js`/`game.js`/`render.js`
  — many assume world==view (`groundY`, `spawnX`, `BASE_X`, flag `x`, conceal zones, breakthrough
  goals, targeting). This is the **riskiest refactor — do it behind a `Camera{x, targetX}`**.
- Rendering: wrap the world draw in `ctx.translate(-cam.x, 0)`; keep HUD (DOM overlay) fixed.
  Parallax sky/hills by `-cam.x * factor`. Lane layers become `WORLD_W` wide offscreen canvases.
- **Input = mouse-edge scroll** (cursor near left/right screen edge pans, like Warfare 1944),
  plus optional drag and arrow keys. Add `screenToWorld(x)`/`worldToScreen(x)` and route
  `UI._canvasPos()` + targeting through it. Add a **minimap** strip showing lane fronts, flags,
  and the camera window.
- Cull off-screen entities in draw loops for perf.

### W4 — VFX overhaul (explosions, muzzle, fire, tracers)
- Sprite-sheet, additive-blended explosions (arty impact, napalm bloom, Arc Light row) driven
  by the same animator; muzzle-flash sprites; better rolling smoke; lingering **ground fire**
  with real flame textures; heat-shimmine on big blasts; brighter glow on tracers.
- Keep `FXManager` as the owner; add a `sprites` particle type that plays a sheet. Fallback to
  current procedural explosion when no sheet is loaded.

### W5 — Audio overhaul (make it hit)
- Sample-based SFX through W1's loader: layered gunfire (mechanical click + report + tail),
  distinct M16/AK/M60/RPD/sniper, meaty explosions with sub-bass, rotor loops, ricochets,
  radio. **Pan/attenuate by lane + camera position** (a fight off-screen-left sounds left).
- Keep the synth `Sound` methods as fallback; the loader just swaps in buffers when present.
- Round-robin + slight pitch randomization so repeated shots don't machine-gun identically.

### W6 — Decals & persistence
- A persistent per-lane decal canvas (offscreen) that **accumulates** craters, scorch, napalm
  scars, blood pools, shell casings, and corpses — composited once, not redrawn per frame.
  `FXManager.decals` is already per-lane; upgrade it to a baked layer + textured stamps.

### W7 — Gore / dismemberment (tie to the game's documentary tone)
- Casualty system: on lethal hits spawn blood decals; on **high-damage kills** (explosions,
  sniper, sapper) spawn **gib particles** + a dismemberment death variant; leave persistent
  corpse decals. Ragdoll-lite is fine (a few articulated segments) — full physics not required.
- **Tone guardrail:** the GDD's whole stated register is *documentary, restrained, no side
  glorified.* Keep gore stylized/silhouette-first with muted `#7c2418` blood — that both fits
  the art direction and is what the provided sprites will be drawn as. Not comedic, not
  torture-porn; grim and matter-of-fact.

---

## 5. Build order & guardrails

**Sequence:** W1 (pipeline) → W2 (sprite soldiers) → W3 (camera/scroll) → W4 (VFX) →
W5 (audio) → W6 (decals) → W7 (gore). Ship each behind graceful fallback so the live site
never breaks between steps.

**Guardrails:**
- **Never remove the procedural fallback** until an asset fully replaces it. The game must run
  with an empty `assets/` folder.
- **Performance:** bigger world + more sprites + gibs = watch it. Cull off-screen, cap
  particles (there's already a 900 cap in `fx.js`), prefer atlas draws over per-frame vector
  work, bake decals.
- **Keep the sim authoritative.** Presentation reads unit state; don't move game logic into
  the renderer.
- **Test headlessly** (see §2) after each workstream; verify a full match still resolves with
  no console errors, then screenshot the visual result.
- **Tone stays documentary.** Real historical context in briefings, neither side glorified.
- Redeploy to Vercel (`vercel deploy --prod`) once each milestone is verified.

---

## 6. V2 STATUS — 8 JULY 2026 SESSION (all 7 workstreams landed)

**W1 ✅ Asset pipeline.** `tools/slice_assets.py` slices the owner's labeled sheets
(they fake transparency with a painted checkerboard — the slicer keys it out, erases
ground lines/label text, splits the 8 poses, strips baked muzzle flashes and records the
muzzle point per sheet). Generates `assets/manifest.js` (112 frames, ~3.8 MB).
`js/assets.js` preloads with progress on the menu; every accessor null-falls-back to the
procedural draw.

**W2 ✅ Sprite soldiers.** All 11 units mapped (see `UNIT_SPRITES` in data.js; engineer
reuses us_rifle, recon reuses us_sniper, nva+rpd share vc_gunner). State machine:
idle / 4-step walk cycle / fire (persistent while `combatT`>0, recoil kick on `muzzleT`) /
prone / hit flinch (`hitT`) / death (hit frame 0.22s → fallen frame → baked corpse).

**W3 ✅ Camera & 2× world.** `WORLD_W=2560`, viewport 1280. `Camera` in render.js;
mouse-edge scroll + arrows/A-D + wheel + clickable minimap (in HUD, drawn per frame).
Parallax far ridges (0.25×) + mid canopy band (0.5×). Unit speeds ×~1.5, ranges ×~1.25,
AoE radii bumped; siege 560s, assault 700s. All world-space CANVAS_W uses audited.

**W4 ✅ Sprite VFX.** Fire-sheet anims: muzzle flashes, explosion blooms, small blasts,
looping ground-fire on napalm strips. **Caveat:** several sheet frames have label text
baked in flame-orange (unkeyable) — they're skipped via `VFX_SKIP` in assets.js and
procedural smoke covers the late phase. Ask the owner for a **clean napalm wall +
explosion smoke-phase sheet (no labels!)** next session.

**W5 ✅ Audio (procedural v2).** No samples were provided, so: layered synth gunshots
(mech click + report + tail, pitch jitter), sub-bass explosions with debris patter, insect
ambience, and **camera-relative stereo panning** (`Sound._spatial(x)`). Sample loading is
the natural next step when the owner sources audio files.

**W6 ✅ Baked decals.** `Renderer.decalLayers` (WORLD_W offscreen per lane) accumulate
craters, scorch, blood pools, shell casings, splatter, and corpses (fallen sprite baked at
`deadT`≥0.9, capped 60/lane). Napalm burn scars still redraw via lane layer.

**W7 ✅ Gore (restrained).** High-damage kills (`_kill` with `{gib:true}`: explosions
≥30 dmg, sapper blasts, 35% of sniper kills) skip the corpse and spawn gib fragments +
blood mist + a baked splatter. Muted `#7c2418`, abstract chunks — documentary register.

**Verified:** 10/10 headless matches (5 maps × both sides) complete with zero console
errors; render ~0.07 ms/frame. Deployed to production.

### Feel pass (same day, after owner review: "make it sandboxy, slower, add towns")

- **Burst fire**: `UNITS` now carry `burst:[min,max]` + `pause:[min,max]`; `rof` = rate
  *inside* a burst. Misses render as tracer overshoot/short-falls with dirt kicks, and
  cracking near-misses suppress (`suppressT`), which puts men visually prone.
- **Pace**: INCOME 2.5/2.9, MORALE_LOSS 0.24/0.15, FLAG_DRAIN 0.22, aiInterval 1.7 (vet),
  speeds ~×1.2 of v1, breakthrough morale ×0.45. Defended-lane sim matches now run
  ~4–5+ min (humans with call-ins: longer).
- **Structures**: `map.settlements` → destructible hooches/longhouses/stilt houses/
  bunkers/wells/haystacks (`game.structures`, drawn in `_drawStructures`). Explosions
  damage them, napalm/standing fires ignite them; intact → damaged → burning → charred
  rubble that persists. Khe Sanh gets US bunkers + a pre-ruined hamlet; Hill 937 crest
  bunkers.
- **Life**: 30% of small-arms deaths crawl (prone frame, blood-drip decals) before dying;
  birds scatter from tree lines near fire; ambient patrol Hueys cross the AO; seeded
  distant smoke columns beyond the ridge.
- **DEPLOY POLICY**: owner reviews before any deploy — do NOT `vercel deploy` unprompted.
  (Prod currently runs the pre-feel-pass interim build.)

**Owner asset wishlist for next session:** clean napalm-wall + explosion sheets (no baked
labels), an NVA rifleman sheet (pith helmet + AK — nva currently borrows the RPD gunner
sheet), a flat-style VC sniper (current one is pixel-art and stylistically odd), vehicle
sheets (Huey, M113, PT-76), terrain texture tiles, and **audio samples** (per-weapon
gunfire layers, explosions, rotor loop, ricochets, radio chatter).
