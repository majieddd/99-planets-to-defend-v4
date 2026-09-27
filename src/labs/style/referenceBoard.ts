import type { Theme } from '../../render/themes';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function list(items: string[]): HTMLUListElement {
  const ul = el('ul');
  for (const item of items) ul.appendChild(el('li', item));
  return ul;
}

/** The board describes the references in words and swatches; it carries no copied imagery. */
export function mountReferenceBoard(host: HTMLElement, theme: Theme): void {
  host.replaceChildren();
  const toggle = el('button', 'Reference board', 'board-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const body = el('div', undefined, 'board-body');
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  body.append(
    el('h2', 'What we are matching'),
    list([
      'Painted 3D from the Sifu flashback: simple forms, hand-painted brush-stroke colour on every surface.',
      'A hard-edged light and shadow boundary with painted gradients inside each zone.',
      'Warm amber key light against teal and green coloured shadows; saturated accents.',
      'Characters blend cel and standard lighting; environments stay painted.',
      'Borderlands ink: bold, near-black silhouette lines on outer edges and major creases.',
      'The flashback ink sketch (black and white with one warm accent) is the cutscene mode.',
    ]),
    el('h2', 'Frozen nouns'),
    el('p', 'painted brush-stroke albedo, brush-edged shadow, coloured shadow, ink silhouette, gunmetal and enamel, cyan energy channel, wet chitin, magenta seam light, warm heart crystal, painted sky'),
    el('h2', 'Calibration from v3 (Painted-Anime-Inkline 1.3.2)'),
    el('p', 'line 1.81, texture 1.5, saturation 1.3, shadow depth 0.35, exposure 0.77'),
    el('h2', `${theme.name} palette`),
  );
  const swatches = el('div', undefined, 'swatches');
  const colours: [string, string][] = [
    ['sun', theme.sun.color],
    ['shadow', theme.shadowTint],
    ['zenith', theme.sky.zenith],
    ['horizon', theme.sky.horizon],
    ['meadow', theme.ground.meadow],
    ['meadow light', theme.ground.meadowLight],
    ['moss', theme.ground.moss],
    ['stone', theme.ground.stone],
    ['soil', theme.ground.soil],
  ];
  for (const [name, hex] of colours) {
    const swatch = el('div', undefined, 'swatch');
    const chip = el('span', undefined, 'chip');
    chip.style.background = hex;
    swatch.append(chip, el('span', `${name} ${hex}`));
    swatches.appendChild(swatch);
  }
  body.appendChild(swatches);
  body.appendChild(el('h2', 'Audit bands'));
  body.appendChild(list(theme.bands.map((band) => `${band.name}: ${band.hueMin} to ${band.hueMax} degrees`)));
  const link = el('a', 'Owner reference clip (YouTube)');
  link.href = 'https://www.youtube.com/watch?v=B-KxB2ip3JY';
  link.target = '_blank';
  link.rel = 'noopener';
  body.appendChild(link);
  host.append(toggle, body);
}
