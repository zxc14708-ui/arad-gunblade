# Stages 2-7 prototype content

## Purpose

This is the replacement map for the temporary Chapter-1 implementation. All
temporary sheets preserve the validated Stage-1 frame geometry and are generated
by `tools/generate_temp_stage_art.py`; final art can replace an `artSet` without
changing enemy AI.

## Stage roster

| Stage | Temporary theme | Required roles |
|---|---|---|
| 2 | Mist marsh | melee, ranged, brute, suicide |
| 3 | Poison mushroom colony | melee, ranged, brute, suicide |
| 4 | Burning encampment | melee, ranged, fire mage (warning circle under the player) |
| 5 | Frozen valley | melee, ranged, frost suicide (persistent slow field), homing ice mage |
| 6 | Forest of the dead | melee, ranged, zombie-summoning mage |
| 7 | Dimensional threshold | melee, ranged, teleporting homing void mage, charging brute |

## Stage 2 temporary illustrated set

Stage 2 replaces its generated palette variants with the user-approved
illustrated temporary sheets: shield swordsman (`s2Imp`), bow archer
(`s2Shooter`), gas suicide goblin (`s2Suicide`), armored brute (`s2Brute`),
and horned hammer boss (`s2Boss`). These keep the existing asset keys and AI.
All states share one 32-color palette per monster and preserve the validated
4/6/4 frame contract; the boss preserves 4/6/6/6 including charge.

## Boss inheritance

Every boss retains the Stage-1 charge, self-centred slam and shot patterns.
Special patterns are cumulative: suicide summons unlock at Stage 2, fire area
attacks at Stage 4, homing ice at Stage 5, zombie summons at Stage 6, and
teleport/void homing attacks at Stage 7. The temporary boss art uses the same
validated frame counts, including the six-frame charge strip.

## Replacement rules

- Keep each existing `artSet` key when replacing art, or update `RunState.ts`,
  `assets.ts`, and `EnemySprite.ts` together.
- Preserve the square-cell horizontal strips and bottom anchoring checked by
  `tools/measure_sprites.py`.
- Do not treat the palette variants as final illustration direction. They exist
  only to make enemy roles and stages readable during system development.
- Boss reward escalation and final boss identities are still open decisions in
  `DESIGN_LOG.md`.
