import { expect, test } from '@playwright/test';
import { DEFAULT_DIALS } from '../../src/render/defaults';
import type { SetDialsResult } from '../../src/render/dialsCodec';

interface AuditResult {
  report: { verdict: string; concentration: number; chromaticShare: number };
  mutation: { rejected: boolean; rotation: number; report: { verdict: string } };
}

test('the style lab renders every preset and passes its colour audit', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // The lab keeps its drawing buffer, so a screenshot or audit taken before the new camera's frame is drawn reads the
  // previous preset's frame and can pass while measuring the wrong picture. A fixed 800 ms wait allowed that: with four
  // lab pages running at once, each preset step took 3 to 4 s. three asks for each next frame before it runs the lab's
  // loop, so its request is queued ahead of this one and the first frame that answers here has already drawn the new
  // camera; the second frame is margin.
  const nextFrames = (n: number) =>
    page.evaluate(
      (count) =>
        new Promise<void>((done) => {
          const step = (left: number): void => {
            if (left === 0) done();
            else requestAnimationFrame(() => step(left - 1));
          };
          step(count);
        }),
      n,
    );
  // Headless Chromium renders in software (SwiftShader), in CI and on the development laptop alike, so the test runs
  // the low tier; the owner reviews high-tier frames in a headed browser.
  await page.goto('./labs/style.html?tier=low');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  // One folder per project: the Pages base-path pass would otherwise overwrite the root pass's frames.
  const frames = `test-results/${test.info().project.name}`;
  for (const preset of ['hero', 'strategic', 'closeup', 'horizon']) {
    await page.evaluate((name) => (window.__P99__!['preset'] as (n: string) => void)(name), preset);
    await nextFrames(2);
    await page.screenshot({ path: `${frames}/style-${preset}.png` });
  }
  await page.evaluate(() => (window.__P99__!['preset'] as (n: string) => void)('hero'));
  await nextFrames(2);
  const result = (await page.evaluate(() => (window.__P99__!['audit'] as () => unknown)())) as AuditResult;
  const { report, mutation } = result;
  // The printed line is the run's evidence for the review. Both assertions carry it because a verdict alone hides its
  // cause: 'inconclusive' comes from the chromatic share, not the hue test, and a mutation that is not rejected needs
  // its rotation and verdict to explain why.
  const line =
    `style lab audit [${test.info().project.name}]: verdict ${report.verdict}, ` +
    `concentration ${report.concentration.toFixed(2)} x chance, chromatic share ${report.chromaticShare.toFixed(2)}, ` +
    `mutation rotation ${mutation.rotation} degrees, mutation verdict ${mutation.report.verdict}`;
  console.log(line);
  expect(report.verdict, line).toBe('pass');
  expect(mutation.rejected, line).toBe(true);
  expect(errors).toEqual([]);
});

// The frames the handle test keeps in the page, and the mean absolute difference between two of them, per channel.
interface HandleFrames {
  snap(name: string): void;
  difference(a: string, b: string): number;
}

// The measured frames in the look pass and the owner's gate move dials through window.__P99__.setDials and hold the
// scene with freeze, so both are held to their word here: a move changes the frame, the old values bring the old frame
// back exactly, a bad value is refused by name (keeping the value its dial had, moved or not) instead of silently
// leaving a default, and a frozen scene does not move.
test.describe('the style lab test handle', () => {
  // Headless Chromium draws in software (SwiftShader), which took about 227 ms per 1280 x 720 frame while the lab's loop
  // asked for one every 97 ms, so each canvas read waited out a queue of frames: the five reads of the 1280 x 720 test
  // spent 26 to 28 s there, and serializing each 57,600-number frame cost up to 1.4 s more, 2.1 minutes a project in
  // the suite against a 240 s budget. At 480 x 270 a frame costs a fraction of that; the frames stay in the page, which
  // returns only their differences; and the reads follow each other within one evaluate or a few milliseconds apart,
  // so no read finds more than the last few frames queued ahead of it. Alone under SwiftShader the old test took 34 s
  // for five reads, and this one takes 7 s for twelve.
  test.use({ viewport: { width: 480, height: 270 } });

  test('moves, restores, refuses and freezes', async ({ page }) => {
    // The same budget as the other lab tests, which a slow CI runner's first shader compile can need; locally under
    // SwiftShader the test takes about 7 s alone.
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('./labs/style.html?tier=low&freeze=1');
    await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });

    // A 160 x 90 copy of the canvas per frame, kept in the page: enough to see any dial's change.
    await page.evaluate(() => {
      const source = document.querySelector('#stage canvas') as HTMLCanvasElement;
      const small = document.createElement('canvas');
      small.width = 160;
      small.height = 90;
      const context = small.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      const frames = new Map<string, Uint8ClampedArray>();
      const handle: HandleFrames = {
        snap(name) {
          context.drawImage(source, 0, 0, 160, 90);
          frames.set(name, context.getImageData(0, 0, 160, 90).data);
        },
        difference(a, b) {
          const x = frames.get(a) as Uint8ClampedArray;
          const y = frames.get(b) as Uint8ClampedArray;
          let sum = 0;
          for (let i = 0; i < x.length; i++) sum += Math.abs((x[i] as number) - (y[i] as number));
          return sum / x.length;
        },
      };
      (window as unknown as { __handleFrames: HandleFrames }).__handleFrames = handle;
    });
    // Moves the dials (when given), waits for the frame that shows the move and keeps it. three asks for its next frame
    // before the lab's loop runs, so the second frame to answer here has drawn any change.
    const step = (name: string, changes: Record<string, unknown> | null = null) =>
      page.evaluate(
        async ({ name, changes }) => {
          const result = changes ? (window.__P99__!['setDials'] as (c: Record<string, unknown>) => SetDialsResult)(changes) : null;
          await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          (window as unknown as { __handleFrames: HandleFrames }).__handleFrames.snap(name);
          return result;
        },
        { name, changes },
      );
    const difference = (a: string, b: string) =>
      page.evaluate(([x, y]) => (window as unknown as { __handleFrames: HandleFrames }).__handleFrames.difference(x as string, y as string), [a, b]);
    const setDials = (changes: Record<string, unknown>) =>
      page.evaluate((c) => (window.__P99__!['setDials'] as (c: Record<string, unknown>) => SetDialsResult)(c), changes);

    const original = await page.evaluate(() => (window.__P99__!['dials'] as () => Record<string, unknown>)());
    await step('before');
    // The locked sun is at 15 degrees, so the move goes to the Verdant theme's own 35: from 15 up to 35 the frame
    // changed by 3.25 under SwiftShader, and from 15 down to 8 by only 2.2, against a floor of 2 for the check below.
    const moved = (await step('sun', { sunElevation: 35 })) as SetDialsResult;

    // With the sun still moved, one bad value of each kind next to one good move: out of range, not a colour, not a
    // dial at all, a string for a number, and a string outside Latin-1 (btoa threw on it, so once nothing moved at all).
    // A refused dial keeps the value it had: the moved sun stays at 35, not the default.
    const refused = await setDials({ sunElevation: 200, shadowTint: 'teal', notADial: 1, bandSoftness: '0.1', inkColor: '#12345☃', exposure: 0.5 });

    // Restored after the refusal, the frame is the very first one: the refusal left nothing behind, and the frozen
    // scene did not move in between.
    const restored = (await step('back', original)) as SetDialsResult;

    // Each look pass dial changes the frame when moved, and moving it back gives the first frame again exactly. The
    // locked look already has a prop brush of 1.3, lit saturation of 1.09 and an actor fill of 1.4, so each move goes to a
    // value away from its locked one: renderer v1's start for the brush and the fill, a restraint for the saturation.
    const looks: [string, number][] = [
      ['propBrush', 0],
      ['litSaturation', 0.8],
      ['shadowLift', 0.05],
      ['actorFill', 0],
    ];
    const lookMoves: Record<string, SetDialsResult> = {};
    for (const [key, value] of looks) {
      lookMoves[key] = (await step(key, { [key]: value })) as SetDialsResult;
      await step(`${key} back`, { [key]: original[key] });
    }

    const differences: Record<string, number> = { sun: await difference('before', 'sun'), back: await difference('before', 'back') };
    for (const [key] of looks) {
      differences[key] = await difference('before', key);
      differences[`${key} back`] = await difference('before', `${key} back`);
    }
    const fmt = (n: number) => n.toFixed(3);
    const line =
      `style lab test handle [${test.info().project.name}]: ` +
      Object.entries(differences)
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(', ') +
      `, refused ${JSON.stringify(refused.rejected)}`;
    console.log(line);
    expect(moved.rejected, line).toEqual([]);
    expect(moved.dials.sunElevation, line).toBe(35);
    expect(differences['sun'], line).toBeGreaterThan(2);
    expect([...refused.rejected].sort(), line).toEqual(['bandSoftness', 'inkColor', 'notADial', 'shadowTint', 'sunElevation']);
    expect(refused.dials.sunElevation, line).toBe(35);
    expect(refused.dials.shadowTint, line).toBe(original['shadowTint']);
    expect(refused.dials.bandSoftness, line).toBe(original['bandSoftness']);
    expect(refused.dials.inkColor, line).toBe(original['inkColor']);
    expect(refused.dials.exposure, line).toBe(0.5);
    expect(restored.rejected, line).toEqual([]);
    expect(differences['back'], line).toBe(0);
    for (const [key, value] of looks) {
      expect(lookMoves[key]!.rejected, line).toEqual([]);
      expect(lookMoves[key]!.dials[key as keyof SetDialsResult['dials']], line).toBe(value);
      expect(differences[key], `${key}: ${line}`).toBeGreaterThan(0.05);
      expect(differences[`${key} back`], `${key}: ${line}`).toBe(0);
    }

    // Unfrozen, the scene moves (the Husk walks, the commander cycles), which shows the freeze held it. The grain is off at
    // the defaults, so the difference is the scene's motion alone: with Bulwark, 0.26 to 0.29 in five runs under
    // SwiftShader at renderer v1's dials and 0.29 and 0.30 in two at the locked ones; with Pip, the default commander since
    // 2026-10-04, 0.43 and 0.72 on the two projects of one run. The grain's re-seeding at its old default of 0.04 had made
    // the difference about 2.8, which would have hidden a scene that never moved.
    await page.evaluate(() => (window.__P99__!['freeze'] as (on: boolean) => void)(false));
    await page.waitForTimeout(600);
    await step('running');
    await page.evaluate(() => (window.__P99__!['freeze'] as (on: boolean) => void)(true));
    const unfrozen = await difference('back', 'running');
    const last = `${line}, unfrozen ${fmt(unfrozen)}`;
    console.log(last);
    expect(unfrozen, last).toBeGreaterThan(0.02);
    expect(errors).toEqual([]);
  });
});

// Pip (commander) is the lab's default commander, by the owner's decision of 2026-10-04, and loads with the other models
// so the first frame shows him; Bulwark, the alternate the locked look was approved on, opens by the address or the
// panel, and a lab opened on him loads nothing of Pip until the panel switches. A Pip who fails to load leaves Bulwark
// in a running lab.
test.describe('the style lab commander toggle', () => {
  test.use({ viewport: { width: 480, height: 270 } });

  test('opens on Pip by default and by name, on Bulwark by name, switches, names an unknown commander, and falls back without Pip or when he fails to load', async ({ page }) => {
    // Seven loads at about 48 s a load, the allowance the five-load test had in its 240 s.
    test.setTimeout(330_000);
    // Each error keeps the load it came in and where it came from, a console error or an uncaught page error, so the two
    // loads in which Pip's GLB answers 404 can expect their own console errors explicitly while every other load, and
    // every page error in any load, must be absent.
    let loadName = '';
    const errors: { load: string; source: 'console' | 'pageerror'; text: string; url: string }[] = [];
    const warnings: string[] = [];
    let requests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ load: loadName, source: 'console', text: message.text(), url: message.location().url });
      if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('pageerror', (error) => errors.push({ load: loadName, source: 'pageerror', text: String(error), url: '' }));
    page.on('request', (request) => requests.push(request.url()));
    // One reading per load: the commander shown, the panel's choice and its options, whether Pip's model was requested,
    // whether a face pose holds, the banner and the dials; then, when asked, a switch to another commander and the
    // banner after it.
    const load = async (name: string, query: string, switchTo: string | null = null) => {
      loadName = name;
      requests = [];
      await page.goto(`./labs/style.html?tier=low&freeze=1${query}`);
      await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
      const pipRequestedAtLoad = requests.some((url) => url.includes('commander_pip'));
      const read = await page.evaluate(async (next) => {
        const p99 = window.__P99__!;
        const call = <T>(name: string, ...args: unknown[]) => (p99[name] as (...a: unknown[]) => T)(...args);
        const select = () =>
          [...document.querySelectorAll('.lil-gui .lil-controller')]
            .find((controller) => controller.querySelector('.lil-name')?.textContent === 'commander')
            ?.querySelector('select') ?? null;
        const reading = {
          shown: call<string>('commander'),
          panel: select()?.selectedOptions[0]?.textContent ?? null,
          options: [...(select()?.options ?? [])].map((option) => option.textContent),
          face: call<boolean>('setFace', { blink: 1 }),
          faceReleased: call<boolean>('setFace', null),
          banner: document.getElementById('banner')!.hidden ? '' : document.getElementById('banner')!.textContent,
          dials: call<Record<string, unknown>>('dials'),
          switched: null as string | null,
          switchedPanel: null as string | null,
          switchedFace: null as boolean | null,
          switchedBanner: null as string | null,
        };
        if (next) {
          reading.switched = await call<Promise<string>>('setCommander', next);
          reading.switchedPanel = select()?.selectedOptions[0]?.textContent ?? null;
          reading.switchedFace = call<boolean>('setFace', { blink: 1 });
          call('setFace', null);
          reading.switchedBanner = document.getElementById('banner')!.hidden ? '' : document.getElementById('banner')!.textContent;
        }
        return reading;
      }, switchTo);
      return { ...read, pipRequestedAtLoad, pipRequestedAfter: requests.some((url) => url.includes('commander_pip')) };
    };

    const byDefault = await load('default', '', 'bulwark');
    const bulwark = await load('bulwark', '&commander=bulwark', 'pip');
    const pip = await load('pip', '&commander=pip');
    const unknown = await load('nope', '&commander=nope');
    // A build whose manifest has no Pip: the default falls back to Bulwark and the banner says why.
    await page.route('**/assets/manifest.json', async (route) => {
      const response = await route.fetch();
      const shipped = (await response.json()) as { assets: { name: string }[] };
      await route.fulfill({ response, json: { ...shipped, assets: shipped.assets.filter((entry) => entry.name !== 'commander_pip') } });
    });
    const missing = await load('missing', '');
    await page.unroute('**/assets/manifest.json');
    // A build whose manifest lists Pip but whose GLB is missing or corrupt, at the start and on the panel's switch from
    // Bulwark: either used to stop the lab ("Style Lab failed to start", or "stopped" on the switch).
    await page.route('**/commander_pip*.glb', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
    const failedAtStart = await load('failed at start', '');
    const failedOnSwitch = await load('failed on switch', '&commander=bulwark', 'pip');
    await page.unroute('**/commander_pip*.glb');
    loadName = '';
    const summary = (name: string, r: typeof byDefault) =>
      `${name} shows ${r.shown} (panel "${r.panel}" of ${JSON.stringify(r.options)}, Pip requested at load ${r.pipRequestedAtLoad}, ` +
      `face ${r.face}/${r.faceReleased}, banner "${r.banner}")` +
      (r.switched
        ? `, switched to ${r.switched} (panel "${r.switchedPanel}", face ${r.switchedFace}, Pip requested by then ${r.pipRequestedAfter}, banner "${r.switchedBanner}")`
        : '');
    // The failed loads' own console errors, and only those, are expected: the browser's 404 for Pip's GLB, by its URL,
    // and the lab's one console.error naming the model, once at the start and once on the switch. A page error is never
    // expected, and a 404 for any other file is not Pip's. Any 404 used to pass in those loads, whatever file it named.
    const failedLoads = ['failed at start', 'failed on switch'];
    const labError = (error: (typeof errors)[number]) => error.source === 'console' && error.text.includes('asset commander_pip failed to load');
    const pip404 = (error: (typeof errors)[number]) =>
      error.source === 'console' && error.url.includes('commander_pip') && error.text.startsWith('Failed to load resource: the server responded with a status of 404');
    const expected = (error: (typeof errors)[number]) => failedLoads.includes(error.load) && (labError(error) || pip404(error));
    const unexpected = errors.filter((error) => !expected(error));
    const labErrors = errors.filter((error) => expected(error) && labError(error));
    const line =
      `style lab commander [${test.info().project.name}]: ${summary('default', byDefault)}; ${summary('?commander=bulwark', bulwark)}; ` +
      `${summary('?commander=pip', pip)}; ${summary('?commander=nope', unknown)}; ${summary('a manifest without Pip', missing)}; ` +
      `${summary('Pip GLB 404 at start', failedAtStart)}; ${summary('Pip GLB 404 on a switch', failedOnSwitch)}; ` +
      `${errors.length} console errors, ${errors.length - unexpected.length} expected from the 404 loads (${labErrors.length} from the lab), ${unexpected.length} unexpected`;
    console.log(line);
    // The default: Pip, loaded with the other models and posed from the first frame, first in the panel; Bulwark one switch away.
    expect(byDefault.shown, line).toBe('pip');
    expect(byDefault.panel, line).toBe('Pip (commander)');
    expect(byDefault.options, line).toEqual(['Pip (commander)', 'Bulwark']);
    expect(byDefault.pipRequestedAtLoad, line).toBe(true);
    expect(byDefault.face && byDefault.faceReleased, line).toBe(true);
    expect(byDefault.banner, line).toBe('');
    expect(byDefault.switched, line).toBe('bulwark');
    expect(byDefault.switchedPanel, line).toBe('Bulwark');
    // Bulwark's visored rig has no face to pose.
    expect(byDefault.switchedFace, line).toBe(false);
    // ?commander=bulwark: the alternate, with nothing of Pip loaded until the panel switches to him.
    expect(bulwark.shown, line).toBe('bulwark');
    expect(bulwark.panel, line).toBe('Bulwark');
    expect(bulwark.pipRequestedAtLoad, line).toBe(false);
    expect(bulwark.face, line).toBe(false);
    expect(bulwark.banner, line).toBe('');
    expect(bulwark.switched, line).toBe('pip');
    expect(bulwark.switchedPanel, line).toBe('Pip (commander)');
    expect(bulwark.switchedFace, line).toBe(true);
    expect(bulwark.pipRequestedAfter, line).toBe(true);
    // ?commander=pip still names him.
    expect(pip.shown, line).toBe('pip');
    expect(pip.panel, line).toBe('Pip (commander)');
    expect(pip.face && pip.faceReleased, line).toBe(true);
    // An unknown name falls back to the default and says so once, in the banner and the console.
    expect(unknown.shown, line).toBe('pip');
    expect(unknown.banner, line).toBe('No commander named "nope"; showing Pip (commander).');
    expect(warnings.filter((text) => text.includes('Style Lab: No commander named "nope"; showing Pip (commander).')), line).toHaveLength(1);
    // Without Pip in the manifest the lab shows Bulwark, requests nothing of Pip, and names why.
    expect(missing.shown, line).toBe('bulwark');
    expect(missing.panel, line).toBe('Bulwark');
    expect(missing.pipRequestedAtLoad, line).toBe(false);
    expect(missing.banner, line).toBe('Pip (commander) is not in the built assets (npm run assets); showing Bulwark.');
    // With Pip listed and his GLB failing, the lab still starts, on Bulwark, and says Pip failed; the banner holds that
    // line alone, where a stopped lab's would read "Style Lab failed to start" or "Style Lab stopped".
    const failedLine = 'Pip (commander) failed to load; showing Bulwark.';
    expect(failedAtStart.shown, line).toBe('bulwark');
    expect(failedAtStart.panel, line).toBe('Bulwark');
    expect(failedAtStart.pipRequestedAtLoad, line).toBe(true);
    expect(failedAtStart.banner, line).toBe(failedLine);
    // Opened on Bulwark, the switch to Pip requests him, falls back to Bulwark and says so, and the lab runs on.
    expect(failedOnSwitch.shown, line).toBe('bulwark');
    expect(failedOnSwitch.banner, line).toBe('');
    expect(failedOnSwitch.switched, line).toBe('bulwark');
    expect(failedOnSwitch.switchedPanel, line).toBe('Bulwark');
    expect(failedOnSwitch.pipRequestedAfter, line).toBe(true);
    expect(failedOnSwitch.switchedBanner, line).toBe(failedLine);
    expect(warnings.filter((text) => text === `Style Lab: ${failedLine}`), line).toHaveLength(2);
    // The address changes the commander, never the look.
    for (const reading of [byDefault, bulwark, pip, unknown, missing, failedAtStart, failedOnSwitch]) expect(reading.dials, line).toEqual(DEFAULT_DIALS);
    expect(labErrors.map((error) => error.load), line).toEqual(failedLoads);
    expect(unexpected, line).toEqual([]);
  });
});

// Every other browser test runs the low tier (forced, or SwiftShader detected as low), and the low tier has no edge
// pass, so a GLSL error in the edge ink or in the normal pass's depth target passed CI unseen. three reports shader
// compile and link errors through console.error when a program is first used, and ready comes after the third frame,
// by which time every pass has drawn.
test('the style lab draws the medium tier, edge ink included, without a console error', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const started = Date.now();
  await page.goto('./labs/style.html?tier=medium');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  // The query sets the tier past detection. A lab that fell back to low would pass here with no edge pass to compile.
  const tier = await page.evaluate(() => window.__P99__?.['tier']);
  const line =
    `style lab medium tier [${test.info().project.name}]: tier ${String(tier)}, ` +
    `ready in ${((Date.now() - started) / 1000).toFixed(1)} s, ${errors.length} console errors`;
  console.log(line);
  expect(tier, line).toBe('medium');
  expect(errors, line).toEqual([]);
});
