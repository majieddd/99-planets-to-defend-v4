"""What a recipe receives and what it returns."""
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class AnimRecord:
    name: str
    duration: float            # seconds
    loop: bool
    strike: float | None = None  # seconds from the start, for attacks


@dataclass
class Placeable:
    """Something the runtime stands on the ground by itself: the whole asset (node None) or one top-level node of the
    GLB. assets:check measures the lowest point of its geometry in the bind pose against its placement origin and fails
    unless that point lies within 5 mm of the origin or, with a `sink`, within 5 mm of `sink` metres under it. A sink is
    a designed burial, such as a rock bedding its base into uneven ground. It is the depth the geometry has, not a bound
    on it, and the recipe that declares one says why beside it.

    The placement origin is the point the runtime puts on the ground. For a top-level empty it is the empty's own
    origin, since the runtime sets the empty's position and rotation; the build refuses such an empty that carries a
    rotation, which placing it would discard. For the whole asset and for a top-level mesh node it is the asset origin:
    the optimizer's quantizer replaces a mesh node's authored origin with its quantization box, and the runtime
    composes that node's transform into each placement instead of overwriting it.

    Empty and mesh are told apart on the shipped GLB, so the split relies on the quantizer (glTF-Transform 4.5) moving
    the mesh of any node that has children onto a new unnamed child: a Blender mesh object with children ships as an
    empty at its authored origin and is measured from there, which is how the old Bolt Sentinel roots, plinths carrying
    their yaw rings, were measured from mid-plinth and failed. A recipe that wants a mesh placed by an origin of its own
    parents it under an empty at that origin, as bolt_sentinel.py does, instead of counting on that split."""
    node: str | None = None
    sink: float = 0.0          # metres


@dataclass
class AssetRecord:
    name: str                  # e.g. 'bulwark'
    family: str                # commanders | xeno | towers | heart | nests | env | textures
    file: str                  # path under the output root, e.g. 'commanders/bulwark.glb'
    kind: str = 'model'        # model | texture
    recipe: str = ''
    nodes: list = field(default_factory=list)
    animations: list = field(default_factory=list)
    tris: int = 0
    notes: dict = field(default_factory=dict)
    # What the runtime places by itself (Placeable). Empty means the whole asset, with no sink. assets:check also
    # measures every top-level empty of the GLB that has geometry under it as a placement handle, declared or not, so
    # a root left above or below the ground fails without its recipe declaring anything. An empty with no geometry
    # under it, such as a marker, is skipped: it has no lowest point to stand on the ground.
    placeables: list = field(default_factory=list)


@dataclass
class BuildContext:
    root: Path                 # repository root
    out: Path                  # raw GLB, sidecars and bake textures
    previews: Path             # preview renders
    textures: Path             # public/assets/textures (the brush atlas lives here)
    seed: int = 1
    previews_enabled: bool = True
    recipe: str = ''

    def ensure_dirs(self):
        for path in (self.out, self.previews, self.textures):
            path.mkdir(parents=True, exist_ok=True)

    def raw_path(self, family, name):
        path = self.out / family / f'{name}.glb'
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def bake_dir(self, family):
        path = self.out / family / 'textures'
        path.mkdir(parents=True, exist_ok=True)
        return path

    def preview_dir(self, name):
        path = self.previews / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def timings(self):
        return json.loads((self.root / 'src' / 'shared' / 'timings.json').read_text(encoding='utf-8'))

    def write_sidecar(self, record):
        record.recipe = self.recipe
        path = self.out / record.family / f'{record.name}.meta.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        data = asdict(record)
        data['animations'] = [asdict(a) if hasattr(a, '__dataclass_fields__') else a for a in record.animations]
        path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
        return path
