# 99 Planets To Defend (v4)

A painted, inked action tower defense fought across living procedural planets. Land on a world,
raise defenses anywhere on its curved surface, walk out past your frontier in first or third person
for crystals and generated weapons, grow your Worldheart until your territory covers the whole
planet, then face the boss that world has grown for you. Then choose the next of 99.

*The swarm found this world. Every nest must keep a path to the heart: seal nothing, shape
everything.*

## Status

Design phase. The approved design, and the running document for the whole build, is
[docs/blueprint.md](docs/blueprint.md). There is no code yet.

When the first milestone ships, the game will be playable at
https://majieddd.github.io/99-planets-to-defend-v4/.

## What this is

v4 re-creates the owner's WorldHeart v3 browser game from the ground up:

- **The look:** Painted-Anime-Inkline 4.0. The painterly 3D of Sifu's animated flashback, the
  clarity of anime shading, and the bold black silhouette ink of Borderlands, built into the
  materials rather than laid over the screen.
- **The assets:** every model, rig and animation built by script in Blender 5.2.1, versioned as
  Python recipes in `blender/`.
- **The code:** TypeScript and Three.js on WebGL2, with the whole game logic in a pure,
  deterministic simulation that a bot can play from start to finish.
- **The game:** the v3 mechanics kept and improved: freeform tower placement under one rule, five
  commanders, generated planets, generated weapons, generated planet bosses, drafts, talents,
  mounts, crafting, weather and disasters, across a 99-planet campaign.

Made with Claude Opus 5.5.
