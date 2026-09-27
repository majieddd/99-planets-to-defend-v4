import { BlendFunction, Effect } from 'postprocessing';
import { Color, Uniform } from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

// Runs on HDR colour before tone mapping: exposure, contrast around mid grey, then split toning.
const fragmentShader = /* glsl */ `
uniform float uExposure;
uniform float uContrast;
uniform vec3 uShadowGrade;
uniform vec3 uHighlightGrade;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb * uExposure, 0.0);
  c = pow(c / 0.18, vec3(uContrast)) * 0.18;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadowGrade, uHighlightGrade, smoothstep(0.03, 1.0, luma));
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor(theme: Theme, dials: RenderDials) {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(dials.exposure)],
        ['uContrast', new Uniform(dials.contrast)],
        ['uShadowGrade', new Uniform(new Color(theme.grade.shadows))],
        ['uHighlightGrade', new Uniform(new Color(theme.grade.highlights))],
      ]),
    });
  }

  setDials(dials: RenderDials, theme: Theme): void {
    (this.uniforms.get('uExposure') as Uniform<number>).value = dials.exposure;
    (this.uniforms.get('uContrast') as Uniform<number>).value = dials.contrast;
    (this.uniforms.get('uShadowGrade') as Uniform<Color>).value.set(theme.grade.shadows);
    (this.uniforms.get('uHighlightGrade') as Uniform<Color>).value.set(theme.grade.highlights);
  }
}
