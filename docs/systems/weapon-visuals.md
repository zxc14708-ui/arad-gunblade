# Weapon Motion Sheet Handoff

## Current status

The temporary per-weapon runtime visual system is deliberately disabled. Every
loadout currently uses the finished original character sheet at
`public/gunblader.png`, so switching weapons cannot replace the player with the
retired white-haired character.

Weapon mechanics, including the scoped rifle's separate tuning, are independent
of this decision and remain active.

## Final art delivery contract

For each final loadout, deliver one transparent PNG motion strip:

- Canvas: **3024 x 64 px**
- Frames: **27 frames**, each **112 x 64 px**
- Idle: frames **0-3**
- Walk: frames **4-10**
- Sword attack: frames **11-18**
- Gun attack: frames **19-26**
- The gun stays in one hand in every frame; do not draw a holster.
- Keep feet on the bottom edge and keep the weapon grip aligned with the hand.
- Match the pixel density, silhouette, and transparent background of
  `public/gunblader.png`.

Only after matching final sheets are delivered should a per-weapon visual system
be reintroduced. Register the sheets in `src/rendering/assets.ts`, keep the
runtime sprite on the same character body, and visually QC every loadout before
shipping. Do not alter combat or weapon-stat logic to swap art.
