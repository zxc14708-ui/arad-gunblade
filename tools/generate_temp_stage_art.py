"""Generate deterministic, disposable stage 2-7 monster palette variants.

These files are placeholders only.  Geometry, frame count and bottom anchoring stay
identical to the validated stage-1 sheets so they can be replaced by final art later.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"

SOURCES = {
    "imp": {
        "idle": "assets/stage1/stage1_goblins/melee_goblin_idle_4f.png",
        "walk": "assets/stage1/stage1_goblins/melee_goblin_walk_6f.png",
        "attack": "assets/stage1/stage1_goblins/melee_goblin_club_attack_4f.png",
    },
    "brute": {
        "idle": "assets/stage1/stage1_tau/tau_warrior_idle_4f.png",
        "walk": "assets/stage1/stage1_tau/tau_warrior_walk_6f.png",
        "attack": "assets/stage1/stage1_tau/tau_warrior_slam_4f.png",
    },
    "shooter": {
        "idle": "assets/stage1/stage1_goblins/fire_goblin_idle_4f.png",
        "walk": "assets/stage1/stage1_goblins/fire_goblin_walk_6f.png",
        "attack": "assets/stage1/stage1_goblins/fire_goblin_cast_4f.png",
    },
    "boss": {
        "idle": "assets/stage1/stage1_tau/tau_chief_idle_4f.png",
        "walk": "assets/stage1/stage1_tau/tau_chief_move_6f.png",
        "attack": "assets/stage1/stage1_tau/tau_chief_slam_6f.png",
        "charge": "assets/stage1/stage1_tau/tau_chief_charge_6f.png",
    },
}

# id -> (source body, stage colour, role accent)
SETS = {
    "s2Imp": ("imp", (51, 139, 124), (114, 231, 183)),
    "s2Brute": ("brute", (44, 112, 105), (91, 209, 178)),
    "s2Shooter": ("shooter", (44, 130, 116), (114, 241, 194)),
    "s2Suicide": ("imp", (77, 151, 90), (203, 255, 82)),
    "s2Boss": ("boss", (36, 106, 92), (96, 242, 191)),
    "s3Imp": ("imp", (96, 77, 146), (195, 122, 255)),
    "s3Brute": ("brute", (77, 58, 122), (176, 96, 235)),
    "s3Shooter": ("shooter", (105, 70, 142), (224, 125, 255)),
    "s3Suicide": ("imp", (124, 66, 126), (255, 100, 220)),
    "s3Boss": ("boss", (72, 45, 112), (207, 100, 255)),
    "s4Imp": ("imp", (145, 68, 42), (255, 143, 57)),
    "s4Shooter": ("shooter", (151, 58, 36), (255, 121, 42)),
    "s4FireMage": ("shooter", (155, 44, 27), (255, 226, 73)),
    "s4Boss": ("boss", (126, 42, 26), (255, 100, 37)),
    "s5Imp": ("imp", (57, 105, 151), (125, 213, 255)),
    "s5Shooter": ("shooter", (48, 99, 157), (112, 218, 255)),
    "s5FrostSuicide": ("imp", (75, 137, 173), (218, 251, 255)),
    "s5IceMage": ("shooter", (58, 104, 173), (171, 235, 255)),
    "s5Boss": ("boss", (42, 79, 137), (112, 203, 255)),
    "s6Imp": ("imp", (76, 99, 65), (166, 204, 113)),
    "s6Shooter": ("shooter", (68, 91, 60), (155, 220, 105)),
    "s6Summoner": ("shooter", (61, 91, 61), (119, 255, 131)),
    "s6Zombie": ("imp", (75, 84, 66), (184, 207, 129)),
    "s6Boss": ("boss", (53, 72, 49), (133, 222, 94)),
    "s7Imp": ("imp", (85, 58, 112), (196, 112, 255)),
    "s7Shooter": ("shooter", (68, 49, 106), (171, 100, 255)),
    "s7VoidMage": ("shooter", (49, 38, 91), (220, 91, 255)),
    "s7Charger": ("brute", (82, 45, 88), (255, 92, 209)),
    "s7Boss": ("boss", (52, 31, 78), (204, 69, 255)),
}

ENVIRONMENT = {
    "floor": "assets/stage1/stage1_background/forest_floor_room.png",
    "treeA": "assets/stage1/stage1_forest_foreground/great_tree_a.png",
    "treeB": "assets/stage1/stage1_forest_foreground/great_tree_b.png",
    "bushA": "assets/stage1/stage1_forest_foreground/dark_bush_a.png",
    "bushB": "assets/stage1/stage1_forest_foreground/dark_bush_b.png",
    "stoneA": "assets/stage1/stage1_forest_foreground/guardian_stone_a.png",
    "stoneB": "assets/stage1/stage1_forest_foreground/guardian_stone_b.png",
    "vineTop": "assets/stage1/stage1_forest_foreground/root_vine_top.png",
}
STAGE_ENV_COLOURS = {
    2: ((47, 101, 85), (91, 167, 126)), 3: ((77, 61, 102), (144, 104, 166)),
    4: ((112, 66, 38), (177, 103, 43)), 5: ((54, 85, 112), (107, 158, 185)),
    6: ((62, 77, 55), (113, 130, 79)), 7: ((48, 37, 69), (103, 66, 126)),
}


def recolour(src: Path, target: tuple[int, int, int], accent: tuple[int, int, int]) -> Image.Image:
    image = Image.open(src).convert("RGBA")
    out = Image.new("RGBA", image.size)
    pixels = []
    for r, g, b, a in image.getdata():
        if a < 128:
            pixels.append((0, 0, 0, 0))
            continue
        lum = (r * 54 + g * 183 + b * 19) / 256 / 255
        vivid = max(r, g, b) - min(r, g, b)
        base = accent if vivid > 70 and lum > 0.48 else target
        shade = 0.32 + lum * 0.9
        pixels.append(tuple(min(255, int(c * shade)) for c in base) + (255,))
    out.putdata(pixels)
    return out


def main() -> None:
    generated = 0
    for art_set, (source_name, target, accent) in SETS.items():
        stage = art_set[1]
        out_dir = PUBLIC / "assets" / "temp" / f"stage{stage}" / art_set
        out_dir.mkdir(parents=True, exist_ok=True)
        for state, rel in SOURCES[source_name].items():
            recolour(PUBLIC / rel, target, accent).save(out_dir / f"{state}.png")
            generated += 1
    for stage, (target, accent) in STAGE_ENV_COLOURS.items():
        out_dir = PUBLIC / "assets" / "temp" / f"stage{stage}" / "environment"
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, rel in ENVIRONMENT.items():
            recolour(PUBLIC / rel, target, accent).save(out_dir / f"{name}.png")
            generated += 1
    print(f"generated {generated} temporary stage sheets")


if __name__ == "__main__":
    main()
