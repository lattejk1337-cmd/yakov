// The Yellow Rooms: endless office. Valves -> maintenance, symbols -> server room, keycards -> elevator.
import { GridBuilder } from './gridbuilder.js';
import { MAT } from '../../engine/textures.js';

function layout() {
  const g = new GridBuilder(48, 48, '#', 23);
  g.fill(1, 1, 46, 46, '.');
  // random office partitions in the general area
  const fixed = (x, z) => (x <= 14 && z >= 33) || (x >= 29 && z >= 29) || (x <= 6 && z <= 6);
  for (let i = 0; i < 95; i++) {
    const x = 2 + Math.floor(g.rnd() * 22) * 2, z = 2 + Math.floor(g.rnd() * 22) * 2;
    const len = 2 + Math.floor(g.rnd() * 5);
    const horiz = g.rnd() < 0.5;
    for (let k = 0; k < len; k++) {
      const cx = horiz ? x + k : x, cz = horiz ? z : z + k;
      if (cx < 1 || cz < 1 || cx > 46 || cz > 46 || fixed(cx, cz)) continue;
      g.put(cx, cz, '#');
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = 2 + Math.floor(g.rnd() * 44), z = 2 + Math.floor(g.rnd() * 44);
    if (!fixed(x, z) && g.get(x, z) === '.') g.put(x, z, 'o');
  }
  // start room
  g.room(0, 0, 7, 7, '.');
  g.puts([[7, 3], [3, 7]], 'D');
  g.puts([[2, 2], [5, 2], [2, 5], [5, 5]], 'P');
  g.put(3, 3, 'l');
  g.put(1, 6, 'n');
  // boiler zone (bottom-left): valves
  g.room(0, 32, 15, 47, '.');
  g.puts([[15, 36], [8, 32]], 'D');
  g.puts([[1, 34], [14, 40], [1, 45]], '2');
  g.puts([[4, 36], [10, 36], [4, 42], [10, 42]], 'o');
  g.puts([[7, 39], [3, 44], [12, 34]], 'l');
  g.puts([[13, 46], [2, 39], [7, 46]], 'c');
  g.puts([[12, 44], [6, 34]], 'i');
  g.put(9, 45, 'p');
  g.fill(5, 38, 9, 40, 'w');
  g.put(7, 39, 'l');
  // maintenance complex (bottom-right) behind the valve door
  g.room(28, 28, 47, 47, '.');
  g.put(28, 34, 'K');
  g.put(36, 28, 'K');
  g.puts([[29, 30], [33, 29], [29, 38], [36, 36]], '3'); // symbol buttons
  g.put(31, 29, '4'); // painted clue wall
  g.puts([[31, 32], [33, 33]], 'l');
  g.puts([[30, 44], [34, 44]], 's');
  g.put(30, 41, 'i');
  g.put(32, 46, 'H');
  // server room with elevator
  g.room(37, 34, 47, 47, '.');
  g.put(37, 40, 'J');
  g.puts([[39, 36], [39, 38], [42, 36], [42, 38]], 's');
  g.puts([[40, 41], [43, 44]], 'l');
  g.put(44, 39, '5'); // elevator panel
  g.room(43, 40, 47, 47, '.');
  g.put(43, 43, 'E');
  g.fill(44, 41, 46, 46, 'X');
  // keycard spots & clutter
  g.scatter(8, 1, 46, 30, 'F', 7, '.');
  g.scatter(8, 8, 27, 31, 'h', 18, '.');
  g.scatter(1, 8, 27, 31, 'i', 8, '.');
  g.scatter(1, 8, 46, 27, 'p', 8, '.');
  g.scatter(1, 8, 46, 27, 'H', 6, '.');
  g.scatter(1, 8, 46, 27, 'w', 22, '.');
  g.put(40, 6, 'M');
  // ceiling panels
  for (let z = 2; z < 46; z += 3) for (let x = 2; x < 46; x += 3) if (g.get(x, z) === '.' || g.get(x, z) === 'w') g.put(x, z, 'l');
  g.ensureConnected([2, 2], (c) => '#'.includes(c), (x, z) => x > 0 && z > 0 && x < 47 && z < 47 && !((x >= 28 && z >= 28)));
  return g.rows();
}

export default {
  id: 'backrooms',
  name: 'map_backrooms',
  desc: 'map_backrooms_d',
  monster: 'moth',
  wallHeight: 2.7,
  grid: layout(),
  roofs: false,
  palette: {
    wall: MAT.WALLPAPER,
    floor: MAT.CARPET,
    ceil: MAT.CEILING_TILES,
    pillar: MAT.WALLPAPER,
    door: 'wood',
    furniture: MAT.WOOD,
    shelf: MAT.PAINTED_METAL,
  },
  baseboard: MAT.WOOD,
  zones: [
    { x0: 1, z0: 33, x1: 14, z1: 46, floor: MAT.CONCRETE_FLOOR, wall: MAT.CONCRETE, ceil: MAT.CONCRETE, decor: { wall: [['barrels', 2], ['generatorProp', 1], ['cinder', 1], ['crate', 1]], thin: [['pipesWall', 4], ['electricBox', 2]], ceiling: [['pipesWall', 3], ['cables', 1]], floor: [['bloodlessStain', 3], ['debris', 1]], density: { thin: 0.5, ceiling: 0.35 } } },
    { x0: 38, z0: 35, x1: 46, z1: 46, floor: MAT.METAL_PLATE, wall: MAT.PAINTED_METAL, decor: { wall: [['filing', 1], ['shelf', 1]], thin: [['electricBox', 3], ['exitSign', 1]], ceiling: [['cables', 2]] } },
    { x0: 29, z0: 29, x1: 46, z1: 46, floor: MAT.TILES, wall: MAT.PLASTER, ceil: MAT.CEILING_TILES, decor: { wall: [['locker', 2], ['shelf', 1], ['boxes', 2], ['bucket', 1]], thin: [['poster', 1], ['extinguisher', 1]] } },
  ],
  lamp: { color: [1.0, 0.95, 0.75], intensity: 4.2, radius: 6.5, flickerChance: 0.22, brokenChance: 0.18, glow: 0.5 },
  lampStyle: 'panel',
  unpoweredGroups: [],
  env: {
    ambient: [0.02, 0.018, 0.012],
    skyAmbient: [0, 0, 0],
    moonDir: [0, 1, 0],
    moonColor: [0, 0, 0],
    fogColor: [0.03, 0.026, 0.014],
    fogDensity: 0.07,
    sky: false,
    wetness: 0,
    dust: { color: [0.008, 0.007, 0.004] },
    volumeDensity: 0.07,
  },
  decor: {
    wall: [['filing', 2], ['cooler', 1], ['plant', 1.5], ['boxes', 2], ['cardboardWall', 1], ['vending', 0.3], ['desk', 1], ['bookshelf', 0.5]],
    thin: [['poster', 2], ['clock', 1], ['radiator', 1], ['electricBox', 0.5], ['exitSign', 0.3]],
    floor: [['papers', 3], ['bloodlessStain', 2], ['fallenChair', 1], ['officeChair', 1.5]],
    ceiling: [['ceilingVent', 2], ['cables', 0.5]],
    density: { wall: 0.22, thin: 0.25, floor: 0.22, ceiling: 0.15 },
  },
  ambience: 'amb_backrooms',
  objects: {
    K: { door: 'metal', lockedBy: 'valves' },
    J: { door: 'metal', lockedBy: 'symbols' },
    E: { door: 'metal', lockedBy: 'exit' },
    F: {},
    2: {},
    3: {},
    4: {},
    5: {},
    n: {},
  },
  objectives: [
    { id: 'valves', type: 'valves', anchor: '2', text: 'o_valves' },
    { id: 'symbols', type: 'symbols', anchor: '3', clue: '4', requires: ['valves'], text: 'o_symbols' },
    { id: 'cards', type: 'collect', item: 'keycard', spawn: 'F', count: 3, deliver: '5', text: 'o_keycards' },
    { id: 'exit', type: 'exit', requires: ['valves', 'symbols', 'cards'], text: 'o_escape' },
  ],
  writings: {
    ru: ['ГАСИ СВЕТ', 'ОНО ЛЕТИТ НА СВЕТ', 'ТЫ ЗДЕСЬ НЕ ПЕРВЫЙ', 'НЕ ШУМИ', 'ВЫХОД ВНИЗУ'],
    en: ['LIGHTS OFF', 'IT FLIES TO THE LIGHT', "YOU'RE NOT THE FIRST", 'BE QUIET', 'EXIT IS BELOW'],
  },
};
