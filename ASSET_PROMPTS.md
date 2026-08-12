# VIETNAM '65 — ASSET PROMPT BOOK (Rigged-Cutout Era)

We animate with a **skeletal rig**: one jointed puppet per soldier. So each unit
needs **ONE clean source figure**, which you cut in Photoshop into limb pieces —
NOT animation frames anymore. The engine puppets the pieces (run/aim/prone/death
all in code), so a soldier can never morph or boil between frames.

---

## 0. UNIVERSAL RULES (put these in EVERY prompt)

- **Transparent PNG with REAL alpha** — NOT a painted checkerboard, NOT a flat color
  behind the figure. (Every sheet so far had a fake baked-in checkerboard; that costs
  cleanup and haloes. In Gemini say: *"transparent background, true alpha, no
  backdrop, no checkerboard, subject fully cut out."*)
- **Side view, facing RIGHT**, full profile. Camera dead level (not 3/4, not tilted).
- **Neutral relaxed stand**: standing straight, **arms hanging slightly away from the
  torso**, **feet ~shoulder width apart**, weapon lowered/at-rest and NOT crossing the
  legs — so limbs can be cleanly separated.
- **Style**: flat documentary illustration, thick dark outlines, matte shading, muted
  colors. Match the existing game look (the "new & improved US soldier run" sheet is
  the benchmark).
- **Size**: figure ~1000 px tall on a ~1200 px canvas, centered, sharp.
- **No text, no numbers, no labels, no watermark, no ground shadow, no grid.**
- **Palette** (name the exact hex the unit uses):
  - US olive coat `#4d5a3c`, US pants `#414c34`, M1 helmet `#3d4830`
  - ARVN lighter khaki-olive `#5d6a49`
  - US skin `#c9a37d`, VC skin `#c19a70`
  - VC black pajamas coat `#38362f`, pants `#302e28`
  - NVA khaki-green `#6f6748`, pith helmet `#655e3e`
  - conical straw hat `#c2a36a`, boonie hat `#46523c`
  - boots/metal near-black `#26251d`, rifle wood `#5c3f22`

---

## 1. SOLDIER SOURCE FIGURES (highest priority — the whole roster)

Each is ONE figure, neutral stand, side profile facing right, transparent PNG.
I only need the NEAR arm and NEAR leg — the engine mirror-shades them for the far
side — but a full clean figure is fine; I'll cut what I need.

### US / ARVN
1. **US Rifleman** — American infantryman, olive-drab jungle fatigues (`#4d5a3c`),
   M1 steel helmet with camo band (`#3d4830`), web gear with ammo pouches and
   canteen, black jungle boots, holding an M16 rifle lowered at his side. Skin
   `#c9a37d`. [suffix]
2. **ARVN Soldier** — South-Vietnamese ARVN infantryman, slightly lighter khaki-olive
   uniform (`#5d6a49`), M1 helmet, lighter build, carrying an M16 lowered. [suffix]
3. **M60 Gunner** — heavy US machine-gunner, olive fatigues, M1 helmet, **belt of
   ammunition draped across chest**, bulkier stance, holding an M60 machine gun at
   the hip, barrel forward. [suffix]
4. **Engineer** — US combat engineer, olive fatigues, M1 helmet, **large demolitions
   pack on his back**, wire cutters/satchel on belt, holding an M16 lowered. [suffix]
5. **LRRP Recon** — US long-range recon scout, olive fatigues, **soft boonie hat**
   (`#46523c`) not a helmet, **radio with tall whip antenna** on his back, binoculars
   on chest, lean and low, holding an M16 lowered. [suffix]
6. **Scout Sniper** — US Marine scout-sniper, olive fatigues, boonie hat, minimal gear,
   holding a scoped M40 bolt-action rifle lowered (long barrel, wooden stock, scope on
   top). [suffix]

### VC / NVA
7. **Viet Cong Guerrilla** — Viet Cong fighter, **black pajama shirt and trousers**
   (`#38362f`/`#302e28`), **conical straw hat** (`#c2a36a`), sandals, chest ammo pouch,
   holding an AK-47/SKS lowered (wooden furniture). Skin `#c19a70`. [suffix]
8. **NVA Regular** — North Vietnamese Army regular, **khaki-green uniform** (`#6f6748`),
   **pith helmet** (`#655e3e`), web gear, sandals, holding an AK-47 lowered. [suffix]
9. **RPD Gunner** — NVA machine-gunner, khaki-green uniform, pith helmet, holding an
   RPD light machine gun (round drum magazine, bipod) at the hip. [suffix]
10. **VC Sapper** — Viet Cong sapper, black pajamas, **red cloth headband** (no hat),
    stripped-down, carrying a satchel demolition charge in one hand (a canvas bag of
    explosives), no rifle. [suffix]
11. **VC Marksman** — Viet Cong sniper, black pajamas, conical straw hat, holding a
    scoped Mosin-Nagant bolt rifle lowered (long, wooden, scope on top). [suffix]

### NEW UNITS (add to roster once art lands)
12. **US Flamethrower** — US soldier, olive fatigues, M1 helmet, **two fuel tanks on
    his back**, holding an M2 flamethrower wand forward with fuel hose. [suffix]
13. **NVA/VC Mortar Crewman** — kneeling optional, but give me a NEUTRAL STAND holding
    a mortar baseplate/tube; khaki or black. (Also a separate small **mortar tube on
    a bipod** prop, side view, for the emplacement.) [suffix]
14. **NVA RPG Gunner** — NVA regular, khaki-green, pith helmet, shouldering an **RPG-7
    rocket launcher** (tube with conical warhead) lowered. [suffix]
15. **US Grenadier** *(optional)* — US rifleman variant holding an **M79 grenade
    launcher** (short fat single-shot, break-action). [suffix]

---

## 2. CUTTING GUIDE (same for every humanoid — do this in Photoshop)

Cut each source figure into these pieces, **each on its own transparent layer,
exported as a separate PNG**. Keep the pivot (joint) point consistent — I list where
the rotation happens. Leave a little overlap at each joint so gaps don't open when
limbs rotate.

| Piece | Contains | Pivot (rotation point) |
|-------|----------|------------------------|
| `head` | head + neck + hat | base of neck |
| `torso` | chest + hips + webbing/pack | at the hip (bottom center) |
| `upperArm` | shoulder → elbow (near arm) | shoulder |
| `foreArm` | elbow → hand (near arm) | elbow |
| `thigh` | hip → knee (near leg) | hip |
| `shin` | knee → foot + boot (near leg) | knee |
| `weapon` | the gun/tool alone | the grip/trigger hand |

That's **7 PNGs per unit**. I duplicate the arm and leg for the far side and shade
them automatically — you do NOT need to draw far-side limbs. Name them
`rifleman_head.png`, `rifleman_torso.png`, etc. (folder per unit is fine).

*If cutting all 11 is a lot: send me the 2 you care most about first (US Rifleman +
VC Guerrilla). I wire the pipeline, you see it move, then we batch the rest.*

---

## 3. WEAPONS (only if you want them sharper than in-figure)

Already have a good reference weapons sheet. If you want crisp standalone weapons for
the rig's `weapon` piece, each side-view facing right, transparent PNG, ~400px long:
M16, M14, M60, AK-47, SKS, RPD, M40 scoped, Mosin scoped, RPG-7, M79, satchel charge,
flamethrower wand. Wood `#5c3f22`, metal `#26251d`.

---

## 4. VEHICLES & AIR (HAVE Huey — these are gaps)

- **HAVE**: UH-1 Huey 4-state (fly/fire/hit/crash). Good.
- **M113 APC** — side view facing right, US olive, boxy tracked carrier, .50 cal on
  top, transparent PNG. [suffix]
- **PT-76 / T-54 tank** *(optional, NVA armor)* — side view, khaki-green. [suffix]
- **Sampan boat** *(Mekong)* — small wooden river boat, side view. [suffix]

---

## 5. VFX (mostly HAVE — regenerate only for higher fidelity)

- **HAVE**: explosion bloom, napalm wall, muzzle flashes, ground fire, smoke — the fire
  VFX sheet and the two Gemini explosion sheets cover these.
- Gap if you want it: **tracer/impact spark** small sheet, and a **water-splash** sheet
  for paddy rounds. Additive-blend friendly (bright on black is fine here — VFX is the
  ONE place a black background is OK since we screen/add it).

---

## 6. DECALS — ground marks, baked permanently (mostly HAVE)

- **HAVE**: shell crater, scorch/burn, napalm scar, blood pool, brass casings, track
  marks, corpse silhouettes (the injury/death + ground-decals grids).
- Gap if you want it: **helicopter rotor-wash scuff** and **crashed-fuselage debris**
  (were referenced in a decals sheet — a clean transparent version would slot in).
  Top-down/flattened, muted, transparent PNG. Blood stays muted `#7c2418`.

---

## 7. TERRAIN & WORLD PROPS (HAVE — good coverage)

- **HAVE**: dikes, flooded/dry paddies, irrigation, vegetation (grass/fern/palm/bush/
  bamboo), mountains, treelines, village silhouettes, hooches, stilt houses, longhouses,
  wells, water tower, market stall, cart, fences, gates, watchtower, sandbags. This kit
  is strong — no new terrain needed unless you want a specific biome pass.
- Gap if you want depth: a **tileable ground-texture strip** per biome (red laterite
  earth, jungle-floor leaf litter, rice-paddy mud, Khe Sanh dust) — 1024×256, seamless
  left-right, muted. This is the step toward the painted-ground concept art.

---

## 8. MENU / LOADING / HUD (from your concept art)

- **HAVE (reference)**: the `menus:loading screens/` concepts (menu.png, image.png) and
  the "Armory" ordnance/arms plate mockups.
- Useful to generate as real assets:
  - **Title key-art background** — wide painted Vietnam scene (jungle valley at dusk,
    Hueys inbound), 1280×720, for the main menu. Can be a single flat JPG/PNG (no
    transparency needed).
  - **Loading-screen backdrop** — similar, darker, room for a mission-file card.
  - **HUD frame plate** — the brass-and-canvas "Armory" panel framing (corner brackets,
    riveted metal strip) as a transparent PNG 9-slice, so I can frame the morale bars
    and info cards like your mockup.

---

## PRIORITY ORDER (what unblocks the most)

1. **US Rifleman + VC Guerrilla** cutout sets (7 pieces each) → proves the rig, then
   we batch the rest of the roster.
2. Remaining 9 core units as cutouts.
3. New units (flamethrower, mortar, RPG) as cutouts → new gameplay.
4. Menu/title key-art + HUD frame → the "fun realistic" presentation layer.
5. Ground-texture strips + M113 → depth polish.

Everything else we already have. Send #1 and I'll show you it moving before you cut
another thing.
