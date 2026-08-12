# VIETNAM '65 — V3 PLAN: THE WARFARE 1944 CORE

> **The running plan is [PLAN.md](PLAN.md).** This document is a reference.

### Squads · Cover · Orders · Grenades · Perks — researched against the original, adapted to Vietnam

## 0. What Warfare 1944 actually did (research summary)

Verified against the Warfarepedia wiki, the JayIsGames review, and Armor Games community
guides:

- **Squads, not soldiers.** Every deployable is a multi-man team: Rifle Squad (~5 men,
  M1 Garands), Assault Team (~4, Thompsons + grenades), Machine Gun Crew (2), Sniper
  Team (2), Bazooka Team (2), Mortar Crew (2), Officer (calls air support), plus tanks.
  A squad is deployed once, fights as a unit, dies man by man.
- **Cover is the whole game.** Pre-placed cover spots (sandbags, craters, walls,
  ruins) line each of the three lanes. **One squad per cover spot.** A soldier in the
  open is drastically more vulnerable. Units automatically HOLD at cover until ordered
  forward — the rhythm of play is leap-frogging squads from cover to cover under
  suppressing fire.
- **Orders.** You select a squad (click or hotkey) and order it: advance to the next
  position, hold, or use an ability (assault grenades, officer strafing run / artillery
  bombardment). One guide: "let your little man finish throwing each grenade before you
  press to throw again" — abilities are manual, per-squad, with animations.
- **Suppression & morale.** MG fire pins squads. Side-level morale: low morale = worse
  accuracy ("if it runs out, your troops surrender"). Casualties, flanking, and
  breakthroughs drain it; kills and reinforcements restore it.
- **Perks between missions.** XP from kills + mission performance buys upgrades in two
  trees — Training/Troops (Ballistics +15% rifle/SMG dmg, Take Cover +10% cover
  defense, Hard Headed, Hit 'em Hard flank damage, Secure Flanks, Grenades unlock,
  High Explosive bigger AoE) and Support (Artillery unlock, Barrage of Fire, Air
  Support strafing run, Post Haste / Resupply Inbound faster reinforcement).
- **Three victory types**: Morale break · Conquer (reach the enemy map edge) ·
  Objective (campaign missions).

What we already have that matches: 3 lanes, side morale, CP economy with caps and
cooldowns, breakthrough-as-conquer, suppression, one support-caller asymmetry. What
we're missing is the **tactical layer**: squads, cover, orders, grenades, and the
meta perk economy.

---

## P1 — SQUAD SYSTEM (foundation refactor; everything else depends on it)

**Design (Vietnam flavor):**

| US / ARVN | men | VC / NVA | men |
|---|---|---|---|
| Rifle Squad (M16) | 4 | Guerrilla Cell | 3 |
| ARVN Squad | 3 | NVA Squad (AK) | 4 |
| Weapons Team (M60) | 2 | RPD Team | 2 |
| Engineer Team | 2 | Sapper | 1 (solo) |
| LRRP Team | 2 | Marksman | 1 (solo) |
| Sniper Team (shooter+spotter) | 2 | RPG Team *(when sheet exists — portrait already sliced)* | 2 |

**Engine:**
- `squad = { side, key, lane, x, order, coverRef, pin, men: [man…] }`; each `man`
  keeps the current unit shape (`x, y, hp, phase, muzzleT, deadT, wounded, sj…`) so
  the renderer, FX, corpse-baking, and gore pipelines port almost unchanged.
- Men fight individually (current burst/miss/close-range code iterates men); target
  selection spreads across enemy *men* (already done).
- **Squad pin bar** (Warfare 1944's key feel): incoming near misses/MG fire build
  `pin 0..1`; pinned squad goes prone, stops, −30% accuracy; decays when fire lifts.
  Replaces today's per-man `suppressT` as the primary suppression mechanic.
- Morale loss per man killed = squadCost/menCount × factor. Sniper duel targets the
  sniper *man* in a team; spotter survivor keeps spotting (recon bonus, no rifle).
- Deaths: squad object survives until last man dies; single-man remnants get a small
  speed/acc penalty ("shaken").
- AI, medevac, flags, spotting, engineer/sapper logic all re-keyed to squads.
- Files: `data.js` (SQUADS table replaces UNITS costs), `game.js` (spawn/update/AI —
  the big one), `render.js` (iterate men; squad selection ring; pin marker),
  `ui.js` (cards = squads).

## P2 — COVER SYSTEM: trenches, sandbags, craters, town rubble

**Design:**
- `covers[lane] = [{ x, w, type, cap:1, prot }]` — types:
  - **sandbags** (prot .5) — firebase lines, LZs
  - **log/berm** (prot .4) — jungle maps
  - **paddy dike** (prot .45) — Mekong
  - **trench** (prot .6, cap 2) — Khe Sanh US line, Hill 937 NVA crest
  - **rubble** (prot .5) — destroyed structures convert to cover (towns become
    fightable positions — the user's "towns where soldiers are covered")
  - **crater** (prot .4) — **created dynamically by artillery/bombs**, so a shelled
    field becomes leap-frog terrain (very Warfare 1944)
- Mechanics: squad in cover → small-arms hit chance ×(1−prot) against them;
  explosives ignore ~70% of prot (grenades/satchels flush cover); one squad per spot;
  concealment (VC brush) unchanged and stacks story-wise: brush hides, cover protects.
- **Auto-hold:** an unordered squad that comes under effective fire while a free cover
  spot is within ~60px snaps into it and holds — recreates W44's default rhythm
  without micromanagement; the player orders when to leave.
- Visuals: procedural sandbag rows/log berms/dug trench with parapet + dirt; cover
  highlight rings during order mode; owner can supply painted cover props later.

## P3 — SQUAD SELECTION & ORDERS (the W44 verbs)

- **Select:** click a squad (or Tab/1-9 cycling). Selection ring under men, portrait +
  order bar appears above the cards.
- **Orders:** `ADVANCE` (move until contact/next cover) · `HOLD` · `MOVE TO` (click
  ground/cover; highlighted spots) · `FALL BACK` (retreat to previous cover, low
  exposure) · ability button per squad type:
  - Rifle/NVA squads: **Throw Grenades** (see P4)
  - M60/RPD team: **Suppressive Fire** — cone on a lane segment, huge pin buildup,
    long cooldown (matches the mockup card text)
  - LRRP: **Mark Target** (lane-wide spot + call-in discount window)
  - Sniper team: **Priority Target** (click enemy squad)
- Hotkeys: Tab cycle · A advance · H hold · G grenade · F fall back · Esc deselect.
- AI issues the same orders (advance in pulses when lane power favors it, grenade
  covered defenders, fall back broken squads) — one shared order API.

## P4 — GRENADES & EXPLOSIVE WEAPONS

- **Frag/stick grenades:** manual squad ability, ~28-40px range bands, arc + fuse +
  blast r≈40; cover prot mostly bypassed (×0.3) — the counter to dug-in squads;
  leaves small crater decal (which is itself cover — emergent!). Throw animation =
  fire pose + lobbed dot; sprite frame wish-listed.
- **M79 grenadier** — US perk upgrade to Rifle Squads (1 man swaps weapon): slow
  direct-fire mini-explosive. **RPG Team** — VC anti-structure/anti-cover squad
  (asset pending). **Satchel** stays sapper's, now devastates trenches/bunkers.

## P5 — PERKS / POINTS SYSTEM (two trees per faction, W44-style)

- **XP:** kills + win bonus + low-casualty bonus per campaign mission → persistent
  (`localStorage`), spent on an upgrade screen between missions ("REQUISITION &
  TRAINING" panel after the result screen).
- **US Training:** Ballistics (+10% rifle dmg) · Fire Discipline (+acc in cover) ·
  Take Cover (+10% cover prot) · Frag Grenades (unlock) · High Explosive (+AoE) ·
  Buddy Aid (wounded refund morale) · Post Haste (−15% squad cooldowns)
- **US Support:** Battery Priority (−20% arty CD) · Danger Close (+radius) · Extended
  Burn (napalm) · Gunship Escort (patrols occasionally strafe) · Dustoff+
- **VC Training:** Ambush Doctrine (+ambush dmg) · Iron Nerves (−pin buildup) · Stick
  Grenades (unlock) · Local Support (+income) · Blood Debt (−morale loss)
- **VC Works:** Deep Works (cheaper traps) · Spider Network (tougher holes) ·
  Sappers' Art (+satchel AoE) · Tunnel Rats (cheaper/faster tunnels)
- Skirmish gets a "veterancy" toggle (perks off / historical presets).

## P6 — FRONTLINE READOUT & POLISH

- HUD frontline bar: per-lane furthest-held position + flag state → overall control %
  (the W44 "pushing the line" legibility). Conquer already exists (breakthrough).
- Pin/suppression markers upgraded (bar over squad, not just text), order pips,
  selected-squad portrait panel with class/ability text (mockup's info card).

---

## Build order & risk

1. **Session A: P1 + P2 — ✅ DONE.** Squads shipped (SQUADS table in data.js, men keep
   the old unit shape in `game.units`, squad layer in `game.squads` owns
   movement/orders/pin). Cover shipped: procedural spots per biome (log/sandbag/dike),
   village walls flanking every settlement, trenches auto-dug under Khe Sanh /
   Hill 937 garrison positions, dynamic shell-crater cover, structure-rubble cover.
   Auto-hold: squads under effective fire break contact and rush (or crawl, if
   pinned) to the nearest free spot; one squad per spot; quiet squads move up after
   ~4.5s (P3 hands that decision to the player). Squad pin bar with hysteresis +
   PINNED marker. Verified: all 5 maps complete headless without errors, cover
   occupied 68-100% of match time. Also shipped: lane-glow deploy highlight,
   squad ghost preview, card ×N badges.
2. **Session B: P3 + P4 — ✅ DONE.** Squad selection (click / Tab-cycle with camera
   snap), order panel (#squad-panel) + hotkeys: ADVANCE [A] · HOLD [H] · FALL BACK
   [B] · move-to (click ground, snaps to cover spots) · GRENADES [G] (3 staggered
   throws, arcing projectiles with fuse, flushes cover, 14s cd, 115px range, uses
   the sliced us_nade/vc_nade throw animations) · SUPPRESSIVE FIRE [S] (MG fires
   without pause for 5s, double pin, 20s cd). Player-held orders don't auto-resume;
   AI squads use the same API (grenades dug-in enemies, suppresses massed lanes).
   Also this session: animation overhaul — fixed-anchor slicing (slice_anim_fixed)
   killed run flicker; 90ms pose crossfades; death-fall rotation; idle breathing;
   velocity-synced stride; projectile bullets with arrival impacts; new run cycles
   (nva_run 50f, m60_run 60f); deploy ghost → chevron marker; lane glow 0.15.
   *Status: SQUADS ability flags + GRENADE constants are in data.js; the orders/
   selection/nade systems are still to build. A fidelity session landed in between:
   soldiers scaled to 56px, 60-frame run cycles (us_run/vc_run, frame-per-RAF-tick),
   painted villages/wells/carts/watchtowers from the texture kit, dike/stone-wall/
   sandbag cover sprites, mountain+treeline+village-silhouette parallax, foreground
   occlusion plants, lane vegetation scatter. Slicer gained solid-bg keying +
   grid slicing (tools/slice_assets.py: slice_grid/slice_new_assets).*
3. **Session C: P5 + P6** — perk trees, XP persistence, upgrade screen, frontline
   HUD, rebalance, deploy (with owner approval).

**Asset wishlist additions** (same generation contract as before — 8-pose rows,
transparent, no labels): grenade-throw pose per faction · RPG Team sheet ·
trench/sandbag/log-berm painted props · M79 grenadier variant · grenade explosion
mini-VFX. Everything else runs on existing sheets.

## V4 POLISH BACKLOG (agreed with owner, July 2026 — graphics/animations/gunfights)

**PHASE 1 STATUS (July 10):** the "new and improved" 12-frame benchmark run cycles are
live (usrun12/vcrun12, checker-keyed, fixed shared anchors, frames-per-stride normalized
so any cycle length plays at the same gait). Movement feel: per-class acceleration
(M60 130px/s², rifles 230, light 330), arrival ease-in, stride length by weight class,
displacement-driven phase (zero skating). Stance state machine with commitment locks
(prone ≥2.4s, stand ≥1.1s, single owner in _updateSquads; point-blank <150px always
standing) — the lay/stand/lay yo-yo is verified dead (3 transitions in 40s of point-blank
combat). Ranges retuned: M16 320 · AK 310 · MGs 360-380 · snipers 640-700.
N/I unit sheets received & queued for Phase 2 wiring: US m60 (file lacks .png ext),
US sniper, US flamethrower, VC mortar/sniper/grenadier/RPG/sapper, US stance set,
VC master block, menu/loading concepts (menus:loading screens/).

**PHASE 2 STATUS (July 10 evening):** disappear/jank fixed (held-frame corruption bug in
the min-hold path; formation spacing 17→24px). Wired from the n/i sets, all with fixed
shared anchors: per-weapon FIRE RECOIL LOOPS (M16/AK/M60/prone-M40: aim→flash→casing→
recover keyed to muzzleT), PRONE TRANSITIONS (6f drop/rise on stance change, both
factions), DEATH SEQUENCES (8f stagger-collapse, corpse bake uses the final frame),
IDLE LOOPS (6f + procedural breathing on top). resolvePose now returns
[pose, frame, anim] with per-anim scale metadata. STILL TO WIRE next session:
'n:i- per class runs us and vc.png' (view layout first), walk cycles (extract PNGs from
'n:i-us & vc walk cycles_files/' — saved as webpage), VC master block, N/I unit sheets
(flamethrower, mortar, RPG, grenadier, snipers, sapper, M60) = new unit types, menu
concepts in 'menus:loading screens/'.

**Animations (flicker fixed via number-erase + march-continuity + 140ms pose min-hold):**
1. Fire animation: 2-3 recoil frames per weapon (asset ask) instead of the single fire pose.
2. Prone-transition frames (drop-down / get-up) + crawl cycle sheet.
3. Reload moments: squad pauses, mag change pose, "RELOADING" pip — rhythm + drama.
4. Muzzle-flash variants per weapon class; shell arcs already exist.
5. Replace pixel-art vc_sniper + flat us_sniper with outlined-style sheets (asset ask).

**Gunfights (squads already take stances: prone front rank / guns rested on cover):**
6. Fire discipline: squads volley on contact then settle into burst rhythm; first-contact
   "CONTACT!" bark + squad turns as one.
7. Casualty reactions: nearby men flinch/duck when a buddy drops; brief return-fire surge.
8. Bounding overwatch order: one fireteam suppresses while the other rushes (uses existing
   pin + rush machinery; the W44 endgame verb).
9. Medic drag: one man pulls a wounded buddy to cover (uses stretcher/casualty art).
10. LMG deployment: M60/RPD bipod-down state — must halt to fire, +acc/+pin when deployed.

**Graphics:**
11. Slice + wire claudeassetexplosions (artillery 6f + napalm 6f) and the decals
    (crater/scorch/blood-pool/casings/track sheet) — replace remaining procedural VFX.
12. Wire the 4-state Huey sheet: flying/firing gunship passes, shot-down crash event
    (rare, dramatic), crashed-wreck as map decor + cover.
13. claudeasset_trenchview + claudeassetRPG_US + claudeassetlastones: trench/firebase kit
    art for the dug positions, RPG team unit (portrait exists).
14. Ground texture strips per biome (asset ask) — the last step to concept-art terrain.
15. HUD reskin: framed morale bars w/ star medallions, mission timer plaque, hover info
    card with stats/ability text (mockup style).

**NEW ADDITIONS (owner, July 10 late):**
16. **Menus/loading screens** rebuilt to match the concepts in
    `assets/assets:vietnam/menus:loading screens/` (menu.png, image.png) — painted
    key-art background, armory-plate framing, mission-file loading cards.
17. **DESIGNATED EMPLACEMENTS** (strategy layer): fixed strongpoints on each map —
    watchtowers, big-hill crests, MG bunkers, mortar pits. Player places the matching
    class there (snipers in towers/hills, MG teams in bunkers, mortars in pits) for
    bonuses (range/LOS/protection). Destructible: napalm/arty/satchels level them
    (structure pipeline already supports states). Adds the take-and-hold strongpoint
    game to every lane.
18. **Identity-complete anim sets** (asset asks): ARVN khaki fire/idle/death/run set,
    NVA pith-helmet fire/idle/death set, boonie sniper set, so every family animates
    without borrowing another character's frames (currently pruned to exact matches).

**Then V3-C:** perk trees + campaign XP + frontline bar (already specced above).

## SESSION HANDOFF (July 31 — pivot to SKELETAL RIG, then Opus 5)

**THE BIG PIVOT.** Frame-based sprite animation is abandoned. Root cause of every
"janky / soldiers morph into different assets / 1980s" complaint: AI-generated sheets
draw each frame independently, so head size, shoulders, shading and weapon drift
frame-to-frame — the character *boils*. No anchoring/smoothing can fix inconsistent
drawings. Warfare 1944 (our benchmark) never used sheets: it used **cutout skeletal
animation** — one jointed puppet, animation = interpolated joint rotation. That is now
our approach, agreed with the owner.

**SHIPPED THIS SESSION:**
- `js/rig.js` — full skeletal engine. 12-bone puppet (hip/torso/head/2×thigh/2×shin/
  2×upperArm/2×foreArm/weapon), Z-order list, far-limb shading. Hand-authored poses:
  idle (breathing), run (leg+arm cycle, bob, lean), aim (bladed stance + recoil),
  prone, death (blends from current pose), hit flinch; `_blend()` interpolates any two;
  stand↔prone uses transT/transDir. `Rig.muzzle()` returns the true weapon-bone barrel
  tip. `Rig.drawCorpse()` bakes the fallen puppet. Vector RIG_PARTS = placeholder art,
  designed to be swapped for painted cutouts at the SAME pivots.
- Wired: `drawSoldier()` routes to Rig first (sprite path kept as fallback),
  `muzzlePoint()` uses the rig, corpse bake uses the rig. `js/rig.js` added to
  index.html before game.js. Verified live in-game (10 units, no errors) + a 7-state
  inspection panel screenshot (idle/run/run+/aim/fire/prone/dead, US + VC).
- Earlier in session: fog-blob ellipses removed (was screen-anchored `_drawWeather`
  fog following the mouse); anim identity-swap pruning; per-class runs; emplacements
  (sniper towerpos +30% range on high ground, MG nestpos +50% pin, class-locked,
  destructible → strongpoint removed + occupants ejected pinned); conceal visibility
  now FADES (u.visA) so VC never blink out between bursts; crossfade no longer dims.

**ASSETS (owner delivered, in `assets/v3_sources/`):** 11 clean side-profile source
figures + 2 new units + ground textures + VFX/Decals. Flat PNGs on a PAINTED
checkerboard (no real alpha) — key with `sat<18 & lum>175`. NOT layered PSDs, so cut
programmatically (psd-tools + scipy now installed if PSDs arrive later).

**NEXT (task #22):** cut each figure into the 7 rig pieces with pivots, export
transparent PNGs, replace RIG_PARTS vector draws with drawImage of the cutouts.
Start with US Rifleman + VC Guerrilla, verify motion, then batch the rest.
Prompt book for any further art: `ASSET_PROMPTS.md`.

**OWNER BAR:** 60fps minimum, running smoothness is the make-or-break; "watching units
move should already feel polished." Do not deploy without explicit approval.

## SESSION LOG — July 31 2026 (rig cutouts landed)

**DONE:** `tools/cut_figures.py` cuts all 13 V3 source figures into 5 rig pieces each
(head / torso / arm+weapon / thigh / shin) with pivots and per-unit weapon geometry →
`assets/rig/` + `assets/rig_manifest.js`. `js/rig.js` rewritten to draw those painted
cut-outs, posed by interpolated joint rotation (idle / run / aim / fire / prone / death /
hit, all blended). 65 pieces verified loading at boot; painted soldiers confirmed
rendering in-game. Far limbs use pre-darkened cached copies. `Rig.muzzle()` returns the
true barrel tip from the weapon's painted angle, so flashes and tracers start at the gun.

**ALSO DONE (Aug 3-4):**
- *Legs fixed.* The arm/weapon detector was judging "weapon" against the CHEST colour
  only, so trousers (a different shade) read as rifle and 83% of each leg was pulled
  into the arm piece. It now samples a cloth palette from chest, thigh, shin and boot,
  and only pixels far from ALL of them count as weapon. Thigh coverage 1.4k → 5.2k px.
- *Title screen* from the concept art: `assets/ui/menu_bg.jpg` (the two unused plates
  clone-patched out), live buttons positioned on the painted plates at 39.70%/21.31%
  with rivets and brass stars. Base `.big-btn{min-width:300px}` must stay overridden.
- *UI reskin*: olive metal panels with corner rivets, brass stencil headings, mission
  rows as plates, riveted HUD cards, morale bars, squad panel.
- *Emplacements per lane*: sniper tower on the lane's best ground, MG nest covering the
  approach, trench pair astride every objective, and VC-only jungle hides seeded through
  the concealment zones (they conceal on their own, so ambush doctrine has real estate).
- *Tactical realism*: squads no longer wander backwards. Rearward cover search cut from
  170px to 28px; a squad's furthest-forward position is remembered and it may not cede
  more than 16px unless the player orders FALL BACK or MOVE. Advancing squads occupy
  strongpoints they pass through, and only cross open ground when a friendly is firing
  or the enemy is out of range (bounding).
- *Soldier scale* 62 → 84px, markers lifted to match. Reload beat: the muzzle drops
  between bursts.
- Verified: all 5 maps play to a result with no errors; cover occupied 92-100% of match.

**VC LEGS (2nd fix, Aug 4).** US legs were fine but VC legs still vanished. Cause was
different: the VC sources are wide (2816px) and the leg BANDS were picking up stray
far-right pixels (AK barrel, watermark sparkle), so the thigh piece came out 678px wide
instead of ~105 and its pivot — the centroid of the hip row — landed hundreds of pixels
off, drawing the leg away from the body. Fix: `body_column()` measures the torso's own
x-range and head/torso/thigh/shin are clipped to it (pad 0.55 for head/torso to keep
packs and antennas, 0.30 for legs); `main_figure_only` also drops blobs sitting far to
one side. All leg pieces are now ~100-170px wide. Verified: guerrilla, NVA, marksman,
RPD, sapper and rifleman all render complete in idle / run / aim.

**RESPONSIVE UI (Aug 4).** The UI was fixed-pixel over a fluid stage, so it looked wrong
on phones and big Macs. Now every UI layer is laid out at the 1280x720 design size and
scaled: `#hud, .screen { width:1280px; height:720px; transform: scale(var(--uiK)) }`
with `--uiK = stage.clientWidth / CANVAS_W`, set in `App._fitUI()` on boot, resize,
orientationchange and via ResizeObserver. Proportions are then identical at any size —
verified at uiK 0.39 (phone) and 1.125, button landing on 39.7%/39.6%/21.3% both times.
Note `.big-btn{min-width:300px}` and `.menu-buttons{margin-top:44px}` must stay
overridden on the title screen or the plates misalign.

**NEXT:** gunfight polish pass 2 (hit reactions, casing arcs, per-weapon flash size) ·
V3-C perks/XP/frontline bar · engineer's thigh piece is still thin (his pack/rifle
overlaps it) if that ever reads badly · a few thin strap/antenna fragments show as
specks on NVA/RPD.

**Known rough edges to watch when verifying in-game:** thigh pieces are thin on units
whose coat hangs past the hip (the hem lands in the thigh band); prone/death poses rotate
far and want a check at real scale.

## Sources
- warfarepedia.fandom.com — Warfare 1944, Units, Upgrades, Assault Team, Officer, Tank pages
- jayisgames.com/review/warfare-1944.php — cover/leap-frog & resource cap analysis
- armorgames.com community — "How To Beat Warfare 1944" tips thread (cover rows, morale, grenade timing)
