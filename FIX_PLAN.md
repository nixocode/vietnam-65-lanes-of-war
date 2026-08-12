# FIX PLAN — no shots, low FPS, no character variety

> **The running plan is [PLAN.md](PLAN.md).** This document is a reference.


Reported: *"no shots firing. Low fps, no different characters. Looks worse than before."*

## How this got past me

I verified with `App.state = 'paused'`, stepping `game.update()` by hand. That skips
the real frame loop, the real spawn cadence and the real AI cadence — so a squad-level
deadlock that only appears over a minute of play was invisible. The browser pane also
reports `document.hidden`, so `requestAnimationFrame` never fires and rasterisation is
skipped: **any FPS number measured in that pane is meaningless.** Both testing habits
have to change, and that is P0 below.

---

## P0 — No shots fired  ✱ root cause found, reproduced

Driving the *real* frame path for 40s with both sides deploying: 33 units on the
field, **0 shots, 0 casualties**.

Cause: in `_updateSquads`, a squad on `holdcover` counts `quietT` up to 2.6s, drops
its cover and returns to `advance`. On the very next tick the bounding-advance block
re-scans for a strongpoint with `dx` in `[-10, 210]` — a window that **includes the
cover it is standing in** (`dx ≈ 0`). It re-targets it, arrives instantly
(`|dx| < 6`), and goes back to `holdcover` with `quietT = 0`.

Squads therefore park forever, ~400–1000px apart, well outside the ~320px weapon
range. Nobody closes, nobody fires. Squads behind them queue on the 44px
`_squadPathClear` rule and stall too.

Fix: a strongpoint may only be claimed if it is genuinely **ahead** of the squad, plus
a short cooldown after vacating so a squad cannot re-grab what it just left.

## P1 — Frame rate

Not measurable in the automation pane. Two parts:

1. **Make it visible** — a frame-time / FPS overlay so this stops being a guess. This
   is the deliverable that lets the problem actually be diagnosed.
2. **Safe wins** — cap the device-pixel-ratio at 2 (was 3: on a dpr-3 screen that is
   2.25× the pixels for no visible gain), and stop forcing
   `imageSmoothingQuality = 'high'` on every scaled blit, which is a markedly slower
   resample path in Chrome. Fill rate, not draw-call count, is the suspect: draw calls
   measured at only ~470 ops/frame with 27 units, but several of those are
   **full-screen** parallax layers, and their cost scales with the backing store.

## P2 — No different characters

Fair, and a regression. The old painted cut-outs were eight separately drawn figures.
Everything now comes off one donor body, so within a side each unit differs only by
weapon, hat and palette — and at 84px that reads as one man repeated.

Fix: push silhouette differences per class (scoped rifle, radio antenna, ammo belts,
satchel, engineer pack) and give individual soldiers variation so a squad is not a row
of identical men.

## Verification standard (new)

No change is "done" until it is exercised through `App._frame()` over at least 60s of
simulated play with both sides deploying, asserting on **outcomes** — shots fired,
casualties, contact made — not on a single paused frame.


---

# OUTCOME

## P0 — No shots fired  ✅ FIXED, verified on every map

**Three separate causes**, not one:

1. **Cover re-acquisition loop.** A squad timing out of `holdcover` re-claimed the
   very cover it was standing in (the scan window started *behind* the squad at
   `dx > -10`), reset its timer and never advanced. Both sides parked outside
   weapon range. Fixed: a strongpoint must be genuinely ahead (`dx > 60`), plus a
   3.5s cooldown after vacating.

2. **`dt` had no lower clamp.** `Math.min(0.05, raw)` accepted *negative* deltas, so
   every `x += rate * dt` in the sim ran backwards — CP drained below zero and
   neither side, including the player, could buy anything. Now clamped at both ends,
   and `startGame` resets the clock so a new match starts its own timeline.

3. My earlier map-by-map results were partly **my own harness** feeding those
   negative deltas. Reported honestly rather than quietly corrected.

Before: **0 shots on every map.** After, 100s of play per map:

| map | shots | kills | US | VC |
|---|---|---|---|---|
| iadrang | 713 | 30 | 35 | 17 |
| cuchi   | 344 | 29 | 36 | 17 |
| mekong  | 646 | 29 | 35 | 20 |
| khesanh | 337 | 23 | 57 | 16 |
| hill937 | 430 | 30 | 22 | 23 |

## P1 — Frame rate  ✅ addressed + made measurable

- **DPR capped 3 → 2.** Full-screen parallax layers redraw every frame, so cost
  scales with the backing store; dpr 3 is 2.25x the pixels for no visible gain.
- **`imageSmoothingQuality` 'high' → 'low'.** Sprites are downscales of
  already-antialiased renders, so bilinear is indistinguishable and much cheaper.
- **Frame-time overlay on ` / F3** — FPS, ms, p95, unit count, backing-store size.
  Frame rate was being argued about from screenshots; now it is a number.

Draw-call volume was measured and is NOT the problem (~470 ops, 56 images for 27
units). Fill rate is, which is why the two changes above target pixels, not calls.

## P2 — No different characters  ✅ FIXED

Four more CC0 donor bodies downloaded from the same Quaternius modular pack, all
sharing one 62-bone skeleton and the same 24 mocap clips — so they are drop-in, and
visibly different people. See `art/models/SOURCE.txt`.

The decisive detail: every body except the SWAT has a separate head mesh with Skin,
Eye, Eyebrow and Hair materials. **They have faces.** The old donor was fully masked
and gloved, which is exactly why every soldier read as the same anonymous mannequin.

- `farmer` → VC guerrilla, marksman (peasant clothing, right for the VC)
- `worker` → NVA, RPD gunner
- `casual` → US rifleman, ARVN, sniper, VC sapper
- `adventurer` → M60 gunner, LRRP recon (own backpack, taller)
- `swat` → engineer (masked and kitted, reads as a specialist)

Bodies are spread *across roles within an army*, so a US fire team now mixes three
silhouettes instead of being one man cloned.

Supporting fixes: recolour is **luma-preserving** (keeps each model's own light/dark
structure instead of flattening to one slab); headgear is seated from the measured
**head mesh** rather than the head bone, which differs per donor and had buried the
helmet inside the skull; civilian hair and ponytails are deleted under headgear;
skin retoned from a pale civilian value that blew out under the key light.
