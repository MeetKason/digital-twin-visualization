/** Street-level D2Q9 lattice Boltzmann demo. Not a calibrated CFD model. */
const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const OPPOSITE = [0, 3, 4, 1, 2, 7, 8, 5, 6];

export interface FlowFootprint {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  heightM: number;
}

/** Normalized footprints inside the demo box. Gaps are the street canyons. */
export const demoFlowFootprints: FlowFootprint[] = [
  { x0: 0.22, y0: 0.26, x1: 0.4, y1: 0.68, heightM: 72 },
  { x0: 0.48, y0: 0.18, x1: 0.62, y1: 0.46, heightM: 128 },
  { x0: 0.48, y0: 0.58, x1: 0.64, y1: 0.82, heightM: 96 },
  { x0: 0.72, y0: 0.28, x1: 0.86, y1: 0.74, heightM: 58 },
];

export interface LatticeFlow {
  width: number;
  height: number;
  inlet: number;
  solid: Uint8Array;
  ux: Float32Array;
  uy: Float32Array;
  speed: Float32Array;
}

export interface LatticeSolver {
  flow: LatticeFlow;
  step: () => void;
}

/** Build a channel with bounce-back buildings and a steady inlet from the west. */
export function createLatticeFlow(
  width: number,
  height: number,
  footprints: FlowFootprint[] = demoFlowFootprints,
  inlet = 0.06,
): LatticeSolver {
  const cells = width * height;
  const solid = new Uint8Array(cells);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = y === 0 || y === height - 1;
      const nx = (x + 0.5) / width;
      const ny = (y + 0.5) / height;
      const blocked = footprints.some(
        (block) => nx >= block.x0 && nx <= block.x1 && ny >= block.y0 && ny <= block.y1,
      );
      if ((edge || blocked) && x > 0 && x < width - 1) solid[y * width + x] = 1;
    }
  }
  const populations = new Float32Array(cells * 9);
  const next = new Float32Array(cells * 9);
  const streamed = new Float32Array(cells * 9);
  const ux = new Float32Array(cells);
  const uy = new Float32Array(cells);
  const speed = new Float32Array(cells);
  const rho = new Float32Array(cells);
  const flow: LatticeFlow = { width, height, inlet, solid, ux, uy, speed };
  const tau = 0.8;

  const fillEquilibrium = (cell: number, density: number, velocityX: number, velocityY: number) => {
    const kinetic = velocityX * velocityX + velocityY * velocityY;
    for (let direction = 0; direction < 9; direction++) {
      const product = CX[direction] * velocityX + CY[direction] * velocityY;
      populations[cell * 9 + direction] =
        W[direction] * density * (1 + 3 * product + 4.5 * product * product - 1.5 * kinetic);
    }
    rho[cell] = density;
    ux[cell] = velocityX;
    uy[cell] = velocityY;
    speed[cell] = Math.hypot(velocityX, velocityY);
  };

  for (let cell = 0; cell < cells; cell++) {
    if (solid[cell]) continue;
    fillEquilibrium(cell, 1, inlet, 0);
  }

  const step = () => {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const cell = y * width + x;
        if (solid[cell]) continue;
        let density = 0;
        let momentumX = 0;
        let momentumY = 0;
        const offset = cell * 9;
        for (let direction = 0; direction < 9; direction++) {
          const value = populations[offset + direction];
          density += value;
          momentumX += value * CX[direction];
          momentumY += value * CY[direction];
        }
        const velocityX = density > 1e-6 ? Math.max(-0.12, Math.min(0.12, momentumX / density)) : 0;
        const velocityY = density > 1e-6 ? Math.max(-0.12, Math.min(0.12, momentumY / density)) : 0;
        const kinetic = velocityX * velocityX + velocityY * velocityY;
        for (let direction = 0; direction < 9; direction++) {
          const product = CX[direction] * velocityX + CY[direction] * velocityY;
          const equilibrium =
            W[direction] * density * (1 + 3 * product + 4.5 * product * product - 1.5 * kinetic);
          next[offset + direction] =
            populations[offset + direction] + (equilibrium - populations[offset + direction]) / tau;
        }
        rho[cell] = density;
        ux[cell] = velocityX;
        uy[cell] = velocityY;
        speed[cell] = Math.hypot(velocityX, velocityY);
      }
    }

    streamed.fill(0);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const cell = y * width + x;
        if (solid[cell]) continue;
        for (let direction = 0; direction < 9; direction++) {
          const targetX = x + CX[direction];
          const targetY = y + CY[direction];
          if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
          const leaving = (x === 0 ? populations : next)[cell * 9 + direction];
          const target = targetY * width + targetX;
          if (solid[target]) streamed[cell * 9 + OPPOSITE[direction]] = leaving;
          else streamed[target * 9 + direction] = leaving;
        }
      }
    }
    populations.set(streamed);

    for (let y = 1; y < height - 1; y++) {
      fillEquilibrium(y * width, 1, inlet, 0);
      const outlet = y * width + (width - 1);
      const upstream = y * width + (width - 2);
      if (solid[upstream]) continue;
      for (let direction = 0; direction < 9; direction++)
        populations[outlet * 9 + direction] = populations[upstream * 9 + direction];
      ux[outlet] = ux[upstream];
      uy[outlet] = uy[upstream];
      speed[outlet] = speed[upstream];
      rho[outlet] = rho[upstream];
    }
    for (let cell = 0; cell < cells; cell++) {
      if (!solid[cell]) continue;
      ux[cell] = 0;
      uy[cell] = 0;
      speed[cell] = 0;
    }
  };

  return { flow, step };
}

/** Vertical extent of the rendered volume, in meters above the ground. */
export const FLOW_VOLUME_CEILING_M = 220;

/**
 * Display speed for one voxel, in m/s.
 * The lattice is a street-level slice; height only shapes the volume.
 */
export function flowVolumeMeters(
  flow: LatticeFlow,
  x: number,
  y: number,
  heightM: number,
  footprints: FlowFootprint[] = demoFlowFootprints,
): number {
  if (heightM <= 0 || heightM >= FLOW_VOLUME_CEILING_M) return 0;
  if (y < 0.04 || y > 0.96 || x > 0.98) return 0;
  const roof =
    footprints.find((block) => x >= block.x0 && x <= block.x1 && y >= block.y0 && y <= block.y1)?.heightM ?? 0;
  if (heightM < roof) return 0;
  const sample = sampleLattice(flow, x, y);
  const street = sample.solid ? 0 : (sample.speed / Math.max(flow.inlet, 1e-6)) * 8;
  const column = Math.sin(Math.PI * Math.min(1, heightM / 170));
  let meters = street * (0.78 + 0.22 * column);
  if (roof > 0) {
    const clearance = heightM - roof;
    if (clearance < 24) {
      const jet = 1 - clearance / 24;
      meters = Math.max(meters, (5 + 6 * jet) * (0.4 + 0.6 * jet));
    }
  }
  if (heightM > 175) meters *= (FLOW_VOLUME_CEILING_M - heightM) / (FLOW_VOLUME_CEILING_M - 175);
  return meters;
}

/** Sample the solved field. Coordinates are normalized across the demo box. */
export function sampleLattice(flow: LatticeFlow, x: number, y: number) {
  const column = Math.max(0, Math.min(flow.width - 1, Math.floor(x * flow.width)));
  const row = Math.max(0, Math.min(flow.height - 1, Math.floor(y * flow.height)));
  const cell = row * flow.width + column;
  return {
    solid: flow.solid[cell] === 1,
    ux: flow.ux[cell],
    uy: flow.uy[cell],
    speed: flow.speed[cell],
  };
}
