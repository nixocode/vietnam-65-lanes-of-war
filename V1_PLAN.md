# VIETNAM '65 — ROAD TO V1.0

> **The running plan is [PLAN.md](PLAN.md).** This document is a reference.

### An honest diagnosis, then a plan to make it look like a 2026 game

---

## 1. WHY IT LOOKS BAD RIGHT NOW (the real reasons, not excuses)

**1. Three different art languages are on screen at once.** This is the single
biggest problem and no animation work fixes it.
- Soldiers: flat side-on profile, thick outline, painted shading
- Buildings: **isometric 3/4 view** with a different line weight and lighting
- Terrain: flat vector shapes with no texture, drawn in code
A hooch drawn in 3/4 next to a pure-profile soldier reads as a collage. Warfare 1944
was consistent: one camera, one line weight, one palette. We are not.

**2. The soldiers are stiff because the rig is too simple.** Five pieces (head,
torso, arm+weapon, thigh, shin) with **one shared pose library**. No elbow, no knee
independence, no per-unit motion. So a heavy M60 gunner and a light scout literally
move with the same timing — the user is right that everything moves the same. A
believable 2D character needs 8-12 joints and per-class pose sets.

**3. Asset hygiene was not enforced.** A source sheet's label text ("1ETER / DE")
shipped baked into the watchtower tile and was drawn in every lane. Watermark
sparkles, stray glyphs, and mixed perspectives all got through because there was no
intake check. That is a process failure, and it is fixable with a gate, not vibes.

**4. No lighting, no shadows, no atmosphere.** Everything is drawn at full ambient
with a flat haze. No contact shadows under units, no light from muzzle flashes or
fire, no time of day, no depth of field. Modern 2D reads "expensive" almost entirely
because of light.

**5. It rendered at the wrong resolution.** The canvas was a fixed 1280x720 image
stretched across whatever display you had — on a Retina Mac that is a 2x upscale,
which is exactly the "pixelated" look. (Fixed today: the backing store now matches
device pixels.)

**What is actually good and must NOT be thrown away:** the simulation. Squads,
cover occupancy, suppression and pinning, orders, bounding advance, morale, flags,
call-ins, destructible structures, emplacements, the AI. That layer is genuinely
solid and is most of the real work in a tactics game. **We do not restart the game.
We restart the presentation.**

---

## 2. THE CORE DECISION: HOW CHARACTER ART IS MADE

Everything else depends on this. Three honest options:

**Option A — Render 2D sprites from simple 3D models. (My recommendation.)**
Build or buy a low-poly soldier per faction, rig it once, animate it once, then
render out sprite sheets from a locked side camera.
- *Why it wins:* frame-to-frame consistency is mathematically guaranteed — the exact
  thing AI-generated sheets can never do and the reason we burned weeks on morphing.
  Unlimited animations (walk, run, crouch-run, aim, fire, reload, prone, crawl, hit,
  3 death variants, vault, throw) at any frame count. Perfect, consistent lighting
  and perspective. Add a unit by re-skinning the same rig.
- *Cost:* one-time 3D setup. Mixamo animations + a free rigged soldier model gets 80%
  of the way for nothing; a bespoke model is a modest commission.
- *This is how most "2D" games with heavy animation actually do it in 2026.*

**Option B — Hand-authored cutout rig, done properly.**
Keep skeletal animation but have art authored FOR it: each unit delivered as 10-12
separate limb pieces on labelled layers (upper arm, forearm, hand, thigh, shin, foot,
head, jaw, torso, pelvis, weapon), drawn in a neutral T-pose.
- *Why:* smallest change from today; tiny asset size; infinitely re-poseable.
- *Cost:* the art must be authored as layers by a human. Auto-cutting a single
  standing figure — what we did — can never produce clean elbows and knees, which is
  why it looks stiff.

**Option C — Frame sheets from a single consistent source.**
Works only if every frame comes from ONE character (a real animation tool, a puppet,
or a 3D render). Ordinary AI generation per frame is ruled out — proven, twice.

**Recommendation: A, with B as fallback.** Either way the current auto-cut pipeline
is a dead end for final quality and should be retired once real art lands.

---

## 3. THE PLAN

### PHASE 0 — Art bible (do this first, it is cheap and prevents everything above)
A one-page spec every asset must obey, and an automated gate that rejects violations.
- **Camera:** strict side-on orthographic. No isometric anything. Buildings redrawn
  in profile.
- **Palette:** one locked set per biome, sampled from the title key art.
- **Light:** single sun direction per map; every asset shaded to match.
- **Line:** one outline weight at a reference size.
- **Scale ladder:** soldier = 84px at depth 1; hooch = 2.1x soldier; tower = 3.4x, etc.
- **Intake gate (script):** rejects any asset with baked text, a watermark, a
  non-transparent background, or an off-palette histogram. This is what would have
  caught "1ETER / DE".

### PHASE 1 — Characters that feel alive
- Full skeleton: pelvis, spine, head, upper/fore arm x2, thigh/shin/foot x2, weapon.
- **Per-class motion profiles:** stride length, cadence, bob, lean, weapon carry and
  settle time differ per unit. The M60 gunner lumbers; the scout is low and quick;
  the sapper is furtive.
- **Per-soldier variation:** each man gets a small random phase offset, height
  variance, timing jitter, and idle fidget seed, so a squad never marches in lockstep.
- Animation set per unit: idle, alert-idle, walk, run, crouch-run, aim, fire, reload,
  go-prone, prone-crawl, prone-fire, hit-flinch, 3 deaths, throw, vault, cheer.
- Blend tree with proper transitions rather than pose swaps.

### PHASE 2 — A world drawn in one language
- Redraw buildings in profile to match the soldiers (hooch, longhouse, stilt house,
  bunker, tower, well, market).
- Real ground: tiling textures per biome with edge blending, wheel ruts, puddles,
  trampled paths that appear where troops walk.
- 5-layer parallax: far ridges, mid jungle, playfield, near brush, foreground fringe.
- Vegetation that reacts — brush parts when troops move through, bends from rotor wash.

### PHASE 3 — Light and atmosphere (biggest "AAA" lever per hour spent)
- Contact shadows under every unit and prop.
- Dynamic lights: muzzle flashes, tracers, fires, explosions, flares illuminate
  nearby terrain and units.
- Time of day per mission; night ops with flares and tracer streaks.
- Volumetric haze by depth, heat shimmer over fire, dust and smoke that occlude.
- Colour grade per map, subtle vignette, film grain at low opacity.

### PHASE 4 — Combat that hits
- Impact by material: dirt gouts, wood splinters, sparks off metal, water plumes.
- Hit-stop on kills, directional screen shake, camera punch on heavy ordnance.
- Layered audio: distinct weapon reports with distance falloff and tails, ricochets,
  radio chatter, ambient wildlife that goes silent under fire.
- Gore consistent with the documentary tone: restrained, muted, persistent.

### PHASE 5 — Depth (the reason to keep playing)
- Perks/XP trees per faction (already specced in V3_PLAN).
- Campaign with persistent squads: veterans gain names, ranks, small stat bumps, and
  can die permanently.
- Frontline control bar, after-action report, medals.

### PHASE 6 — Platform
- DPI-correct rendering (done), responsive UI (done), touch controls for phone,
  save/resume, settings (volume, quality, colourblind-safe markers).

---

## 4. SEQUENCING

| Order | Work | Why here |
|---|---|---|
| 1 | Phase 0 art bible + intake gate | Stops new mistakes immediately; cheap |
| 2 | Character pipeline decision (A/B) + 2 units end-to-end | Proves the look before bulk art |
| 3 | Phase 3 lighting on the existing world | Fastest visible jump in quality |
| 4 | Phase 2 world redraw | Removes the collage problem |
| 5 | Phase 1 full roster animation | Bulk work, only after 2 units prove out |
| 6 | Phase 4 combat feel | Polish on a solid base |
| 7 | Phase 5 depth, Phase 6 platform | Ship |

---

## 5. WHAT I NEED FROM YOU

1. **Pick the character pipeline** (A: 3D-rendered sprites — recommended; or B:
   hand-layered cutouts). Everything downstream depends on it.
2. If **A**: I can set up the render pipeline and a free rigged model + Mixamo clips
   to prove it on one unit before you spend anything.
3. If **B**: art must arrive as labelled layers (PSD or separate PNGs), not a single
   flat figure — that is the difference between stiff and alive.
4. **Do not generate more per-frame AI animation sheets.** That path is closed.

---

## 6. FIXED TODAY (while writing this)
- Stripped the baked "1ETER / DE" label and stray glyph from the watchtower tile.
- DPI-correct rendering — canvas backing store now matches device pixels, with
  high-quality smoothing. This was the "pixelated" look.
- Removed the half-opacity concealed enemies that read as ghost duplicates; hidden
  troops are now a clean cut, and a fighter who opens fire stays visible for 6s.
