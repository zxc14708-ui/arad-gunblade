# Temporary Weapon Visual System

## Runtime behavior

- The default M1911 + katana loadout keeps `public/gunblader.png` unchanged.
- Any other equipped loadout starts from `public/gunblader_base.png` and adds
  the selected gun and sword as temporary layers on the existing 27 frames.
- This changes visuals only. Weapon stats still come exclusively from
  `src/systems/Weapons.ts`.

## Asset map

- Source handoff atlas: `public/assets/player/weapon_atlas_temp.png`
- Per-weapon runtime sprites: `public/assets/player/weapons/<weapon-id>.png`
- Gun projectile style sheet: `public/assets/player/fx/weapon_projectiles_temp.png`
- Sword effect style sheet: `public/assets/player/fx/weapon_melee_fx_temp.png`

`rifle.png` is a scoped rifle. The legacy `daggers` id intentionally displays
as a one-handed sword and is named **한손검** in the game UI.

## Final art delivery contract

For a final replacement, deliver a transparent 3024×64 PNG strip: 27 frames
of 112×64 pixels, in this order: idle 0–3, walk 4–10, sword attack 11–18,
gun attack 19–26. The gun stays in one hand in every frame; no holster is
needed. Keep the feet on the bottom edge and the hand/grip position stable.

If final art arrives as modular parts, every layer uses the same 112×64 grid
and frame order. Do not resize a source file to compensate for a pivot error;
fix the grip position in the sheet instead.
