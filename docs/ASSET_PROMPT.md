# Asset brief — Vietnam '65: Lanes of War

Paste the section below into Claude Design (or any image tool) to generate new
scenery, props and UI art that sits inside the game's existing look instead of
beside it.

**Why this file exists.** Every asset in the game is rendered through *one*
locked orthographic side camera, and that single constraint is what makes the
scene agree with itself — soldiers, huts, palms, sandbags and vehicles all share
a viewpoint, so nothing reads as pasted on. New art has to honour the same rule
or it will look wrong no matter how good it is in isolation. Numbers below are
read out of the code, not remembered.

---

## THE PROMPT

> Create game art for **Vietnam '65: Lanes of War**, a 2D side-on lane-tactics
> game set in Vietnam 1965–69 with a **documentary tone — neither side is
> glorified, nothing is heroic or cartoonish**.
>
> **Viewpoint — the single most important rule.** Strict **orthographic side
> elevation**. No perspective, no vanishing point, no 3/4 view, no tilt. Imagine
> a camera infinitely far away looking horizontally at the subject. Verticals
> stay vertical, horizontals stay horizontal, near and far edges of the same
> object are the same size. Every existing asset obeys this; a prop drawn in 3/4
> will be visibly wrong next to them.
>
> **Silhouette first.** These are read at 60–200px on a busy background. The
> outline has to carry the object. Keep interior detail sparse and chunky —
> broad shapes, a few strong planes, no fine texture, no small pattern work,
> nothing that dissolves when scaled down.
>
> **Shading.** Flat-to-low-poly. Two or three tonal steps per material, hard
> edges between them, no gradients, no gloss, no specular highlights. Light
> comes from **above and slightly front-left, warm**, with a **cool bounce from
> below-right** and a faint **warm rim along the top edge** — enough to lift the
> object off the background, never enough to look glossy.
>
> **Edges.** A single-pixel dark edge in **rgb(38, 40, 32) at 72% opacity** —
> a soft contact shadow, *not* a black cartoon keyline. Do not thicken it.
>
> **Materials to work in:** weathered timber and bamboo, corrugated iron,
> sandbags, packed earth and red laterite clay, thatch and palm, canvas, rusted
> steel, jungle foliage. Everything is worn, sun-bleached and dirty. Nothing is
> new, painted, chrome or plastic.
>
> **Palette** — stay inside these; they are the game's actual map palettes:
>
> | | sky | far hills | foliage | ground | deep shade |
> |---|---|---|---|---|---|
> | Ia Drang, dry season | `#f6d7a0` → `#e8a35e` | `#8c93a8` | `#5f7a38` | `#a8954f` | `#44502c` |
> | Cu Chi, red laterite | `#d6e4d0` → `#a8c49a` | `#6e8478` | `#3f652c` | `#5a6b34`, soil `#7a4526` | `#243820` |
> | Mekong Delta, sunset | `#f2a65e` → `#e4695a` | `#a05c48` | `#5c7030` | `#6d7a3a`, water `#d78a5e` | `#3a3524` |
> | Khe Sanh, red mud | `#d97a52` → `#eeb47a` | `#6b6a70` | `#5c6b34` | `#8a5a3e` | `#26301f` |
> | Hill 937, monsoon | `#6a7a82` → `#b3c0bf` | `#4a5a52` | `#495830` | `#55603c` | `#232a24` |
>
> **Output:** PNG with a **transparent background**, square canvas, the object
> **standing on the bottom edge of its own footprint** (no drop shadow baked in —
> the engine casts its own). Give me the object alone, no ground plane, no scene,
> no border, no text.
>
> **Scale.** Draw to real-world size. A soldier is **1.8 m tall and 84 px on
> screen**, so **1 metre ≈ 47 px**. Tell me the intended real height in metres
> for each asset so it can be placed correctly.
>
> **Do not:** add perspective, add a horizon or background, add lens blur or
> bloom, add modern kit, stylise toward anime or comic-book, use neon or
> saturated primaries, or draw anything celebratory. This is a war depicted
> plainly.

---

## Asset requests worth making

Ranked by what the game is actually short of:

1. **Foliage variety.** The foreground band and treeline repeat a handful of
   shapes. Wanted: banana palm, bamboo clump, elephant grass stand, dead/burnt
   tree, low scrub, hanging vine. 1.5–6 m.
2. **Village and field structures.** Hooch with open doorway, raised stilt
   granary, animal pen, drying rack, well head, fence run, ox cart. 1–4 m.
3. **Military clutter.** Ammo crates, oil drums, coiled wire, sandbag
   revetment, radio antenna, stretcher, fuel bladder, helipad marker. 0.5–2.5 m.
4. **Paddy furniture.** Dike marker, sluice gate, rice sheaf, wooden footbridge,
   sampan. 0.5–3 m.

## Wiring a finished asset in

1. Drop the PNG in `assets/props/`.
2. Add an entry to `assets/props/props.json` with the same fields the existing
   props use: `name`, `realH` (metres — this is what places it), `hM`, `wM`,
   `groundY` (pixels from the top of the image down to where it meets the
   ground), `ppm`, `res`, `aspect`.
3. `Props.draw()` sizes it from `realH` against `PROP_MAN_M = 1.8`, so a correct
   `realH` is the difference between a hut and a doll's house.

**Sanity check before committing:** render a frame with
`Capture.shot({map:'mekong'})` and look at it next to a soldier. Every art
mistake this project has made was caught by looking at a frame and missed by
every metric.
