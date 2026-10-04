// St. Agatha Hospital: breakers -> patient-record code (pharmacy) -> tapes at the nurse station
// reveal the exit code -> main exit. The Nurse hears racing heartbeats through walls.
import { GridBuilder } from './gridbuilder.js';
import { MAT } from '../../engine/textures.js';

const WARD = {
  wall: [['hospitalBed', 4], ['ivStand', 1.5], ['medCabinet', 1], ['wheelchair', 1], ['curtain', 1.5]],
  thin: [['poster', 1], ['clock', 0.5], ['radiator', 1]],
  floor: [['papers', 1], ['bloodlessStain', 1], ['gurney', 0]],
  density: { wall: 0.45, thin: 0.25, floor: 0.2 },
};

function layout() {
  const g = new GridBuilder(48, 40, '#', 41);
  // corridors
  g.fill(1, 19, 46, 20, '.');
  g.fill(23, 1, 24, 35, '.');
  // reception / lobby (south)
  g.room(14, 28, 33, 38, '.');
  g.fill(23, 27, 24, 28, '.');
  g.puts([[16, 30], [18, 30], [16, 33], [18, 33], [29, 30], [31, 30], [29, 33], [31, 33]], 'H');
  g.puts([[20, 34], [27, 34]], 't');
  g.puts([[17, 36], [30, 36], [23, 31]], 'l');
  g.puts([[21, 37], [22, 37], [23, 37], [24, 37]], 'P');
  g.put(24, 38, 'E');
  g.fill(23, 39, 25, 39, 'X');
  g.put(25, 37, '6');
  g.put(23, 37, 'P');
  // nurse station at the crossing
  g.puts([[21, 21], [26, 21]], 't');
  g.put(22, 22, '5');
  g.fill(21, 22, 26, 22, '.');
  g.put(22, 22, '5');
  g.puts([[23, 22], [24, 22]], '.');
  // north-west ward
  g.room(1, 2, 12, 12, '.');
  g.put(8, 12, 'D');
  g.fill(8, 13, 8, 18, '.');
  g.puts([[3, 4], [6, 4], [9, 4], [3, 10], [6, 10], [9, 10]], 'k');
  g.puts([[5, 7], [9, 7]], 'l');
  g.puts([[2, 3], [11, 11]], 'F');
  g.put(11, 3, 'n');
  // operating theatre (north centre)
  g.room(14, 2, 21, 10, '.');
  g.put(21, 6, 'D');
  g.put(17, 6, 't');
  g.puts([[16, 4], [19, 8]], 'l');
  g.put(15, 9, 'F');
  g.put(20, 3, 'i');
  // morgue (north-east)
  g.room(26, 2, 35, 10, '.');
  g.put(26, 6, 'D');
  g.puts([[28, 4], [31, 4], [28, 8], [31, 8]], 'k');
  g.put(33, 6, 'l');
  g.put(34, 9, 'F');
  g.put(34, 3, 'n');
  // north-east ward
  g.room(36, 2, 46, 12, '.');
  g.put(40, 12, 'D');
  g.fill(40, 13, 40, 18, '.');
  g.puts([[38, 4], [41, 4], [44, 4], [38, 10], [44, 10]], 'k');
  g.puts([[40, 7]], 'l');
  g.put(45, 11, 'i');
  g.put(37, 11, 'H');
  // pharmacy (records code)
  g.room(28, 12, 35, 18, '.');
  g.put(31, 18, 'K');
  g.put(30, 19, '.');
  g.put(32, 19, '4');
  g.puts([[29, 13], [34, 13], [29, 17]], 's');
  g.put(32, 15, 'l');
  g.put(34, 17, 'F');
  g.put(30, 15, 'i');
  // records office (west)
  g.room(1, 22, 10, 27, '.');
  g.put(6, 22, 'D');
  g.puts([[2, 23], [9, 23], [2, 26]], 'h');
  g.put(5, 25, 'l');
  g.put(9, 26, 'n');
  g.put(3, 26, 'i');
  // electrical room (south-west): breakers
  g.room(1, 28, 12, 38, '.');
  g.put(12, 33, 'D');
  g.fill(13, 33, 14, 33, '.');
  g.puts([[1, 30], [1, 33], [1, 36], [11, 37]], '2');
  g.put(6, 28, '#');
  g.put(5, 29, '3');
  g.puts([[4, 34], [8, 31]], 'c');
  g.put(6, 34, 'l');
  // east wing corridor offices
  g.room(36, 22, 46, 27, '.');
  g.put(40, 22, 'D');
  g.puts([[38, 24], [44, 24]], 'h');
  g.put(41, 26, 'l');
  g.put(45, 23, 'n');
  g.put(37, 26, 'F');
  g.room(35, 28, 46, 38, '.');
  g.put(35, 33, 'D');
  g.fill(26, 33, 34, 33, '.');
  g.puts([[38, 30], [42, 30], [38, 35], [42, 35]], 'k');
  g.puts([[40, 32]], 'l');
  g.put(45, 37, 'M');
  g.put(44, 29, 'i');
  // chapel (west of the crossing)
  g.room(14, 12, 21, 18, '.');
  g.put(17, 18, 'D');
  for (let x = 15; x <= 20; x += 2) g.put(x, 15, 't');
  g.put(17, 13, 'l');
  // corridor lamps & clutter
  for (let x = 3; x < 46; x += 5) g.put(x, 19, 'l');
  for (let z = 4; z < 34; z += 6) g.put(24, z, 'l');
  g.puts([[10, 20], [34, 20], [24, 26]], 'i');
  g.puts([[18, 20], [44, 19], [23, 14]], 'p');
  g.puts([[2, 20], [45, 20]], 'H');
  g.ensureConnected([23, 36], (c) => '#'.includes(c), (x, z) => x > 0 && z > 0 && x < 47 && z < 39);
  return g.rows();
}

export default {
  id: 'hospital',
  name: 'map_hospital',
  desc: 'map_hospital_d',
  monster: 'nurse',
  wallHeight: 3.0,
  grid: layout(),
  roofs: false,
  bed: 'hospital',
  palette: {
    wall: MAT.PLASTER,
    floor: MAT.TILES,
    ceil: MAT.CEILING_TILES,
    door: 'wood',
    furniture: MAT.PAINTED_METAL,
    shelf: MAT.PAINTED_METAL,
  },
  baseboard: MAT.PAINTED_METAL,
  zones: [
    { x0: 2, z0: 3, x1: 11, z1: 11, decor: WARD, powerGroup: 'wing' },
    { x0: 37, z0: 3, x1: 45, z1: 11, decor: WARD, powerGroup: 'wing' },
    { x0: 36, z0: 29, x1: 45, z1: 37, decor: WARD },
    { x0: 15, z0: 3, x1: 20, z1: 9, wall: MAT.TILES, decor: { wall: [['medCabinet', 2], ['ivStand', 2], ['gurney', 1], ['sink', 1]], density: { wall: 0.6 } }, powerGroup: 'wing' },
    { x0: 27, z0: 3, x1: 34, z1: 9, floor: MAT.TILES, wall: MAT.TILES, decor: { wall: [['gurney', 3], ['medCabinet', 1], ['sink', 1]], thin: [['pipesWall', 2]], density: { wall: 0.6 } }, powerGroup: 'wing' },
    { x0: 29, z0: 13, x1: 34, z1: 17, decor: { wall: [['medCabinet', 3], ['shelf', 2], ['boxes', 1]], density: { wall: 0.7 } } },
    { x0: 2, z0: 23, x1: 9, z1: 26, floor: MAT.WOOD, decor: { wall: [['filing', 3], ['bookshelf', 2], ['boxes', 2]], floor: [['papers', 4]], density: { wall: 0.6, floor: 0.5 } } },
    { x0: 2, z0: 29, x1: 11, z1: 37, floor: MAT.CONCRETE_FLOOR, wall: MAT.CONCRETE, ceil: MAT.CONCRETE, decor: { wall: [['generatorProp', 1], ['barrels', 1], ['crate', 1]], thin: [['electricBox', 3], ['pipesWall', 2]], ceiling: [['cables', 2]], density: { thin: 0.5 } } },
    { x0: 15, z0: 29, x1: 32, z1: 37, decor: { wall: [['plant', 2], ['cooler', 1], ['vending', 1], ['wheelchair', 1], ['trashCan', 1]], thin: [['poster', 2], ['clock', 1], ['exitSign', 0.5]] } },
    { x0: 15, z0: 13, x1: 20, z1: 17, floor: MAT.WOOD, decor: { wall: [['lantern', 2], ['plant', 1]], thin: [['poster', 1]] } },
  ],
  lamp: { color: [0.85, 0.95, 1.0], intensity: 5, radius: 7.5, flickerChance: 0.35, brokenChance: 0.2, glow: 0.6 },
  lampStyle: 'panel',
  unpoweredGroups: ['wing'],
  env: {
    ambient: [0.018, 0.02, 0.022],
    skyAmbient: [0, 0, 0],
    moonDir: [0, 1, 0],
    moonColor: [0, 0, 0],
    fogColor: [0.01, 0.013, 0.015],
    fogDensity: 0.06,
    sky: false,
    wetness: 0,
    dust: { color: [0.006, 0.007, 0.008] },
    volumeDensity: 0.07,
  },
  ambience: 'amb_backrooms',
  decor: {
    wall: [['wheelchair', 1.5], ['gurney', 1.5], ['ivStand', 1], ['medCabinet', 1], ['trashCan', 1], ['plant', 0.6], ['boxes', 0.6]],
    thin: [['poster', 2], ['radiator', 1.5], ['extinguisher', 1], ['clock', 0.5], ['exitSign', 0.4]],
    floor: [['papers', 2], ['bloodlessStain', 1.5], ['debris', 0.8], ['fallenChair', 0.6]],
    ceiling: [['ceilingVent', 1.5], ['cables', 0.8], ['cobweb', 0.6]],
    density: { wall: 0.25, thin: 0.3, floor: 0.25, ceiling: 0.15 },
  },
  objects: {
    K: { door: 'metal', lockedBy: 'records' },
    E: { door: 'metal', lockedBy: 'exit' },
    F: {},
    2: {},
    3: {},
    4: {},
    5: {},
    6: {},
    n: {},
  },
  objectives: [
    { id: 'breakers', type: 'levers', anchor: '2', board: '3', text: 'o_breakers', power: ['wing'] },
    { id: 'records', type: 'keypad', keypad: '4', notes: 'n', text: 'o_records' },
    { id: 'tapes', type: 'collect', item: 'tape', spawn: 'F', count: 3, deliver: '5', requires: ['breakers'], revealsCode: true, text: 'o_tapes' },
    { id: 'exitcode', type: 'keypad', keypad: '6', codeFrom: 'tapes', requires: ['tapes'], text: 'o_exitcode' },
    { id: 'exit', type: 'exit', requires: ['exitcode'], text: 'o_escape' },
  ],
  writings: {
    ru: ['ДЫШИ РОВНО', 'ОНА СЛЫШИТ СЕРДЦЕ', 'НЕ БЕГИ', 'ПАЛАТА 13', 'ТИХИЙ ЧАС'],
    en: ['BREATHE SLOWLY', 'SHE HEARS YOUR HEART', "DON'T RUN", 'WARD 13', 'QUIET HOURS'],
  },
};
