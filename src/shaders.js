import * as THREE from 'three';
// Shared uniforms (fog, outline colour/width, resolution).
export const U = {
  fogColor: { value: new THREE.Color(0xf7f7f4) }, fogRange: { value: new THREE.Vector2(60, 330) },
  lineColor: { value: new THREE.Color(0x222226) }, lineWidth: { value: 1.8 }, resolution: { value: new THREE.Vector2(1280, 720) },
};

// Flat "maquette" shading: vertex colour x simple directional term, distance fog, optional depth pull (alpha < 1).
export const facesMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec4 acol;
    uniform vec3 fogColor; uniform vec2 fogRange;
    varying vec3 vCol; varying float vFog;
    void main() {
      vec3 vp = (modelViewMatrix * vec4(position, 1.0)).xyz;
      float dist = length(vp);
      float pull = (1.0 - acol.a) * 1.12 * (0.25 + dist * 0.006);
      vp *= max(0.0, 1.0 - pull / max(dist, 0.001));
      gl_Position = projectionMatrix * vec4(vp, 1.0);
      vec3 n = normalize(mat3(modelMatrix) * normal);
      vec3 L = normalize(vec3(0.45, 0.80, -0.30));
      float d = dot(n, L);
      float sh = 0.80 + 0.20 * clamp(d, 0.0, 1.0) - 0.04 * clamp(-d, 0.0, 1.0);
      vCol = acol.rgb * sh;
      vFog = clamp((dist - fogRange.x) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 fogColor; varying vec3 vCol; varying float vFog;
    void main() { gl_FragColor = vec4(mix(vCol, fogColor, vFog), 1.0); }`,
});

// Screen-space-width outlines: each segment is a quad, position = this end, other = other end, side.x = +-1,
// side.y = 1 faint storey line / -1 ground line (kerb, pulled harder) / 0 normal. Clipped to the near plane in view space.
export const linesMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec3 other; attribute vec2 side;
    uniform vec2 fogRange; uniform float lineWidth; uniform vec2 resolution;
    varying float vFog; varying float vFaint;
    void main() {
      vec3 a = (modelViewMatrix * vec4(position, 1.0)).xyz;
      vec3 b = (modelViewMatrix * vec4(other, 1.0)).xyz;
      float nz = -(0.15 + 0.02);
      float valid = 1.0;
      if (a.z > nz) { if (b.z > nz) valid = 0.0; else a = mix(a, b, (nz - a.z) / (b.z - a.z)); }
      else if (b.z > nz) b = mix(b, a, (nz - b.z) / (a.z - b.z));
      float ground = side.y < -0.5 ? 1.0 : 0.0;
      float da = length(a); a *= max(0.0, 1.0 - (0.04 + da * 0.004 + ground * (0.32 + da * 0.008)) / max(da, 0.001));
      float db = length(b); b *= max(0.0, 1.0 - (0.04 + db * 0.004 + ground * (0.32 + db * 0.008)) / max(db, 0.001));
      vec4 ca = projectionMatrix * vec4(a, 1.0); vec4 cb = projectionMatrix * vec4(b, 1.0);
      vec2 hres = resolution * 0.5;
      vec2 sa = ca.xy / ca.w * hres, sb = cb.xy / cb.w * hres;
      vec2 d = sb - sa; float L = length(d); d = L > 1e-4 ? d / L : vec2(1.0, 0.0);
      vec2 n = vec2(-d.y, d.x);
      float w = lineWidth * mix(1.0, 0.55, clamp(da / 250.0, 0.0, 1.0)) * (side.y > 0.5 ? 0.75 : 1.0);
      ca.xy += n * side.x * (w * 0.5) / hres * ca.w;
      gl_Position = valid > 0.0 ? ca : vec4(0.0, 0.0, -10.0, 1.0);
      vFog = clamp((da - fogRange.x) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0);
      vFaint = max(0.0, side.y);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 fogColor; uniform vec3 lineColor; varying float vFog; varying float vFaint;
    void main() {
      vec3 c = mix(lineColor, vec3(0.70, 0.69, 0.67), vFaint);
      gl_FragColor = vec4(mix(c, fogColor, clamp(vFog + vFaint * 0.25, 0.0, 1.0)), 1.0);
    }`,
});

// Inverted hull (trees): back faces pushed out along the normal by ~constant pixels.
export const hullMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide,
  vertexShader: /* glsl */`
    uniform vec2 fogRange; uniform float lineWidth; uniform vec2 resolution;
    varying float vFog;
    void main() {
      vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
      vec3 n = normalize(mat3(modelMatrix) * normal);
      float dist = length(cameraPosition - w);
      w += n * (lineWidth * dist * 2.0 / (resolution.y * projectionMatrix[1][1]) * 0.9);
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      vFog = clamp((dist - fogRange.x) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 fogColor; uniform vec3 lineColor; varying float vFog;
    void main() { gl_FragColor = vec4(mix(lineColor, fogColor, vFog), 1.0); }`,
});
