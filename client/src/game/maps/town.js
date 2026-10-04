// Quiet Hollow: repair the generator, tune the radio for the crypt code, fuel the bus, find its key.
import { GridBuilder } from './gridbuilder.js';
import { MAT } from '../../engine/textures.js';
import { MeshBuilder, cylinderBuilder } from '../../engine/mesh.js';
import { DrawItem } from '../../engine/renderer.js';
import { m4 } from '../../engine/math.js';

function layout() {
  const g = new GridBuilder(50, 44, ',', 11);
  // forest border
  for (let x = 0; x < 50; x++) {
    g.put(x, 0, 'T');
    g.put(x, 43, 'T');
  }
  for (let z = 0; z < 44; z++) {
    g.put(0, z, 'T');
    g.put(49, z, 'T');
  }
  g.scatter(1, 1, 48, 2, 'T', 14, ',');
  g.scatter(1, 41, 48, 42, 'T', 14, ',');
  // streets
  g.fill(1, 21, 48, 22, '_');
  g.fill(24, 1, 25, 42, '_');
  for (const x of [4, 11, 18, 32, 39]) g.put(x, x % 2 ? 20 : 23, 'L');
  for (let z = 4; z < 42; z += 7) g.put(z % 2 ? 23 : 26, z, 'L');

  // garage (generator)
  g.room(3, 4, 12, 10, '.', 'B');
  g.put(8, 10, 'D');
  g.put(7, 7, '1');
  g.puts([[4, 5], [5, 5], [11, 5], [11, 9]], 's');
  g.puts([[10, 7], [4, 9]], 'c');
  g.put(6, 5, 'l');
  g.put(10, 8, 'F');
  g.put(5, 8, 'i');
  // radio station
  g.room(28, 3, 35, 9, '.', 'B');
  g.put(31, 9, 'D');
  g.put(31, 4, '2');
  g.puts([[29, 4], [34, 4]], 'h');
  g.puts([[34, 8], [29, 8]], 's');
  g.put(32, 6, 'l');
  g.put(33, 7, 'i');
  // sheriff office
  g.room(38, 4, 46, 10, '.', 'W');
  g.put(42, 10, 'D');
  g.puts([[39, 5], [41, 5]], 'H');
  g.puts([[43, 7], [40, 8]], 'h');
  g.put(42, 6, 'l');
  g.put(44, 9, 'i');
  g.room(43, 4, 46, 7, '.', 'W'); // holding cell
  g.puts([[44, 7]], 'b');
  g.put(45, 6, 'k');
  g.put(44, 5, 'F');
  g.put(39, 9, 'n'); // radio frequency note
  // houses north of the main street
  g.room(3, 13, 10, 18, '.', 'W');
  g.put(6, 18, 'D');
  g.puts([[4, 14], [9, 14]], 's');
  g.put(7, 16, 't');
  g.put(5, 15, 'l');
  g.put(4, 17, 'F');
  g.room(14, 13, 20, 18, '.', 'W');
  g.put(17, 18, 'D');
  g.puts([[15, 14], [19, 14]], 'k');
  g.put(17, 15, 'l');
  g.put(19, 17, 'i');
  g.put(15, 16, 'H');
  g.room(29, 13, 36, 18, '.', 'B');
  g.put(32, 18, 'D');
  g.puts([[30, 14], [35, 14]], 's');
  g.put(33, 15, 't');
  g.put(31, 16, 'l');
  g.put(35, 17, 'F');
  g.put(30, 17, 'p');
  g.room(40, 13, 47, 18, '.', 'W');
  g.put(43, 18, 'D');
  g.puts([[41, 14], [46, 14]], 'k');
  g.put(44, 15, 'l');
  g.put(46, 17, 'i');
  g.put(41, 17, 'H');
  // gas station
  g.room(3, 26, 11, 31, '.', 'B');
  g.put(7, 26, 'D');
  g.puts([[4, 27], [5, 27], [10, 27], [10, 30]], 's');
  g.put(7, 29, 'l');
  g.put(4, 30, 'i');
  g.put(14, 28, '5'); // fuel pump (gives a gas can once powered)
  g.put(14, 27, 'L');
  // south houses
  g.room(15, 27, 21, 32, '.', 'W');
  g.put(18, 27, 'D');
  g.puts([[16, 28], [20, 31]], 'k');
  g.put(18, 30, 'l');
  g.put(16, 31, 'F');
  g.put(20, 28, 'H');
  g.room(27, 26, 31, 31, '.', 'W');
  g.put(29, 26, 'D');
  g.put(28, 30, 's');
  g.put(30, 28, 'i');
  g.put(29, 29, 'l');
  // church with crypt
  g.room(33, 27, 46, 40, '.', 'B');
  g.put(39, 27, 'D');
  for (let z = 30; z <= 37; z += 2) {
    g.hline(35, 37, z, 't');
    g.hline(40, 41, z, 't');
  }
  g.puts([[38, 29], [38, 33], [38, 37], [43, 29]], 'l');
  g.puts([[34, 28], [34, 39]], 'H');
  g.put(45, 28, 'i');
  g.room(41, 33, 46, 40, '.', '#');
  g.put(43, 33, 'K');
  g.put(42, 32, '3'); // keypad
  g.put(44, 37, '4'); // bus key
  g.put(43, 35, 'l');
  // bus at the east end of the main street
  g.fill(41, 19, 48, 20, 'u');
  g.put(44, 21, '6');
  g.fill(46, 21, 48, 22, 'X');
  // fenced field (scarecrow's home)
  g.fill(2, 35, 21, 41, 'g');
  g.hline(2, 21, 34, 'f');
  g.vline(22, 34, 41, 'f');
  g.put(11, 34, ',');
  g.put(22, 38, ',');
  g.put(11, 38, 'M');
  g.scatter(2, 35, 21, 41, 'c', 4, 'g');
  // yards & clutter
  g.hline(3, 10, 12, 'f');
  g.put(6, 12, ',');
  g.hline(40, 47, 12, 'f');
  g.put(43, 12, ',');
  g.puts([[13, 22], [33, 21], [20, 24], [36, 24]], 'C');
  g.scatter(1, 3, 48, 40, 'T', 18, ',');
  g.scatter(1, 3, 48, 40, 'p', 8, ',');
  g.scatter(1, 3, 48, 40, 'i', 4, ',');
  g.scatter(1, 3, 48, 40, 'r', 6, ',');
  g.puts([[22, 23], [23, 24], [22, 24], [23, 23]], 'P');
  // keep the streets clear
  return g.rows();
}

export default {
  id: 'town',
  name: 'map_town',
  desc: 'map_town_d',
  monster: 'scarecrow',
  wallHeight: 2.9,
  exteriorHeight: 4.2,
  outdoorDefault: true,
  grid: layout(),
  palette: {
    wall: MAT.PLASTER,
    floor: MAT.WOOD,
    ceil: MAT.PLASTER,
    outdoor: MAT.DIRT,
    road: MAT.ASPHALT,
    exterior: MAT.SIDING,
    wallTop: MAT.ROOF,
    roof: MAT.ROOF,
    door: 'wood',
    furniture: MAT.WOOD,
    shelf: MAT.WOOD,
  },
  baseboard: MAT.WOOD,
  zones: [
    { x0: 4, z0: 5, x1: 11, z1: 9, floor: MAT.CONCRETE_FLOOR, wall: MAT.BRICK, ceil: MAT.CONCRETE, decor: { wall: [['tires', 2], ['barrels', 2], ['shelf', 1], ['pallet', 1], ['bucket', 1]], thin: [['electricBox', 1], ['pipesWall', 1]], density: { wall: 0.45 } } },
    { x0: 4, z0: 27, x1: 10, z1: 30, floor: MAT.TILES, decor: { wall: [['vending', 1], ['shelf', 2], ['cooler', 1], ['trashCan', 1]], density: { wall: 0.5 } } },
    { x0: 42, z0: 34, x1: 45, z1: 39, floor: MAT.CONCRETE_FLOOR, wall: MAT.CONCRETE, ceil: MAT.CONCRETE, decor: { wall: [['crate', 1], ['lantern', 1]], thin: [['cobweb', 1]], floor: [['debris', 2]], ceiling: [['cobweb', 3]] } },
    { x0: 34, z0: 28, x1: 45, z1: 39, floor: MAT.CONCRETE_FLOOR, wall: MAT.PLASTER, decor: { wall: [['lantern', 2], ['crate', 1], ['bookshelf', 1]], thin: [['poster', 0.5], ['cobweb', 2]], ceiling: [['cobweb', 3]] } },
  ],
  matTile: {},
  lamp: { color: [1.0, 0.75, 0.45], intensity: 5, radius: 7, flickerChance: 0.35, brokenChance: 0.2, glow: 0.7 },
  lampStyle: 'bulb',
  streetLamp: { color: [1.0, 0.62, 0.32], intensity: 20, radius: 13, group: 'street', brokenChance: 0.2 },
  unpoweredGroups: ['street'],
  env: {
    ambient: [0.018, 0.02, 0.026],
    skyAmbient: [0.035, 0.042, 0.06],
    moonDir: [-0.5, 0.6, 0.6],
    moonColor: [0.1, 0.12, 0.17],
    fogColor: [0.012, 0.014, 0.02],
    fogDensity: 0.045,
    sky: true,
    skyTop: [0.005, 0.007, 0.014],
    skyHorizon: [0.03, 0.035, 0.05],
    cloudiness: 0.6,
    wetness: 0.3,
    dust: { color: [0.006, 0.006, 0.007], drift: [0.25, -0.05, 0.1] },
    volumeDensity: 0.10,
  },
  decor: {
    wall: [['bookshelf', 2], ['table', 1], ['plant', 1], ['boxes', 2], ['filing', 0.5], ['radioBox', 0.5], ['lantern', 0.5]],
    thin: [['poster', 2], ['clock', 1], ['radiator', 1], ['wallShelf', 2]],
    floor: [['papers', 1], ['fallenChair', 1], ['debris', 1], ['bloodlessStain', 1]],
    ceiling: [['cobweb', 2]],
    outdoor: [['grass', 8], ['bush', 3], ['trashBag', 1], ['trashCan', 1], ['tires', 1], ['barrels', 0.6], ['mailbox', 0.8], ['hydrant', 0.4], ['pole', 0.5], ['cone', 0.6], ['barrier', 0.3], ['carWreck', 0.25], ['debris', 1]],
    density: { wall: 0.35, thin: 0.3, floor: 0.25, ceiling: 0.15, outdoor: 0.28 },
  },
  ambience: 'amb_town',
  objects: {
    K: { door: 'metal', lockedBy: 'crypt' },
    u: { blockNav: true, solid: false, outdoor: true, floor: MAT.ASPHALT },
    X: { outdoor: true, floor: MAT.ASPHALT },
    6: { outdoor: true, floor: MAT.ASPHALT },
    F: {},
    1: {},
    2: {},
    3: {},
    4: {},
    5: { outdoor: true },
    n: {},
  },
  objectives: [
    { id: 'generator', type: 'generator', anchor: '1', text: 'o_generator', power: ['street'] },
    { id: 'radio', type: 'radio', anchor: '2', notes: 'n', text: 'o_radio' },
    { id: 'crypt', type: 'keypad', keypad: '3', codeFrom: 'radio', requires: ['radio'], text: 'o_code' },
    { id: 'gas', type: 'collect', item: 'gas', spawn: 'F', count: 3, deliver: '6', late: { after: 'generator', anchor: '5' }, text: 'o_gas' },
    { id: 'buskey', type: 'collect', item: 'key', spawn: '4', count: 1, requires: [], text: 'o_bus' },
    { id: 'exit', type: 'exit', requires: ['gas', 'buskey', 'crypt'], text: 'o_escape' },
  ],
  writings: {
    ru: ['НЕ ОТВОДИ ГЛАЗ', 'ОНО СТОИТ ТАМ', 'СМОТРИ НА НЕГО', 'АВТОБУС УШЁЛ'],
    en: ["DON'T LOOK AWAY", 'IT STANDS THERE', 'WATCH IT', 'THE BUS LEFT'],
  },
  decorate(world) {
    // the bus
    const gl = world.gl;
    const b = new MeshBuilder(512);
    const L = 7.6, W = 1.25, H = 2.9;
    b.box([-L, 0.45, -W], [L, H, W], MAT.PAINTED_METAL, { uv: 'local' });
    for (let i = 0; i < 7; i++) {
      const x = -L + 1.2 + i * 2.0;
      b.box([x, 1.6, -W - 0.01], [x + 1.5, 2.5, W + 0.01], MAT.GLASS, { uv: 'local' });
    }
    b.box([L - 0.01, 1.4, -W + 0.2], [L + 0.01, 2.6, W - 0.2], MAT.GLASS, { uv: 'local' });
    const wheel = cylinderBuilder(MAT.RUST_METAL, 12, true);
    const m = m4.create();
    for (const sx of [-L + 1.6, L - 2]) {
      for (const sz of [-W, W]) {
        m4.identity(m);
        m4.translate(m, m, sx, 0.5, sz);
        m4.rotateX(m, m, Math.PI / 2);
        m4.scale(m, m, 1.0, 0.3, 1.0);
        b.append(wheel, m);
      }
    }
    const item = new DrawItem(b.build(gl), -1);
    item.setColor([0.75, 0.55, 0.12]);
    item.sky = 1;
    const cx = 45 * 2, cz = 20 * 2;
    m4.identity(item.model);
    m4.translate(item.model, item.model, cx, 0, cz);
    item.center = [cx, 1.5, cz];
    item.radius = 9;
    world.dynamicItems.push(item);
    world.physics.add({ min: [cx - L, 0, cz - W], max: [cx + L, H, cz + W] });
    world.busPos = [cx, 0, cz];
    // radio mast
    const mast = new MeshBuilder(256);
    const pole = cylinderBuilder(MAT.RUST_METAL, 6, false, 0.05, 0.12).setAttr(null, 1);
    m4.identity(m);
    m4.translate(m, m, 36.5 * 2, 6, 6.5 * 2);
    m4.scale(m, m, 1, 12, 1);
    mast.append(pole, m);
    for (let i = 1; i < 6; i++) mast.box([36.5 * 2 - 0.5, i * 2, 6.5 * 2 - 0.02], [36.5 * 2 + 0.5, i * 2 + 0.05, 6.5 * 2 + 0.02], MAT.RUST_METAL, { uv: 'local', sky: 1 });
    world.staticMeshes.push({ mesh: mast.build(gl), min: [72, 0, 12], max: [75, 12, 15] });
    // church bell tower
    const tower = new MeshBuilder(256);
    tower.box([37 * 2, 4.2, 26 * 2 + 1], [40 * 2, 9, 28 * 2 + 1], MAT.BRICK, { sky: 1 });
    tower.box([37 * 2 - 0.3, 9, 26 * 2 + 0.7], [40 * 2 + 0.3, 9.4, 28 * 2 + 1.3], MAT.ROOF, { sky: 1 });
    tower.box([38.5 * 2 - 0.15, 9.4, 27 * 2 + 0.85], [38.5 * 2 + 0.15, 11.5, 27 * 2 + 1.15], MAT.RUST_METAL, { sky: 1, uv: 'local' });
    tower.box([38.5 * 2 - 0.6, 10.3, 27 * 2 + 1 - 0.08], [38.5 * 2 + 0.6, 10.5, 27 * 2 + 1 + 0.08], MAT.RUST_METAL, { sky: 1, uv: 'local' });
    world.staticMeshes.push({ mesh: tower.build(gl), min: [73, 4, 52], max: [81, 12, 58] });
    // fuel pump canopy
    const can = new MeshBuilder(64);
    can.box([12 * 2, 3.6, 26 * 2], [16 * 2, 3.9, 30 * 2], MAT.PAINTED_METAL, { sky: 1, uv: 'local' });
    can.box([12 * 2 + 0.2, 0, 26 * 2 + 0.2], [12 * 2 + 0.45, 3.6, 26 * 2 + 0.45], MAT.PAINTED_METAL, { sky: 1, uv: 'local' });
    can.box([16 * 2 - 0.45, 0, 30 * 2 - 0.45], [16 * 2 - 0.2, 3.6, 30 * 2 - 0.2], MAT.PAINTED_METAL, { sky: 1, uv: 'local' });
    world.staticMeshes.push({ mesh: can.build(gl), min: [24, 0, 52], max: [32, 4, 60] });
    world.physics.add({ min: [24.2, 0, 52.2], max: [24.45, 3.6, 52.45] });
    world.physics.add({ min: [31.55, 0, 59.55], max: [31.8, 3.6, 59.8] });
  },
};
