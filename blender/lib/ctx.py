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
