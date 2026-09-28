import { Vector3, type PerspectiveCamera } from 'three';

/** A member's label stands over the point it marks, its tail pointing down; a family's placard hangs under its point. */
export type LabelKind = 'family' | 'member';

export interface LabelSpec {
  key: string;
  kind: LabelKind;
  text: string;
  /** A smaller second line: the family's key, which `?family=` takes. */
  detail?: string;
  anchor: Vector3;
}

interface Label {
  spec: LabelSpec;
  node: HTMLElement;
  name: HTMLElement;
  shown: boolean;
  x: number;
  y: number;
}

/** What the page reads back about a label, for the browser tests. */
export interface LabelReading {
  key: string;
  kind: LabelKind;
  text: string;
  shown: boolean;
  x: number;
  y: number;
  fontPx: number;
}

/**
 * DOM labels over the canvas, each carried to a point in the world every frame. They are interface, not paint, so they
 * are text on backplates in the interface's tokens, sized for a phone, and never part of the rendered frame: a capture
 * of the canvas alone has none. They take no pointer events, so the orbit camera still turns under them.
 */
export class WorldLabels {
  private readonly labels = new Map<string, Label>();
  private readonly view = new Vector3();
  private readonly ndc = new Vector3();

  constructor(private readonly host: HTMLElement) {}

  add(spec: LabelSpec): void {
    const node = document.createElement('div');
    node.className = `world-label world-label-${spec.kind}`;
    node.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'world-label-name';
    name.textContent = spec.text;
    node.appendChild(name);
    if (spec.detail) {
      const detail = document.createElement('span');
      detail.className = 'world-label-detail';
      detail.textContent = spec.detail;
      node.appendChild(detail);
    }
    node.hidden = true;
    this.host.appendChild(node);
    this.labels.set(spec.key, { spec, node, name, shown: false, x: 0, y: 0 });
  }

  spec(key: string): LabelSpec | undefined {
    return this.labels.get(key)?.spec;
  }

  setText(key: string, text: string): void {
    const label = this.labels.get(key);
    if (!label || label.spec.text === text) return;
    label.spec.text = text;
    label.name.textContent = text;
  }

  setAnchor(key: string, anchor: Vector3): void {
    this.labels.get(key)?.spec.anchor.copy(anchor);
  }

  /**
   * Places every label the policy wants shown over its anchor, and hides the rest along with any whose anchor is behind
   * the camera or off the canvas. Only transform and the hidden flag change, so a frame never lays out the page.
   */
  update(camera: PerspectiveCamera, width: number, height: number, wanted: (spec: LabelSpec) => boolean): void {
    camera.updateMatrixWorld();
    for (const label of this.labels.values()) {
      let shown = wanted(label.spec);
      if (shown) {
        this.view.copy(label.spec.anchor).applyMatrix4(camera.matrixWorldInverse);
        shown = this.view.z < -camera.near;
      }
      if (shown) {
        this.ndc.copy(label.spec.anchor).project(camera);
        shown = Math.abs(this.ndc.x) <= 1 && Math.abs(this.ndc.y) <= 1;
        label.x = ((this.ndc.x + 1) / 2) * width;
        label.y = ((1 - this.ndc.y) / 2) * height;
      }
      const rise = label.spec.kind === 'member' ? '-100%' : '0';
      if (shown) label.node.style.transform = `translate3d(${label.x.toFixed(1)}px, ${label.y.toFixed(1)}px, 0) translate(-50%, ${rise})`;
      if (shown !== label.shown) {
        label.node.hidden = !shown;
        label.shown = shown;
      }
    }
  }

  read(): LabelReading[] {
    return [...this.labels.values()].map((label) => ({
      key: label.spec.key,
      kind: label.spec.kind,
      text: label.spec.text,
      shown: label.shown,
      x: label.x,
      y: label.y,
      fontPx: parseFloat(getComputedStyle(label.name).fontSize),
    }));
  }
}
