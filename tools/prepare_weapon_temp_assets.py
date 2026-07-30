"""Create small runtime-ready temporary weapon sprites from the approved weapon atlas.

The source atlas is kept as the art handoff.  This script only derives the
individual runtime sprites and two lightweight style sheets used by the game.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public/assets/player/weapon_atlas_temp.png"
OUT = ROOT / "public/assets/player/weapons"
FX = ROOT / "public/assets/player/fx"

SLOTS = {
    "m1911": (0, 0), "smg": (1, 0), "shotgun": (2, 0), "rifle": (3, 0),
    "magnum": (0, 1), "crossbow": (1, 1), "autocannon": (2, 1),
    "katana": (0, 2), "daggers": (1, 2), "rapier": (2, 2), "greatsword": (3, 2),
    "warhammer": (0, 3), "glaive": (1, 3), "moonblade": (2, 3),
}


def tight(sprite: Image.Image, pad: int = 4) -> Image.Image:
    alpha = sprite.getchannel("A")
    box = alpha.getbbox()
    if not box:
        return Image.new("RGBA", (8, 8))
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(sprite.width, x1 + pad), min(sprite.height, y1 + pad)
    return sprite.crop((x0, y0, x1, y1))


def write_sliced_weapons() -> None:
    atlas = Image.open(ATLAS).convert("RGBA")
    xs = (0, 314, 627, 941, atlas.width)
    ys = (0, 314, 627, 941, atlas.height)
    OUT.mkdir(parents=True, exist_ok=True)
    for weapon_id, (col, row) in SLOTS.items():
        # The two user-requested replacements are generated independently and
        # must not be overwritten by an atlas crop.
        target = OUT / f"{weapon_id}.png"
        if weapon_id in {"rifle", "daggers"} and target.exists():
            image = tight(Image.open(target).convert("RGBA"))
        else:
            cell = atlas.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
            image = tight(cell)
        max_side = 96
        scale = min(1, max_side / max(image.size))
        if scale < 1:
            image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.NEAREST)
        image.save(target)


def write_projectile_sheet() -> None:
    colors = [
        ("#fff4b0", "#e8b543"), ("#b7f0ff", "#45a7df"), ("#ffd68a", "#e77a2c"),
        ("#d6f5ff", "#68b8e8"), ("#fff0c9", "#e6a445"), ("#eff7ff", "#9fc5d8"),
        ("#ffb34d", "#d84c2b"),
    ]
    size = 24
    sheet = Image.new("RGBA", (size * len(colors), size))
    draw = ImageDraw.Draw(sheet)
    for i, (core, trail) in enumerate(colors):
        x = i * size
        draw.rectangle((x + 3, 10, x + 14, 13), fill=trail)
        draw.rectangle((x + 10, 8, x + 18, 15), fill=trail)
        draw.rectangle((x + 14, 9, x + 20, 14), fill=core)
        draw.rectangle((x + 19, 10, x + 21, 13), fill="#ffffff")
    FX.mkdir(parents=True, exist_ok=True)
    sheet.save(FX / "weapon_projectiles_temp.png")


def write_melee_sheet() -> None:
    colors = ["#f6d99a", "#ffd878", "#edf2ff", "#f1bb7b", "#ffb15e", "#abef9e", "#8ee9ff"]
    size = 48
    sheet = Image.new("RGBA", (size * len(colors), size))
    draw = ImageDraw.Draw(sheet)
    for i, color in enumerate(colors):
        x = i * size
        # A compact crescent arc.  It is oriented rightward and rotated by the
        # renderer to the player aim direction.
        draw.arc((x + 4, 4, x + 44, 44), start=208, end=330, fill=color, width=5)
        draw.arc((x + 8, 8, x + 40, 40), start=210, end=325, fill="#ffffff", width=2)
        draw.rectangle((x + 34, 20, x + 42, 27), fill=color)
    FX.mkdir(parents=True, exist_ok=True)
    sheet.save(FX / "weapon_melee_fx_temp.png")


if __name__ == "__main__":
    write_sliced_weapons()
    write_projectile_sheet()
    write_melee_sheet()
    print("Temporary weapon sprites created.")
