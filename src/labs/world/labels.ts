import { Vector3, type PerspectiveCamera } from 'three';

/** A member's label stands over the point it marks, its tail pointing down; a family's placard hangs under its point. */
export type LabelKind = 'family' | 'member';

export interface LabelSpec {
  key: string;
  kind: LabelKind;
  /** The family the label belongs to: a placard's own, or a member's. */
  family: string;
  text: string;
  /** A placard's smaller second line: the family's key, which `?family=` takes. */
  detail?: string;
  /** A member label's second line in the member's own view, which shows no placard: its family's name. */
  line?: string;
  anchor: Vector3;
}

interface Label {
  spec: LabelSpec;
  node: HTMLElement;
  name: HTMLElement;
  line: HTMLElement | null;
  shown: boolean;
  x: number;
  y: number;
}

/** What the page reads back about a label, for the browser tests. */
export interface LabelReading {
  key: string;
  kind: LabelKind;
  text: string;
  /** The second line: a placard's family key (which phones hide), or a member's family name in the member's own view. */
  line: string | null;
  shown: boolean;
  x: number;
  y: number;
  fontPx: number;
}

/** How far a label must move, in CSS pixels, before its transform is written again. */
const MOVE_PX = 0.05;

/**
 * DOM labels over the canvas, each carried to a point in the world every frame. They are interface, not paint, so they
 * are text on backplates in the interface's tokens, sized for a phone, and never part of the rendered frame: a capture
 * of the canvas alone has none. They take no pointer events, so the orbit camera still turns under them.
 */
export class WorldLabels {
  private readonly labels = new Map<string, Label>();
  private readonly view = new Vector3();
  private readonly ndc = new Vector3();
  private focused: Label | null = null;

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
    let line: HTMLElement | null = null;
    if (spec.line) {
      line = document.createElement('span');
      line.className = 'world-label-line';
      line.textContent = spec.line;
      node.appendChild(line);
    }
    node.hidden = true;
    this.host.appendChild(node);
    this.labels.set(spec.key, { spec, node, name, line, shown: false, x: Number.NaN, y: Number.NaN });
  }

  specs(): LabelSpec[] {
    return [...this.labels.values()].map((label) => label.spec);
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

  /** Shows the second line of one member's label, the member whose own view is open, or of none. */
  focus(key: string | null): void {
    const next = (key && this.labels.get(key)) || null;
    if (next === this.focused) return;
    this.focused?.node.classList.remove('world-label-focused');
    next?.node.classList.add('world-label-focused');
    this.focused = next;
  }

  /**
   * Places every label the view shows over its anchor, and hides the rest along with any whose anchor is behind the
   * camera or off the canvas. Only transform and the hidden flag change, so a frame never lays out the page, and a label
   * that has not moved keeps its transform, so a still camera writes no styles and builds no strings.
   */
  update(camera: PerspectiveCamera, width: number, height: number, shows: (spec: LabelSpec) => boolean): void {
    camera.updateMatrixWorld();
    for (const label of this.labels.values()) {
      let shown = shows(label.spec);
      let x = label.x;
      let y = label.y;
      if (shown) {
        this.view.copy(label.spec.anchor).applyMatrix4(camera.matrixWorldInverse);
        shown = this.view.z < -camera.near;
      }
      if (shown) {
        this.ndc.copy(label.spec.anchor).project(camera);
        shown = Math.abs(this.ndc.x) <= 1 && Math.abs(this.ndc.y) <= 1;
        x = ((this.ndc.x + 1) / 2) * width;
        y = ((1 - this.ndc.y) / 2) * height;
      }
      if (shown && !(Math.abs(x - label.x) < MOVE_PX && Math.abs(y - label.y) < MOVE_PX)) {
        const rise = label.spec.kind === 'member' ? '-100%' : '0';
        label.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, ${rise})`;
        label.x = x;
        label.y = y;
      }
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
      line: label.spec.kind === 'family' ? (label.spec.detail ?? null) : label === this.focused ? (label.spec.line ?? null) : null,
      shown: label.shown,
      x: label.x,
      y: label.y,
      fontPx: parseFloat(getComputedStyle(label.name).fontSize),
    }));
  }
}
