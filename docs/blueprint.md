# 99 Planets To Defend (v4): game blueprint

Status: design approved in brainstorming on 2026-09-23. The M0a toolchain, checks, CI and Pages site,
the M0b simulation kernel, the M0c Blender asset set, and the M0d renderer v1 and Style Lab exist, and
the owner locked the Painted-Anime-Inkline 4.0 look at the M0 style gate on 2026-09-28, so M0 is
complete. The Asset World, M0's inspection follow-up, lays out every built asset in the locked look;
no game systems yet. This file is both the approved spec and the running design document for the whole
game. Check it before any build:

```bash
node "<aegis-suite>/tools/blueprint.js" check docs/blueprint.md --gate
```

## How to use this document

- This document is the prompt. It is the first thing any agent receives, before any request. The
  agent's first act is to restate the pillars in its own words and name the first end-to-end
  playable (Build order, item 1). A session that opens with a feature request has skipped it.
- Every number lives in Numbers with a rationale. Change the number here in the same commit that
  changes it in code.
- Decided, Task list and Where we are change in the same session that changes the game. A decision
  that is not in the ledger did not happen.
- House rules carried from WorldHeart v3 and still binding:
  - No em dash anywhere: code, comments, player copy, docs, commit messages. Use " - ".
  - Player copy is mechanics first, flavour second, and the flavour is one concrete sentence.
  - No exclamation marks in shipped copy. Uppercase only for short system markers (WAVE 12,
    PATH BLOCKED), never for sentences.
  - Comments explain why, not what. When fixing something subtle, say what the wrong behaviour was.
  - Commit messages describe the defect, the cause and the measurement, not only the change.

## Reference

The reference is **WorldHeart v3**, the owner's own shipped browser game
(https://majieddd.github.io/worldheart/v3/, branch `v3` of github.com/majieddd/worldheart). v4
re-creates it from the ground up: new code, every asset rebuilt in Blender, a new painted-ink look,
and the same mechanics, improved where possible. The v3 documents `docs/GAMEPLAY.md`,
`docs/CREATIVE.md` and `docs/99-PLANETS-TO-DEFEND.md` on that branch are the source for every value
marked "(v3)" below.

Borrowed mechanics, one line each. Each is an H3 under Mechanics.

- From WorldHeart v3: freeform placement on a curved planet under one rule (Tower placement); six
  tower families (Towers); the Xeno species (Xeno enemies); nests that feed waves (Nests and waves);
  crystals carried home (Crystals and deposit); the Worldheart ladder (Territory and the
  Worldheart); five commanders (Commander combat); drafts (Drafts); talents (Meta progression);
  mounts (Mounts); walls and forging (Walls and crafting); disasters (Weather and disasters);
  possession (Allies and possession).
- From Dungeon Defenders and Orcs Must Die: a hero who fights beside the defenses they build
  (Commander combat).
- From Borderlands: weapons generated from manufacturers, parts and rarities (Procedural weapons),
  and the bold black ink silhouette (Painted-ink renderer).
- From Dark Souls: committed attacks with readable wind-up and recovery (Xeno enemies, Commander
  combat), and the run back to recover what you dropped (Commander death and recovery).
- From Sifu: speed-painted surfaces, simplified volumes, cinematic colour, and a blend of cel and
  standard lighting on characters (Painted-ink renderer).
- From Kingdom Rush: a branch choice when a tower reaches its third mark (Towers).
- From Slay the Spire: choosing the next node on a branching route (Campaign route).

What v4 does that none of them do: a commander physically fights and carries resources across a
curved, fully generated planet while their defenses protect a base that grows until it covers the
whole world, and claiming the world wakes that world's own generated boss.

## Pillars

1. **The planet is the board.** Curvature is always visible, enemies crest the horizon before they
   arrive, and ranges and canyons shape every route. Nothing is flat and nothing is a map.
2. **Two decisions, one game.** Where your towers stand and where you stand are separate choices,
   each with a cost. Walking out leaves the base to fight alone; staying home leaves crystals, loot
   and nests untouched.
3. **Seal nothing, shape everything.** Build anywhere on your ground, with exactly one restriction:
   no placement may sever the last path from a nest to the Worldheart. The game is about bending a
   march, never walling it out.
4. **Every blow reads.** A wind-up you can see, a strike frame where the hit lands, a stop of time on
   contact, a spark and a number at the wound, a recovery you can punish. Nothing damages anything by
   touching it.
5. **Painted, inked, and honest light.** Every surface is painted in the asset and inked at its
   silhouette. Glow is information: cyan is yours, magenta is Xeno, warm is the heart and its
   economy. Decoration does not emit.

## Core loop

**Moment to moment (seconds).** Every few seconds there is a useful action: read a tell or a route,
then strike, dodge, build, upgrade, order, collect or reposition. Land the hit, see the reward, move.

**Session (one planet, 25 to 35 minutes).**

1. Landfall (0 to 2 min): the drop pod lands on an open site, the Worldheart deploys, the first tower
   goes down and a 12 m ring of territory appears.
2. Hold and venture (2 to about 27 min): timed waves pour from nests beyond the frontier, and calling
   a wave early pays gold. Between and during waves the commander walks or rides past the frontier
   for crystals, caches, weapons and buildings, and breaks nests.
3. Grow: deposit crystals as base credit, add gold, raise the Worldheart. Each of ten levels widens
   the territory, raises the tower mark cap and strengthens the commander. Level ten claims the
   whole planet.
4. Claim and boss (about 27 to 35 min): claiming the planet silences the last nests and wakes the
   planet's generated boss. Beat it, collect salvage, extract.
5. Choose: pick the next planet on the route map.

The planet is lost when the Worldheart falls. Nothing else ends a planet.

**Long term (campaign).** 99 planets along a branching route. Hostility, planet size, weapon eras
and boss complexity rise with the planet index. Coins earned every wave buy permanent talents:
towers, commanders, mounts and standing bonuses. Extracted weapons persist between planets; loot not
yet extracted is lost on defeat. New systems arrive one per planet over the first six planets, so no
planet teaches more than one new thing.

## Architecture

Approved in brainstorming as design section 1.

- **Stack.** TypeScript (strict), Three.js on WebGL2, Vite. Vitest for logic, Playwright for browser
  checks. GitHub Actions builds, checks and deploys to
  `https://majieddd.github.io/99-planets-to-defend-v4/`. WebGPU stays a later option, not a
  dependency.
- **`src/sim/` is the game.** Planet generation, navigation and flow fields, towers, enemies,
  nests and waves, economy, the heart ladder, the commander's authoritative movement and attacks,
  weapon, boss and loot generation, drafts, meta progression and the campaign. It runs at a fixed
  60 ticks per second from seeded RNG streams, imports nothing from `three` or the DOM, never calls
  `Math.random` or `Date`, keeps state plain and serialisable, models players as a list even when
  solo, and reports what happened as events. A lint rule enforces the boundary, because breaking it
  destroys headless testing (v3 invariant 1).
- **`src/render/`** draws whatever the simulation says: painted-ink materials, ink passes, post,
  terrain meshing, scatter, effects, animation playback and cameras. It interpolates between ticks
  and never writes simulation state.
- **`src/game/`** is the glue: input actions (keyboard and mouse, touch), commands into the
  simulation, simulation events out to render, audio and UI.
- **`src/ui/`** is the DOM HUD and menus in the painted-ink interface style, including touch
  controls. **`src/audio/`** is a procedural WebAudio engine. **`src/labs/`** holds the inspection
  pages.
- **`blender/`** holds one Python recipe per asset family plus shared libraries (paint bake, rig,
  animate, export). `npm run assets` runs Blender 5.2.1 headless and writes compressed GLB files,
  turntable preview sheets and `public/assets/manifest.json`. The outputs are committed, so CI and
  Pages never need Blender.
- **Built at runtime, not in Blender:** planets, and weapons and bosses assembled from Blender-made
  parts.
- **Saves** are a versioned envelope over the serialised simulation state, in IndexedDB with a
  localStorage fallback, with export and import.
- **Co-op later.** Nothing is networked now. The pure simulation keeps a co-op or Roblox port
  possible without a rewrite.

Planned repository layout:

```
src/sim/       pure deterministic game logic
src/render/    three.js renderer, materials, ink, post, terrain, effects, animation, cameras
src/game/      input actions, commands, event routing
src/ui/        HUD, menus, touch controls
src/audio/     procedural audio engine
src/labs/      Asset World, Planet Lab, Weapon Forge, Boss Lab, Style Lab
blender/       recipes/ and lib/ (paint, rig, animate, export)
public/assets/ exported GLB, textures, manifest.json
tools/         asset build and checks, bot runner, capture, perf
tests/         vitest suites
docs/          this blueprint, decision records, evidence
```

## Art direction

Approved in brainstorming as design section 2, with approach A (painted in the asset, lit in the
shader, inked in two passes) chosen over a whole-screen painterly filter and over fully procedural
shader paint.

**The name.** Painted-Anime-Inkline 4.0: the painterly 3D of the Sifu flashback, the clarity of
Genshin Impact's anime shading, and the bold black silhouette ink of Borderlands.

**Material language.** The split is absolute, carried from v3's creative direction.

| Side | Surface | Glow |
|---|---|---|
| Player tech | Machined gunmetal and enamel plates, painted wear on edges | Cyan energy channels cut into the metal |
| Xeno swarm | Dark wet chitin | Magenta light bleeding through seams, as pressure rather than a lamp |
| Planet | Painted terrain in a per-theme palette | Only hazards emit (lava, geysers) |
| Worldheart | Warm crystal | The only warm glow on the planet |

**Per-theme palettes.** Each planet theme owns a named palette and a named light: key light colour
and elevation, a complementary shadow tint, fog colour, and a painted sky. A named palette plus a
named light direction is what buys the anime read; naming a style does not (a measured lesson from
the owner's `worldheart-styles` trials). Palettes are in Content.

**The frame, in order.**

1. Depth and normal prepass for the edge pass.
2. Painted lighting: three hard-edged light bands whose terminator breaks up like a brush stroke,
   shadows tinted with the theme's complementary colour, rim light, small stylized highlights.
   Characters blend cel and standard lighting, as Sifu does on its characters only.
3. Ink: an inverted-hull silhouette on characters, towers and props (width from a vertex channel
   authored in Blender), plus a screen-space pass on depth and normal discontinuities for terrain
   creases and object intersections. Lines wobble slightly like real ink and fade with distance.
4. Atmosphere: height fog, aerial perspective and a painted sky dome, all tinted by the theme.
5. Finish: bloom on emissive energy, a per-theme colour grade and a soft vignette. The film grain is
   off by default at the owner's direction at the M0 style gate, and its dial is kept (Film grain,
   Render defaults). Depth of field only in menus and cutscenes.
6. A second render mode draws story cutscenes as black-and-white ink sketches with one warm accent.

**Ink rules** (measured lessons from `worldheart-styles`, binding): the style lives in the
materials, never as a screen overlay pinned to the glass; ink fades with distance so far terrain
does not become moire; open sunlit ground carries no ink across it; any hatching is computed in
object space and only in deep shadow; ink width scales per object so a 2 m character and a 300 m
planet both read.

**Blender recipes.** Each asset family has a Python recipe:

1. Build the model from primitives, bevels, skin modifiers and subdivision; simplify volumes the way
   Sifu does, so painting carries the detail rather than geometry. A generated source mesh may stand
   in for the primitives, and the recipe then reworks it (Coherence sheet).
2. Bake the painted colour map: ambient occlusion, curvature, a warm-top cool-bottom gradient, and
   brush-stroke noise that follows the form, combined through the asset family's palette.
3. Rig: one shared humanoid skeleton for commanders and wardens, creature skeletons for the Xeno.
4. Animate by script from pose libraries and timing curves. Every strike frame carries a marker that
   must equal the simulation's active frame (asset check).
5. Export GLB with compressed geometry and textures, plus a turntable contact sheet for review.

Enemy crowds bake their animation into vertex animation textures so hundreds stay cheap on a phone.
Commanders, wardens and bosses use skeletons.

**Style check, the M0 gate.** A golden-hour planet patch with one commander (idle, run, attack),
Bolt Sentinel marks I to III, a Husk, the Worldheart, a nest and the Verdant theme's rocks and
plants, shown in the Style Lab with live dials (ink weight, paint strength, band softness, shadow
hue, grade) beside the reference board. The owner's approved dial values become the locked
Painted-Anime-Inkline 4.0 defaults, and no asset family is mass-produced before that approval. The
owner approved the golden-hour look with three adjustments on 2026-09-28, and its values are locked in
`src/render/defaults.ts` (Render defaults).

## Kit: the Blender asset vocabulary

The kit is not bought. It is built by script in Blender 5.2.1 LTS from recipes in
`blender/recipes/`. The asset build finds Blender through the `BLENDER_PATH` environment variable
(on the owner's machine, `C:\Users\Majied LaFleur\tools\blender-5.2.1\blender.exe`). The manifest is
`public/assets/manifest.json`, written by `npm run assets` and counted from the exported files. Once
a milestone's assets are built, the Content entries for that milestone must equal the manifest's
counts, a rule kept by hand; later milestones' entries are plans until then. The current count
is 9 manifest entries: M0c's 8, the `brush_strokes` and `ink_noise` textures and the models `verdant_kit`
(8 pieces), `worldheart` (plinth and 11 stages), `nest`, `bolt_sentinel` (marks I to III), `husk`
and `bulwark`, and M1's `commander_pip`, Pip (commander), the M1 commander preview and since
2026-10-04 the default commander (idle, run and attack, the five face morphs). Since 2026-10-04 he is
built by recipe like every other model: `blender/recipes/commander_pip.py` runs the CharForge rework
template `blender/lib/charforge.py` on a generated source, `blender/sources/charforge/pip.glb`, the
owner's CharForge Pip as published on 2026-10-03 (Generated sources, Decided), so `npm run assets`
rebuilds him from committed files like the rest. Its retargeted idle and run pass through a ground pass
(`ground_clips`): one hips offset per clip puts the lowest boot point on the ground, and the idle's sword
hand takes one constant turn that holds the blade's tip `BLADE_CLEARANCE_M` over it; each clip's lowest
point is recorded in the sidecar (`clip_ground`) and a unit test holds every one within the contract. A recipe may read such a source from
`blender/sources/`; no recipe imports another, so the plate vocabulary the Bulwark and Pip's armour share
(the sculpted primitives, plate colours, painted caps and paint style) lives in `blender/lib/armour.py`.
Every placeable asset has its root at its ground contact point, so the bind-pose
minimum Y of each tower mark, each Verdant piece and every other model as a whole is within 5 mm of
0, unless its recipe names a designed sink of at most 0.14 m (rocks bury their base edge), which
the measured depth must match within 5 mm.
`npm run assets:check` holds each model in the manifest to its family budget (Performance budgets),
the shared strike timings and this ground contract, using the numbers the build recorded; it never
compares the manifest with the Content tables. Every design noun in Mechanics through Content must
be in this catalogue before the milestone that uses it starts.

**Face morphs and skin.** A model may carry morph targets, Blender shape keys exported by
`export_glb(..., morphs=True)` (blender/lib/export.py) with morph normals and tangents off, on the terms
the ground contract keeps: no target may move any vertex within 5 mm of its placeable's lowest point,
the ground contact, nor carry any other vertex down to within 5 mm of it, at any weight from 0 to 1, and
the file's default weights must lie in that range (Morph targets against the ground contact,
Performance budgets). The build measures this through the skin in the bind pose and fails before it
publishes, naming the target. A commander's face morphs (`blink_L`, `blink_R`, `smile`, `brows_up`,
`pucker`) pass; a morph that moves a foot is refused. `inspect.mjs` reads each model's morph names, the
manifest records them after the model's clips (`morphs`, written only for a model that has some, so every
other entry keeps its bytes), and `npm run assets:check` holds them to the family's list (Performance
budgets). Every export applies its modifiers, and one that changes the
topology (triangulate, bevel, subdivision) drops the mesh's shape keys, so a morph export fails unless
every shape key reached the file: a recipe applies such modifiers before it adds the shape keys. A mesh
may also carry `_SKIN`, a per-vertex float that is 1 on face, ears and neck skin, 0 elsewhere and soft
at the borders, where a missing attribute means 0. The painted material lights skin softly (Soft skin
light, Render constants), and the loader moves a mesh that carries `_SKIN` to the noEdge layer, out of
the screen-space edge pass, so a face shows no crease ink at the nose, lips and eyes while its hull
keeps the silhouette (on the GPU in the locked look, a box nose on a sphere head drew 511 pixels of edge
ink inside the face on the world layer, at its outline and its crease, and none on noEdge). The choice
is per mesh: garments and hair on the skinned body lose their crease
ink too, while armour exported as a mesh of its own keeps it. `_INK` may be 0 on hair that overlaps the
face, so the hull does not outline the hair across it.

| Class | Planned count | Recipe | First milestone |
|---|---|---|---|
| Commanders | 5 archetypes on one shared skeleton (Bulwark, Twinfang, Longsight, Kettle, Emberline), rebuilt from M1 in the CharForge style with a cartoon face; Pip (commander) (`commander_pip`) is the M1 preview of that rebuild and the default commander since 2026-10-04, with Bulwark the alternate | `bulwark.py` (M0); `commander_pip.py` on `lib/charforge.py` from his CharForge source (M1); one recipe per commander after | M0 (Bulwark, now the alternate), M1 (Pip, the default commander), M4 (all five) |
| Allies | 1 (Warden) | `allies.py` | M4 |
| Xeno species | 4 (Mite, Husk, Aegis, Wisp) plus 4 evolution overlays (armour, speed, shield, split) | `husk.py` (M0); one recipe per species after | M0 (Husk), M2 (all four) |
| Towers | 6 families x 3 marks = 18 models, plus 12 specialization variants | `bolt_sentinel.py` (M0); one recipe per family after | M0 (Bolt Sentinel I to III), M2 (all) |
| Worldheart | 1 model with 11 growth stages | `heart.py` | M0 |
| Nests | 1 base model plus a dressing per theme | `nest.py` | M0 |
| Weapon parts | 6 families x 5 slots x 4 manufacturers x 3 eras, about 360 parts | `weapons.py` | M5 |
| Boss parts | 5 archetypes, each with body, limb, head, armour and weak-point sets | `bosses.py` | M6 |
| Mounts | 3 (Ridge Strider, Tideback, Sky Ray) | `mounts.py` | M8 |
| Structures and chests | 4 structure families, 5 chest rarities, 1 wall segment | `structures.py` | M5 (structures, chests), M8 (walls) |
| Pickups and projectiles | crystal, scrap, coin, cargo cache, about 12 projectiles | `pickups.py` | M2 |
| Props | drop pod, heart plinth, beacon, about 6 | `props.py` | M2 |
| Environment kits | per theme: 6 to 10 rocks, 6 to 10 flora, 3 to 5 landmarks, grass cards | `verdant.py` (M0); one recipe per theme after | M0 (Verdant), M2 (6 themes), M8 (12 or more) |
| Brush atlas | brush-stroke detail textures for terrain and paint bakes | `brushes.py` | M0 |
| UI icons | rendered from the models in the painted style: towers, weapons, powers | `icons.py` | M9 |

Pip (commander) is the name the labs, their consoles and `npm run assets:check` give the `commander_pip`
model, and code, asset records and this document call him Pip. "Pip-A", the name of the M1 study's
hand-run exports, is retired with them: since 2026-10-04 the model ships from its recipe.

Kits that are not Blender assets: the painted-ink material and ink passes (`src/render/`), sky and
terrain painting (runtime shaders fed by the brush atlas), and audio (procedural, `src/audio/`).

## Concept and coherence

**Reference board.** Three sources, used for their qualities, never copied:

1. The owner's Sifu clip (youtube.com/watch?v=B-KxB2ip3JY, 80 s), studied frame by frame on
   2026-09-23. From 0:00 to 1:05 it is painterly 3D: simple forms carrying hand-painted,
   brush-stroked albedo on skin, hair strands, cloth folds and wood grain; a hard-edged terminator
   with painted gradients inside each zone; warm amber key light against teal and green coloured
   shadows; saturated accents; rain, neon bloom and bokeh; caricatured faces; thin painted lines only
   on features. From 1:10 to 1:20 it is a raw black-and-white ink-sketch flashback: the ink half of
   the brief, and the model for v4's cutscene mode.
2. v3's four painted prologue panels (Painted-Anime-Inkline 1.3.2, v3 branch), which set the owner's
   earlier calibration: line 1.81, texture 1.5, saturation 1.3, shadow depth 0.35, exposure 0.77.
3. Borderlands' ink silhouette, described in words only: bold, near-black, uniform contour lines on
   outer silhouettes and major creases.

Sifu's technique, from its own team: the art director describes speed-painted textures and
simplified volumes plus cinematic lighting and grading; its lighting artist describes a smooth mix of
cel shading and standard lighting applied to characters only, with art-tunable parameters.

**Frozen nouns.** These words describe the look in every brief, review and commit: painted
brush-stroke albedo, brush-edged shadow, coloured shadow, ink silhouette, gunmetal and enamel, cyan
energy channel, wet chitin, magenta seam light, warm heart crystal, painted sky.

**Coherence sheet.** No image generator makes the concept: the kit is the renderer plus the Blender
assets, so the in-engine render is the concept. Generated sources are allowed only as inputs to a
Blender recipe: a shape from the owner's CharForge may be source material that a Blender 5.2.1
recipe re-proportions, decimates, repaints, animates and exports, so every shipped file is still
built by script in Blender (owner, 2026-09-27). The Style Lab (M0) shows the style scene beside the
reference board, with the `art-catalogue` colour audit (does each theme hold the palette it names)
and its mutation proof (the audit must reject a hue-rotated render of the same scene).
Status: partial, since 2026-09-28. For the Verdant theme, the only one M0 builds, the criteria are met:
the Style Lab shows the style scene beside the reference board, the colour audit passes at the locked
defaults (1.926, 1.942 and 1.946 times chance on the high, medium and low tiers at the hero camera, and
1.974 to 1.982 at the other three cameras on high, against a gate of 1.5), and the mutation proof
rejects the hue-rotated render of every one of those frames. The owner approved the look with three
adjustments, and these frames are the render at the locked set. Each of the five other themes needs
the same in M2 before its assets are made.

## Mechanics

Every mechanic below has six fields. Values marked "(v3)" come from WorldHeart v3's documents.
Values without a mark are new in v4 and are listed again in Numbers with their rationale.

### Painted-ink renderer

**Purpose:** makes every frame read as a painted, inked illustration while staying readable at every
zoom and fast on every supported device.
**Experience:** up close the world looks hand-painted; at strategic zoom it stays clean; silhouettes
pop against terrain; energy glows where it means something; nothing swims when the camera moves.
**Inputs:** the scene, the planet theme's palette (key light colour and elevation, shadow tint, fog,
grade), the quality tier, the locked render dials, the camera mode (strategic, third person, first
person, cutscene).
**Outputs:** the final frame: painted lighting, hull ink, screen-space edge ink, fog and sky, bloom,
grade, vignette, and film grain where its dial is above 0 (off by default); in cutscene mode, the
ink-sketch frame.
**Edge cases:** distant terrain ink turning to noise (distance fade and a minimum screen-space line
spacing); sunlit open ground (a lit-flatness mask suppresses ink); thin geometry (hull width clamped
in screen pixels); the first-person weapon (its own pass that clears depth only, never colour, v3
invariant 5); transparent surfaces such as water, range veils and telegraphs (excluded from the edge
pass, drawn after it); very small or very large objects (per-material ink and brush scale).
**Failure:** on a failed capability check or a slow device the renderer steps down one tier at a time
(edge pass off, then shadow resolution, then post), never to a black frame; a lost WebGL context
restores its resources and continues.

### Commander movement

**Purpose:** puts the player physically on the planet, so they can walk past the frontier, carry
crystals, reach fights and escape them.
**Experience:** fast, fluid and weighty: acceleration into a run, a sprint that widens the lens, jumps
that always fire when pressed, turns that ease rather than snap, the horizon curving ahead.
**Inputs:** move vector (WASD or the touch thumb pad), sprint, jump, dodge, look (mouse or right-side
touch drag), the terrain height field, solid props and tower footprints, water depth, cargo load,
mount state.
**Outputs:** position on the sphere with gravity toward the centre, velocity, facing, movement state
(grounded, airborne, swimming, dodging, mounted), footstep and landing events, animation state.
**Edge cases:** poles and the longitude seam (the tangent frame is transported, never Euler angles; a
unit's frame stays orthonormal, v3 invariant 2); a tower placed on the commander (pushed to the
nearest free point); step-ups under 0.45 m are automatic and mantles reach 1.6 m; slopes over 50
degrees slide; a jump pressed just before landing or just after leaving a ledge still fires (buffer
and coyote time); water entry and exit use hysteresis (enter at 0.65 m depth, leave at 0.45 m, v3);
knockback sweeps in steps of at most 0.12 m and stops at illegal edges (v3).
**Failure:** a position inside terrain or a non-finite value snaps back to the last valid grounded
pose; a commander that falls through the world returns to the heart with a notice. Never a soft lock.

### Cameras

**Purpose:** keeps orientation and targeting reliable while the player changes scale and control
mode.
**Experience:** three views joined by smooth 0.35 s blends: Strategic (an orbit over the base, where
dragging pans with the ground locked under the cursor, v3), Third person (a spring arm with
collision) and First person (with a painted viewmodel). The planet feels vast underfoot and round
from above.
**Inputs:** Tab (or the view button on touch) switches between the Strategic view and the commander;
in commander views the mouse wheel moves between first and third person, and in the Strategic view it
zooms; look, pan and zoom input; commander state; frontier state; the reduced-motion setting; terrain
collision.
**Outputs:** the presentation camera pose and lens every frame (never simulation state), the reticle
and aim ray, view-change events for the HUD.
**Edge cases:** the Strategic view is refused while the commander stands outside the frontier (v3
rule, which keeps venturing risky); a camera inside a cliff shortens its arm; a view switch during a
dodge; poles (heading carried with the focus, v3); near-plane precision (near tied to altitude, v3
invariant 6); pointer lock refused (right-drag looks, v3).
**Failure:** if no collision-free pose exists, the camera drops to the head position for that frame;
input ownership is always restored after a menu closes.

### Commander combat

**Purpose:** makes the commander a real force: clearing raids, breaking nests, answering leaks at the
heart and fighting the boss.
**Experience:** Dark Souls weight at Sifu speed: a chain of three light strikes, a charged heavy, the
weapon skill (V) and the commander skill (Z), a dodge-roll whose invulnerable frames reward reading
tells, soft lock-on, hit-stop, camera kick, sparks and numbers. Five archetypes feel different in the
hands: Bulwark's heavy cleave, Twinfang's fast pair, Longsight's hitscan rifle, Kettle's arcing
lobber and Emberline's channelled beam (v3).
**Inputs:** attack, heavy (hold attack), aim (ranged families), skills, lock-on, equipped weapon
stats, archetype, targets in range.
**Outputs:** attack instances with a shape (arc, cone, sphere, ray or projectile) and phase timings
(wind-up, active, recovery); damage packets with element and critical flag; status effects; hit and
miss events for effects, audio and UI.
**Edge cases:** a target that leaves the shape before the active frame is missed; one swing hits each
enemy at most once; a dodge cancels recovery only after the active frame; being staggered cancels a
wind-up and removes its telegraph; first and third person share one resolver, so a hit is the same
hit in both views; weapon swaps settle after recovery and launched projectiles keep their release
stats (v3).
**Failure:** an attack whose owner dies, is stunned or is left by possession is cancelled together
with its telegraph. There is never invisible damage.

### Commander death and recovery

**Purpose:** makes venturing dangerous without ending a 30-minute planet on one mistake.
**Experience:** a Souls-style recovery. You fall; your carried crystals and unextracted pickups drop
as a glowing cargo cache where you died; you watch the base from the Strategic view while the respawn
counts down; you walk back and reclaim the cache. Caches never expire: die again before reaching one
and both wait for you.
**Inputs:** commander health reaching zero, the death position, cargo, frontier state.
**Outputs:** a cargo cache entity with a HUD marker; a respawn timer (12 s inside the frontier, 30 s
outside); respawn at the heart at full health. Earlier caches stay where they are.
**Edge cases:** death in deep water, lava or a pit puts the cache at the last safe ground position;
death during the boss fight still respawns while the boss keeps going; a cache swallowed by expanded
territory stays claimable; death while mounted sends the mount home; the heart falling while the
commander is dead loses the planet.
**Failure:** a cache whose position becomes invalid (after a quake) moves to the nearest walkable
node.

### Territory and the Worldheart

**Purpose:** the base's single upgradable spine: how much of the planet you hold, how strong your
towers may become, and the trigger for the boss.
**Experience:** a painted ring on the ground grows with each level, fog lifts over newly claimed
land, swallowed nests collapse, the heart crystal grows through eleven visible stages, and at level
ten the whole world is yours and the sky turns.
**Inputs:** a purchase (B or the heart panel) paid with base credit first and gold for the rest; the
current level; the planet radius.
**Outputs:** the frontier's angular radius; the tower mark cap (2 + level, v3); commander bonuses per
level (+15% health, +12% power, +2.5% speed, +4.5% reach, v3); the heart's integrity maximum; nests
inside the new frontier silenced with their bounty paid; at level ten, the claim event that starts
the boss awakening.
**Edge cases:** buying during a wave is allowed and enemies already inside keep fighting; a swallowed
nest's queued enemies are cancelled while its living ones remain; the navigation graph is built once
at final size and masked, never rebuilt (v3 invariant 3); buying while the commander is dead is
allowed.
**Failure:** a purchase that cannot validate is refused with its reason, and nothing is spent.

### Tower placement

**Purpose:** turns the planet into the board: freeform building that bends the march without walling
it out.
**Experience:** a ghost follows the cursor (Strategic view) or the crosshair (commander views), green
when legal and red with a plain reason when not; a range veil shows true 3D reach including height;
the tower settles onto the ground's normal.
**Inputs:** the tower card, position, footprint, the navigation graph with current blocks, the
frontier mask, gold, and in commander views the commander's position (build reach 14 m, v3).
**Outputs:** the tower entity; gold and the card spent; the footprint blocked in the navigation
graph; the flow field updated; a placement event.
**Edge cases:** the one rule, which refuses any footprint that severs the last path from any live
nest or certified nest site to the heart (reachability sweep with the candidate blocked, v3); covering
the heart or a nest node; a living enemy on the footprint (refused as occupied) while a dying one
does not block (v3); ground steeper than a 0.62 grade (v3); water; raised ground adds reach; terrain
affinity gives bonuses only (hot stone +15% Mortar damage, cold stone +10% Cryo slow; v3's
restrictions become bonuses).
**Failure:** if the flow field update fails the placement rolls back and refunds. The ghost never
lies: preview and commit call the same validator.

### Towers

**Purpose:** the player's patient, stationary power: six machines with six different verbs.
**Experience:** each tower does one thing clearly, looks like what it does from any distance, and
visibly changes at each authored mark; at mark III the player picks one of two specializations that
changes how it plays.
**Inputs:** type, mark, specialization, modifiers from powers and talents, height bonus, terrain
affinity, the heart's mark cap.
**Outputs:** attacks through the shared damage pipeline, status effects, garrison units (Warden
Barracks), upgrade and sell events.
**Edge cases:** marks past III follow the endless ladder, capped by the heart level (cost x1.5 per
mark, power exponent 1.5, uneven per-stat scaling, v3); an upgrade blocked by the cap shows why;
selling refunds 70%, or 90% with the Salvage power (v3); a specialization is permanent until the
tower is sold; the Mortar keeps a minimum range; Mortar and Warden Barracks cannot hit air (v3).
**Failure:** a tower whose target dies mid-shot releases its projectile harmlessly or retargets; a
tower disabled by a radiation storm shows its ring and resumes when the timer ends (v3).

### Tower targeting

**Purpose:** decides who each tower shoots, predictably.
**Experience:** towers turn to real targets, defend the heart first by default, and let experts set a
priority per tower.
**Inputs:** enemies inside 3D acquisition range, each enemy's flow distance to the heart, the
tower's priority (First, Strongest, Air, Closest), its current target.
**Outputs:** the chosen target and the turret heading.
**Edge cases:** a current target is kept inside 1.1 times squared range (v3); heads turn at 9 rad/s,
the Mortar at 5, and fire only within 0.15 rad of aim (v3); a dying body is untargetable during its
0.42 s collapse (v3); flyers dive to 0.7 m near allies and climb back (v3).
**Failure:** with no valid target the turret eases to its rest pose. It never fires at nothing.

### Xeno enemies

**Purpose:** the pressure: a conversation of species in which each answers the player's last answer.
**Experience:** they crest the horizon, march the routes the player shaped, and every blow is
telegraphed by a red volume and a wind-up that can be read and dodged. Mites are fast and cheap,
Husks soak, Aegis are armoured, Wisps fly over the maze (v3).
**Inputs:** species template, wave scaling, evolution tier, the flow field, nearby targets
(commander, allies, walls), the heart.
**Outputs:** movement; attacks with wind-up, strike frame and recovery; damage to units, walls and the
heart; death, bounty and drop events.
**Edge cases:** chase rules (an enemy may break off toward the commander within 7 m, the heart wins
within 10 m, the chase ends at 11 m or after 9 s, then that enemy ignores the commander for 6 s;
bosses never chase, v3); flyers use their own graph and ceiling; a blow lands only if the victim is
still inside reach plus a small grace at the strike frame (v3); pooled enemies reset every field on
reuse (v3 invariant 4); enemies that reach the heart strike it with telegraphed blows instead of
subtracting lives.
**Failure:** an enemy with no route (impossible under the one rule) walks straight for the heart at
8% speed (v3 emergency travel) and is flagged in the developer log.

### Enemy evolution

**Purpose:** turns the planet's clock into escalating pressure, so expanding slowly costs.
**Experience:** at set waves the whole swarm gains a trait, announced on the HUD.
**Inputs:** the wave number.
**Outputs:** traits applied to newly spawned enemies: armour at wave 4, speed at wave 8, a shield at
wave 12 (soaks three hits and recharges after 3 s untouched, v3), and splitting at wave 16 (mites
split on death at 40% health, v3).
**Edge cases:** enemies already alive keep their tier; split children cannot split again (v3); the
shield breaks only under sustained fire; Deep Freeze holds for 4 s, then that enemy cannot be frozen
for 2.5 s (v3).
**Failure:** an unknown tier id is ignored with a developer warning.

### Nests and waves

**Purpose:** the source of the swarm, placed in the world so the player can go out and break it.
**Experience:** a new nest bursts from the ground beyond the frontier each wave after a three-second
warning; the wave timer counts down; calling early pays gold; breaking a nest cancels what it still
owed and pays a bounty; expanding over a nest silences it.
**Inputs:** the wave number, the nest site catalogue certified at generation, the frontier, the
timer, the call-early input.
**Outputs:** nest entities, spawn queues, wave start and clear events, rewards.
**Edge cases:** nest sites need a 2.4 m dry clearing, 6 m from other nests and 10 m from the heart
(v3); new nests seek an outward target of 12 m plus 7 m per completed wave beyond the frontier (v3);
surviving nests add a pack to later waves (v3); a wave clears when its own enemies are gone, and nest
raiders never hold it open (v3); when no safe site exists the wave is delayed with a visible warning
and selling reopens the search (v3); strategic pause and drafts freeze the clock.
**Failure:** if generation cannot certify enough nest sites, the planet seed advances by 7919 before
play starts (v3).

### Economy

**Purpose:** four currencies with four separate jobs, so every pickup has an obvious use.
**Experience:** gold for the board, crystals for the heart, scrap for crafting, coins for the
campaign.
**Inputs:** kills, wave clears, early calls, nest bounties, caches, crystal deposits, salvage.
**Outputs:** balances and spend events.
**Edge cases:** base credit from crystals only buys heart levels (v3); cost modifiers cannot push a
price below 25% (v3); every receipt is idempotent, so a reload cannot pay twice (v3).
**Failure:** a purchase without the funds is refused and the missing amount is shown.

### Crystals and deposit

**Purpose:** the reason to leave the base.
**Experience:** warm crystals glint in the wild, are picked up by walking over them, slow you a little
when you carry a full load, and deposit themselves with a chime when you walk into the heart's aura.
**Inputs:** crystal sites (two per expansion, 24 at most, 9 m apart, outside the frontier, v3), the
commander's position, cargo capacity (3, or 4 with a talent).
**Outputs:** the cargo count, base credit (+100 per crystal, v3), deposit events.
**Edge cases:** with a full cargo the crystal stays where it is and the HUD says so; death drops the
cargo into the cargo cache; deposit is automatic within 4.5 m of the heart, with no key press (v3
used a key); crystals on land that is claimed later stay collectable.
**Failure:** a crystal generated inside terrain moves to the nearest walkable node.

### Frontier and exploration

**Purpose:** the risk and reward space outside the base.
**Experience:** step over the ring and painted fog closes behind you, the Strategic view goes dark,
the music thins; points of interest pull you on: crystal glints, cache beacons, building silhouettes,
nest pulses; a compass always shows home.
**Inputs:** the frontier mask, the commander's position, points of interest, distance from the
frontier.
**Outputs:** fog density, compass markers, the Strategic view lock. The danger outside is the
swarm's own: raiders walking from live nests toward the heart, and the planet's hazards.
**Edge cases:** the frontier can expand while the commander is outside, putting them suddenly inside;
mounts extend the practical range; telegraphs always draw above the fog.
**Failure:** if the compass cannot resolve a route home, it points in a straight line.

### Procedural planets

**Purpose:** every planet is new, and every planet is fair.
**Experience:** from orbit a whole painted world with its own palette and landforms; up close, ranges
and canyons that shape the routes the swarm must take.
**Inputs:** the seed, planet index, theme, terrain pack, size class and hostility.
**Outputs:** an analytic height field (continents, ranges with passes, canyons with ramps, plateaus,
water); biome paint; the navigation graph; a certified heart site; nest and crystal sites; scatter
instances; structures and landmarks; sky and palette.
**Edge cases:** the same seed produces the same planet (hash test); the heart site must be open
ground; every nest site must be reachable; range crests are impassable except at passes (v3); the
height field used for walking excludes fine visual noise so walkability never fractures (v3); water
crossings cost more; generation runs in workers within the time budget in Numbers.
**Failure:** an invalid field advances the seed by 7919 and retries (v3), up to 12 tries, then falls
back to a known-good seed and logs it.

### Pathing

**Purpose:** turns towers and walls into shaped routes.
**Experience:** the swarm visibly bends around what you build.
**Inputs:** the navigation graph (a geodesic grid over the sphere), blocked nodes from tower
footprints, wall costs, the heart node.
**Outputs:** a ground flow field (single-source Dijkstra from the heart, v3), a separate flyer graph
with a ceiling, and route previews for placement.
**Edge cases:** incremental updates on build and sell; walls add a finite cost, so enemies detour or
batter through a sealed lane (v3); swimming costs; a bounded uphill penalty (v3); quakes update
routes in bounded batches (v3).
**Failure:** an update that exceeds its tick budget completes over later ticks while enemies keep the
previous field.

### Procedural weapons

**Purpose:** loot worth walking out for; every drop a small surprise.
**Experience:** a light beam in the rarity's material, a card with the three stats that matter and an
arrow against what you hold; each manufacturer feels different in the hand, and every part visibly
changes behaviour.
**Inputs:** family (Sword, Spear, Twinblade, Carbine, Lobber, Scepter), manufacturer, parts,
rarity, element, era by planet tier, item level (planet index), seed.
**Outputs:** a weapon definition (stats, behaviour flags, parts, name), a model assembled from Blender
parts, and its card.
**Edge cases:** a compatibility table excludes impossible part pairs; stat ranges are clamped per
family; a Relic's unique effect cannot roll twice on one planet; the same seed gives the same weapon.
**Failure:** an invalid combination deterministically rerolls the offending part.

### Inventory and equipment

**Purpose:** holding, comparing and swapping weapons without breaking the flow.
**Experience:** walk over a drop to collect it; press I to pause and compare; swap between the two
equipped slots with X.
**Inputs:** pickups within 2.8 m (v3), the backpack (12 slots, v3), the equipped slots (2, v3).
**Outputs:** inventory state, equip events, salvage (1 scrap each, v3).
**Edge cases:** a full backpack leaves the drop on the ground; a swap during an attack applies after
recovery (v3); extracted weapons persist between planets.
**Failure:** a corrupt saved weapon becomes a basic weapon of its family, with a notice.

### Structures and chests

**Purpose:** landmarks with rewards, so exploring pays.
**Experience:** ruined outposts, crashed landers, ancient shrines and dead Xeno hives stand in the
wild with open entrances; inside, chests in rarity materials.
**Inputs:** structure sites from generation, chest rolls, interaction (E or a tap).
**Outputs:** loot (scrap, weapons, crystals, gold) and one-time claims.
**Edge cases:** structures never block nest routes; interiors have collision the commander can walk
into; claims persist in the planet save (v3).
**Failure:** a chest that cannot spawn its loot pays scrap instead.

### Planet boss

**Purpose:** the planet's final exam, generated from the planet itself.
**Experience:** claiming the world turns the sky; ten seconds later the boss rises from the planet's
most dramatic landform and marches on the heart. It telegraphs everything, carries glowing weak
points the commander can break, and changes phase as they break.
**Inputs:** the planet's theme and element, planet index, seed, and an estimate of player power
(towers, marks, weapon level).
**Outputs:** a boss definition (archetype, parts, element, attack modules, phase thresholds, health),
the boss entity, phase and defeat events.
**Edge cases:** the archetype comes from the theme affinity table in Content; planets 1 to 20 have two
phases and later planets three; attacks reuse the shared telegraph and damage pipeline; towers across
the planet engage it in range; it never chases the commander (v3) but punishes anyone in reach; the
commander can still respawn during the fight.
**Failure:** a boss that gets stuck relocates along its route with a burrow or flight animation.

### Drafts

**Purpose:** run-to-run variety inside a planet through light decisions.
**Experience:** every cleared wave pays a reward: odd waves offer a choice of two tower cards, even
waves a choice of three powers. The draft pauses the game until you pick.
**Inputs:** the wave number, unlocked towers, the power pool (weights 100 common, 45 uncommon, 14
rare, v3), the hand (3 cards, or 4 with a talent, v3).
**Outputs:** a card added to the hand (spent when its tower is placed), or a power written to the
modifier object.
**Edge cases:** into a full hand, the player replaces a card or discards the new one (v3 lost it
silently); rare powers are unique and change a rule (v3); multipliers add into a base of 1, so three
+12% powers make 1.36 (v3 guard against runaway stacking); every power has a test proving a consumer
reads what it writes (v3 shipped four that did nothing).
**Failure:** an empty pool offers gold instead.

### Meta progression

**Purpose:** long-term goals and unlocks across the campaign.
**Experience:** coins from every wave, spent in a four-tier talent tree between planets on new
towers, commanders, mounts and standing bonuses.
**Inputs:** coins earned (banked whether the planet is won or lost, v3), the talent tree.
**Outputs:** the account profile (unlocked towers, commanders and mounts, bonuses) and the stash of
extracted weapons.
**Edge cases:** talents apply at the next planet start; every talent has a test proving it works (v3
shipped two that did nothing); coins are never lost on defeat.
**Failure:** an older save migrates through versioned steps; a save that cannot migrate is kept as a
downloadable backup and a fresh profile starts.

### Campaign route

**Purpose:** the 99-planet journey, with meaningful choice.
**Experience:** a painted star chart; at each step, choose between two or three planets, each showing
its theme, size, hostility, boss silhouette and reward bias.
**Inputs:** the campaign seed, the current node, the account profile.
**Outputs:** the next planet's definition, route state, and story beats at planets 1, 10, 25, 50, 75
and 99.
**Edge cases:** defeat returns you to the same step (retry, or pick another node) with coins and
extracted weapons kept; hostility rises with the index whatever the route; branches rejoin, so no
choice locks the finale.
**Failure:** a corrupt route regenerates from the campaign seed and the current index.

### Mounts

**Purpose:** faster travel across large territories, and routes over water or through the sky.
**Experience:** call a mount with M: the Ridge Strider is fast on land, the Tideback swims, and the
Sky Ray glides and flies briefly (v3).
**Inputs:** mount unlocked by talent, mount state, terrain.
**Outputs:** speed and weapon damage factors (v3 values in Numbers), flight energy.
**Edge cases:** the Sky Ray flies for 12 s and recharges on landing, and high peaks still block it
(v3); a heavy hit dismounts; mounts cannot enter structures; commander speed bonuses multiply mount
speed (v3).
**Failure:** a mount stuck in terrain despawns and can be called again.

### Walls and crafting

**Purpose:** cheap tactical shaping, and a use for scrap.
**Experience:** lay short wall segments to add path cost, and enemies detour or batter through; forge
a random tower card at the heart; merge three identical weapons into the next rarity.
**Inputs:** scrap; wall placement (1 scrap for 5 segments of 180 HP each, v3); forge price (3, 5, 7
scrap and so on, v3); weapon merge (three identical weapons, capped at Rare, v3).
**Outputs:** wall entities with a path cost and health, forged cards, merged weapons.
**Edge cases:** walls add finite cost, so they never break the one rule; flyers pass over walls; a
forge needs a free hand slot and only a successful forge raises its price (v3); walls keep their
health in saves (v3).
**Failure:** a wall that cannot be placed returns its scrap.

### Weather and disasters

**Purpose:** planets that fight back, and moments that change a plan.
**Experience:** an eight-second warning showing the exact affected area, then a tornado, quake,
storm or wave that hits both armies (v3).
**Inputs:** theme compatibility; hostility (0.15 to 0.60 on planet 1, 0.80 to 1.60 on planet 99,
v3); a seeded schedule (calm interval 150 / (0.65 + hostility) seconds, never under 38 s, v3).
**Outputs:** disaster events with area, effect and duration; terrain changes for quakes.
**Edge cases:** tsunamis need a coastline and eruptions need a volcano (v3); a radiation storm stops a
struck tower for 8 s (v3); bosses resist displacement (v3); at most eight quake faults per planet
(v3); quakes preserve heart access, nest routes and tower footprints (v3).
**Failure:** a disaster that cannot find a valid area is skipped.

### Allies and possession

**Purpose:** extra hands on the ground, and a way to be anywhere.
**Experience:** Warden Barracks raise spear wardens who hold ground; click any friendly unit to take
control of it in first or third person; rally nearby wardens into a party with G and dismiss them
with H (v3).
**Inputs:** the barracks mark (2, 3 or 5 wardens, summoned every 7, 6 or 5 s, v3), the possession
target, rally input.
**Outputs:** ally units, possession state, party orders.
**Edge cases:** the pin budget (a unit may hold one enemy for 3 s, then must release it for 4 s, v3);
a possessed warden that dies returns control to the commander; only the commander can rally (v3).
**Failure:** control always returns to the commander when the possessed unit is removed.

### Story cutscenes

**Purpose:** gives the 99-planet journey a spine without slowing play.
**Experience:** short ink-sketch sequences, black and white with one warm accent in the manner of the
Sifu flashback, at arrival, the first boss, and planets 10, 25, 50, 75 and 99; always skippable. The
core fiction is kept from v3: a Worldheart is the crystal that keeps a living world alight, the Xeno
swarm devours worlds, and you carry the heart from world to world across 99 planets.
**Inputs:** the campaign beat and its cutscene script (shots, poses, captions).
**Outputs:** a sequence rendered in-engine from the game's own assets in the ink-sketch mode.
**Edge cases:** skipping mid-sequence; reduced motion holds frames instead of moving the camera; every
aspect ratio from phone portrait to ultrawide.
**Failure:** a cutscene that fails to load is skipped and its captions are shown as a card.

### Saves

**Purpose:** progress is never lost.
**Experience:** autosave at every wave clear, heart upgrade and planet end; resume mid-planet from
the last checkpoint.
**Inputs:** simulation state (serialisable by design), campaign state, settings.
**Outputs:** a versioned save envelope in IndexedDB with a localStorage fallback; export and import.
**Edge cases:** private browsing refuses storage (warn once and continue); version migrations;
idempotent receipts, so a reload never pays twice (v3).
**Failure:** a failed save offers retry and export, and travel to the next planet waits for a
successful save (v3).

### Onboarding

**Purpose:** teaches one system at a time, so the full game never arrives as a wall of rules.
**Experience:** planet 1 guides towers, crystals and the heart; each later planet introduces at most
one system: drafts on planet 2, weapons in depth on 3, disasters on 4, mounts on 5, walls and
crafting on 6.
**Inputs:** planet index, tutorial flags.
**Outputs:** system gates and contextual prompts.
**Edge cases:** skipping the tutorial releases every gate at once; the first-planet guide holds the
first wave until the first heart upgrade (v3).
**Failure:** a tutorial step that cannot complete times out and releases its hold (v3).

### Audio

**Purpose:** sound that confirms every action and carries the mood.
**Experience:** your tech is tuned, mechanical and short with a metallic transient; the Xeno is
detuned and breathy with no pitch centre; the heart is warm and sustained, the only long tail (v3);
music thins outside the frontier and swells for the boss.
**Inputs:** simulation and UI events, frontier state, wave state, settings.
**Outputs:** procedural WebAudio effects (layered synthesis, pre-rendered to buffers where cheaper),
adaptive music stems generated by code, spatial panning.
**Edge cases:** the frequency gate (a sound that happens a hundred times a match is quiet and dry,
v3); voice limits per family; mobile audio unlock on first touch; mute on N.
**Failure:** an audio context that cannot start leaves the game silent with a settings hint.

## Numbers and tuning

Initial values. The competent bot at M2 and M3 tunes them against the targets in the first table;
the owner's playtests overrule the bot.

### Session and planet

| Value | Number | Rationale |
|---|---|---|
| Planet duration target | 25 to 35 min | Owner decision |
| Planet radius, standard | 160 m | Half the circumference is 503 m, about 72 s at run speed: the far side is a real trip but not a slog |
| Planet radius, small and large | 130 m and 190 m | Size classes on the route map shift a planet's length by about 4 min either way |
| Worldheart levels | 10 | v3; level 10 claims the whole planet |
| Starting frontier | 12 m arc radius | v3 |
| Frontier angle at level L | a0 + (PI - a0) x (L / 10)^2.35, with a0 = 12 m / radius | v3 curve: early levels stay tight to defend, late levels claim large regions |
| Waves per planet, typical | 18 to 24 | Follows from the wave interval over about 25 min of play |
| Planet generation budget | 4 s on the RTX 4080 laptop, 8 s on Iris Xe | v3 was measured at 10 s and more; long loads break a 30-minute session |

### Worldheart ladder

| Level | Cost (credit first, then gold) | Tower mark cap | Rationale |
|---|---|---|---|
| 0 | 0 | II | v3 |
| 1 | 180 | III | v3 |
| 2 | 280 | IV | v3 |
| 3 | 420 | V | v3 |
| 4 | 620 | VI | v3 |
| 5 | 880 | VII | v3 |
| 6 | 1,200 | VIII | v3 |
| 7 | 1,600 | IX | v3 |
| 8 | 2,100 | X | v3 |
| 9 | 2,700 | XI | v3 |
| 10 | 3,400 | XII | v3; the full ladder costs 13,380, most of a planet's income, so claiming the world is the planet's main purchase |

| Value | Number | Rationale |
|---|---|---|
| Heart integrity, level 0 | 2,000 | Five unattended Mites (7 attack x 2.8 campaign multiplier, one blow per second) take about 20 s to break it: a leak is an emergency, not an instant loss |
| Heart integrity per level | +300 | Keeps pace with rising wave damage |
| Heart regeneration | 0 per second | Integrity is a resource you spend by leaking; powers can add regeneration |

### Commander

| Value | Number | Rationale |
|---|---|---|
| Walk speed | 3.2 m/s | Careful movement and aiming |
| Run speed | 7.0 m/s | 2.7 times v3's 2.6 m/s, which playtests found sluggish; crossing the starting ring takes under 2 s |
| Sprint speed | 10.0 m/s | Travel beyond the frontier without a mount |
| Time to full run speed | 0.18 s | Responsive without snapping |
| Time to stop | 0.12 s | Stops feel planted |
| Gravity | 24 m/s squared | Snappier jump arcs than real gravity at this scale |
| Jump height | 1.6 m | Clears rocks and low walls, never towers |
| Jump buffer | 150 ms | A press just before landing still jumps |
| Coyote time | 120 ms | A press just after leaving a ledge still jumps |
| Dodge distance and duration | 4.5 m over 0.45 s | Clears a Husk's reach in one roll |
| Dodge invulnerability | 0.06 s to 0.34 s | Rewards timing against a 0.25 s to 0.6 s wind-up |
| Dodge cooldown | 0.6 s | Stops chain-dodging through every telegraph without a stamina bar |
| Respawn inside and outside the frontier | 12 s and 30 s | Dying far out costs a wave's worth of attention |
| Cargo capacity | 3 crystals (4 with a talent) | v3 |
| Speed penalty at full cargo | 10% | v3 |
| Build reach in commander views | 14 m | v3 |

| Archetype | Health | Power | Movement | Rationale |
|---|---|---|---|---|
| Bulwark | 1,400 | 1.15 | 0.92 | v3: heavy cleave, the sturdy starter |
| Twinfang | 1,050 | 0.90 | 1.22 | v3: fast pair of blades |
| Longsight | 900 | 1.00 | 1.08 | v3: hitscan rifle, range over health |
| Kettle | 1,150 | 1.25 | 0.88 | v3: arcing lobber, splash |
| Emberline | 1,000 | 1.08 | 1.00 | v3: channelled beam |

### Combat feel

| Value | Number | Rationale |
|---|---|---|
| Hit-stop, light and heavy | 55 ms and 90 ms | Readable contact without stalling the flow |
| Strike frame, cleave, twin strike, lob | 0.40, 0.34, 0.42 of the swing | v3 timings |
| Cleave swing (Bulwark attack) | 0.85 s, strike at 0.34 s | v3: the cleave's 0.40 strike frame above, in seconds; the Bulwark's attack clip is keyed to both times |
| Pip (commander)'s cleave (his attack clip, `commanders.commander_pip` in src/shared/timings.json) | 0.85 s, strike at 0.34 s | His shield-and-sword cleave keeps the Bulwark's contract, so the two commanders' swings read alike until M4 tunes each archetype: a wind-up coiled to the right that peaks 5 frames before the strike, the cut down in front at 0.34 s, and a held recovery, with both boots planted by IK on every frame (blender/recipes/commander_pip.py). `npm run assets:check` holds his exported clip to both times within a frame; it exports at 25 frames, 0.833 s, as the Bulwark's does |
| Pip (commander)'s clip ground pass, `BLADE_CLEARANCE_M`, `BLADE_TURN_STEPS`, `BLADE_TURN_MIN_REACH_M` and the 0.1 mm and 0.5 mm checks (blender/lib/charforge.py `ground_clips`, `_lift_blade`) | each clip's lowest boot point at 0 by one hips offset, up or down; the lowest sword point 1 cm up by one constant turn of the hand, found in at most 6 secant steps from a first guess over a reach of at least 0.1 m; idle offset 1 mm and turn 4.63 degrees, run offset 1.76 cm, attack none | The 2026-10-03 source's clips were retargeted with no ground pass: the run's boots reached 1.75 cm under the ground, and the idle's new arm rotations put the sword's tip 3.4 cm into it in front of him (1.8 cm in the opening pose, which the Asset World read as the idle sinking 1.7 cm) while its boots stood within 1 mm. Raising the body would float the boots, so the sword is lifted by the hand instead, one rotation in the hand's own frame for the whole clip; neither pass varies by frame, which would bob the body or move the blade where the clip does not. 1 cm holds the tip visibly over the ground rather than grazing it. The offset goes both ways, so a clip that floats is lowered as one that sinks is raised; only sinking was corrected at first, and Pip's idle and run both sank, so both still rise by the same amounts. The turn is solved by the secant method from a first guess of the lift over the point's reach from the wrist, the reach floored at 0.1 m so a point beside the wrist does not ask for a turn of many radians at once; each step measures the whole clip, so 6 steps cap the build's time with room for a clip whose worst frame changes as the hand turns, and a turn that leaves the lowest point where it was (a sword point the hand does not carry) stops the build at once with that fault named, where the search used to divide by 1e-9 and leap through an arbitrary angle. The build stops unless a shifted clip's boots then read 0 within 0.1 mm and a turned clip's sword the clearance within 0.5 mm; the sidecar's `clip_ground` records each clip's readings, and tests/unit/assets/pip-meta.test.ts holds every clip's lowest point within the contract's 5 mm either way, each measured clip's sword at the clearance within 0.5 mm, and the attack's overlaps at 0 and boot shift within 1 mm; the Blender test lowers a floating clip, carries the turn through a hand keyed far from rest without moving the tip sideways, and refuses a sword point the hand does not carry |
| Commander skill cooldowns | Bulwark ward 24 s, Twinfang dash 16 s, Longsight focus 22 s, Kettle blast 28 s, Emberline field 30 s | v3 |
| Weapon skill cooldowns | sword cleave 12 s, spear lunge 13 s, twinblade cadence 18 s, carbine railshot 14 s, lobber siege shell 18 s, scepter heat vent 20 s | v3 |
| Enemy attack multiplier in the campaign | 2.8 | v3 |
| Largest share of health one player strike can remove | 85% | v3: no blow deletes a healthy body |

### Towers

| Tower | Cost | Hits air | MK I | MK II | MK III | Rationale |
|---|---|---|---|---|---|---|
| Bolt Sentinel | 150 | yes | 9 dmg, 4.6/s, 10.9 m | 15 dmg, 5.2/s, 11.3 m, 15% crit | 24 dmg, 6.0/s, 11.7 m, 25% crit | v3 |
| Cryo Bloom | 200 | yes | 38% slow, 7.1 m | 48%, 7.5 m | 55%, 8.0 m, brittle | v3 |
| Mortar Bastion | 250 | no | 34 dmg, 0.48/s, 13.4 m, 2.3 m splash | 56, 0.52/s, 13.8 m, 2.7 m | 88, 0.56/s, 14.3 m, 3.1 m, two shells | v3 |
| Arc Spire | 300 | yes | 30 dmg, 1.5 s charge, 3 chains | 46, 1.35 s, 4 | 68, 1.2 s, 6 | v3 |
| Helios Lance | 500 | yes | 26 dps, ramps to 3x over 2.0 s | 42, 1.7 s, 3x | 64, 1.4 s, 3.5x | v3 |
| Warden Barracks | 220 | no | 2 wardens, 7 s | 3, 6 s | 5, 5 s | v3 |

| Value | Number | Rationale |
|---|---|---|
| Critical multiplier | 2.2 | v3 |
| Ladder past MK III | cost x1.5 per mark, power exponent 1.5 | v3: each step costs more and buys proportionally less |
| Sell refund | 70% (90% with Salvage) | v3 |
| Height reach bonus | 1 + min(0.6, height x 0.02) | v3 |
| Specialization cost | equal to the MK III upgrade cost | The choice replaces a numeric upgrade rather than adding a new currency |
| Terrain affinity | hot stone +15% Mortar damage, cold stone +10% Cryo slow | v3 values, now bonuses rather than restrictions |
| Applied slow cap in the campaign | 70% | v3 |

### Enemies

| Species | Health | Speed | Armour | Bounty | Attack | Blow to blow | Wind-up | Reach | Rationale |
|---|---|---|---|---|---|---|---|---|---|
| Mite | 26 | 3.1 m/s | 0 | 6 | 7 | 1.00 s | 0.25 s | 1.2 m | v3 |
| Husk | 85 | 1.85 m/s | 0 | 12 | 11 | 1.40 s | 0.40 s | 1.3 m | v3 |
| Aegis | 340 | 1.1 m/s | 6 | 32 | 16 | 1.60 s | 0.45 s | 1.4 m | v3 |
| Wisp (flies at 2.6 m) | 52 | 2.5 m/s | 0 | 14 | 6 | 1.10 s | 0.30 s | 1.6 m | v3 |

### Waves and nests

| Value | Number | Rationale |
|---|---|---|
| Time between wave starts | 55 s + 1 s per wave, at most 80 s | About 21 waves in 25 min; late waves get room for longer marches |
| Early call bonus | 0.6 gold per second remaining x (1 + 0.05 x wave) | Calling wave 1 with 40 s left pays 25 gold, a sixth of a Bolt Sentinel |
| Enemy health growth | x1.08 per wave, steeper past wave 20 | v3 |
| Enemy melee growth | 35% of the health curve, at most 4x | v3 |
| Wave reward | 70 + 9 x wave gold | v3 |
| Evolution waves | 4, 8, 12, 16 | v3 used 3, 6, 9, 12 across 15 waves; respaced for about 21 |
| New nests per wave | 1, or 2 on waves 5, 10 and 15 | v3 |
| Nest warning | 3 s | v3 |
| Nest bounty | 180 gold | v3 |

### Economy and loot

| Value | Number | Rationale |
|---|---|---|
| Starting gold | 450 | v3 |
| Crystal credit | 100 per crystal | v3 |
| Crystal sites | 2 per expansion, 24 at most, 9 m apart | v3 |
| Weapon drop chance | 2% ordinary, 10% Aegis, 100% boss | v3 |
| Rarity weights | Common 68%, Uncommon 22%, Rare 7.5%, Epic 2%, Relic 0.5% | v3 |
| Backpack and equipped slots | 12 and 2 | v3 |
| Auto-pickup radius | 2.8 m | v3 |
| Scrap per salvaged weapon | 1 | v3 |
| Coins per cleared wave | 3 + floor(wave / 4) | 113 coins from a 21-wave planet (63 base plus 50 from the step), about one tier-1 talent per planet early on |
| Coins per planet won | 40 + 2 x planet index | 42 on planet 1, about a third of the wave coins, so winning matters but losing still progresses |

### Drafts and meta

| Value | Number | Rationale |
|---|---|---|
| Hand size | 3 (4 with a talent) | v3 |
| Tower card offer | choose 1 of 2 | Adds a decision to v3's random draw at no extra complexity |
| Power offer | choose 1 of 3 | v3 |
| Power weights | 100 common, 45 uncommon, 14 rare | v3 |
| Stacking | additive into a base of 1 | v3 guard |
| Minimum price after modifiers | 25% | v3 |
| Talent tiers | 4 | v3 |

### Planet boss

| Value | Number | Rationale |
|---|---|---|
| Awakening warning | 10 s | Enough to return to the heart from mid-territory at sprint speed |
| Phases | 2 on planets 1 to 20, 3 from planet 21 | Complexity rises with the campaign |
| Health | 5,000 x (1 + 0.15 x (planet index - 1))^1.1 | About a 3 to 5 minute fight on planet 1 against a competent build |
| Heart damage from a boss blow | 25% of maximum integrity | v3 removed half on contact; a telegraphed blow at a quarter leaves room to answer |

### Mounts

| Mount | Land speed | Water speed | Weapon damage | Rationale |
|---|---|---|---|---|
| Ridge Strider | 1.65x | 0.7x | 80% | v3 |
| Tideback | 1.2x | 2.4x | 90% | v3 |
| Sky Ray | 1.35x, 12 s of flight | glides | 65% | v3 |

### Walls, crafting and disasters

| Value | Number | Rationale |
|---|---|---|
| Wall cost | 1 scrap for 5 segments | v3 |
| Wall segment health | 180 | v3 |
| Forge price | 3, 5, 7 scrap and so on | v3 |
| Merge | 3 identical weapons to the next rarity, capped at Rare | v3 |
| Disaster warning | 8 s | v3 |
| Hostility range | 0.15 to 0.60 on planet 1, 0.80 to 1.60 on planet 99 | v3 |
| Calm interval | 150 / (0.65 + hostility) s, at least 38 s | v3 |
| Radiation storm tower stop | 8 s | v3 |

### Performance budgets

| Value | High (RTX 4080 laptop, 1440p) | Medium (Iris Xe, 1080p) | Low (mid-range phone) | Rationale |
|---|---|---|---|---|
| Target frame rate | 60 fps | 60 fps | 30 fps or better | Approved in design section 1 |
| Draw calls | under 400 | under 250 | under 150 | Instancing and batching keep crowds cheap |
| Triangles on screen | under 2.5 M | under 1.0 M | under 400 k | Silhouettes carry the look, not density |
| Texture memory | under 600 MB | under 300 MB | under 160 MB | Compressed textures and per-theme loading |
| Live enemies | 400 | 250 | 120 | Vertex animation textures for crowds |
| First load | under 25 MB | under 25 MB | under 25 MB | Themes and later families stream in |

The asset budgets mirror `tools/assets/budgets.json`, and `npm run assets:check` holds every model in
the manifest to its family's row. A triangle budget counts the whole GLB, including every mark, stage
and piece in it; the texture budget caps the width and height of each texture; ink means the model
carries the `_INK` width attribute the hull ink reads. `commanders` must also export idle, run and
attack clips, and `xeno` idle, walk and attack. A family's `morphs` line names the morph targets its
models may carry, and a family without one takes none: the commanders take the five face morphs the
face driver sets (`blink_L`, `blink_R`, `smile`, `brows_up`, `pucker`), because a stray shape key costs
every vertex of its mesh a morph fetch in the painted and hull shaders and nothing would drive it. Every
model must export every clip its family requires: the `pending` table that let Pip lack his attack while
it was made went when the clip shipped (2026-10-04), with the check's machinery for it, and a passing
model's line names the clip timings it was held to ("attack 0.85 s, strike 0.34 s as timings.json
sets"). Pip (commander), built by his recipe, measures 23,999 triangles, under the line, 24 bones (the
CharForge rig's 64 less its 40 finger bones; the jaw stays), three 1,024 px textures (the atlas his body
and armour share, its emissive, and the head's own albedo on a second body material), the five face
morphs and idle (1.6 s), run (0.7 s) and attack (0.85 s, strike at 0.34 s) clips, inside every
`commanders` line; the texture line caps each texture's size, not their count, so the head texture needs
no allowance.

| Family | Triangles | Bones | Texture (px) | Ink | Rationale |
|---|---|---|---|---|---|
| `commanders` | 24,000 | 32 | 1,024 | yes | Seen closest, in third person and on the hangar turntable; one humanoid skeleton serves all five |
| `xeno` | 9,000 | 24 | 1,024 | yes | Seen in crowds, so well under a commander |
| `towers` | 36,000 | 0 | 1,024 | yes | One GLB holds a family's three marks, and a tower shows one |
| `heart` | 30,000 | 0 | 1,024 | yes | One GLB holds the plinth and 11 stages, and the runtime shows the plinth and one stage |
| `nests` | 8,000 | 0 | 512 | yes | A small static mound, and each wave adds one or two |
| `env` | 20,000 | 0 | 1,024 | yes | One GLB holds a theme's whole kit, and each piece is instanced as scatter |

The same check holds these tolerances.

| Value | Number | Rationale |
|---|---|---|
| Ground contact, the bind-pose minimum Y of each placeable | within 5 mm of 0 | The runtime stands each root on the ground, so any miss floats or sinks the asset; 5 mm allows only rounding |
| Designed sink, named by the recipe | at most 0.14 m, matched by the measured depth within 5 mm | Lets a rock bury its base edge; the cap stops a sink from hiding a misplaced root |
| Clip length and strike time against `src/shared/timings.json` | within 1/30 s | One frame at the clips' 30 fps, so animation and simulation never disagree by more than a frame |
| Morph targets against the ground contact (tools/assets/inspect.mjs, checked by the build, not by assets:check) | no target moves a vertex within 5 mm of its placeable's lowest point or carries one down to within 5 mm of it, judged at weight 1; default weights 0 to 1; a displacement counts past 0.1 mm (`MORPH_STILL`) | The ground measurement reads only base positions, so a morph is allowed only where it cannot move what that measurement stands for: 5 mm is the ground tolerance itself, and a displacement is linear in its weight, so judging each target at weight 1 covers every weight from 0 to 1, the range Blender's shape key sliders and the face driver keep to. A face morph passes; a morph that moves a foot, even sideways, is refused. The placeable's lowest point is used rather than the whole asset's, which for a commander, one placeable, is the same point and for a kit is the stricter one. 0.1 mm is the manifest's rounding of ground contact; a target leaves the vertices it does not move at exactly 0, which the quantizer keeps exact. Before M1 any morph target was refused; the synthetic GLBs in tests/unit/assets/morphs.test.ts run the rule through the build's own optimizer |

### Render defaults

Painted-Anime-Inkline 4.0. Every dial was locked at the M0 style gate on 2026-09-28, when the owner
approved the golden-hour look, preset B3's live link (its row, below), with three adjustments, in the
owner's words: "I looked at the golden-hour style lab, and it definitely looks great! Let's stick with
it, but here are a couple minor adjustments to make as the default: Make default EdgeStrength = .33;
Make default Edgefadefar = 65" and "Also make litsaturation 1.09". `DEFAULT_DIALS` in
`src/render/defaults.ts` holds these values; every other dial keeps B3's value or, where B3 named none,
renderer v1's start. The Style Lab and the Asset World both open on `DEFAULT_DIALS`. Each row keeps
its measured rationale and gives renderer v1's start where it helps ("was"). In the rationales, "the
defaults" and "the default key" mean renderer v1's starts, measured before the lock, unless a figure
names the locked set. A dials link names only the dials that differ from the defaults, so a link made
before the lock opens every dial it does not name at its locked value: B3's own link now opens the
locked look with B3's edgeStrength of 1 and litSaturation of 0.87. The colour audit at the locked
defaults, frozen at 1920 x 1080 on the RTX 4080 laptop (gate 1.5), with Pip (commander), the labs'
default commander since 2026-10-04: 1.927, 1.942 and 1.946 at the hero camera on the high, medium and
low tiers, and 1.961, 1.980 and 1.982 at the close-up, strategic and horizon cameras on high. With
Bulwark, the commander the look was locked on (`?commander=bulwark`): 1.926, 1.942 and 1.946, and 1.974,
1.980 and 1.982, the lock's figures to the digit. The mutation proof rejects the hue-rotated copy of all
twelve frames. Where a row's figures name Bulwark, they were measured with him.

| Dial | Locked | Rationale |
|---|---|---|
| Light bands | 2 | Owner-approved at the M0 gate, 2026-09-28, from preset B3: two bands, a hard split of light and shadow whose terminator the brush noise breaks up (Brush noise on the terminator). Was 3, renderer v1's start, chosen as enough to model form, on the view that fewer reads flat and more reads smooth |
| Band edge softness | 0.03 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.06). A crisp edge that still anti-aliases. Under the locked 15 degree key the cap's scale at the heart is about 0.151 (cos 15 degrees / 160 x 25), so on the level clearing the locked 0.03 acts as about 0.0045 of ndl; the figures that follow were measured at renderer v1's start. The dial is the ramp's half-width in band units, which is dial / (bands - 1) of ndl to each side of an edge (a half-width in ndl only at 2 bands), so on the terrain it is scaled down wherever the ground curves more gently than `BAND_EDGE_RADIUS` (Render constants): across the planet's own curve 0.03 of ndl to each side spread over nearly 10 m of ground and read as airbrushed blobs at the strategic limb. The cap scales the dial by the ground's rate of change of ndl times 25 m wherever that product is under 1, so it limits the dial's reach across broad, gently curved ground, not only on the level clearing: there, under the default key, the scale is about 0.128 at the heart (cos 35 degrees / 160 x 25) and up to about 0.13 across the clearing, because the planet curve's rate of change of ndl is sin(angle to the key) / 160 per metre and that angle grows on the side away from the key: the scale is about 0.131 at the clearing's 6 m edge, where relief begins, and 0.135 at 14 m. So the dial's top of 0.25 gives at most about 0.033 across the clearing (or the pixel floor, where that is wider), less than the 0.06 the defaults had before the cap. Moving the dial from 0.06 to 0.25 at the defaults changes 8.3 percent of the hero frame's pixels by more than 2 of 255, against 22.2 percent before the cap. At the defaults the cap sharpens the meadow's mid-to-lit brush strokes wherever the ground curves gently, the level heart clearing above all: 3.7 percent of the hero frame's pixels move by more than 2 of 255 and 0.19 percent by more than 8, at most 13 (the close-up 4.6 and 0.29 percent, the strategic camera 2.9 and none, the horizon 1.6 and 0.02) |
| Brush noise on the terminator | 0.3 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.12): it breaks the shadow edge into broad strokes. With two bands the terrain's terminator cap reaches only the terminator at any noise (Terminator cap's fade, Render constants), so the lit band keeps its strokes. Renderer v1's 0.12 broke the edge into strokes without speckle under three bands |
| Paint texture strength | 1 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.85): the baked strokes at full strength, with nothing blended toward the broad mip (Broad paint mip, Render constants). v3's 1.3.2 recipe ran texture at 1.5 on flatter assets; renderer v1 started at 0.85 on the view that baked paint needs less |
| Brush scale | 0.7 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.35): the brush atlas tiles this many times per metre of object or world space, so its strokes are half the size of renderer v1's |
| Terrain brush | 1.2 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.5): the brush atlas scales the terrain's albedo by 1 + (brush - 0.5) times the dial, so across the atlas's 5th to 95th percentiles (0.29 to 0.71) the ground's strokes span 0.75 to 1.25 of its colour, against 0.9 to 1.1 at 0.5 |
| Standard blend | 0.45 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.35, Bulwark's authored blend): the dial rescales every material's authored blend of standard lighting against the cel bands by the dial over 0.35 (`AUTHORED_CHARACTER_BLEND`, Render constants), so at 0.45 each takes 9/7 of its authored blend |
| Prop brush | 1.3 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0, where characters, towers and props keep their baked paint alone). Above 0 the brush atlas strokes their albedo in object space, as the terrain brush strokes the ground, because the baked paint reads smooth on Bulwark's broad plates at hero distance. Preset B3's 1.3 (Golden-hour preset B3, below) moves his body's luma by 11 and 12 percent (the spread of its log ratio against the dial at 0) at the hero and close-up cameras, 5.0 and 6.9 luma on average |
| Saturation | 1.12 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 1.3, v3 1.3.2's): the albedo's saturation before the light; the lit saturation (next row) then sets the lit colour's |
| Lit saturation | 1.09 | The owner's adjustment at the M0 gate, 2026-09-28: "Also make litsaturation 1.09", replacing preset B3's 0.87 (was 1, where lit colour keeps the chroma the key gives it). Above 1 it pushes lit colour away from grey, the key's warm tint included, which the albedo saturation, working before the light, does not reach. Below 1 it restrains the colour after the key, fill, lift and rim and before any emitter adds its light, and emitting pixels are spared (Emitter spare ramp, Render constants), so the energy and the bloom that reads it keep their colour. It stands in for the grade saturation the gate's brief asked for, because a saturation in the grade would run after the bloom and grey the halo too; the sky, the fog and the ink are not drawn with the painted material, so it leaves them as they are. Preset B3's 0.87 takes the hero camera's meadow from 0.655 HSV saturation (at 1) to 0.581 and the frame's bottom third from 0.680 to 0.605 (the defaults' meadow reads 0.55), while the rails keep hue 173 at 0.409 saturation and the heart crystal's glowing pixels 0.580 (0.581 at 1). At the locked defaults (every dial locked, high tier, the RTX 4080 laptop) the hero camera's meadow reads 0.701 HSV saturation at 1.09 against 0.580 at 0.87 (B3's figure, reproduced), the bottom third 0.724 against 0.604, the heart stone 0.525 against 0.474 and the darkest tenth 0.575 at hue 141 against 0.533 at 144, while the 5th-percentile luma is 39.6 against 39.0 and Bulwark reads 45.0 luma, 0.551 of his ground. Emitters keep their colour: between 1.09 and 1.0 the heart crystal's glowing pixels, the rails and the nest's seams move by at most 0.2 degrees of hue and 0.001 of saturation at the four cameras (at the hero camera the heart 29.4 degrees at 0.567, the rails 178.4 at 0.374, the nest 338.0 at 0.398), the Husk's seams by at most 0.5 degrees and 0.005, and Bulwark's channels by 0.1 degrees where they fill hundreds of pixels (the hero and close-up cameras) and by 1.0 and 2.7 degrees over the 49 and 2 partly emitting edge pixels the horizon and strategic cameras see. Extrapolating from grey can take a channel under 0, and painted.ts's withSaturation clamps each channel at 0, so no lit colour enters the HDR buffer negative: read just before the clamp, 10.2 to 13.1 percent of the painted pixels at the four cameras have a channel under 0 (the Verdant kit 24 to 33 percent, the terrain 9 to 13), never more than 0.09 of the pixel's luma under it, the bound at 1.09 for a channel that was 0, and the clamp holds them at 0. No dark fringes follow: from 1.0 to 1.09 the most any pixel darkens at the four cameras is 2.0 of 255 in luma, and none brightens by more than 4 (1st percentile -0.7 to -1.2, 99th +0.6). The colour audit barely moves: 1.926, 1.931 and 1.928 times chance at 1.09, 1.0 and 0.87 at the hero camera, 1.980, 1.981 and 1.982 at the strategic camera, 1.974, 1.977 and 1.956 at the close-up and 1.982, 1.984 and 1.986 at the horizon |
| Shadow tint | #1b7078 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was #2f8f8c): a deeper teal, the complementary colour to the amber key, so the long shadows read teal; the shadow band's direct light is this tint times the shadow depth |
| Shadow depth | 0.62 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.35, v3 1.3.2's). Despite its name it sets how light the shadow band is: the band's direct light is the shadow tint times this value, so raising it lightens the shadows in the tint's colour (B3's 0.62 gives the band a quarter more direct light than B2's 0.5) |
| Shadow lift | 0 | Owner-approved at the M0 gate, 2026-09-28, unchanged: preset B3 leaves it at 0. The shadows as the shadow depth and the grade's contrast leave them. Above 0, light added in the theme's shadow grade colour at unit luminance, as a fraction of full sun whatever the albedo, giving way to the key by the smooth key (max(ndl, 0) times the cast shadow) as the actor fill does. It adds rather than floors, so darker albedo stays darker in shadow. The smooth weight never steps down at the terminator, where the banded weight it replaced inverted the step on dark albedo (a lift of 0.06 on an albedo of 0.04 under the default key, 0.1 on 0.1); but the smooth key is under 1 on lit ground too, so the lift reaches it, not only under a low key: 0.43 of it on level ground under the default 35 degree key and 0.74 at 15 degrees, so it greys a golden hour: on preset B3, measured at its old grain of 0.06, 0.025 lifts the hero frame's 5th-percentile luma from 36.4 to 43.8 but takes the meadow's saturation from 0.581 to 0.529, the darkest tenth's from 0.522 to 0.417 and the heart stone's from 0.480 to 0.393, which is why B3 leaves it at 0 and raises its shadow depth instead, from B2's 0.5 to 0.62: the shadow band's direct light is the shadow tint times the depth, so that lights the shadows about a quarter more in the saturated tint rather than greying them. Being additive, a strong lift on dark albedo can still leave a cast shadow brighter than the sunlit ground beside it (the smooth key drops across a cast shadow's edge). On cel terrain the key is flat across a lit band while the lift still falls with ndl, so within the band a slope turned further toward the sun reads a little darker than one turned less: at the dial's top of 0.15 the lift falls by 0.075 of full sun across the default's top band (ndl 0.5 to 1). It lives in the painted material, not the grade, because the grade cannot tell fogged ink from a dark it should lift (a grade lift raised the hull ink beside Bulwark from 5 to 27 luma at the hero camera), so the ink stays black under it: the hull ink beside Bulwark reads 4.3 luma at B3, whose lift is 0, at grain 0; at the old grain of 0.06 it read 6.3, and 6.5 with the lift, a rise of 0.2 luma measured only with that grain on |
| Ambient strength | 0.22 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.45; B2 had 0.24): the ambient hemisphere as a fraction of full sun. It lights both sides of the terminator alike, so it cancels out of the terminator's step (tests/unit/render/look-terminator.test.ts) |
| Exposure | 0.44 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.77, v3 1.3.2's), under a sun of 6.6 against renderer v1's 3.2; at the locked defaults the hero frame's median luma is 121.7 and its 5th percentile 39.6 |
| Grade contrast | 1.35 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 1.05): a power around linear mid grey (Grade contrast pivot, Render constants). Under preset B it crushed every shadow toward navy-black, which B3's lighter shadow band in the tint's colour answers in the material (Shadow depth) |
| Hull ink width | 3.2 px at 1080p, clamped 1.2 to 4 px | Owner-approved at the M0 gate, 2026-09-28, from preset B3's heavier ink (was 2.2 px). Borderlands-bold at gameplay distance without swallowing small enemies. The hull ink does not take the edge pass's strength or fade, so every character, tower and prop keeps its full silhouette at the locked edge ink strength of 0.33 |
| Ink colour | #0e0f14 | Owner-approved at the M0 gate, 2026-09-28, unchanged from renderer v1: a near-black with a cool cast for the Borderlands contour; the bloom's ink gate follows it (`INK_GATE_HEADROOM`, Render constants) |
| Edge ink strength | 0.33 | The owner's adjustment at the M0 gate, 2026-09-28: "Make default EdgeStrength = .33", replacing preset B3's 1 (renderer v1 started at 0.9). The screen-space edge pass mixes this much of the ink colour into a full edge, so terrain creases and the edge set's silhouettes draw at a third of B3's weight, while the hull ink on characters, towers and props keeps its full weight (Hull ink width). At the locked defaults, against 1, it lightens 3.0, 1.2, 1.5 and 1.2 percent of the hero, strategic, close-up and horizon frames' pixels by more than 2 of 255 (0.5 to 0.9 percent of the terrain in each), raises the ink ring beside Bulwark at the hero camera from 4.3 to 5.6 luma, and lets the heart halo add 31.0 luma 1 to 4 px outside the crystal, against 22.3 (Heart halo) |
| Edge line width | 1.4 | Owner-approved at the M0 gate, 2026-09-28, from preset B3's heavier ink (was 1.2): the edge pass reads its neighbours this many screen pixels to each side, from 0.6 to 1.4 times it as the ink noise wobbles, at least one texel of the edge buffers |
| Edge depth and normal thresholds | 0.03 and 0.35 | Owner-approved at the M0 gate, 2026-09-28, unchanged from renderer v1: a depth edge begins where the farthest neighbouring depth lies 3 percent beyond the pixel's and is full at 6 percent, and a crease begins where the normals bend by 0.35 (1 - dot) and is full at 0.56; why these values were chosen was not recorded |
| Edge pass fade | 60 m to 65 m | The owner's adjustment at the M0 gate, 2026-09-28: "Make default Edgefadefar = 65", the far end of the pair (was 180 m, which preset B3 kept); the near end stays at 60 m, so the pair stays strictly ordered. Terrain creases read near and vanish before they become moire. The fade runs on view depth: the edge pass's crease (normal) ink fades out between 60 and 65 m, and past 65 m only its depth (silhouette) edges remain, at 0.45 of their weight, beside the hull ink, which does not fade this way. At the locked defaults that reaches only the strategic camera, where 16.4 percent of the terrain in view lies past 65 m (23.2 percent past 60 m, 0.2 percent past 100 m); the other three cameras see no terrain past 60 m, because the 160 m planet's horizon lies 20 to 35 m from them. Against a far end of 180 m, 65 changes 0.37 percent of the strategic frame's pixels by more than 2 of 255 (0.14 percent by more than 8) and none at the other cameras, because at the locked edge ink strength of 0.33 the creases past 65 m were already faint |
| Rim light | 0.6 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.35). Separates characters from terrain in coloured shadow |
| Rim power | 3 | Owner-approved at the M0 gate, 2026-09-28, unchanged from renderer v1: the rim takes (1 - dot(N, V)) to this power, so it keeps to the silhouette; why 3 was chosen was not recorded |
| Actor fill | 1.4 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0, no fill); at the locked defaults Bulwark reads 45.0 luma, 0.551 of his ground, from the hero camera. Above 0, a fill from the camera's side on actors (materials authored with a standard blend above 0), in the ambient hemisphere's colour, falling off with dot(N, V), weighted by the authored blend against Bulwark's 0.35 (the Husk, authored at 0.3, takes 0.86 of it, and the towers, heart and nest at 0.1 take 0.29) and sparing emitters. It gives way to the key by the smooth key, (1 - lambert), not the banded (1 - lit): the banded weight stepped down where the key stepped up, so camera-facing white under the default key lost its terminator (0.217 linear luminance across 0.05 of ndl at a fill of 0, 0.059 at 1.2, 0.006 at 1.6, -0.046 at 2), and the smooth one keeps it (0.178 at 2; on a test sphere through the whole frame, -1.7 luma became +7.3). An actor reads when its body's median luma is at least 40 and at least 0.45 of the ground's around it. Preset B's backlit Bulwark at the hero camera sat at 14 (0.18 to 0.20 of his ground). On preset B3 there, with the lift at 0, he reads 16.6 (0.20) with no fill, 38.8 (0.469) at 1.2, which fails, and 42.1 (0.508) at B3's 1.4; a lift of 0.025 adds about 10 (48.8 and 0.56 at 1.2, as B2's 1.2 read 36.7 alone and 47.0 with its lift). At 1.4 alone Bulwark and the Husk pass at sun elevations of 8, 15 and 35 degrees: Bulwark 41.8 to 42.1 luma at 0.487 to 0.539 from the hero camera and 93.6 to 102.2 at 0.759 to 0.82 from the close-up, the Husk 73.7 to 74.7 at 0.573 to 0.597 from the horizon camera. Its limits: a cast shadow on an actor's lit side keeps the whole fill while the sunlit surface beside it keeps only part, so where the fill outshines the key the shadow reads brighter than the light; under the default key that begins above 1.18 on sky- and camera-facing surfaces, and under B3's key not within the dial's range. The smooth weight keeps the hard terminator the key's, but the lit side itself keeps (1 - ndl) of the fill, so where the fill fades faster than the key brightens, a face turned fully to the key reads darker than one turned partly away: on the same surfaces at Bulwark's standard blend, whatever the albedo, that begins above a fill of 0.42 under the default key and 0.99 under B3's, and from ndl 0.75 to 1 the luminance falls by 9.9 percent at 1.2 under the default key (0.07 percent under the banded weight) and by 3.8 percent at B3's 1.4 |
| Bloom threshold and energy halo | 1.0 and 1.2 | Owner-approved at the M0 gate, 2026-09-28: the threshold unchanged, the energy halo from preset B3 (was 0.8); the figures below were measured at renderer v1's 0.8 unless they name another value. Only energy and hazards bloom. The bloom takes each emitter pixel's hue at full brightness, and 0.8 gives the rails and the nest the glow they had at 0.6 of the capped surface colour (Bulwark's channels at the close-up camera: 5.8 luma added 1 to 4 px out, 5.6 before; the ink gate leaves the ink-free part of that ring unchanged). It is kept off every emitter's own pixels, not only the heart's, because energy keeping its saturated hue is how Pillar 5 reads: against the bloom that lit every pixel (469e74e), the hero camera's cyan lost 12.9 luma and went from 0.310 to 0.374 saturation, the close-up's cyan lost 9.1 (0.224 to 0.245), the strategic camera's nest 4.2 (0.350 to 0.359) and the heart crystal 14.1 (0.425 to 0.460). It is kept off ink the gate can tell from paint by luminance, just over the ink colour's own, and adds at most four times a pixel's own luminance (Render constants), so hull ink that wholly covers a pixel near the camera stays dark: the heart crystal's outline at the hero camera averaged 123, 139 and 161 luma on the high, medium and low tiers, with 33, 16 and 100 percent of its right edge's rows broken, and now averages 13, 12 and 1.9 with none broken. Its limits: in the default fog, ink more than about 22 to 30 m away rises past the gate (the heart's outline at the strategic camera reads 101, 99 and 116 luma, against 62, 57 and 49 with the bloom off, on high and medium as before the gate); edge ink at strength 0.9 is part paint and only capped (about 20 luma added near energy at the hero camera, 32 at the close-up); at the art preset fogged ink beside energy reads dark brown (30, 32 and 43 luma, down from 91, 110 and 184 but against about 3 with the bloom off); a sky or ground darker than the gate gets no halo, or a capped one (Ashen Moon's black sky in M8, Ember Rift's charcoal basalt in M2); and a lighter ink takes the halo off paint as dark as it: around energy at the hero camera #3a1f5c keeps about 85 percent of the default ink's halo and #808080 11 to 28 percent (`INK_GATE_HEADROOM`, Render constants). A per-pixel ink signal, such as a reserved key band under the lowest threshold of 0.2 or an ink coverage flag, is needed before M2 |
| Heart halo | 11 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 4). At the locked defaults it adds 31.0, 35.5, 30.1 and 21.3 luma 1 to 4, 4 to 8, 8 to 16 and 16 to 32 px outside the crystal at the hero camera on the high tier (22.3, 33.5, 26.4 and 19.9 with the edge ink at B3's full strength), measured over every pixel of each ring; the figures that follow were measured at 4. Warm emitters, the heart and its economy (Pillar 5), feed the bloom at this strength instead of the energy's, so the heart reads without flaring every rail: 27, 27, 17 and 11 luma added to the ink-free pixels 1 to 4, 4 to 8, 8 to 16 and 16 to 32 px outside the crystal at the hero camera, while the crystal's outline at that camera stays dark (13 luma or less on every tier, Render constants); measured over every pixel, outline included, the rings read 32, 12, 7 and 4 before the heart had its own strength, 77, 35, 24 and 16 while the glow still washed the outline, and 23, 28, 19 and 13 now |
| Fog density and start | 0.02 and 0 m | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.006 and 20 m, a distance fog that left the low cameras' 20 to 35 m horizon clear and took about half the strategic limb's colour). With the height fog falloff of 0.3 the haze lies on the ground from the camera out (next row) |
| Height fog falloff | 0.3 per metre | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0, where every metre of the ray counts alike, a distance fog). 0.3, with density 0.02 and start 0, lays the haze on the ground: 0.4 to 0.5 of the fog colour at the low cameras' limbs while the strategic limb keeps 0.39 and its centre 0.06 |
| Sun elevation, colour and intensity | 15 degrees, #ffc05c, 6.6 | Owner-approved at the M0 gate, 2026-09-28, from preset B3: a raking amber golden-hour key (was 35 degrees, #ffd29a and 3.2, the Verdant theme's light). The dials override the theme's light, so a preset can lower and warm the key without editing the theme; the theme keeps its own light (35 degrees, #ffd29a, 3.2 in themes.ts) and the azimuth, which no dial moves. Per-theme seeds for these dials are an M2 task (Task list) |
| Soil edge breakup | 1 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0, the smooth soil ring). At 1 its edge breaks into the terrain's brush strokes: mixed pixels on the edge fall from 45 to 7 percent at the strategic camera |
| Film grain | 0 | Owner-approved at the M0 gate, 2026-09-28, unchanged. Off, at the owner's direction at the M0 style gate: preset B3's 0.06 (the start was 0.04) read as noise laid over the screen. The finish hashes the grain per screen pixel, so it rides the glass rather than the painted surfaces: re-seeded 24 times a second while the scene runs, and a fixed speckle the world moves under when frozen. That is what the Ink rules (Art direction) rule out: the style lives in the materials, "never as a screen overlay pinned to the glass". At B3's hero camera on the high tier, 0.06 put a high-pass RMS (luma less its 7 x 7 mean) of 4.1 luma on the flat haze beside the heart, where the paint alone leaves 0.1, moved 72 percent of the frame's pixels by more than 2 of 255, and lifted the hull ink beside Bulwark from 4.3 to 6.3 luma, because grain clipped at black can only brighten it. The painted texture the owner kept lives on the surfaces: the brush atlas, the broken terminator and the sky's brush clouds. The dial keeps its 0 to 0.2 range. A dials link names only the dials that differ from the start, so a link made before this change that left the grain at its old start of 0.04 names no grain and now opens with none, while a B3 link copied before this change still carries 0.06 and turns the grain back on: the owner started from the current B3 link, which carries none. B3's figures in these rows were measured at its old 0.06; at 0 its hero camera reads meadow 0.581, heart stone 0.475 (the saturation of its mean colour 0.498, so the grain had raised the per-pixel median, not the colour), darkest tenth 0.539 at hue 145, 5th-percentile luma 36.7, Bulwark 42.0 at 0.507 of his ground and a heart halo of 22, 33, 26 and 20 luma, with colour audits of 1.928, 1.926 and 1.925 on the high, medium and low tiers and 1.956, 1.985 and 1.988 at the close-up, strategic and horizon cameras on high |
| Vignette | 0.55 | Owner-approved at the M0 gate, 2026-09-28, from preset B3 (was 0.35). A smooth darkening toward the frame's corners, pinned to the frame (screen space) rather than to the world, and not noise: the finish darkens each pixel in proportion to its squared distance from the frame's centre (Vignette falloff, Render constants), so at the locked 0.55 the corners keep 0.56 of their display-linear light and the middle of each edge 0.78, and at 0.35 they kept 0.72 and 0.86. 0.35 was renderer v1's start, from the M0d plan, which records no reason for it. At B3's hero camera, against no vignette, the corners read 20.2 luma darker and the whole frame 8.9 darker at 0.55, 10.4 and 4.7 at 0.30, and 5.1 and 2.3 at 0.15. The owner kept B3's 0.55 at the gate |
| Golden-hour preset B3 | `{"bands":2,"bandSoftness":0.03,"terminatorNoise":0.3,"paintStrength":1,"saturation":1.12,"shadowDepth":0.62,"shadowTint":"#1b7078","rimStrength":0.6,"standardBlend":0.45,"ambientStrength":0.22,"brushScale":0.7,"terrainBrush":1.2,"propBrush":1.3,"soilBreakup":1,"litSaturation":0.87,"actorFill":1.4,"inkWidthPx":3.2,"edgeStrength":1,"edgeLineWidth":1.4,"fogDensity":0.02,"fogStart":0,"fogHeightFalloff":0.3,"sunElevation":15,"sunColor":"#ffc05c","sunIntensity":6.6,"exposure":0.44,"contrast":1.35,"bloomIntensity":1.2,"heartHalo":11,"grain":0,"vignette":0.55}` | The look the owner approved and locked at the M0 style gate on 2026-09-28, with three adjustments that the rows above quote: edge ink strength 0.33 in place of 1, the edge fade's far end at 65 m in place of 180, and lit saturation 1.09 in place of 0.87. Painted-Anime-Inkline 4.0 is this row with those three. Its live link, written by the lab's "Copy dials link" against renderer v1's starts, names these 30 dials and no grain, and `decodeDials` decodes it to this row key for key (tests/unit/render/themes-dials.test.ts). It was the golden-hour look for the owner's gate, as the lab's dials link carries it (every dial not named kept renderer v1's start), except that the JSON names `"grain":0` explicitly, while the lab's "Copy dials link" leaves it out because 0 is now the default: a raking 15 degree amber key, two bands with a brush-broken terminator, long teal shadows, the soil's edge broken into strokes and heavier ink. The figures that follow were measured at grain 0.06, B3's value until the owner turned the grain off, and the Film grain row gives the grain-0 figures. At the hero camera on the high tier: meadow HSV saturation 0.581 (the target was at least 0.53), heart stone 0.480 (at least 0.48; the saturation of the stone's mean colour is 0.499; at grain 0 the stone reads 0.475, which is 0.005 under the 0.48 target on the per-pixel median, while the stone's mean colour holds at 0.498), the darkest tenth of the frame 0.522 at hue 143 (at least 0.45), the frame's 5th-percentile luma 36.4 (35 to 40), and the heart halo 23, 32, 26 and 20 luma 1 to 4, 4 to 8, 8 to 16 and 16 to 32 px out (17, 23, 21 and 16 at B2's 8); readability holds on the fill alone (Actor fill). Colour audit 1.925, 1.930 and 1.931 on the high, medium and low tiers at the hero camera, and 1.954, 1.985 and 1.988 at the close-up, strategic and horizon cameras on high (gate 1.5). It draws in 2.09 ms uncapped at 2560 x 1440 on the RTX 4080 laptop (the defaults 2.16). It replaces B2, the look pass's, which differs in saturation 1, shadowDepth 0.5, shadowLift 0.025, ambientStrength 0.24, litSaturation 0.8, actorFill 1.2, heartHalo 8 and grain 0.06; B2 replaced B, the preset pass's (the art preset of the Render constants rows), which differs from B2 in sunColor #ffb468, shadowLift 0, propBrush 0, litSaturation 1, actorFill 0 and heartHalo 7. The heart halo's range reaches 12, up from 8, because B2 sat at the old top; every link made under 8 opens unchanged |

### Render constants

Numbers in the renderer's code that no dial moves. Change one here in the same commit that changes it in code.
Figures "at the defaults" or under "the default key" in these rows were measured at renderer v1's
starting dials and its 35 degree key, before the M0 lock (Render defaults), unless they name the locked
set.

| Constant | Value | Why |
|---|---|---|
| `FOG_STEPS` (post/fogEffect.ts) | 8 | The segments the height fog integrates each ray over. Against a 4000-step reference on the style scene's ground rays, 8 keep the fog-weighted length within 2.3 percent at a falloff of 0.3 from fogStart 20 m and 3.3 percent from 0 m (3.9 and 5.5 percent at the dial's top falloff of 0.5), at most 0.018 of fog amount at density 0.02; 4 drift by 8.9 and 12.5 percent (14.4 and 19.9 at 0.5). The worst ray is always the strategic camera's grazing limb, and the low cameras stay under 0.5 percent |
| Fog series threshold, `abs(x) > 1e-3` in `fogLength` (post/fogEffect.ts) | 1e-3 | Where a segment's weight, the mean of exp(-falloff times altitude) across it, switches from the quotient (e0 - e1) / x to the first-order series e0 (1 - x / 2), x being the falloff times the segment's change of altitude. At x = 1e-3, e0 and e1 agree in their first 3 digits, so their difference keeps only about 4 of fp32's 7, and there the series is off by x squared over 6 of e0, under 2e-7. The series also carries x = 0, where the quotient is 0 / 0: a ray through a hollow under the sphere, whose altitude is 0 throughout, or one that ends before fogStart, whose segments have no length. On level rays at eye height, where every segment takes the series, the quotient missed the exact weights by up to 2.1e-4 of the sum and the series stays within 1.5e-7 (fog-length.test.ts) |
| Fog curve and sunward lobe, `1.0 - exp(-pow(travelled * uDensity, 1.5))` and `pow(max(dot(direction, uSunDirection), 0.0), 6.0)` (post/fogEffect.ts) | 1.5 and 6 | The fog amount is 1 - exp(-(d times density) to the 1.5), for a fog-weighted length d, so it builds more slowly than plain exponential fog while d times density is under 1 and faster beyond, keeping near ground clearer at the same density: it reaches half where d times density is 0.78, and plain exponential fog at 0.69. Looking toward the sun the haze takes the theme's sunward fog colour by the cosine to the sun raised to the 6th power, half of it about 27 degrees from the sun and a tenth at about 47. Renderer v1's values, from the M0d plan; why these two numbers were chosen was not recorded |
| `COVER_TOLERANCE` (post/inkEdgeEffect.ts) | 0.01 | How much nearer than the edge set the main depth must be, as a fraction of the nearest of the edge pass's five taps, before a pixel counts as covered by something outside the edge set (a grass blade, a flower, a hull) and draws no edge ink, so a crease is never drawn across what stands in front of it. Little more than depth precision has to fit under it, because on any surface both buffers hold the nearest tap is about as near as the main depth sample, or nearer; the upper part of a grass blade clears it even from the strategic camera (a 0.6 m tip is about 1.6 percent nearer than the ground behind it there), and far more of the blade does from the low presets |
| `WARM_BLUE_FULL` and `WARM_BLUE_NONE` (post/pipeline.ts) | 0.2 and 0.35 | The edges of the bloom's warm test on a red-led pixel's blue over its peak: at 0.2 or less it takes heartHalo, at 0.35 or more bloomIntensity. They encode Pillar 5 on the committed assets lit at the locked defaults (tools/render/warm-texels.mjs lights the texels, and bloom-warm.test.ts pins the assets, the lighting and the generator's own assumptions they came from: where the hemisphere is read, how far a silhouette faces away and the failure's key): the heart crystal's texels sit at 0.037 to 0.060 (1st to 99th percentile), 0.140 under the first edge, and the nest's magenta seams at 0.365 to 0.470, 0.015 over the second (0.382 to 0.519 and 0.032 under renderer v1's key), and cyan's red never leads. In the generator's model a silhouette rim under the locked key puts 98.3 percent of the seam texels at least half warm, as the art preset's did, so the known failure is reachable at the locked defaults in the model. The GPU, at the locked defaults on the high and low tiers, does not show it at the four preset cameras: no nest seam pixel the bloom feeds tests half warm; at the strategic camera, where the least blue 1 percent of the fed seam pixels reach 0.33 of their peak (0.32 on low), 7 of 132 take a trace of warmth (3 of 122 on low), warmth times mask summing to 0.2 pixels, and the seams add at most 1.0 luma of heart halo on high and 1.9 on low, measured against a frame whose warm ramp is narrowed to 0.12 to 0.15 (earlier, at the art preset, at most 4.6). The Husk's magenta seams, which the generator does not sample, put 1 of 32 fed pixels half warm at the strategic camera on high, adding up to 7.2 luma and moving 28 pixels of the frame by more than 2 of 255, and none on low. The heart's own fed pixels stay warm: all of them at the hero and strategic cameras, and 1,216 of 1,222 wholly warm at the horizon camera, where fog takes its bluest 1 percent to 0.19. The known failure's key, a sunColor of #ff8844 at intensity 8 with that rim, makes 99.6 percent of the seam texels test at least half warm; deciding warmth in painted.ts from the emitter's own colour would end the rim case, the failure and the Husk's traces |
| `INK_GATE_HEADROOM` and `INK_GATE_WIDTH` (post/pipeline.ts) | 1.235797 and 0.009 | The ink gate: a pixel takes none of the bloom's glow at or under the headroom times the ink colour's linear luminance and all of it from the width above that, so hull ink, drawn in the ink colour, takes none where it wholly covers a pixel. It follows the inkColor dial because fixed edges (0.006 and 0.015, only 1.24 times over the default ink's 0.0049) let a lighter ink take the glow again: #102030 took 93 percent of it and its heart outline at the hero camera gained 42 and 46 luma on the low and high tiers, where it now gains 0.2 and 16, as the default ink does. A lighter ink is harder to tell from dark paint by luminance, so its gate also takes the halo off paint as dark as it: around energy at the hero camera #102030 keeps 99 and 96 percent of the default ink's halo, a mid-grey #808080 only 28 and 11. The headroom is 0.006 over the default ink's 0.0048552, to seven digits, so the default ink's edges are the 0.006 and 0.015 they replace, and frames in the default ink measured unchanged bit for bit. The width is added, so a black ink still has a ramp, and because it is added rather than scaled the ramp narrows as the ink lightens: between the sRGB greys at its two edges it spans about 14.8 levels of 255 at the default ink, 9.6 at #102030 and 2.2 at #808080. At #ffffff the gate spans 1.236 to 1.245, over the full-sun white renderer v1's key is calibrated to (about 1.0), so almost no paint got a halo. Under the locked key sunlit white clears the gate before exposure, at 1.255 from the direct light alone and about 1.34 with the ambient, so with a white ink sunlit white paint takes the full halo. Paint sits above the default edges: the darkest ink-free pixels near energy were 0.0167 (1st percentile) and under 0.3 percent fell below 0.015, over the hero, close-up and strategic cameras on all three tiers at the defaults and the art preset (ink found by drawing it black, then white) |
| `GLOW_LIFT_MAX` (post/pipeline.ts) | 4 | The most glow a pixel takes, as a multiple of its own luminance: glow raises a pixel's luminance at most five-fold (2.3 stops), though a saturated glow raises one channel further (a Xeno magenta or violet glow, #ff3fa6 or #d84dff, adds up to 14.5 or 14.7 times the pixel's luminance to its strongest channel). It holds the ink the gate misses, fogged ink (the art preset's heart outline is 0.015 to 0.034 linear at the hero camera, where the darkest paint near energy is 0.019), edge ink, which is part paint, and MSAA edge pixels, and it holds dark paint beside a strong emitter to a warm tint where the glow flooded it pale. At 4 the art preset's heart outline stays under 55 luma at the 95th percentile on every tier (72 at 6). The halo pays on dark paint: the heart's ink-free halo 1 to 4 px out keeps 98 percent of its luma on the high tier and 85 percent on the low tier at the defaults, and on the low tier 79 percent at heartHalo 7 and 76 percent at the art preset; the rails keep 92 to 100 percent of theirs and the nest 97 to 100 |
| `BLOOM_SMOOTHING` (post/pipeline.ts) | 0.25 | The width, in emissive key units, of the ramp above the threshold over which the bloom's input mask and its shield open, so an emitter fades in rather than switching on at one key. The dial's top threshold of 3 plus the ramp still fits under `EMISSIVE_KEY_RANGE`, which the pipeline test holds |
| `EMISSIVE_KEY_RANGE` (materials/painted.ts) | 4 | The emissive key rides in alpha as key / 4. postprocessing's EffectPass clamps alpha to 0 to 1 at the end of every pass, so a raw key would reach the bloom as at most 1, under the default threshold plus its ramp, and nothing would glow; 4 holds every threshold the dial allows (up to 3, plus 0.25) and M0c's energy, authored at emissive strength 4 |
| `EMISSIVE_PEAK` (materials/painted.ts) | 1.25 | The brightest channel an emissive surface may add to its lit colour, one factor on all three channels so the hue holds under AgX. With the heart's amber-gold glow the crystal's median saturation measured 0.44 at a cap of 1.5, 0.47 at 1.25 and 0.51 at 1.0; 1.25 is the brightest cap that clears 0.45, and there the magenta nest and the cyan rails keep their hues (330 and 170 degrees, from 337 and 176 uncapped) |
| Terminator cap's fade (materials/painted.ts) | from the noise to twice it, in abs(ndl) | The terrain's terminator-noise cap (`TERMINATOR_BAND_TILES`) weakens as abs(ndl) rises from terminatorNoise to twice it, a smoothstep, and is gone beyond: the noise can flip light into shadow only where abs(ndl) is under it, and capped further out the default's three-band meadow, whose 35 degree key lies on the mid-to-lit edge, lost its broken strokes. So the cap reaches only the terminator while 2 * terminatorNoise stays under 1 / (bands - 1), the ndl of the next band edge: at any noise with 2 bands, up to 0.25 with 3, 0.17 with 4 and 0.125 with 5; past that it caps the next edge too. The fade's lower edge is floored at 1e-4, because at a noise of 0 smoothstep's edges would be equal, which GLSL leaves undefined |
| `TERMINATOR_BAND_TILES` (materials/painted.ts) | 1 | The widest the terrain's brush-broken terminator spreads, in brush tiles to each side of it: the terminator noise is capped at the ground's rate of change of ndl times this width, near the terminator only, so the edges between lit bands keep their strokes. Uncapped, a low key over the gently curved planet spread the band for tens of metres and the tiling brush atlas printed a lattice of dark strokes over the lit meadow, preset B's crosshatch on the strategic camera's right half: 127 dark flecks per thousand ground pixels by the limb at 15 degrees and 197 at 8, against 80 and 56 with the noise off; capped, 84 and 71. It was not shadow acne (see `SHADOW_BIAS`). The defaults' frames are unchanged bit for bit |
| `AUTHORED_CHARACTER_BLEND` (materials/painted.ts) | 0.35 | Bulwark's standard blend, which every material's blend is authored against: the standardBlend dial rescales them all by the dial over 0.35, and the actor fill takes the material's blend over 0.35 of its strength, at most all of it: Bulwark all of it, the Husk, authored at 0.3, 0.86, and the 0.1 structures 0.29, where full strength greyed the heart's stone around its crystal (saturation 0.40 without the fill, 0.30 at full strength, 0.36 weighted, at the hero camera) |
| `BAND_EDGE_RADIUS` (materials/painted.ts) | 25 m | On terrain the band edge softness is scaled by the ground's rate of change of ndl times this radius wherever that is under 1, so an edge's ramp spans at most the ground it would on a curve of this radius (0.75 m to each side at 0.03 of ndl), and the dial still widens or narrows it. It is floored at half of x's change across a pixel (fwidth), unless the dial is narrower still, so every edge anti-aliases over about a pixel wherever the dial allows, and at 1e-4; it never rises over the dial, which wins both ways, so across a cast shadow's edge, where x jumps, the dial's own softness stands. Uncapped, preset B2's 0.03 spread each edge across the planet's curve (about 1/160 of ndl per metre) over nearly 10 m of ground, and the review found soft airbrushed blobs by the strategic limb, a 55 px luma ramp where a cast-shadow edge in the same frame took 10 px. 25 m is about the radius of the patch's broad relief (a 50 m wavelength, 2.5 m high), so a terminator on relief keeps its ramp, and on the planet's curve B2's softness acts like 0.005, which the review found crisp and brush-broken. Measured along the luma gradient with cast shadows off (the luma smoothed first, so a crisp edge reads about 6 px), the band terminator's ramp by the limb under B2 falls from a median of 7.8 px (90th percentile 31, and 21 percent of its length wider than 20 px) to 6.8 (15, 5.5 percent) at 15 degrees, and from 14.2 (35, 31 percent) to 10.1 (19, 8.8 percent) at 8; B3 reads 6.9 (15, 5.4 percent) and 10.2 (20, 9.9 percent). A 12.5 m radius gives medians of 6.1 and 7.9, a 50 m one 7.6 and 12.9. Dark flecks by the limb stay where the terminator cap left them (B2 84 to 85 per thousand ground pixels at 15 degrees and 73 at 8; B3 88 and 73). The defaults change where their mid-to-lit strokes cross level ground (Band edge softness, Render defaults) |
| Emitter spare ramp (materials/painted.ts) | the emissive key's first unit | The actor fill, the shadow lift and the lit saturation spare emitting pixels by 1 - clamp(emissiveKey, 0, 1): fully on a pixel whose brightest emissive channel reaches 1, not at all on one that does not emit, and in part on one that only faintly emits, so energy keeps its authored colour (Pillar 5). Restrained along with the stone, the heart crystal's glowing pixels fell from 0.58 to 0.49 saturation at the hero camera; spared, they keep 0.57, and under preset B3 lit saturation at 1 and at 0.87 leaves them at 0.581 and 0.580 and the rails at hue 173 and 0.409 |
| Rim gate, `smoothstep(-0.1, 0.4, ndl)` (materials/painted.ts) | -0.1 and 0.4 | The rim is sunlight caught at a grazing angle, so it follows the key's side: none where ndl is under -0.1, all of it from 0.4, a smooth ramp between. Starting just past the terminator lets a silhouette that turns away from the sun keep a thin rim instead of losing it exactly at the band edge. Both values come from renderer v1 and have not been measured since |
| Broad paint mip, `textureLod(uMap, vUv, 6.0)` (materials/painted.ts) | level 6 | The paint strength dial fades the baked strokes toward the region's broad colour, read from mip 6: on the 1,024 px maps (Performance budgets) that is the 16 px level, one texel for every 64 of the map, broad enough to lose the strokes and still keep each painted region's colour. Renderer v1's value, not measured since |
| Brush triplanar exponent, `pow(abs(normalize(n)), vec3(4.0))` (materials/painted.ts) | 4 | The brush atlas is projected along the three axes and blended by the normal's components raised to this power, so a face within 30 degrees of an axis takes 90 percent or more of that axis's projection and the strokes stay crisp, blending only near the diagonals; at 1 that face would take 63 percent and every face would smear a three-way mix. Renderer v1's value, not measured since |
| Grade contrast pivot and toning ramp (post/gradeEffect.ts) | 0.18, and 0.03 to 1.0 | The contrast dial is a power around linear mid grey, 18 percent reflectance, so contrast deepens the darks and lifts the lights about the tone a grey card reads while exposure alone moves the mid tones; at preset B's 1.35 that power crushed every shadow toward navy-black, which the shadow lift and B3's higher shadow depth, a lighter shadow band in the tint's colour, answer in the material. The split toning blends from the shadow grade to the highlight grade over luminance 0.03 to 1.0, a smoothstep. Renderer v1's values, not measured since |
| Vignette falloff, `1.0 - uVignette * dot(q, q) * 1.6` with `q = uv - 0.5` (post/finishEffect.ts) | 1.6 | The vignette dial scales a darkening that grows with the squared distance from the frame's centre in screen units, which is 0.5 in each corner and 0.25 at the middle of each edge, so with 1.6 the corners keep 1 - 0.8 times the dial of their light and the edges' middles 1 - 0.4 times it: 0.72 and 0.86 at the default 0.35, 0.56 and 0.78 at B3's 0.55, and 0.2 and 0.6 at the dial's top of 1, so no setting reaches black. It multiplies display-linear light after AgX, before the grain and the output encode. Because uv runs from 0 to 1 along both axes, the darkening is an ellipse that follows the frame's aspect, not a circle. Renderer v1's value, from the M0d plan; why 1.6 was chosen was not recorded |
| Grain re-seed, `Math.floor(this.time * 24) % 1000` (post/finishEffect.ts) | 24 per second, wrapping at 1000 | The grain's seed steps 24 times a second of scene time, so on a display at 24 Hz or faster the speckle changes about every 42 ms rather than every frame, and wraps after 1000 steps, about 42 s. The lab's freeze stops scene time, which fixes the speckle (Film grain, Render defaults), and under reduced motion the seed never steps, because a per-frame shimmer is motion (the code's comment). At the default grain of 0 neither shows. 24 is film's frame rate, but why it and 1000 were chosen was not recorded; both come from renderer v1's M0d plan |
| Grain hash, `fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453)` on the pixel index `floor(uv * uResolution)` (post/finishEffect.ts) | 12.9898, 78.233 and 43758.5453 | A pseudo-random value from 0 to 1 for each screen pixel and seed: the dot product folds the pixel's column and row into one number, the seed offsets it, and the sine scaled by 43758.5453 changes so fast between neighbours that its fractional part reads as noise. Indexing by the screen pixel is what pins the grain to the glass rather than to the painted surfaces (Film grain, Render defaults). These are the constants of the widely used one-line shader hash; renderer v1 took it from the M0d plan, and why this hash was chosen over another was not recorded |
| Grain space, `sqrt(c)` before the grain and `g * g` after (post/finishEffect.ts) | gamma 2 | The grain is added to the square root of the display-linear colour and the sum is squared back, a gamma 2 space close enough to sRGB that equal steps of grain read evenly from ink to highlights. Added in display-linear light it was six to nine times louder in shadows and ink, a spread of 14.9 sRGB levels in ink against 1.8 in highlights, and clipping it there lifted black into grey speckle; in gamma 2 it spreads 2.6 to 3.8 levels across all tones (83db415, measured in headless Chromium). The sum is still clipped at 0, so grain can only brighten black ink, which is why B3's old 0.06 lifted the ink beside Bulwark from 4.3 to 6.3 luma (Film grain, Render defaults) |
| `DEFAULT_STANDARD_BLEND` (materials/painted.ts) | 0.1 | The blend a painted material takes when its creator names none, a prop's; above 0 the material is an actor's and takes the actor fill |
| Soft skin light: `SKIN_BAND_SOFTNESS`, `SKIN_TERMINATOR_NOISE`, `SKIN_STANDARD_BLEND` and `SKIN_PROP_BRUSH` (materials/painted.ts) | 0.35, 0, 0.65 and 0 | Where a mesh's `_skin` weight is 1 (Kit, Face morphs and skin), the band edge softness, the terminator's brush noise, the standard blend and the prop brush lerp toward these by the weight, in the Sifu manner: smooth gradients inside a simple form, never a hard light and dark split down a face. The lines exist only in a material made for a mesh that carries the weight, and each takes its dial exactly at a weight of 0. The softness is a half-width in band units, so at the locked 2 bands the light ramps over ndl from -0.35 to +0.35, and it must stay at or under 0.5, past which the ramp steps at every band's top. The terminator noise is 0 because the locked 0.3 flips whole brush strokes between light and shadow. The blend replaces the material's own (Bulwark's 0.35 is 0.45 at the locked dial), leaning toward smooth light. The prop brush is 0 because the atlas tiles 0.7 times per metre, so one stroke is about twice a head's width: at the locked 1.3 it laid angular light and dark patches across a sphere face's cheek and brow, and turning the head's cast shadow off changed nothing, so the patches were the brush's alone. Measured in the locked look on the RTX 4080 laptop, high tier, 1920 x 1080, on a 0.12 m sphere head 14 m over the clearing seen from 0.75 m, face to the camera, key at 15 degrees: along the face's centre row the largest step between neighbouring pixels is 2.1, 14.9, 7.6, 6.4 and 2.0 luma on the cel face with the key 0, 45, 90, 120 and 150 degrees from the camera, against 0.8, 1.4, 1.0, 1.1 and 1.0 on skin, and over four pixels 8.1, 47.5, 28.6, 22.3 and 6.9 against 0.9, 5.1, 2.9, 2.9 and 2.9; no pixel on skin is a sliver (4 luma or more under its neighbourhood on both sides), and the cel face has one at 45 degrees. With the key at 90 degrees the lit side reads 158 luma and the shadow side 83, the terminator's middle 129. Against the softness and blend pairs 0.25 and 0.55, 0.5 and 0.65, and 0.5 and 0.75, the four-pixel step at 45 degrees reads 7.3, 4.5 and 4.6 against 5.1 here: 0.25 keeps a narrower band and the 0.5 pairs read airbrushed, while 0.35 keeps a soft terminator the eye still finds. In the lines' arithmetic (tests/unit/render/skin-lighting.test.ts), the largest change of linear luminance over 0.04 of ndl on camera-facing skin is 0.344 on the cel bands and 0.029 on skin, it never falls as the face turns toward the key, and the brush moves it by 0.41 on the cel bands and not at all on skin. A skin weight of 0 matches a mesh with no weight bit for bit on the GPU: 0 of 2,073,600 pixels differ with the key at 45, 90 and 150 degrees |
| `FAMILY_STANDARD_BLEND` (assets/familyBlend.ts) | commanders 0.35, xeno 0.3, towers, heart and nests 0.1, env 0 | The blend each manifest family's materials are authored at, which the Style Lab and the Asset World both load with, so an asset lights alike on the two pages: Bulwark's `AUTHORED_CHARACTER_BLEND`, the Husk's 0.3 (Actor fill, Render defaults), a structure's 0.1 (`DEFAULT_STANDARD_BLEND`) and paint alone for the kit, the values the Style Lab loaded each asset with before the table existed. A family the table does not name throws with its name rather than loading as a prop, because a character loaded as a prop would lose the actor fill and nothing on screen would say why |
| `SOIL_EDGE_GAIN` and `SOIL_EDGE_SOFTNESS` (materials/painted.ts) | 2.2 and 0.06 | How far the brush sample moves the soil edge's threshold, in soil weight, and the threshold's half-width. The brush atlas spans 0.29 to 0.71 between its 5th and 95th percentiles, so 2.2 spreads the threshold over the whole of the old soft band where 1 would jitter it by a fifth; 0.06 is about 10 cm of ground on the ring's ramps, a crisp stroke edge at hero distance that still anti-aliases from the strategic camera |
| Hull ink distance scale, `clamp(uDistanceRef / max(-mvPosition.z, 0.001), 0.35, 1.0)` with `uDistanceRef` 25 (ink/hull.ts) | 25 m and 0.35 | The hull ink keeps its full screen width out to 25 m from the camera and beyond that thins in proportion to 25 m over the distance, so far props do not turn to ink blots; the clamp stops the thinning at 0.35 of the full width, reached 71 m out, and the width is then held to the Hull ink width row's 1.2 to 4 px (Render defaults). At the default 2.2 px, on ink authored at width 1, the 1.2 px floor takes over from about 46 m, so the 0.35 clamp shows only on wider ink. Renderer v1's values, from the M0d plan; why 25 m and 0.35 were chosen was not recorded |
| Sky cloud band and threshold, `smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.24, 0.5, h))` and `smoothstep(0.54, 0.6, field * 0.8 + band * 0.35)` (render/sky.ts) | h 0.02 to 0.12 and 0.24 to 0.5; field 0.54 to 0.6 | h is the sine of a direction's elevation above the planet's limb, so the cloud band fades in from about 1 to 7 degrees above the limb and out from about 14 to 30, and the painted cumulus sits low over the horizon. Inside it the brush field, the atlas read at two scales and weighted 0.6 and 0.4, times 0.8, plus 0.35 of the band's own weight, is thresholded over the narrow ramp from 0.54 to 0.6, so the strokes turn into hard-edged masses, and the band term makes cloud form most readily at the band's heart. Without the brush atlas the sky reads a black field, which never reaches the threshold; a grey one lifted the whole band over it into one solid slab (main.ts). Renderer v1's values, from the M0d plan; why these numbers were chosen was not recorded |
| `SUN_DISTANCE` (labs/style/main.ts) | 90 m | The sun rides a sphere of this radius around the scene centre with its target at the centre, so at every elevation the scatter's casters stay past the shadow camera's near plane and the patch's farthest ground inside its far plane: the corner at (80, 80) on the tangent plane is 96.9 m from the scene centre and at most 178.7 m deep in the light's view, under a key near 19.5 degrees. The scatter plan's casters lie 41.3 to 139.2 m deep at every elevation, yaw and azimuth, inside the 1 to 220 m box (tests/unit/labs/shadow-reach.test.ts; 41.4 to 139.1 m at the 72 azimuths and 8 yaws first measured) |
| `SHADOW_HALF_WIDTH`, `SHADOW_CROWN_MARGIN`, `SHADOW_NEAR` and `SHADOW_FAR` (labs/style/main.ts) | the scatter plan's reach (48 m) plus 2 m, so 50 m; and 1 to 220 m | The sun's square shadow box, derived from the scatter plan rather than fitted to the layout today's seed draws, so a reseed or a wider ring cannot put a caster outside it. Near a noon sun the box lies on the ground; under a low sun one axis still runs across it, so the plan's reach sets the box at every elevation. The margin covers a tree at the edge of its ring leaning out with the planet's curve, and its crown at the largest scatter size, and tests/unit/labs/shadow-reach.test.ts holds the box to it: every casting piece of the shipped kit, read from its GLB, at the outer edge of its ring, at 1.25 times its size (`SCATTER_SIZE_MAX`, labs/style/scene.ts), at any yaw, every degree of azimuth and every elevation the dial allows, reaches at most 49.35 m in the light's view (a conifer), and the placeholder kit 49.31 m; the browser measurement the margin was chosen on sampled 72 azimuths and 8 yaws, for 49.24 m, and today's layout reaches 46.4 m (at 85 degrees). The plan's reach of 48 m is its largest ring's radius, a coordinate on the tangent plane, so it is an upper bound on how far a root stands from the scene centre: surfaceAt(48, 0) lands about 46 m out. The old 45 m cut the outermost conifer's shadow at 85 degrees, and the 48 m fitted to today's layout held only the trees this seed placed. At 50 m the high tier's 2048 map has 4.9 cm texels; at the defaults the move from 48 m shifts cast-shadow edges on 0.73 percent of the hero frame's pixels by more than 2 of 255 (0.37 percent by more than 24) |
| `SHADOW_BIAS` and `SHADOW_NORMAL_BIAS` (labs/style/main.ts) | -0.0004 and 0.03 m | A small constant bias and a 3 cm push along the normal keep lit ground free of self-shadowing at the tiers' map sizes. Preset B's strategic crosshatch was tested against them: bias 0 or -0.002, normal bias 0 to 0.3 and PCF radius 0 to 3 each moved its fleck count by under 3 percent |
| Shadow PCF radius, `sun.shadow.radius` (labs/style/main.ts) | 0 | three r186's PCF spreads five taps over the radius and rotates them per pixel with screen-anchored noise, which the painted bands turned into shadow, mid and lit speckle that crawled with the camera (radius 3 measured 6.3 band changes per column across a straight shadow edge, against 2 for a clean edge); at 0 the taps coincide in one hardware-filtered lookup |
| `CYCLE_STRIKE_AT`, `CYCLE_LAP_AT` and `CYCLE_SECONDS` (labs/style/scene.ts) | 3 s, 6 s and 12 s | The Style Lab commander's cycle. Three seconds of idle open it, so a frame taken at the start shows him home; the strike runs from 3 s for his own attack's length (`COMMANDER_ATTACK_SECONDS`, 0.85 s for Pip and Bulwark alike); the idle returns until the lap leaves home at 6 s, over two seconds back in his guard after the longest attack; the lap takes 3.59 s (`RUN_SPEED`, 7 m/s, round a 4 m radius); and the idle from 9.59 s to 12 s is the 2.4 s stretch the high-tier evidence frames are taken in (phases 11.0 to 11.2 s). The lap's start was a bare 6 in the cycle's code until it was named |

### Asset World layout

The Asset World's numbers (Content, Asset World). Positions are metres on the world's view frame: s
to the right as its cameras see it and d away from them, on the plane tangent at the pole, with the
world's centre on the pole.

| Constant | Value | Why |
|---|---|---|
| `WORLD_FACING_DEG` (labs/world/registry.ts) | 145 degrees | The bearing from the world's centre toward every camera, from +x toward +z. The Verdant key's azimuth of 250 degrees puts the sun at bearing 200 on the tangent plane, so each view has the key 55 degrees behind it and to its left: members lit three quarters from the front with their shadow side still partly in view, and the locked 15 degree key's long shadows (Sun elevation, colour and intensity, Render defaults) falling away from the cameras and to the right, behind a member rather than across its neighbour |
| `KIT_ARC_RADIUS` and `KIT_ARC_SPAN_DEG` (labs/world/registry.ts) | 17 m and 96 degrees | The Verdant kit's eight pieces on an arc around the centre on the cameras' side, 4.1 m of arc apart, small flora at the left end and the trees at the right, where their shadows fall off the world. At 14 m, with the towers at -6.5 m, the towers' family label came within 20 px of the arc's labels in the 1920 x 1080 overview; 17 m, with the rows spread, gives them room |
| `TOWER_ROW_DEPTH`, `TOWER_ROW_START`, `TOWER_SPACING` and `NEST_SPOT` (labs/world/registry.ts) | -9 m; marks at s -7.6, -4.4 and -1.2 m, 3.2 m apart; the nest at (4.6, -9) | The Bolt Sentinel's marks, up to 1.96 m across, side by side with at least 1.4 m between plinths, and the 3.2 m nest on the same row to their right |
| `CHARACTER_ROW_DEPTH`, `CHARACTER_SPACING`, `CHARACTER_ROW_GAP`, `COMMANDER_ROW_GAP`, `HUSK_ROW_START`, `PIP_ROW_START` and `BULWARK_ROW_START` (labs/world/registry.ts) | 0; 2.6 m; 4 m and 5 m; the Husk's idle, walk and attack from s -6.4 m, Pip (commander)'s idle, run, face and attack from 2.8 m, Bulwark's idle, run and attack from 15.6 m | The characters stand plumb on and beside the level clearing at the pole (level within 6 m of it), 1.2 m or more apart. Since the owner made Pip the default commander (2026-10-04, Decided) he leads the commanders' zone, first in its order and on the clearing beside the Husk, where Bulwark stood, and Bulwark, the alternate, follows him past the clearing; Pip had stood there in a zone of his own. Pip's row starts 4 m past the Husk's last member and Bulwark's 5 m past Pip's, each row starting from the end of the one before, so the attack member Pip took with his clip (2026-10-04), last in his row so his other members stayed where they were measured, moved Bulwark's row 2.6 m further out, from 13 m to 15.6 m, with nothing to edit; what was measured on the layout before was measured again (the label widths, the sun's box and the ground readings below). The commanders' gap is a metre wider because each commander's row hangs a placard of its own (`FAMILY_LABEL_GAP`): at 4 m, "Pip (commander)" and "Bulwark" overlapped by 2.6 px in a 375 x 667 phone's overview and by 8.8 px at 667 x 375, and at 5 m by none at the nine sizes measured on the GPU (375 x 667 to 2560 x 1440). Past the clearing the ground slopes 3 to 5 degrees; in their opening poses the browser test reads Pip's four -1.69, -1.01, -3.47 and -0.71 cm against the ground (his face member 8 m out on the slope; the recipe build's idle, retargeted from the 2026-10-03 source, opens with a boot 1.7 cm down on the level clearing, where the study export's read -0.04 cm), Bulwark's 0.58, 5.24 (his run, both feet up, now 18 m out) and 0.93 cm, and the Husk's 0.81, 1.91 and -0.04 cm, all inside the characters' allowance. The Husk's row stays where the idle Husk joined it: at s -9 m, past the clearing, the ground under a plumb Husk's 0.8 m foot ring strays 7.9 cm from level, against 2.7 cm at -6.4 m |
| `HEART_ROW_DEPTH`, `HEART_ROW_START` and `HEART_SPACING` (labs/world/registry.ts) | 12.5 m; s -5.4 m on, 3.6 m apart | The hearts' 2.5 m plinths with 1.1 m between them, at the back, where the stage 10 heart's 5.2 m and its long shadow hide nothing. At 10.5 m the heart row's family label met Bulwark's member labels in the overview; 12.5 m clears them |
| `LEAN` (labs/world/registry.ts) | characters 0; towers, hearts and nest 0.8; rocks 0.8; flora 0.2 | place()'s lean toward the ground's normal. The structures' plinths and mounds, 1.9 to 3.2 m across, stand on 1 to 8 degree slopes: plumb, their edges strayed up to 13.5 cm from the ground, and at the Style Lab's tower lean of 0.5 up to 7.6 cm; at 0.8 at most 4.4 cm (the stage 0 heart, where the ground curves under its plinth), tilting none more than 6.1 degrees. The rocks and flora keep the Style Lab's scatter leans (`ROCK_LEAN`, `SCATTER_LEAN`) |
| `THREE_QUARTER_TURN_DEG` (labs/world/registry.ts) | 30 degrees | The characters and towers turn from facing the cameras toward the key's side, so a lit three-quarter face and a barrel's length show instead of a flat front |
| `LIVE_HEART_START_LEVEL` (labs/world/registry.ts) and the fixed stages | 7; stages 0, 5 and 10 | The slider heart opens between the fixed stages, so it reads as a fourth heart and not a copy; the fixed three show the first, middle and last of the eleven stages |
| `HEART_STAGES` (labs/world/layout.ts) | 11 | The heart's stage nodes, one per level 0 to 10 (blender/recipes/heart.py); the panel's slider runs from 0 to `HEART_STAGES - 1` and the heart clamps to them |
| `TURRET_SWEEP_SECONDS` and `TURRET_SWEEP_DEG` (labs/world/layout.ts) | 9 s and 35 degrees each side, a third of a period apart | The tower heads sweep slowly about their rest, so the head, the barrels and their energy read from every side without a target, and out of step so each reads alone |
| `OVERVIEW_PITCH_DEG`, `FAMILY_PITCH_DEG` and `MEMBER_PITCH_DEG` (labs/world/views.ts) | 48, 26 and 18 degrees | The overview looks down far enough that no row hides the one behind it; a family's view low enough to see faces and high enough that the rows in front of a closely fitted zone fall under the frame (at 20 degrees, with the looser sphere fit the page first had, the tower row filled the foot of the characters' frame) |
| `FIT_NDC` and `MIN_FIT_HALF_SIZE` (labs/world/views.ts) | 0.9 of the half-frame; 1.2 m | A view comes as close as keeps every corner of its members' bounds, and the room its labels take, within 0.9 of the frame's middle toward each edge, and centres them: the distance is halved 40 times between 0.05 m and a start of four times the members' half-diagonal (doubled up to 12 times if that does not fit), and the target re-centred twice. A sphere fitted around the whole world left it in the middle 40 percent of a 1920 x 1080 frame. In the overview and a family's view, points closer together than 1.2 m to each side are framed as if they spread that far, so a zone of small pieces is seen with meadow around it; a member's own view has its own, smaller floor (`MEMBER_MIN_FIT_HALF_SIZE`). The page's points and fit are views.ts's viewPoints and frameView, which the unit test drives: every member's own view stands within 1.3 times the distance of a fit to its bounds alone at the same 0.5 m floor, at 375 x 667 and 1920 x 1080 (in the browser, on the shipped assets, 0.99 to 1.02, and the nest, framed with its placard, 1.11 on a 1920 x 1080 screen and 0.97 on a phone). Framing the family's placard as well stood an end-of-row member back until its zone fitted: the flowers 3.90 times as far on a phone (29.1 m against 7.5 m) and 2.15 times on a 1920 x 1080 screen, both at the 1.2 m floor member views then had |
| `MEMBER_MIN_FIT_HALF_SIZE` (labs/world/views.ts) | 0.5 m | A member's own view frames points closer together than 0.5 m to each side as if they spread that far, a metre's cube just larger than the two smallest members, the flowers (0.4 by 0.45 m) and the grass tuft (0.45 by 0.68 m), so each is studied close with a little meadow around it. At the family views' 1.2 m, the flowers filled 0.07 by 0.14 of a 1920 x 1080 frame from 4.36 m, and 16 of the 22 members stood at that same 4.36 m however small each was; at 0.5 m the flowers fill 0.17 by 0.34 from 1.82 m (on a 375 x 667 phone 0.31 by 0.20 from 3.11 m, against 0.13 by 0.08 from 7.45 m), the grass tuft 0.22 by 0.48, and every member larger than the cube comes as close as its own bounds and label allow (on the 1920 x 1080 screen the idle Husk from 2.50 m and Mark II from 3.00 m, both 4.36 m before; measured on the GPU). A member whose own size already set its distance at 1.2 m keeps it (on that screen the two trees, the heart's stages 5 and 10 and the slider heart), and the overview and family views keep 1.2 m |
| `FAMILY_LABEL_GAP`, `MEMBER_LABEL_ROOM_PX`, `FOCUSED_MEMBER_LABEL_ROOM_PX` and `FAMILY_LABEL_ROOM_PX` (labs/world/views.ts); `LABEL_AXIS_RADIUS` and `LABEL_AXIS_LINES` (labs/world/layout.ts) | 0.8 m; 36, 52 and 56 px; 0.3 m and 8 lines | A family's label hangs like a placard from the ground 0.8 m in front of its zone, so a family's name never meets its members' names (the commanders' zone, which holds two characters, hangs one under each commander's row, "Pip (commander)" and "Bulwark", in one line in front of the whole zone, and each of its members' second lines names his commander), and a member's stands on its body's top: the highest point where its drawn surface crosses the up line through its root or one of 8 lines 0.3 m around it, with no lift in metres, because the tail stands it off by the same few pixels at every distance. Standing 0.15 m over the highest point of all, Bulwark's labels rose 0.5 m over his helmet on his upright sword and Mark III's 0.3 m, and in a close view they sat on the assets behind ("Mark II" on a Husk, "Idle" on a heart); the surface is crossed, not its vertices sampled, because a low-poly box has vertices only at its corners. In a member's own view its label adds its family's name as a second line, and no placard shows. A view keeps the room each takes inside its frame: in the browser a member label and tail take 33.5 px (30.2 px on phones), with its family line 49.1 px (45.8 px), and a placard 54.3 px (33.3 px). The browser test reads the two-line label's room over Mark II in its own view on both sides of the phone line, at 480 and 800 px wide, and holds each to 52 px |
| Label sizes (labs/world/world.css) | family 18 px (15 px on phones), its family key 12 px (hidden on phones), member 13 px (12 px on phones), a member's family line in its own view 12 px, tail 10 px (8 px on phones) | Readable on a 375 px phone at the 12 px the Style Lab's phone chips use, in Barlow Condensed for the family names and Inter for the rest (Interface and HUD) |
| `MOVE_PX` (labs/world/labels.ts) | 0.05 px | A label's transform is written again only when its point moves this far, half the 0.1 px step the transform is written in, so frames under a still camera write no styles and build no strings |
| `OVERVIEW_MEMBER_LABELS_MIN_WIDTH` (labs/world/views.ts) | 1680 px | The overview names every member only on a screen at least this wide; narrower, the 25 member labels (26 members, but the nest, its family's only member, has none) crowd each other, so the overview names the six zones on their seven placards (the commanders' one per commander) and each zone's view names its members. Measured on the GPU with every member label forced on, after Pip's attack member moved Bulwark's row out and so widened the overview's fit: at 1280 x 720 seven pairs overlapped (the Worldheart's placard over the Husk's "Attack" and Pip's "Idle", "Bolt Sentinel" over "Bush", "Nest" over "Rock B", the Husk's "Walk" over his "Attack", Pip's "Face" over his "Attack" and the hearts' "Stage 10" over "Stage 7 (slider)"), at 1366 x 768 five, at 1440 x 900 and 1600 x 900 one ("Stage 10" over "Stage 7 (slider)" by 0.6 px), and at 1680 x 1050, 1920 x 1080 and 2560 x 1440 none; at 16:9 the same width, 1680 x 945, also has none, as does 1760 x 990 (2026-10-05), so the threshold holds at either shape; 1680 is the narrowest screen measured without an overlap. It was 1280 px, set when the first member labels were laid out, and 1600 px from the layout with Pip the default and three members, measured at 1280 x 720 (six pairs), 1366 x 768 (five) and 1920 x 1080 and 2560 x 1440 (none) |
| `FAMILY_MEMBER_LABELS_MIN_WIDTH` (labs/world/views.ts) | the Verdant kit's view 1024 px, the commanders' 640 px; no other family | A family's view names its members only on a screen at least this wide; narrower, it names the family alone, as the overview does, and each member names itself in its own view and in the panel's member list. The kit's eight pieces stand 4.1 m apart on an arc 25 m across, which a portrait phone fits into its width: measured on the GPU, at 375 x 667 six pairs of their labels overlapped and "Flowers" ran 9.7 px off the left edge (five pairs and 8.9 px at 390 x 844), one pair still overlapped at 667 x 375 and at 768 x 1024, and none at 1024 x 768, 1280 x 720, 1366 x 768 or 1920 x 1080, where the view is unchanged. The commanders' zone has held seven members across 18 m since Pip's attack joined it (six, which named themselves without an overlap at every size measured, before): measured on the GPU with its labels forced on, at 375 x 667 two pairs overlapped (Pip's "Face" and "Attack" by 3.0 px, Bulwark's "Run" and "Attack" by 1.2 px) and at 390 x 844 one (1.3 px), and none at 667 x 375 or the nine larger sizes measured up to 2560 x 1440, so it takes the characters' 640 px. The Husk's view names its three members without an overlap at all twelve sizes |
| `CHARACTERS_MEMBER_LABELS_MIN_WIDTH` (labs/world/views.ts) | 640 px | The characters' view names its members only on a screen at least this wide; narrower, it names the Husk's and the commanders' placards alone. It frames the whole character row, 27.2 m from the idle Husk to Bulwark's attack since Pip's attack member joined his row (24.6 m before, when six pairs overlapped at the same two sizes): measured on the GPU with every member label forced on, at 375 x 667 and 390 x 844 seven pairs of member labels overlapped (neighbours in each of the three rows) and Bulwark's "Attack" ran 1.1 px off the right edge at 375 x 667, and at 667 x 375 and the nine larger sizes measured none. 640 lies between the widest screen that overlapped and the narrowest that did not |
| `TURNTABLE_SECONDS` (labs/world/main.ts) | 40 s a turn | The turntable turns slowly enough to study a silhouette as it passes, OrbitControls' autoRotateSpeed of 60 / 40 at the frame's own seconds |
| `TRANSITION_SECONDS` (labs/world/main.ts) | 0.8 s, easing out | A view chosen in the panel glides there, starting at once and settling softly; reduced motion, the address and the test handle jump |
| `MAX_ANIMATION_SPEED` (labs/world/panel.ts) | 2, in steps of 0.05 | The speed dial runs the clips and sweeps from paused to twice their authored speed; below 1 is where a strike frame is studied |
| `PLAY_WALK_SPEED` and `PLAY_SPRINT_SPEED` (labs/world/playMotion.ts) | 3.2 and 5.6 m/s along the ground | Play Pip (prototype)'s paces for a 1.78 m character with one run clip and no walk: the Commander table's walk speed with a key held, and a fast run with Shift. The run clip is measured in the page (`PLAY_STRIDE_SAMPLES`): Pip's covers 2.70 m in its 0.70 s loop (the study export's and the recipe build's alike), 3.86 m/s at its authored rate, so it plays at 0.83 at the walk pace and 1.45 at the sprint, near enough its own speed that the planted foot keeps pace with the ground. The Commander table's 7 and 10 m/s would play it at 1.8 and 2.6 times, a scramble; they wait for M1's clips |
| `PLAY_SECONDS_TO_WALK`, `PLAY_SECONDS_TO_STOP` and `PLAY_TURN_RATE_DEG` (labs/world/playMotion.ts) | 0.18 s, 0.12 s and 540 degrees a second | The Commander table's times to speed and to a stop, as rates from the walk pace, and a turn cap under which a half turn takes a third of a second, easing rather than snapping. He runs along his own facing at the share of the pace asked that his facing points the way asked, so a reversal turns him on the spot rather than sliding him backward |
| `PLAY_BODY_RADIUS` and `PLAY_MIN_MEMBER_REACH` (labs/world/playMotion.ts) | 0.35 m; 0.2 m | He cannot come within a member's reach of its root: the farthest face of its bounds from the root across the ground, at least 0.2 m, widened by his own 0.35 m. A step into a reach is pushed straight out from the root, so he slides round a member instead of stopping dead. Held head on, his ground speed, and so the run clip, falls to nothing while the pace he drives at does not: fed back into the drive, the held-back speed restarted every frame's ease and crawled him along a wall |
| `PLAY_AREA_RADIUS` (labs/world/playMotion.ts) | 23 m on the tangent plane | Inside the world sun's shadow box, which reaches 27.8 m to each side of the pole across the sun's bearing (`WORLD_SHADOW_HALF_WIDTH`; 25.2 m before Pip's attack member moved Bulwark's row out), 4.45 m past his shoulders at the edge, and much further along it, where the 15 degree key lays the ground nearly flat in the light's view: past it he would run out of his own shadow. It leaves 4 m of meadow past the kit arc's trees, and the relief (fading from 50 m) and the rim (64 to 71.5 m) are far beyond; he slides along the edge rather than stopping at it. Steps are turned from ground metres to the tangent plane (1 / cos squared of the angle from the pole outward, 1 / cos across), without which he would run 2 percent slow outward at the edge, 6 percent at 40 m |
| `PLAY_RUN_FULL_WEIGHT_SPEED` (labs/world/playMotion.ts) | 1.2 m/s | The idle and the run crossfade by ground speed, the run's weight rising from 0 standing to 1 at 1.2 m/s, which the walk pace's ease reaches in under 0.07 s, while the run's rate follows the ground speed |
| `PLAY_SPAWN` (labs/world/playMotion.ts) | (4.1, -3.5), facing the cameras turned 30 degrees toward the key | 3.5 m in front of Pip (commander)'s row, midway between his idle and run members, 3.7 m from each, on the level clearing, turned like the placed characters (`THREE_QUARTER_TURN_DEG`) so the opening frame shows him three-quarters on with his row behind him. It was (13.3, -3.5), in front of the row he had past the clearing, and moved with his row; there it would have stood in front of Bulwark's. In the browser he comes out 2.38 m outside the nearest member's reach, read from the drawn bounds (`clearance` in labs/world/playMotion.ts); it was 2.41 m with the study export's bounds |
| `PLAY_CONTACT_TOLERANCE` and `PLAY_STRIDE_SAMPLES` (labs/world/playMotion.ts, play.ts) | 3 cm; 64 moments a loop | The run clip's ground speed is read from its feet (each foot's toe base in the rig's own frame at 64 even moments of a loop): a planted foot slides back under the in-place body as fast as the ground would pass, so the median backward speed of each foot while within 3 cm of its lowest point is the clip's speed. A new export's stride is picked up without a number to update |
| `PLAY_STICK_DEAD_ZONE` and `PLAY_STICK_SPRINT` (labs/world/playMotion.ts); the pad's size (labs/world/world.css) | 0.15 and 0.9 of the pad's reach; a 140 px pad with a 1 px border and a 60 px knob, so a 39 px reach (playInput.ts reads it from the pad's clientWidth, 138 px inside the border, less the knob, halved), 24 px in from the left and 56 px up (16 px in and above the frame interval chip on phones) | A thumb resting near the pad's centre moves nothing, the pace rises from the dead zone's edge rather than jumping to 15 percent, and a push to the rim sprints, the touch screen's Shift. 140 px sits under an adult thumb, and the pad shows only while playing on a coarse pointer, over the look chip, which it hides then |
| Play Pip's attack triggers (labs/world/playInput.ts) and the Attack button (labs/world/world.css) | F, or a left mouse click on the canvas; on a coarse pointer an 88 px round button labelled "Attack", 24 px in from the right and level with the pad's centre (16 px in on phones), which also answers Enter, Space and a screen reader's activation | F sits beside WASD under the left hand, and a click is the mouse's natural swing; a touch on the canvas still orbits, so the touch screen's trigger is a button for the other thumb, twice the 44 px least target, shown and hidden with the pad. The button swings on its pointerdown, and on a click that no pointerdown came before, which is how Enter, Space and TalkBack's double tap arrive: listening to the pointer alone, it did nothing for them (2026-10-05). A tap's own click follows its pointerdown and is left alone, so one tap is one swing; the click's detail told the two apart at first (0 for a keyboard's click), but an assistive technology may click with a detail of 1 and no press, and that did nothing. Keys typed into the panel's fields, keys held with Ctrl, Cmd or Alt, and an F held past its first keydown swing nothing, as the move keys already behave |
| `PLAY_CLICK_SLOP_PX` and `PLAY_CLICK_MAX_SECONDS` (labs/world/playMotion.ts) | under 5 px of movement, lifted within 0.25 s | A left drag on the canvas is OrbitControls' orbit, so a press counts as a click only if it stays put and lifts quickly: 5 px turns the orbit by 1.7 degrees on a 1080 px tall canvas, too little to read as a drag, and 0.25 s holds an ordinary click of about 0.1 s with room to spare |
| `PLAY_ATTACK_MOVE_SCALE` (labs/world/playMotion.ts) | 0: he stops dead for the swing and keeps his facing | The cleave plants both boots (the recipe holds them by IK on every frame), so any pace under it would slide them; the frame that starts the swing zeroes his drive and speed (`startSwing`), so the stop is a committed plant, and a direction asked mid-swing neither moves nor turns him, because the swing is committed (Pillar 4). He used to shed his pace at the stop rate (`PLAY_SECONDS_TO_STOP`), 0.12 s from a walk and 0.21 s from a sprint, while the clip reached full weight in 0.07 s, so he slid about 0.19 m and 0.59 m under planted boots (2026-10-05). Out of the swing the held key turns and runs him again |
| `PLAY_ATTACK_FADE_IN` and `PLAY_ATTACK_FADE_OUT` (labs/world/playMotion.ts) | 0.07 s and 0.2 s, the fade out ending one frame before the clip; one swing per trigger, a trigger mid-swing or on a frozen frame dropped | The clip takes over from the idle and run in a fifth of the 0.34 s wind-up, so the wind-up reads from its first frames, and hands back over its last 0.2 s, the recovery's return to the guard, taking its weight from the idle and run alike so he settles into whichever his speed asks for. The run keeps the weight it had while the swing fades in (`blendRunWeight`): his speed drops to 0 on the swing's first frame, and following it there dropped the run to 0 at once and showed 76 percent idle at 60 fps (29 percent at 20 fps) under the swing's first frame, where the held run, its rate 0 at his zero speed, stands still until the swing covers it. The fade out ends one frame early (the frame's step short of the clip's end), since the swing ends on the frame that reaches the end: ending there left the last swing frame up to a step's share of the fade, a quarter at SwiftShader's 0.05 s, which vanished in one frame. A frozen frame keeps the weight it had. The clip's time and the strike moment (0.34 s, timings.json) come from one clock in pure playMotion.ts, unit tested. A trigger during a swing is dropped, not buffered: the prototype has no input buffer, which the M1 controller's buffers (Decided) will bring; so is one on a frozen frame, which used to wait at the swing's first frame and play on unfreezing |
| `PLAY_CAMERA_DISTANCE`, `PLAY_CAMERA_PITCH_DEG`, `PLAY_CAMERA_MIN_DISTANCE`, `PLAY_CAMERA_MAX_DISTANCE`, `PLAY_CAMERA_MAX_POLAR_DEG`, `PLAY_TARGET_HEIGHT` and `PLAY_FOLLOW_RATE` (labs/world/play.ts) | 5.5 m at 16 degrees; 2.5 to 16 m; no lower than 84 degrees from straight down; his chest 1.1 m up; 10 a second | The follow camera opens on the world cameras' bearing from him, near enough that his 1.78 m fills about a third of the frame's height with the world behind him. The orbit's centre closes on his chest at 10 a second (63 percent of the gap in 0.1 s) and the camera moves with it, so a drag orbits and the wheel zooms about him between 2.5 and 16 m, never below his chest's level; panning is off, since the follow would carry a pan's offset for good. The view glides, the turntable and the view and member choices wait while he plays |
| The play browser test (tests/e2e/asset-world.spec.ts) | out clear of every reach; 0.5 m moved; within 1 mm of the ground; the camera's centre followed 0.1 m; one swing for one F with S held, the clip within a 30 fps frame of 0.85 s, at full weight at its strike, standing still and unturned from its first frame, then running again; one swing for a click at the canvas centre held 50 ms (`CLICK_HOLD_MS`), read back within 1 ms and seen within five frames (`SWING_SHOWS_WITHIN_FRAMES`); none for a 40 px drag, which moves the camera more than 5 cm; on a touch phone the Attack button shown and one swing for one tap | `?play=pip` puts him out outside every member's reach (his clearance above 0, so a re-laid world cannot spawn him inside a member), and W held until he has covered half a metre (SwiftShader's frames each move him at most 1/20 s) leaves him on surfaceAt at his tangent point and the camera's centre moved with him. Then F with S held, which turns him back over the open clearing toward the cameras, more than 10 m clear, so the run after the swing does not hang on the room the walk left him: a recorder in the page reads every frame, since reads from the test once let the whole 0.83 s swing pass between two of them, and F is dispatched in the call that starts it, so the swing starts from the state recorded rather than a round trip later with him running on toward what stands ahead (the line logs his clearance before and after). The swing reaches its 0.34 s strike at weight 1, his speed is 0 from its first frame to its end and his yaw unchanged, after which he runs on under the key; the clip's length is held within 1/30 s of the contract, the tolerance assets:check uses, where `toBeCloseTo(0.85, 1)` let it be 0.05 s off. The swing's first frame keeps the run weight of the frame before (the page caps a frame's step at 1/20 s, inside the 0.07 s fade in). The same recorder holds a click at the canvas centre to one swing and one strike. Its press and release go through the DevTools protocol with timestamps 50 ms apart, a fifth of the 0.25 s a click may take, which the page's event times carry (it reads the hold back within 1 ms, and a release sent 402 ms late still read 50.000 ms): `page.mouse.click` sends the release only once the press is acknowledged, which SwiftShader's busy main thread can hold past 0.25 s, so the click read as a held press and the wait for a swing ran out its minute. A click that starts no swing within five frames of the release fails at once with the hold the page read; the page's next frame takes the attack, so five leave room and cost a quarter second at 20 frames a second. A press, a 40 px move and a release start no swing over the same five frames and move the camera more than 5 cm: the drag asks for a 53 degree orbit on the 270 px tall canvas, metres of travel, while he stands and gives the follow nothing to carry. On the 375 x 667 touch phone, one `tap()` of the visible Attack button gives one swing |
| `WORLD_SUN_DISTANCE`, `WORLD_SHADOW_NEAR`, `WORLD_SHADOW_FAR`, `WORLD_SHADOW_BIAS` and `WORLD_SHADOW_NORMAL_BIAS` (labs/world/sun.ts) | 90 m, 1 to 220 m, -0.0004 and 0.03 m, PCF radius 0 | The Style Lab's sun (Render constants), whose reasons hold here: every point of every member lies within 27.8 m of the centre (`WORLD_SHADOW_HALF_WIDTH`, the furthest root plus the caster margin; 25.2 m before Pip's attack member moved Bulwark's row out), so at least 62 m from the light at 90 m, far past the near plane, and the patch's farthest corner, 96.9 m out, inside the far plane |
| `WORLD_CASTER_MARGIN` and `WORLD_SHADOW_HALF_WIDTH` (labs/world/sun.ts) | 7 m; the furthest root, Bulwark's attack member 20.8 m out, plus 7, so 27.8 m | A member's point lies at most its root's distance, plus its footprint's half-width, plus its height from the centre, and the largest of each in the manifest are the broad tree's 1.71 m and the stage 10 heart's 5.19 m (measured from the GLBs), 6.9 m rounded up; Pip's swing reaches 1.12 m out at its strike on a 1.78 m body, well inside. The high tier's 2048 map then has 2.7 cm texels (2.71 cm; 2.46 cm in the 25.2 m box while Bulwark's attack stood 18.2 m out, 2.4 cm while Pip's face member stood furthest, 17.2 m out, and 2.3 cm before his row set the reach past the kit arc's 17 m), against the Style Lab's 4.9 cm. The width follows the layout through `WORLD_REACH`; these figures were measured again when Pip's attack member moved Bulwark's row out |
| The browser test's ground allowances (`CONTRACT_M`, `STRUCTURE_STRAY_M`, `KIT_STRAY_M`, `CLIP_FLOAT_M` and `CLIP_SINK_M` in tests/e2e/asset-world.spec.ts) | 5 mm, plus 4.4 cm either way for the structures and 2.5 cm for the kit; for the characters 5.5 cm above the ground and 1 cm below it | Each member's lowest drawn point, along the planet's up at its spot (`PlacedMember.lowest`, measured with its bounds), against the ground on the planet's radius through it, less its designed sink. The bounds' lowest corner cannot stand for it: the planet's curve tilts a member 17 m out by 6 degrees, which alone put rock B's bounds 14 cm under its root. The Kit's 5 mm contract, then the structures' lean stray (`LEAN`; Mark III reads 4.1 cm), the kit's rocks and flora leaning on the arc's slopes as the Style Lab's scatter does (rock A reads 2.3 cm), and the characters' plumb opening poses rather than the bind pose the contract measures, held to each side apart. A character's float may reach 5.5 cm (a 6.0 cm limit with the contract): Bulwark's run opens with both feet up, 3.8 cm on the clearing, 3.2 cm at 15.6 m and 5.24 cm at 18 m, where Pip's attack member moved it and the ground falls away under his stance. Its sink may reach 1 cm (a 1.5 cm limit): the deepest reads 0.71 cm, Pip's attack member standing plumb on the slope at 10.6 m. Pip's idle read 1.69 cm down and his face member 3.47 cm until his recipe's ground pass (his idle's sword tip was in the ground, Kit), and one 5.5 cm allowance for both sides, checked on the reading's size alone, had passed both (2026-10-05). Both limits stay far under the 15 to 26 cm by which misplaced roots once sank. Every read is the same on every load, since the layout, the ground and the opening poses are fixed |
| The Style Lab's frame (labs/world/main.ts) | a 50 degree lens from 0.1 to 2500 m, orbit to 400 m; the scene's step clamped to 1/20 s; the frame interval a 0.95 running average, shown every 30 frames; ready at frame 3; flat textures of 128 (materials) and 0 (sky) | Taken as the Style Lab has them, so the two pages measure and draw alike |

### Face driver

The labs' face for a commander (`src/labs/shared/faceDriver.ts`): render and lab code, driven by the lab's frame
delta, outside the simulation. It blinks both lids together (`blink_L`, `blink_R`), holds `smile`, `brows_up` and
`pucker` at weights from 0 to 1 set for a demo, opens the `jaw` bone if the rig has one, and holds the face while the
lab is frozen. The hull ink shares the body's morph influences, so the ink closes with the lid (Kit, Face morphs and
skin).

| Constant | Value | Why |
|---|---|---|
| `BLINK_INTERVAL_MIN_SECONDS` and `BLINK_INTERVAL_MAX_SECONDS` | 2.5 to 5 s, drawn evenly from an injected random source (`seededFaceRandom` for a seed) | People at rest blink every few seconds; a drawn wait never settles into a metronome, and a slower rate reads as a stare on a face this close to the camera. The unit test holds every wait inside the range at 60 fps and at the labs' slowest step of 1/20 s |
| `BLINK_CLOSE_SECONDS` and `BLINK_OPEN_SECONDS` | 0.06 and 0.09 s, 150 ms in all, each eased by a smoothstep | A lid closes faster than it opens, and 150 ms sits inside a real blink's 100 to 400 ms. A long frame delta runs through every phase it spans, so one 10 s step and a thousand 10 ms steps land on the same lid |
| `DOUBLE_BLINK_CHANCE` and `DOUBLE_BLINK_GAP_SECONDS` | 0.2 and 0.1 s | One blink in five comes twice, 100 ms apart, which reads as life rather than a timer; the second of a pair is never followed by a third |
| `JAW_OPEN_MAX_DEG` and `JAW_BONE_NAME` | 14 degrees about the jaw axis (the bone's own x unless the lab names another), from the bone's rest pose; `jaw` | A mouth open to speak, not a yawn; the commander's rig decides the axis, which the lab passes once the asset arrives. A lab updates the driver after its animation mixer, which would otherwise overwrite the morphs and the jaw with any track its clips carry. Pip's CharForge rig names its jaw `jaw` with no prefix (its other bones carry `mixamorig:`), and his idle, run and attack key it at its rest (0 degrees off it in every key of the recipe build) |
| Jaw axis (`jawAxisOf`, labs/shared/commanderFace.ts) | the character's +X in the jaw bone's frame, read from the rig in its bind pose; Pip's is (0.9625, -0.0924, -0.2551), in the study export and the recipe build alike | Pip's jaw bone is turned about 130 degrees from his head and its own x runs 15.7 degrees off the character's, so about its own x the chin swings sideways as it drops. About the character's left-right axis the chin drops and draws back: the unit test, on the shipped GLB through GLTFLoader, reads a chin point 10 cm down the bone moving under 0.1 mm sideways at a full jaw, and over 1 mm about the bone's own x |
| `FACE_SEED` (labs/shared/commanderFace.ts) | 1, and each further commander instance on a page the next seed | Every face blinks on its own seeded timing, so the Asset World's four Pip (commander) members, and Play Pip's own instance after them, never blink in step and every load blinks alike |
| `FACE_DEMO_STEPS`, `FACE_DEMO_HOLD_SECONDS` and `FACE_DEMO_BLEND_SECONDS` (labs/shared/commanderFace.ts) | neutral, smile, brows up, then neutral again; each held 2 s and eased into the next over 0.4 s, at full weight, a 7.2 s cycle | The Asset World's `pip_face` shows each held expression long enough to study under the blinks, which run on through it, and opens on neutral, so a frozen frame shows the rest face |
| Blink hold (`FaceDriver.setBlinkHold`) | lids held at a weight from 0 to 1, or handed back to the auto-blink | A frozen evidence frame of a closed lid; the auto-blink keeps its timing underneath, and the labs' `setFace` handles hold a whole pose this way |

## Content: planets and families

Every family has an inspection view that shows all of it at once and can open any one member,
reachable by URL. Once a milestone's assets are built, its entries in these tables must equal
`public/assets/manifest.json` (Kit).

### Planet themes

| Theme | Ground palette | Key light | Shadow tint | Signature landform | Boss affinity | Milestone |
|---|---|---|---|---|---|---|
| Verdant Highlands | jade meadow, moss, warm grey stone | amber, 35 degrees | teal | ranges with passes, rivers | Colossus | M0 style scene, M2 |
| Dune Sea | ochre and cream sand, rust rock | white-gold, 60 degrees | lilac | dune fields, buttes, dry canyons | Wyrm | M2 |
| Glacier Reach | blue-white ice, slate | rose-gold, 12 degrees | ultramarine | glaciers, ice bridges, crevasses | Titan | M2 |
| Ember Rift | basalt charcoal, ash, orange magma veins | red-gold, 25 degrees | violet | calderas, lava channels, fissures | Colossus or Titan | M2 |
| Tidal Archipelago | turquoise shallows, pale sand, green islands | noon white, 70 degrees | deep ultramarine | islands, atolls, sea stacks | Leviathan | M2 |
| Amber Steppe | golden grass, rust maples, cream rock | late-afternoon orange, 20 degrees | cool blue | rolling hills, escarpments | Matriarch | M2 |

Planned for M8, bringing the count to 12 or more: Ashen Moon (airless, black sky), Storm Plateau,
Mire Hollows, Karst Jungle, Aurora Tundra, and Shattered Reach (floating rock platforms, v3's space
battlefield as a planet type). v3's ten terrain packs (Mixed Landscapes, Giant Peaks, Deep Canyons,
Ocean World, Badlands, Karst Labyrinth, Geothermal Fields, Glacial Frontiers, Windlands, Sky Reaches)
combine with themes. Inspection view: **Planet Lab** (`/labs/planets.html?theme=&pack=&seed=`), with
Play this seed.

### Towers and specializations

| Tower | Verb | Specialization A | Specialization B |
|---|---|---|---|
| Bolt Sentinel | rapid single-target rails, hits air | Rail Lance: rails pierce in a line | Flak Crown: bursts shred flyers and groups |
| Cryo Bloom | slowing aura, ground and air | Stasis Bloom: periodic full freeze pulses | Brittle Bloom: frosted enemies take more damage |
| Mortar Bastion | lobbed splash, ground only | Siege Battery: a three-shell barrage | Cinder Pit: craters burn |
| Arc Spire | charged chain lightning with a stun | Storm Crown: more chains | Thunder Maul: one heavy bolt, long stun |
| Helios Lance | beam that ramps on one target | Prism Array: the beam splits to three | Sun Needle: ramps to 5x on one target |
| Warden Barracks | summons wardens who hold ground | Phalanx Hall: more, tougher wardens | Vanguard Lodge: fewer elite hunters |

Inspection view: **Asset World** (`/labs/world.html?family=towers`, one mark with
`?member=bolt_mk2`): every built mark side by side, in the overview, the family's view and each
mark's own view. The specializations join it when they are built, with presets at first-person,
third-person and strategic distance.

### Xeno species and evolutions

Mite, Husk, Aegis and Wisp (v3), each with four evolution overlays (armour, speed, shield, split).
Inspection view: Asset World (`/labs/world.html?family=xeno`, one clip with `?member=husk_attack`),
with every animation playable.

### Commanders and allies

Bulwark, Twinfang, Longsight, Kettle and Emberline (v3), on one shared skeleton; the Warden. From
M1 the commanders take the owner's CharForge style, as its Bo and Pip show
(https://majieddd.github.io/charforge/): about 4.5 to 5 heads tall, oversized hands and feet, slim
limbs and chunky rounded volumes, with a visible cartoon face (painted features, blink and jaw shape
keys). M0's Bulwark stays the visored knight the style gate locked on. Pip (commander)
(`commander_pip`), built by `blender/recipes/commander_pip.py` and `blender/lib/charforge.py` from the
owner's CharForge Pip (`blender/sources/charforge/pip.glb`, the 2026-10-03 publication), is the M1
preview of the rebuild, with idle, run and a shield-and-sword cleave, and, by the owner's decision of
2026-10-04, the default commander, with Bulwark the alternate; the owner has not named the character
yet, so the labs call him "Pip (commander)". Inspection view: Asset World
(`/labs/world.html?family=commanders`, Pip (commander) first and Bulwark after him, his face with
`?member=pip_face`, his attack with `?member=pip_attack`, one of Bulwark's clips with
`?member=bulwark_run`, and Play Pip with `?play=pip`), the Style Lab, which opens on Pip
(`?commander=bulwark` for Bulwark), and
the M1 test course (`/labs/course.html`).

### Weapons

| Axis | Members | Rationale |
|---|---|---|
| Families | Sword, Spear, Twinblade, Carbine, Lobber, Scepter | v3's six; three melee, three ranged or channelled |
| Manufacturers | Anvil (forged steel, slow and brutal, knockback), Filament (precise tech, crits and reach, cyan filaments), Hollow (Xeno salvage in bone-white chitin rewired in cyan, life steal), Kiln (ancient fired stone and bronze, echo strikes and ricochets) | Four identities you can read from silhouette alone, as Borderlands does |
| Part slots | head or barrel, core, grip, guard or stock, charm or sight | Five slots give variety without a parts inventory |
| Rarity materials | Common wood, Uncommon iron, Rare gold, Epic diamond, Relic onyx | v3 mapping; material instead of a colour avoids clashing with cyan, gold and magenta |
| Elements | Ember (burns 3 s), Frost (slows 2 s), Arc (chains and stuns), Shatter (breaks armour) | v3 burn and frost timings; magenta stays reserved for the Xeno |
| Eras | Ancient on planets 1 to 33, Tech on 34 to 66, Empowered on 67 to 99 | v3 |

Naming grammar: an adjective from the defining part or element plus the family noun (Searing
Carbine), with the manufacturer shown as a badge; each Relic has its own two-word name. Inspection
view: **Weapon Forge** (`/labs/forge.html?family=&maker=&rarity=&seed=`).

### Planet bosses

| Archetype | Body plan | Signature attacks | Theme affinity |
|---|---|---|---|
| Colossus | a giant walker | stomp shockwaves, sweeping arm, thrown boulders | Verdant Highlands, Ember Rift |
| Wyrm | a burrowing serpent | erupting lunge, tail sweep, sand or lava spray | Dune Sea |
| Leviathan | a sky or sea giant | diving pass, barrage from above, tidal slam | Tidal Archipelago |
| Matriarch | a hive mother | summons broods, acid pools, spawning nests | Amber Steppe |
| Titan | a crystal or stone golem | ground beams, shield phases, crystal spikes | Glacier Reach, Ember Rift |

Each boss is an archetype, the planet's element, four to six attack modules from its archetype's
library, and two or three phases. Naming grammar: a theme word plus the archetype (Rime Titan,
Cinder Wyrm). Inspection view: **Boss Lab** (`/labs/bosses.html?theme=&archetype=&seed=`).

### Structures, mounts and disasters

Structures: Outpost Ruin, Crashed Lander, Ancient Shrine, Dead Hive (v3 had four families). Mounts:
Ridge Strider, Tideback, Sky Ray (v3). Disasters: Tornado, Quake, Lightning Storm, Tsunami,
Eruption, Radiation Storm (v3), plus Blizzard and Sandstorm as theme weather. Inspection views: Asset
World for structures and mounts (`/labs/world.html?family=` and `?member=`, once their families are
built); Planet Lab's disaster trigger for disasters.

### Style

Inspection view: **Style Lab** (`/labs/style.html`), the style scene with live dials, the reference
board, and the colour audit. Its commander is Pip (commander), the default since the owner's decision
of 2026-10-04 (Decided), built as `commander_pip`: he loads with the other models, so the first frame and
its colour audit show him with no swap, blinking on his own timing, in the commander's cycle, where he
strikes with his own attack clip for his own length (`COMMANDER_ATTACK_SECONDS` in labs/style/scene.ts,
from src/shared/timings.json), as Bulwark strikes with his; a commander without an attack clip holds his
idle there. `?commander=pip` names him too.
Bulwark, the visored knight the look was locked on, is the alternate: the panel's commander control or
`?commander=bulwark` shows him, and a lab opened on him loads nothing of Pip until the panel switches.
An unknown `?commander=` name shows Pip and names itself once in the console and the banner, and a build
whose manifest lacks Pip shows Bulwark and says so. So does a Pip whose model fails to load, a missing or
corrupt GLB: the lab logs one console error, shows Bulwark and says "Pip (commander) failed to load;
showing Bulwark.", at the start and on a switch alike, and keeps running. One load of Pip serves the
opening and every switch, only the latest choice in the panel is shown however late his load comes in,
and leaving him hands a held face pose back to his blink. Opened on Bulwark, the lab draws the look as it was
locked: the colour audit reads the lock's figures to the digit (Render defaults), and his evidence
frames match the lock's but for the moving Husk, turrets and commander (Where we are, 2026-10-04).

### Asset World

Inspection view for every built asset family: **Asset World** (`/labs/world.html`). It lays out
every model the manifest lists, and every placeable in it, in labelled zones on the Style Lab's
painted patch, in the locked Painted-Anime-Inkline 4.0 defaults (`DEFAULT_DIALS`, Render defaults),
or in the look a `?dials=` link carries, applied over those defaults as the Style Lab applies it. Its
panel's "Open this look in the Style Lab" and the Style Lab's "Open the Asset World with these dials"
carry the dials on screen between the two pages in the same link; from one of Bulwark's members the Style Lab opens on
Bulwark (`commander=bulwark`), and from anywhere else on its default commander, Pip. `?family=` opens one family's
zone: `env` (the Verdant kit's eight pieces on an arc), `heart` (the Worldheart at stages 0, 5 and 10
beside a heart the panel's slider sets from 0 to 10), `nests` (the nest), `xeno` (the Husk idle,
walking and attacking), `commanders` (Pip (commander), the default commander, first: idle, running,
a face member whose expressions cycle and attacking, each blinking on its own; then Bulwark, the
alternate, idle, running and attacking; a placard under each commander's row names him), `towers`
(Bolt Sentinel marks I to III, their heads
sweeping), or `characters` (the Husk's row and the commanders' together). Pip had a zone of his own,
`pip`, until he became the default; `?family=pip` is now a name the page reports and skips.
`?member=` opens one member by its placed name, such as `rock_a`, `worldheart_stage_05`,
`husk_walk` or `bolt_mk3`, and names it with its family as the label's second line. A family's
view names its members, except the Verdant kit's on a screen under 1024 px wide, where its eight
labels would crowd each other, and the commanders' under 640 px, where their seven would; there it
names the family alone, and each member names itself in its own view. The characters' view names its
members from 640 px wide, and the overview from 1680 px. Each parameter is read as its own kind: an empty one is skipped, and a name that is not one of
its kind is named in the console and the banner while the view falls back to the other parameter, or
the overview. The address follows the view chosen in the panel, so the bar always holds a link to
what is on screen.
Every root stands on the ground through the shared place() (Kit's ground contract), with no offset
for any asset, and the browser test reads each member's lowest drawn point against the ground. The
placement registry (`src/labs/world/registry.ts`) gives every manifest entry a place, every clip a
member that loops it or a reason in `CLIPS_NOT_SHOWN`, and, for a texture, the reason it is not
shown, and a unit test fails any new entry, kit piece, tower mark or clip without one, by name, and
any reason left for a clip the manifest no longer lists or a member loops. The world shows the
members alone, with no scatter a viewer could take for one. The layout's numbers are in Numbers
(Asset World layout).
Play Pip (prototype), the panel's first toggle or `?play=pip`, puts an instance of Pip (commander) of his own on the
patch in front of his row: WASD or the arrow keys walk him relative to the camera, Shift sprints, a thumb pad does both on a
touch screen, he walks round every member and stays inside the patch, and the camera follows him while a drag orbits
and the wheel zooms; F, a left click on the canvas or the touch screen's Attack button (or Enter, Space or a screen
reader's activation on it) swings his sword once, a committed cleave in which he stops dead and keeps his facing,
before he settles back into the idle or the run; leaving it
returns to the overview. It is a lab prototype for trying the character, not the M1 commander controller (Mechanics,
Commander movement, Commander combat), and its numbers are in Numbers (Asset World layout).

## Interface and HUD

**Visual language.** Painted-ink panels: dark painted ink washes with brush-edged borders drawn as
9-slice frames, text on solid backplates so it always reads. Tokens: ink `#14161d`, paper
`#efe6d2`, cyan `#59f2ff` (the one interface accent, for player energy, selection and focus), gold
`#ffc857` (economy only), danger `#ff5470` (damage and loss only). Magenta belongs to the Xeno in the
scene and never appears in interface chrome. No pure black or white. Fonts: Barlow Condensed for
display and numerals, Inter for body text. HUD motion stays under 300 ms and animates only transform
and opacity. Anything that happens a hundred times a match (shots, kills, coin ticks) changes
instantly with no animation (v3 frequency gate). Reduced motion is honoured in CSS and JS.

**Screens.**

1. **Title.** A live painted planet turning in the game's own renderer; Continue, New campaign,
   Planet Lab, Settings.
2. **Hangar**, between planets. The commander on a turntable; loadout (starting tower card, two
   weapons from the stash); the talent tree; the route map.
3. **Route map.** A painted star chart; planet cards show a theme swatch, size, hostility, boss
   silhouette and reward bias.
4. **Planet, Strategic view.**
   - Top centre: the wave pill (WAVE 7, countdown, live nests) and Call wave with its bonus.
   - Top left: the Worldheart panel (integrity bar, level, next cost with credit applied, B).
   - Left: gold, base credit, scrap, and crystals carried (0/3).
   - Bottom centre: the hand (tower cards on 1 to 4) and walls (J).
   - Bottom right: a small globe minimap (territory, nests, crystals, commander, cargo cache).
   - A tower panel anchored to the selected tower: mark, upgrade cost, sell value, priority, and the
     specialization choice at mark III.
5. **Planet, commander views.** Health and skill cooldowns (Z, V) bottom left; weapon slots bottom
   right; the crosshair; a compass strip across the top (home, cargo cache, nests, crystals); the
   hand stays usable within build reach.
6. **Draft overlay.** Two tower cards or three powers, mechanics first, one line of flavour.
7. **Inventory (I).** Two equipped slots, twelve backpack slots, weapon cards with comparison arrows.
8. **Pause and settings.** Graphics tier and the advanced render dials; camera feel sliders (lens,
   pitch, pan and zoom sensitivity, as in v3); audio; controls; accessibility (reduced motion,
   telegraph patterns that do not rely on red alone, text size).
9. **Victory, defeat and extraction** summaries.
10. **Cutscene player** with skip.

**Keyboard and mouse.** Carried from v3 where v3 had a binding; new actions take free keys.

| Input | Strategic view | Commander views |
|---|---|---|
| WASD or arrows | pan | move |
| Mouse | select, drag to pan | look |
| Wheel | zoom | first and third person |
| Tab | take the commander | return to the Strategic view (refused outside the frontier) |
| Left click | build, select, possess | attack (hold for heavy) |
| Right click | order the selection, cancel | aim (ranged families) |
| Shift | | sprint |
| Space | pause | jump |
| Ctrl | | dodge |
| Q | rotate view left | lock-on |
| E | rotate view right | interact (chests, structures) |
| Z and V | | commander skill and weapon skill |
| X | sell the selected tower | swap weapon slots |
| U | upgrade the selected tower | |
| 1 to 4 | pick a tower card | pick a tower card (build within 14 m) |
| J | walls | walls |
| B | raise the Worldheart | raise the Worldheart |
| T | forge a tower card at the heart | forge a tower card at the heart |
| I | inventory | inventory |
| G and H | | rally and dismiss wardens |
| M | | call or dismiss the mount |
| N | mute | mute |
| P | | pause |
| Esc | cancel, deselect | drop the build ghost, then open the menu |

**Touch.** A floating 136 px thumb pad under the landing finger; attack 80 px, jump 84 px, abilities
80 x 72 px, aim 64 px (v3); building, inventory and orders in drawers; safe-area insets; a mirrored
layout option (v3). Menus use 48 px targets.

## Build order

The renderer and asset work (Track A) and the game logic (Track B) run in parallel from M0 and meet
at the first rendered playable in M3. Every milestone ends with tests, bot runs, captured frames and a
live Pages link.

| Milestone | Track A: look and feel | Track B: game logic, headless | Gate |
|---|---|---|---|
| M0 | Repo, CI and Pages; Blender pipeline; renderer v1; style scene assets; Style Lab | Simulation kernel: fixed tick, seeded RNG streams, event log, save envelope, bot harness | Owner approves the look |
| M1 | The commander rebuilt in the CharForge Bo and Pip style with a cartoon face (Task list); commander controller on a test planet; three cameras; animation state machine; basic combat and hit feedback | Planet generator v1, navigation graph, flow field, placement rule | Owner approves the feel |
| M2 | Planet rendering (terrain meshing, painting, scatter, sky) for 6 themes; Planet Lab; all tower and Xeno models | Towers, Xeno, nests and waves, economy, crystals, heart ladder, placeholder boss | The bot wins and loses a planet headless |
| M3 | Integration: the first rendered playable loop, HUD v1 | Balance pass from bot telemetry | Owner plays a full planet |
| M4 | Five commanders, skills, Wardens, possession, evolution visuals | Commander and ally logic, evolutions | |
| M5 | Weapon parts and Weapon Forge; structures and chests | Weapon generator, inventory, loot | |
| M6 | Boss parts and Boss Lab | Boss generator and attack library | |
| M7 | Route map, talent tree, hangar | Drafts, meta progression, campaign, saves | |
| M8 | Mounts, walls, disaster effects, themes to 12 or more | Mount, wall and disaster logic | |
| M9 | Full HUD and menus, touch controls, audio and music, ink cutscenes, onboarding | Onboarding gates | |
| M10 | Balance, performance, accessibility, release | | |

The order of construction:

1. The first end-to-end playable: a complete planet played headless by the bot, from landfall
   through waves, crystals and all ten heart levels to the claim and a placeholder boss, ending in a
   win, plus a forced loss when the heart falls, each printing a result line. Track B builds it from
   M0 and it lands in M2, before any polish request.
2. The style check approved (M0 gate).
3. The feel approved (M1 gate).
4. A full planet played rendered by the owner (M3 gate).
5. Commanders and allies (M4).
6. Weapons and loot (M5).
7. Bosses (M6).
8. The campaign (M7).
9. World features (M8).
10. Presentation (M9).
11. Release (M10).

## Verification

"Done" means a frame or a result line that shows the behaviour, never code that reads right.

| Instrument | Command | Proves | When |
|---|---|---|---|
| Static checks | `npm run check` | types, lint, the simulation boundary, no em dash in any form | every commit, in CI |
| Unit tests | `npm test` | each mechanic's rules; every power and talent has a consumer | every commit |
| Determinism | `npm run test:determinism` | the same seed and inputs give the same state hash after 20,000 ticks | every commit |
| Bot runs | `npm run bot -- --planets 20` | three policies (competent, idle, reckless) win and lose planets; the competent bot finishes in 25 to 35 simulated minutes | milestone and nightly |
| Browser smoke | `npm run e2e` | every page boots without console errors; scripted input places a tower and runs a wave; frames saved | every pull request |
| Captures | `npm run capture` | every inspection page captured for review | milestone |
| Asset checks | `npm run assets:check` | each model within its family's triangle, bone, texture, ink and morph budget (Performance budgets); no double-sided material; every required clip present, with durations and strike times within 1/30 s of `src/shared/timings.json`, the timed clips named on each passing model's line; every listed file present, each model at the byte length the manifest records; placeable roots at ground contact (Kit); fails without a manifest; reads only the numbers the build recorded, never a GLB | every commit, in CI |
| Performance | `npm run perf` | frame time along a fixed camera path per tier on the development laptop | milestone |
| Blueprint gate | `blueprint.js check docs/blueprint.md --gate` | this document is complete | every commit |
| Agent play | the built-in browser | the agent plays the change and attaches frames | every change |
| Owner gates | the live Pages link | the look (M0), the feel (M1), a full planet (M3), each later milestone | milestone |

## Decided

| Decision | Status | Evidence |
|---|---|---|
| Browser game: TypeScript, Three.js on WebGL2, Vite, GitHub Pages | partial | toolchain, CI and Pages live (docs/evidence/m0/pages-placeholder.png); no game yet |
| Repository majieddd/99-planets-to-defend-v4, public | partial | repository created holding this blueprint, 2026-09-23 |
| Approach A: painted assets, shader lighting, two-pass ink | in game | Style Lab live; docs/evidence/m0/style-hero-high.png (Pip (commander), the default since 2026-10-04, his recipe build since that day's later entry in Where we are) and style-hero-high-bulwark.png (Bulwark); locked dials in src/render/defaults.ts |
| Painted-Anime-Inkline 4.0 render defaults locked, from preset B3's link with the owner's three adjustments | in game | owner, 2026-09-28: "I looked at the golden-hour style lab, and it definitely looks great! Let's stick with it, but here are a couple minor adjustments to make as the default: Make default EdgeStrength = .33; Make default Edgefadefar = 65" and "Also make litsaturation 1.09"; preset B3's live link with those three adjustments, locked in src/render/defaults.ts (Render defaults); frames at the locked defaults with Bulwark, the commander it was locked on, in docs/evidence/m0/style-*-high-bulwark.png and style-*-low-bulwark.png (retaken 2026-10-04 by the lock's methods), and with Pip (commander), the default since then, in style-*-high.png and style-*-low.png |
| Every asset built by script in Blender 5.2.1 | partial | style-scene set built by npm run assets; assets:check pass=8 fail=0; sheets in docs/evidence/assets |
| Stylized, visored commanders | dropped | owner replaced the visor with a visible cartoon face, 2026-09-27 |
| Character bodies in the owner's CharForge stylized cartoon style, as its Bo and Pip show (https://majieddd.github.io/charforge/): about 4.5 to 5 heads tall, oversized hands and feet, slim limbs, chunky rounded volumes | not yet | owner choice, 2026-09-27; it replaces heroic proportions; the commanders take it first, from M1 (Task list); which other characters take it, such as the Warden on the commanders' skeleton, is not yet decided |
| Commanders show a visible cartoon face: painted features, with blink and jaw shape keys | not yet | owner choice, 2026-09-27; it replaces the visor, and M0's Bulwark stays visored |
| Pip is the default commander; Bulwark is an alternate | partial | owner, 2026-10-04: "yes make Pip the default, keep Bulwark as alternate"; in both labs: the Style Lab opens on Pip (commander) (`commander_pip`), `?commander=bulwark` opens Bulwark, and the Asset World's commanders' zone leads with Pip, Bulwark after him; frames in docs/evidence/m0/style-*-high.png and style-*-low.png (Pip) and style-*-bulwark.png (Bulwark); no game yet |
| Generated sources, such as CharForge shapes, allowed only as inputs that a Blender 5.2.1 recipe re-proportions, decimates, repaints, animates and exports | partial | owner choice, 2026-09-27; no Mac is available to run CharForge, so its published GLBs are the sources; since 2026-10-04 `blender/recipes/commander_pip.py` reworks the owner's published Pip (`blender/sources/charforge/pip.glb`, the 2026-10-03 publication, 10,016,740 bytes) through `blender/lib/charforge.py` into the shipped `commander_pip`, which `npm run assets` rebuilds (identical to the study's reference build apart from bake texels); in the labs, no game yet |
| Pip (commander) is built by a Blender recipe from the owner's CharForge source, so every shipped file of his comes from committed files | partial | the generated-sources row above allows it (owner choice, 2026-09-27); the source is an input to the recipe only, and what ships is the recipe's export through the build's optimize, inspect and manifest steps: `npm run assets -- --only commander_pip` in 197.7 s, 23,999 triangles, 24 bones, three 1,024 px textures, the five face morphs and idle, run and attack clips (Performance budgets); frames in docs/evidence/m1/ and docs/evidence/m0/style-*-high.png and style-*-low.png; no game yet |
| The game stays free and non-commercial | partial | owner, 2026-09-27; the public Pages site is free to open, and no license records the non-commercial terms yet (Task list) |
| Every v3 system returns, staged by milestone for quality | not yet | owner choice, 2026-09-23 |
| A planet takes 25 to 35 minutes | not yet | owner choice, 2026-09-23 |
| The boss wakes when the whole planet is claimed | not yet | owner brief, 2026-09-23 |
| Death outside the frontier drops a cargo cache and respawns; only the heart falling ends a planet | not yet | owner choice, 2026-09-23 |
| Keyboard and mouse plus touch are first-class inputs | not yet | owner choice, 2026-09-23 |
| Core fiction kept, told through ink-sketch cutscenes | not yet | owner choice, 2026-09-23 |
| Commander run speed 7 m/s with dodge, buffers, lock-on and hit-stop | not yet | approved improvement, 2026-09-23 |
| Tower specialization at mark III | not yet | approved improvement, 2026-09-23 |
| Borderlands-style weapons: family, manufacturer, parts, rarity, element | not yet | approved improvement, 2026-09-23 |
| Themed bosses from archetype, element and attack modules | not yet | approved improvement, 2026-09-23 |
| Route choice between two or three planets | not yet | approved improvement, 2026-09-23 |
| One new system per planet over the first six planets | not yet | approved improvement, 2026-09-23 |
| Every power and talent has a test proving its effect | not yet | approved improvement, 2026-09-23 |
| Crystals deposit automatically in the heart's aura | not yet | owner approved in spec review, 2026-09-23 |
| Enemies strike the heart with telegraphed blows instead of subtracting lives | not yet | owner approved in spec review, 2026-09-23 |
| Terrain affinity gives bonuses instead of restrictions | not yet | owner approved in spec review, 2026-09-23 |
| Tower card draft offers a choice of two | not yet | owner approved in spec review, 2026-09-23 |
| Per-tower target priority | not yet | owner approved in spec review, 2026-09-23 |
| A second death before reclaiming the cargo cache loses it | dropped | owner declined in spec review, 2026-09-23; caches never expire |
| Story, Standard and Veteran difficulties | dropped | owner declined in spec review, 2026-09-23 |
| Wandering packs outside the frontier | dropped | owner declined in spec review, 2026-09-23 |
| Gamepad as a first-class input | dropped | owner selected keyboard and mouse plus touch, 2026-09-23 |
| Whole-screen painterly post filter (approach B) | dropped | owner chose approach A, 2026-09-23 |
| v3's Apophis and Earth-first prologue told verbatim | dropped | owner chose a new telling of the core fiction, 2026-09-23 |
| v3's run-ending death outside the frontier | dropped | owner chose the cargo cache rule, 2026-09-23 |
| v3 classic maps (Pocket World, Giant World, Titan's Brow) | not yet | candidates for Planet Lab sandbox play after M10 |
| Co-op or multiplayer | not yet | the pure simulation keeps it possible |

## Task list

- [x] Owner reviewed this blueprint and settled the eight additions (2026-09-23)
- [x] Write the M0 implementation plan (writing-plans), then dispatch through the Chief Orchestrator
- [x] Toolchain: Vite, strict TypeScript, Three.js, Vitest, Playwright, ESLint with the simulation
      boundary rule, an em dash check covering all four forms
- [x] CI workflow and the GitHub Pages deploy
- [x] Blender pipeline: headless runner, shared libraries (paint bake, rig, animate, export),
      manifest, turntable sheets, asset checks
- [x] Renderer v1: painted lighting material, hull ink, screen-space edge ink, fog and sky, bloom and
      grade, quality tiers
- [x] Style scene assets: Bulwark (idle, run, attack), Bolt Sentinel marks I to III, Husk (walk,
      attack), Worldheart, nest, Verdant kit (rocks, flora, grass cards), brush atlas
- [x] Style Lab with live dials, the reference board and the colour audit
- [x] Simulation kernel: fixed tick, seeded RNG streams, event log, save envelope, bot harness
- [x] Owner style gate: the owner tunes the dials live in the deployed Style Lab and sends a dials
      link; lock the Painted-Anime-Inkline 4.0 defaults from it (2026-09-28: preset B3 with the
      owner's three adjustments)
- [ ] Owner: choose a license that keeps the game free and non-commercial (owner's intent,
      2026-09-27); none is chosen yet, so all rights are reserved by default
- [ ] M1's first character task: the commander body in the CharForge Bo and Pip style (about 4.5 to
      5 heads tall, oversized hands and feet, slim limbs, chunky rounded volumes) and a visible
      cartoon face with painted features and blink and jaw shape keys; M0 locked on the current,
      visored Bulwark; the renderer's face support is built and tested on synthetic meshes (face
      morphs allowed under the ground rule, morph targets in the painted and hull materials, soft skin
      light from `_SKIN`, no crease ink on skin meshes, the labs' face driver; Kit, Face morphs and
      skin). Pip (commander) is built by recipe from the owner's CharForge source
      (`blender/recipes/commander_pip.py` on `blender/lib/charforge.py`, 2026-10-04) with his idle, run
      and attack clips, the five face morphs and the manifest's morph names, in both labs and in Play
      Pip, and since 2026-10-04 the labs' default commander with Bulwark the alternate (Decided); the
      owner judges him there. Open: the owner's verdict on the recipe build, and whether its face
      export needs another pass (the study export's crease down the face's centre and notch at the
      bridge of the nose, Where we are, 2026-09-28; the recipe build's close-up evidence frame shows
      the face as the study export's frame did)
- [x] When Pip's attack ships and its member joins his row, re-measure what does not follow the
      layout by itself (2026-10-04, measured on the GPU): Bulwark's row moved from 13 to 15.6 m and the
      character row from 24.6 to 27.2 m; the overview's label threshold rose from 1600 to 1680 px, the
      characters' view kept 640 px, and the commanders' view took 640 px too
      (`OVERVIEW_MEMBER_LABELS_MIN_WIDTH`, `CHARACTERS_MEMBER_LABELS_MIN_WIDTH`,
      `FAMILY_MEMBER_LABELS_MIN_WIDTH`); the sun's box is 27.8 m with 2.71 cm texels (sun.ts, the
      `WORLD_SUN_DISTANCE` and `WORLD_CASTER_MARGIN` rows, `PLAY_AREA_RADIUS`'s spare of 4.45 m);
      Bulwark's ground readings are 0.58, 5.24 and 0.93 cm, so the characters' allowance rose from 4 to
      5.5 cm; Play Pip's spawn stands 2.38 m clear (Asset World layout)
- [ ] When M4 tunes the attacks, put each contract duration on a whole 30 fps frame: Bulwark's and Pip's
      0.85 s is 25.5 frames, so each exports as 25 frames (0.8333 s) and passes only on assets:check's
      one-frame tolerance (`FRAME`, tools/assets/check.mjs); the timings stay as they are until then
- [ ] Consider Git LFS for `blender/sources/` before a second CharForge publication lands: each
      republished source adds about 10 MB to the history (pip.glb is 10,016,740 bytes)
- [ ] For M2, from the M0 gate: a per-pixel ink signal so the bloom never lifts fogged or edge ink;
      per-theme seeds for the sun dials, which override the theme's light; a bloom rule for warm
      hazards such as magma, which would take heartHalo because warm glow means the heart; deciding
      the bloom's warmth from the emitter's own colour, because at the locked defaults the warm-texel
      model's silhouette rim warms the nest's seams and the Husk's seams take traces of the heart's
      halo at the strategic camera (`WARM_BLUE_FULL`, Render constants); a triangle readout in the
      lab, and a LOD for the Verdant clumps if M2's scatter budgets need one

## Where we are

2026-09-23. The design was approved in brainstorming: the platform, approach A, design sections 1 to
4, and the cargo cache death rule. The repository held this blueprint and a README, and no code yet.
Blender 5.2.1 LTS portable is installed at `C:\Users\Majied LaFleur\tools\blender-5.2.1` (checksum
verified against blender.org, 915 MB); portable 4.5.1 and 4.3.2 installs were already present in the
same folder. The local OpenViking knowledge base
was not running. The owner then reviewed this written spec, kept five of the eight details added
while writing it (auto-deposit, heart blows, terrain bonuses, a choice of two cards, target
priority) and declined three (losing a cache on a second death, difficulty levels, wandering packs).
2026-09-24. M0a is complete: the toolchain, checks, CI and the Pages site are live at
https://majieddd.github.io/99-planets-to-defend-v4/. Next: M0b, M0c and M0d in parallel
(docs/superpowers/plans/2026-09-23-m0-overview.md).
M0b is complete: the simulation kernel is deterministic across seeds, commands and a mid-run save
(tests/unit/sim/determinism.test.ts), and `npm run bot` prints a stable result line.
2026-09-27. M0d's renderer and Style Lab are complete on placeholder assets: renderer v1 draws the
style scene at all three quality tiers, and the lab's dials, reference board and colour audit run on
it (docs/evidence/m0/style-placeholder-*.png). The browser tests render the lab at the low tier from
all four cameras, at the root path and at the Pages base path; the hero frame passes the colour audit
(concentration 1.90 x chance against a gate of 1.5) and the mutation proof rejects its hue-rotated
copy. The lab will switch to M0c's Blender assets automatically once those merge. Next: the owner's
style gate (M0d plan Task 11), after M0c.
2026-09-27. M0c is complete: `npm run assets` builds the style-scene set in Blender 5.2.1,
`npm run assets:check` passes (pass=8 fail=0) and runs in CI, and contact sheets are in
docs/evidence/assets. The check now also holds the Kit's ground contract, which puts every placeable
asset's root at its ground contact point. The Style Lab now loads these assets from the manifest,
and `npm run e2e` renders all four camera presets with them (docs/evidence/assets/style_lab_hero.png).
Next: the owner's style gate (M0d plan Task 11) on these assets.
2026-09-27. The M0 style gate is open and waits on the owner's live tuning, so M0 is not complete.
M0a, M0b and M0c are merged, as are M0d's renderer and Style Lab (PR #3) and its pre-gate fixes
(PR #4). M0d plan Task 11 has run up to the owner's decision: the lab renders M0c's assets, the
Verdant crowns and bushes are rounder, and ten new dials cover the heart's warm halo, height fog,
the sun, a brush-broken soil edge and the look (Render defaults); actors stay readable under a low
key, the ink stays black under the bloom near the camera, and the terrain terminator stays hard on
the planet's curve. The colour audit passes, and `npm run e2e` passes 16 of 16. The owner saw three
looks, A (the defaults), B (Sifu golden hour) and C (Sifu overcast); the coordinator recommended B
as the base, and two look passes made it preset B3 (Render defaults). The owner chose to tune live
first, so `DEFAULT_DIALS` stay at A and nothing is locked. Next: once this work is live on Pages,
the owner opens the Style Lab (https://majieddd.github.io/99-planets-to-defend-v4/labs/style.html),
tunes its dials from the defaults or from B3, presses "Copy dials link" and sends that link. A small
lock pull request then decodes it into `DEFAULT_DIALS` as Painted-Anime-Inkline 4.0, takes the
evidence frames, sets the Render defaults rows to the locked values and records M0 as complete;
M1 (commander feel) and M2 (planets and the headless end-to-end playable) follow.
2026-09-27. At the owner's direction the film grain is off by default and preset B3 carries 0,
because it read as noise laid over the screen (Film grain, Render defaults); the vignette stays for
the owner's live tuning. The owner also settled the commanders' look: CharForge's Bo and Pip body
style and a visible cartoon face with blink and jaw shape keys replace the visored knight, generated
sources may only feed a Blender recipe, and the game stays free and non-commercial (Decided). M0
still locks on the current, visored Bulwark, and the new commander is M1's first character task
(Task list).
2026-09-28. M0 is complete. The owner approved the golden-hour look at the style gate, and it is
locked as Painted-Anime-Inkline 4.0: preset B3's live link with three adjustments, edge ink strength
0.33, the edge fade's far end at 65 m and lit saturation 1.09 (Render defaults, which quote the
owner). `DEFAULT_DIALS` holds the locked set, the Style Lab opens on it with no dials link, and the
high-tier evidence frames were taken at it (docs/evidence/m0/style-{hero,strategic,closeup,horizon}-high.png,
with Bulwark; since 2026-10-04 those names hold Pip's frames and Bulwark's are the `-bulwark` ones).
At the hero camera the colour audit reads 1.926, 1.942 and 1.946 times chance on the high, medium and
low tiers (gate 1.5), the mutation proof rejects the hue-rotated copy of each, and on the RTX 4080
laptop the high tier draws the hero camera at 2560 x 1440 in 2.07 ms uncapped (16.67 ms under vsync).
The owner's lit saturation above 1 spares the emitters and lets no lit colour below 0 (Lit
saturation). Under the locked key the warm-texel model's silhouette rim warms the nest's seams, which
no preset camera shows on the GPU (`WARM_BLUE_FULL`, Render constants), so deciding warmth from the
emitter's own colour joins M2's follow-ups (Task list). Next: M1, commander feel, starting with the
CharForge-style commander (Task list), and M2, planet rendering and the headless end-to-end playable
(Build order, item 1).
2026-09-28. The Asset World (`/labs/world.html`), M0's inspection follow-up, lays out every built
asset for inspection on the Style Lab's patch in the locked Painted-Anime-Inkline 4.0 defaults: the
Verdant kit's eight pieces, the Worldheart at stages 0, 5 and 10 beside a heart the panel's slider
sets, the nest, the Husk idle, walking and attacking, Bulwark idle, running and attacking, and Bolt Sentinel
marks I to III, each family in a labelled zone with its own view, reachable by `?family=` and
`?member=` (Content, Asset World). It is the inspection view the plan called the Asset Gallery. It
was built in preset B3 while the gate was open and now opens on `DEFAULT_DIALS`, as the Style Lab
does, so the locked look has one source in code; a dials link still applies over it. A registry test
fails any manifest entry the world does not place. The home page links to it, the Style Lab's panel
opens it in the look its dials make, and its own panel opens the Style Lab in its look. Next is
unchanged: M1 and M2, as the paragraph above records.
2026-09-28. Pip-A, the M1 commander preview, is in both labs. His GLB came in through the build's own
optimize, inspect and manifest steps (2.81 MB to 613 KB, the other 8 entries re-derived byte for byte),
the manifest records morph names, and the `commanders` budget has a morph line and his pending attack;
`npm run assets:check` passes 9 of 9. The Asset World shows him idle, running and with a face whose
expressions cycle, each instance blinking on its own, in a zone of his own beside Bulwark; the Style
Lab shows him through its commander control or `?commander=pip`, and its default hero frame is
unchanged (0 of 2,073,600 pixels). On the RTX 4080 laptop at 2560 x 1440 the Style Lab hero with Pip-A
draws in 2.5 to 3.4 ms uncapped (Bulwark 2.2 to 2.9 ms in the same run) and 16.67 ms under vsync. In
the locked look his blink closes the lids, no crease ink reaches his skin (0 pixels), the hair over his
face draws no ink across the forehead, and the hull inks the face only at its edges with the hair and
the chin. The face is not yet clean, and every cause measured lies in the export rather than the
renderer: under the Style Lab's key a straight crease runs down the face's centre from the brow to the
chin, stepping 80 luma over 4 px with the albedo flat (106 textured) and still 70 to 76 at the softest
skin light (0.5) or a 0.85 standard blend, and welding or recomputing the normals leaves it in place;
61 of the 200 vertices in his right eye band have normals facing backward; the face's split vertices
part their normals by a median 24 degrees on the centre line and 43 on the right cheek, which draws a
seam down that cheek; `_SKIN`, taken from the lit texture's colour, averages 0.22 in his right eye band
and 0.56 on his right cheek at the nose, which light with the cel bands; the painted albedo carries a
seam and baked light and shade of its own; and with the key behind his head the face turns olive-teal
(mean hue 60 against 22 to 27 lit). Next: the owner's verdict on Pip-A in the labs, then phase B (his
attack clip and a face export that fixes these), alongside M1 and M2.
2026-09-28, later. Pip-A is now the v5 study export, through the same optimize, inspect and manifest
steps (3.58 MB to 671 KB, the other 8 entries re-derived byte for byte): 24,000 triangles, on the
`commanders` line, and a second body material for a 1,024 px head texture, three textures in all,
which the texture line allows since it caps each texture's size. GLTFLoader loads the two-material
body as a Group of the body and the head, and each is painted as skin, inked and driven by the face
morphs. In the locked look, in the same close-up of his face, the ink specks on his neck under the jaw
and on his right cheek are gone, and his run stride is unchanged (2.70 m in 0.70 s); the seam down the
face's centre and the dark notch at the bridge of the nose remain as they were in v4.
2026-09-28, later. The Asset World has Play Pip (prototype), the panel's first toggle or `?play=pip`: an instance of
Pip-A of his own walks the patch under WASD, the arrow keys or a thumb pad, round every member and inside the play
area, with the camera following him (Content, Asset World). A review round fixed its steering, which laid the camera's
view ray on his ground and so, at the area's edge, ran 22.8 degrees off up the screen at a 20 degree polar angle and
walked him toward the camera straight overhead; forward is now his up crossed with the camera's level right, 0 degrees
off at every pitch (tests/unit/labs/play-motion.test.ts). A key held with Ctrl, Cmd or Alt no longer walks him or loses
its shortcut, Cmd going down lets go of the held keys, the slider heart's reach is read again when it changes while he
plays, and leaving play gives the turntable back as it was. It stays a lab prototype, not the M1 commander controller,
and Next is unchanged.
2026-10-04. The expression-decal renderer (texture-swap eye and mouth cells for an anime head) and the anime head test GLB are shelved on branch `m1-anime-shelved` (head 69b86c3); Pip-A's face stays on morphs.
2026-10-04. Pip is the default commander and Bulwark the alternate, at the owner's word: "yes make Pip
the default, keep Bulwark as alternate" (Decided). The Style Lab opens on Pip (commander), loaded with
the other models so his first frame and its colour audit need no swap; `?commander=bulwark` opens
Bulwark without loading Pip, an unknown name falls back to Pip and a manifest without Pip to Bulwark,
each named in the banner. The Asset World's commanders' zone leads with Pip, idle, run and face on the
level clearing beside the Husk, and Bulwark follows past it, each row under a placard naming its
commander; Pip's zone of his own is gone, his attack member comes with his attack clip, and Play Pip
(prototype) spawns in front of his row, 2.41 m clear of every member's reach (Asset World layout). The
colour audit at the locked defaults, frozen at 1920 x 1080 on the RTX 4080 laptop, reads 1.927, 1.942
and 1.945 with Pip at the hero camera on the high, medium and low tiers and 1.963, 1.980 and 1.982 at
the close-up, strategic and horizon cameras on high, and with Bulwark the lock's 1.926, 1.942 and 1.946
and 1.974, 1.980 and 1.982 (gate 1.5); the mutation proof rejects every hue-rotated copy. The evidence
frames now show Pip under their old names (docs/evidence/m0/style-{hero,strategic,closeup,horizon}-{high,low}.png)
and Bulwark under `-bulwark` names, each set taken by the method that took the lock's: the high tier
unfrozen at 1920 x 1080 on the GPU inside an idle stretch of the commander's cycle with the lab UI
hidden, the low tier as the browser test takes it, under SwiftShader at 1280 x 720 with the UI. They show
that this branch's renderer has not moved the locked look for Bulwark. At the high tier his retakes
differ from the lock's frames on 0.005, 0.018, 0.010 and 0.351 percent of the pixels by more than 2 of
255 at the hero, strategic, close-up and horizon cameras, all on the walking Husk, the turret heads
tracking it and the commander's idle, against 0.044, 0.093, 0.032 and 0.448 percent between two retakes,
and on at most 0.003 percent outside that motion. The lock's low-tier frames landed at later scene times
than the retakes, so a retake differs on 3.7 to 21.6 percent of the frame, on the same moving actors and
the panel's new commander rows; at the matching scene time the canvas strip between the board and the
panel differs on 0.0011, 0.025, 0 and 0.0002 percent, the four cameras in the same order. Next is
unchanged: Pip's phase B (his attack clip and a face export that fixes the seams), alongside M1 and M2.
2026-10-04, later. A fix round on the Pip-default change, from its two reviews. A missing or corrupt Pip
GLB stopped the Style Lab ("failed to start", or "stopped" on the panel's switch); Pip now loads once per
page, shared by the opening and every switch, and a failed load leaves a running lab on Bulwark with one
console error and "Pip (commander) failed to load; showing Bulwark." The browser test routes his GLB to a
404 at the start and on a switch from Bulwark and reads Bulwark, that line and no unexpected console
error, on both projects. Only the latest commander choice is shown however late Pip's load resolves, and
leaving him releases a held face pose. The Asset World's member list names each commander ("Pip
(commander) idle (pip_idle)"), the page names any member it drops that the coverage check did not, and
the shadow box figures read Bulwark's attack member at 18.2 m, a 25.2 m box and 2.46 cm texels. npm test
reads 431 passed and the browser suite 23 passed and 3 skipped. Next is unchanged.
2026-10-04, later. Pip (commander) is built by recipe and has his attack. `blender/recipes/commander_pip.py`
runs the CharForge rework template `blender/lib/charforge.py` on the owner's CharForge Pip as published on
2026-10-03 (`blender/sources/charforge/pip.glb`, 10,016,740 bytes, sha256 128d5853...; the 2026-09-28
publication is archived outside the repository), and `npm run assets -- --only commander_pip` built him in
197.7 s through the build's optimize, inspect and manifest steps: 23,999 triangles, 24 bones, three
1,024 px textures, the five face morphs on both body primitives with `_skin` and `_ink`, the armour with
`_ink`, and idle (1.6 s), run (0.7 s) and a shield-and-sword cleave (0.85 s, strike at 0.34 s, his own
entry in src/shared/timings.json). His raw GLB matches the study's reference build in every node,
attribute, morph target, animation channel and material, apart from bake texels. The study's copy of
export.py predated the repo's morphs option, so the template now exports through it. The Bulwark's armour
primitives and plate settings moved into `blender/lib/armour.py`, since no recipe imports another; the
Bulwark built before and after the move is identical apart from bake texels (every attribute, the skin and
all 198 animation channels), and his committed GLB is unchanged. With the attack shipped, the `pending`
exception and its machinery are gone, and `npm run assets:check` passes 9 of 9, naming the timings it held
("ASSET commander_pip ok (23999 tris, 694 KB; attack 0.85 s, strike 0.34 s as timings.json sets)"). Play
Pip swings on F, a left click or an Attack button: he stops and keeps his facing for the swing, a trigger
mid-swing is ignored, and he settles back into the idle or the run (Asset World layout). The Style Lab's
cycle strikes with Pip's own clip, and the Asset World has `pip_attack`, whose arrival moved Bulwark's row
2.6 m out; what does not follow the layout was measured again on the GPU (Task list): the overview's label
threshold rose to 1680 px, the commanders' view names its members from 640 px, the sun's box is 27.8 m
with 2.71 cm texels, the characters' ground allowance rose to 5.5 cm for Bulwark's run at 5.24 cm, and Play
Pip's spawn stands 2.38 m clear. The colour audit at the locked defaults, frozen at 1920 x 1080 on the RTX
4080 laptop, reads 1.927, 1.943 and 1.946 with Pip at the hero camera on the high, medium and low tiers and
1.961, 1.980 and 1.982 at the close-up, strategic and horizon cameras on high (gate 1.5; the study export
read 1.927, 1.942, 1.945, 1.963, 1.980 and 1.982), and Bulwark's hero on high still reads the lock's 1.926;
the mutation proof rejects every hue-rotated copy. Pip's evidence frames were retaken by the previous
round's methods (docs/evidence/m0/style-*-high.png and style-*-low.png; the high ones differ from the study
export's on 2.66, 0.73, 10.35 and 1.20 percent of the pixels by more than 2 of 255 at the hero, strategic,
close-up and horizon cameras, the close-up most because he fills it and his idle now comes from the
2026-10-03 source), the Bulwark's frames stay, and docs/evidence/m1/ holds play-attack-midswing.png,
world-pip-attack.png and style-pip-attack.png, each near the strike. npm test reads 436 passed and the
browser suite 23 passed and 3 skipped. Next: the owner's verdict on the recipe build in the labs,
alongside M1 and M2.
2026-10-05. A fix round on the reviews of Pip's recipe, his attack and Play Pip's swing. Pip sank in the
Asset World: his idle read 1.69 cm and his face member 3.47 cm under the ground, which the characters'
one 5.5 cm allowance passed. His retargeted clips had no ground pass, and the idle's lowest point was not
a boot (1 mm under) but his sword's tip, 3.4 cm into the ground in front of him, while the run's boots
reached 1.75 cm under. `ground_clips` (`blender/lib/charforge.py`) now gives each retargeted clip one
hips offset that stands its lowest boot point on the ground (idle 1 mm, run 1.76 cm) and turns the idle's
sword hand by one constant 4.63 degrees so the tip clears the ground by 1 cm; the sidecar records each
clip's lowest point (idle, run and attack at 0.0) and a unit test holds them. Rebuilt in 225.1 s, with
nothing else churned, he reads 0.10, 0.75, 1.03 and -0.71 cm at his idle, run, face and attack members
(were -1.69, -1.01, -3.47 and -0.71), and the browser test holds a character to 5.5 cm above the ground
and 1 cm below it. The colour audit at the locked defaults, frozen at 1920 x 1080 on the RTX 4080 laptop,
reads 1.927, 1.942 and 1.946 at the hero camera on high, medium and low and 1.961, 1.980 and 1.982 at the
close-up, strategic and horizon cameras on high (gate 1.5). Play Pip stops dead on the frame that takes a
swing, drops a trigger on a frozen frame, ends the fade a frame before the clip, and his Attack button
answers Enter, Space and a screen reader; the browser test swings once for F, once for a click and once
for a tap, and not for a drag. charforge's settings refuse unknown keys, and a source without an
armature, mesh, shape keys or albedo is named with what it lacks. The overview's member labels are clear
at 1680 x 945 as at 1680 x 1050, so the 1680 px threshold holds. Pip's evidence frames are retaken (the
high ones differ from the last on 1.53, 0.25, 5.14 and 0.23 percent of the pixels at the hero, strategic,
close-up and horizon cameras), and style-pip-attack.png now shows his wind-up 0.21 s into the swing from
the hero camera, where the close-up's frame at 0.32 s had read as his idle. npm test reads 444 passed and
the browser suite 24 passed and 4 skipped. Next: the owner's verdict on the recipe build in the labs,
alongside M1 and M2.
