// Blackyard Prison: admin wing -> restore power -> cell block levers -> yard -> gate.
import { GridBuilder } from './gridbuilder.js';
import { MAT } from '../../engine/textures.js';

function layout() {
  const g = new GridBuilder(46, 40, '#', 7);
  // ---------------- yard (north, outdoor)
  g.fill(1, 3, 44, 10, ',');
  g.fill(21, 1, 24, 1, 'X'); // exit pocket beyond the gate
  g.put(22, 2, 'G');
  g.put(21, 3, '6'); // gate lock panel
  g.puts([[3, 4], [42, 4], [3, 10], [42, 10], [14, 7], [31, 7]], 'L');
  g.puts([[7, 4], [8, 4], [7, 5], [37, 9], [38, 9], [38, 8], [26, 4], [17, 9]], 'c');
  g.puts([[10, 8], [35, 5]], 'T');
  g.hline(28, 34, 6, 'f');
  g.puts([[15, 5], [16, 5]], 't');
  g.puts([[5, 9], [40, 6], [30, 9]], 'i');
  g.puts([[12, 4], [24, 9], [33, 8], [19, 6]], 'p');
  g.put(22, 12, 'A'); // door yard <-> cell block (levers)
  g.put(22, 11, ',');

  // ---------------- cell block (z 13..21)
  g.fill(1, 16, 44, 18, '.'); // corridor through both wings
  g.fill(18, 13, 27, 21, '.'); // central hall
  for (const [x0, x1] of [[1, 16], [29, 44]]) {
    // upper cells z13..14, bars z15; lower cells z20..21 bars z19
    for (let x = x0; x <= x1; x += 3) {
      const a = x, b = x + 1;
      if (b > x1) break;
      g.fill(a, 13, b, 14, '.');
      g.put(a, 15, 'b');
      g.put(b, 15, '|');
      g.fill(a, 20, b, 21, '.');
      g.put(a, 19, 'b');
      g.put(b, 19, '|');
      g.put(a, 13, 'k');
      g.put(a, 21, 'k');
      if (x + 2 <= x1) {
        g.vline(x + 2, 13, 15, '#');
        g.vline(x + 2, 19, 21, '#');
      }
    }
  }
  g.puts([[2, 17], [8, 17], [14, 17], [31, 17], [37, 17], [43, 17]], 'l');
  g.puts([[20, 14], [25, 14], [20, 19], [25, 19], [22, 17]], 'l');
  g.puts([[19, 16], [26, 16], [19, 18], [26, 18]], 'o');
  g.puts([[22, 20], [23, 20]], 't');
  g.put(25, 13, '3'); // signal board
  g.puts([[1, 16], [1, 18], [44, 16], [44, 18]], '2'); // levers at corridor ends
  g.puts([[2, 14], [42, 20]], 'n'); // code notes in cells (wall mounted)
  g.puts([[5, 14], [11, 21], [36, 14], [39, 21], [29, 14]], 'i');
  g.puts([[13, 14], [32, 20]], 'p');
  // power-gated bars between hall and admin wing
  g.puts([[20, 22], [25, 22]], 'Q');
  g.put(8, 22, 'v'); // vent from storage into a lower west cell
  g.put(8, 23, 'v');

  // ---------------- admin wing (z 23..38)
  g.fill(1, 27, 44, 28, '.'); // main corridor
  g.puts([[4, 27], [12, 28], [20, 27], [28, 28], [36, 27], [43, 28]], 'l');
  // rooms north of corridor (z 23..25), wall at z26
  g.room(0, 22, 9, 26, '.'); // storage
  g.put(8, 22, 'v');
  g.room(9, 22, 17, 26, '.'); // showers
  g.fill(18, 23, 27, 26, '.'); // lobby under the gates
  g.room(27, 22, 36, 26, '.'); // guard room
  g.room(36, 22, 45, 26, '.'); // infirmary
  g.fill(19, 22, 26, 22, '#');
  g.puts([[20, 22], [25, 22]], 'Q');
  g.put(18, 26, '.');
  g.put(27, 26, '#');
  g.puts([[5, 26], [13, 26], [31, 26], [40, 26]], 'D');
  g.put(8, 23, 'v');
  g.puts([[2, 23], [3, 23], [6, 25], [7, 25]], 's');
  g.puts([[2, 25], [4, 24]], 'c');
  g.puts([[10, 23], [12, 23], [14, 23], [16, 23]], 'H');
  g.puts([[28, 23], [29, 23], [30, 23]], 'H');
  g.puts([[33, 24]], 't');
  g.puts([[38, 23], [41, 23], [43, 23]], 'k');
  g.puts([[44, 25]], 's');
  g.puts([[22, 24], [23, 24]], 'o');
  g.puts([[3, 24], [13, 24], [31, 25], [41, 24]], 'F');
  g.put(16, 25, 'n');
  g.puts([[2, 24], [11, 25], [34, 23], [42, 25], [19, 24]], 'i');
  g.puts([[5, 23], [35, 25]], 'p');
  g.puts([[13, 24], [31, 24], [41, 25], [21, 25]], 'l');
  // rooms south of corridor (z 30..37), wall z29
  g.room(0, 29, 8, 38, '.'); // switch room
  g.room(8, 29, 23, 38, '.'); // cafeteria
  g.room(23, 29, 31, 38, '.'); // kitchen
  g.room(31, 29, 45, 38, '.'); // warden office
  g.puts([[4, 29], [15, 29], [27, 29]], 'D');
  g.put(37, 29, 'K'); // warden office (code)
  g.put(36, 28, '4'); // keypad next to the door
  g.put(2, 30, '1'); // fuse box
  g.puts([[6, 33], [6, 34]], 'c');
  g.puts([[3, 36], [5, 36]], 's');
  g.put(4, 33, 'l');
  for (let x = 10; x <= 20; x += 3) for (let z = 31; z <= 36; z += 2) g.put(x, z, 't');
  g.puts([[12, 33], [18, 33], [15, 36]], 'l');
  g.put(21, 36, 'M');
  g.puts([[12, 35], [27, 33]], 'F');
  g.puts([[24, 30], [24, 31], [30, 30], [30, 31], [30, 36]], 's');
  g.puts([[27, 35]], 't');
  g.put(27, 31, 'l');
  g.puts([[25, 37], [29, 37]], 'p');
  g.puts([[9, 37], [22, 30]], 'n');
  g.puts([[34, 32], [40, 32]], 'h');
  g.puts([[32, 37], [33, 37], [44, 36], [44, 37]], 's');
  g.puts([[35, 35], [41, 35]], 'l');
  g.put(38, 36, '5'); // gate key
  g.puts([[43, 30], [32, 30]], 'i');
  g.puts([[10, 30], [21, 37], [26, 36]], 'i');
  g.puts([[2, 27], [3, 28], [5, 27], [6, 28]], 'P');
  g.puts([[14, 32], [19, 34]], 'p');
  return g.rows();
}

export default {
  id: 'prison',
  name: 'map_prison',
  desc: 'map_prison_d',
  monster: 'warden',
  wallHeight: 3.2,
  exteriorHeight: 6,
  grid: layout(),
  palette: {
    wall: MAT.PRISON_WALL,
    floor: MAT.CONCRETE_FLOOR,
    ceil: MAT.CONCRETE,
    outdoor: MAT.DIRT,
    exterior: MAT.CONCRETE,
    wallTop: MAT.CONCRETE,
    roof: MAT.CONCRETE,
    door: 'metal',
    doorColor: [0.3, 0.36, 0.33],
    furniture: MAT.RUST_METAL,
  },
  zones: [
    { x0: 1, z0: 13, x1: 44, z1: 21, powerGroup: 'block' },
    { x0: 10, z0: 23, x1: 16, z1: 25, floor: MAT.TILES, wall: MAT.TILES },
    { x0: 37, z0: 23, x1: 44, z1: 25, floor: MAT.TILES, wall: MAT.TILES },
    { x0: 9, z0: 30, x1: 22, z1: 37, floor: MAT.TILES },
    { x0: 24, z0: 30, x1: 30, z1: 37, floor: MAT.TILES, wall: MAT.TILES },
    { x0: 32, z0: 30, x1: 44, z1: 37, floor: MAT.WOOD, wall: MAT.PLASTER },
    { x0: 1, z0: 30, x1: 7, z1: 37, powerGroup: 'switch' },
  ],
  lamp: { color: [1.0, 0.82, 0.58], intensity: 6.5, radius: 8.5, flickerChance: 0.3, brokenChance: 0.12, glow: 0.8 },
  lampStyle: 'cage',
  streetLamp: { color: [0.75, 0.85, 1.0], intensity: 22, radius: 14, group: 'yard', brokenChance: 0.0 },
  unpoweredGroups: ['block', 'yard', 'switch'],
  env: {
    ambient: [0.022, 0.023, 0.028],
    skyAmbient: [0.02, 0.025, 0.04],
    moonDir: [0.4, 0.75, -0.5],
    moonColor: [0.07, 0.09, 0.14],
    fogColor: [0.004, 0.005, 0.007],
    fogDensity: 0.055,
    sky: true,
    skyTop: [0.004, 0.006, 0.012],
    skyHorizon: [0.02, 0.025, 0.035],
    cloudiness: 0.8,
    wetness: 0.6,
    dust: { color: [0.004, 0.004, 0.005] },
    volumeDensity: 0.08,
  },
  ambience: 'amb_prison',
  objects: {
    G: { door: 'gate', lockedBy: 'gate' },
    A: { door: 'metal', lockedBy: 'levers' },
    K: { door: 'metal', lockedBy: 'code' },
    Q: { door: 'bars', lockedBy: 'fuses' },
    F: {},
    1: {},
    2: {},
    3: {},
    4: {},
    5: {},
    6: {},
    n: {},
  },
  objectives: [
    { id: 'fuses', type: 'collect', item: 'fuse', spawn: 'F', count: 3, deliver: '1', text: 'o_fuses', power: ['block', 'switch'] },
    { id: 'levers', type: 'levers', anchor: '2', board: '3', requires: ['fuses'], text: 'o_levers', power: ['yard'] },
    { id: 'code', type: 'keypad', keypad: '4', notes: 'n', text: 'o_code' },
    { id: 'gate', type: 'collect', item: 'key', spawn: '5', count: 1, deliver: '6', requires: [], text: 'o_gate' },
    { id: 'exit', type: 'exit', requires: ['levers', 'gate'], text: 'o_escape' },
  ],
  writings: {
    ru: ['ОН СЛЫШИТ', 'НЕ БЕГИ', 'ТИШЕ', 'IIII IIII II', 'ВЫХОДА НЕТ', 'ПРИСЯДЬ'],
    en: ['HE HEARS', "DON'T RUN", 'QUIET', 'IIII IIII II', 'NO WAY OUT', 'CROUCH'],
  },
};
