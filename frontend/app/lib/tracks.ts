// Simplified, recognizable outlines of real F1 circuits for the live-sim view.
// Coordinates are on a 500x500 canvas (matches TrackOverlay.tsx).
// Each shape is deliberately built around that circuit's real topology
// (Monaco: tight harbor loop; Spa: long triangle with Eau Rouge climb;
// Interlagos: figure-eight with an elevation crossover; Yas Marina:
// rectangular marina layout; Silverstone: wide, flowing high-speed loop)
// so they read as distinct circuits, not interchangeable ovals.
//
// Replay mode doesn't use these — it draws the actual traced polyline built
// from FastF1 car-position telemetry (real geometry, not an approximation).

export interface TrackLayout {
  id: string;
  name: string;
  // SVG path `d` for the track outline (a closed loop)
  path: string;
  // Rough total path length in canvas units, used to place markers by progress (0..1)
  length: number;
}

export const TRACKS: Record<string, TrackLayout> = {
  // Wide, sweeping, high-speed loop — rounded rectangle with the
  // Maggots/Becketts esses cut into the top-left.
  silverstone: {
    id: "silverstone",
    name: "Silverstone Circuit",
    path: `M 400 120
           L 400 90
           C 400 75, 388 65, 372 65
           L 300 65
           C 285 65, 278 75, 265 72
           C 248 68, 235 78, 238 95
           C 241 112, 225 118, 210 108
           C 192 96, 168 100, 158 118
           C 148 136, 128 138, 115 122
           C 100 104, 75 108, 68 130
           C 62 150, 70 172, 90 180
           C 115 190, 118 215, 96 228
           C 75 240, 72 268, 92 282
           C 115 298, 148 292, 165 272
           C 180 254, 205 254, 218 274
           C 232 296, 262 300, 280 280
           C 295 263, 320 262, 333 282
           C 348 304, 378 305, 395 285
           C 410 267, 408 240, 390 226
           C 415 220, 432 198, 425 172
           C 419 150, 400 138, 400 120 Z`,
    length: 1600,
  },

  // Tight harbor street circuit — narrow, elongated, packed with hairpins.
  monaco: {
    id: "monaco",
    name: "Circuit de Monaco",
    path: `M 460 260
           C 460 245, 448 236, 432 238
           L 340 248
           C 328 249, 320 240, 322 228
           C 324 214, 314 204, 300 206
           L 220 216
           C 210 217, 204 210, 206 200
           C 209 186, 198 176, 184 180
           L 130 196
           C 116 200, 104 190, 106 176
           C 108 160, 96 148, 80 152
           C 62 157, 48 144, 52 126
           C 56 108, 44 94, 26 98
           C 14 101, 6 92, 8 80
           C 11 64, 30 58, 42 70
           L 100 128
           C 112 140, 130 138, 140 124
           C 148 112, 165 112, 172 126
           C 180 142, 200 144, 210 128
           C 218 116, 236 118, 242 132
           C 249 148, 270 149, 278 132
           C 286 116, 306 118, 312 136
           C 317 150, 336 152, 344 136
           C 352 120, 374 122, 380 140
           C 385 155, 404 156, 410 140
           C 417 122, 440 124, 445 144
           C 448 158, 465 160, 470 144
           C 474 130, 460 260, 460 260 Z`,
    length: 1750,
  },

  // Long triangular circuit with the iconic Eau Rouge / Raidillon climb
  // rendered as the sharp uphill kink on the left side.
  spa: {
    id: "spa",
    name: "Circuit de Spa-Francorchamps",
    path: `M 330 90
           C 355 85, 380 100, 380 125
           C 380 148, 400 158, 420 148
           C 442 137, 465 152, 462 176
           C 459 198, 440 208, 420 202
           C 445 214, 460 240, 448 265
           C 436 288, 450 312, 476 315
           C 490 317, 495 332, 484 342
           C 470 354, 450 350, 440 336
           C 425 315, 395 315, 380 336
           C 366 356, 335 358, 318 340
           C 305 326, 282 328, 272 344
           C 258 366, 225 366, 210 344
           C 198 326, 170 328, 160 348
           C 148 370, 115 366, 108 340
           C 103 320, 118 300, 140 298
           C 118 288, 100 265, 108 240
           C 115 218, 100 198, 78 195
           C 60 192, 52 172, 65 158
           C 78 144, 100 148, 108 165
           C 118 186, 145 190, 160 172
           C 172 158, 195 160, 202 178
           C 210 198, 235 200, 245 180
           C 254 162, 230 138, 245 118
           C 258 100, 285 96, 302 112
           C 312 121, 322 92, 330 90 Z`,
    length: 1900,
  },

  // Figure-eight with a crossover bridge (the real Interlagos "S do Senna"
  // descent feeding back under itself) — drawn as two overlapping loops.
  interlagos: {
    id: "interlagos",
    name: "Autódromo José Carlos Pace",
    path: `M 250 90
           C 300 90, 340 118, 340 155
           C 340 185, 315 205, 285 205
           C 320 210, 350 235, 350 270
           C 350 308, 315 335, 275 335
           C 245 335, 220 320, 210 295
           C 200 320, 172 335, 142 335
           C 102 335, 68 305, 68 268
           C 68 235, 92 210, 122 202
           C 92 195, 68 170, 68 138
           C 68 100, 100 72, 140 72
           C 168 72, 192 87, 202 110
           C 210 88, 228 90, 250 90 Z
           M 200 200
           C 210 205, 225 205, 235 198`,
    length: 1750,
  },

  // Rectangular marina-circuit layout — long back straight, hairpin
  // hotel complex, and the pit-lane building represented by the notch.
  abudhabi: {
    id: "abudhabi",
    name: "Yas Marina Circuit",
    path: `M 110 120
           L 340 120
           C 365 120, 385 100, 385 100
           C 400 92, 418 100, 418 120
           L 418 150
           C 418 168, 400 178, 385 172
           C 368 165, 350 178, 355 196
           C 360 214, 345 228, 328 220
           L 300 208
           C 285 202, 270 212, 272 228
           C 274 246, 260 258, 244 250
           L 220 238
           C 205 231, 190 240, 192 256
           L 192 320
           C 192 340, 175 355, 155 355
           L 130 355
           C 108 355, 92 338, 92 316
           L 92 250
           C 92 232, 78 220, 62 224
           C 46 228, 32 216, 34 198
           C 36 178, 55 168, 72 176
           C 90 184, 108 172, 105 152
           L 105 140
           C 105 130, 106 124, 110 120 Z`,
    length: 1650,
  },

  generic: {
    id: "generic",
    name: "Circuit",
    path: `M 150 100
           C 150 50, 350 50, 350 100
           L 350 150
           C 350 180, 300 200, 250 200
           C 200 200, 150 180, 150 150
           Z`,
    length: 1000,
  },
};

export function trackFor(id: string | undefined | null): TrackLayout {
  if (id && TRACKS[id]) return TRACKS[id];
  return TRACKS.generic;
}
