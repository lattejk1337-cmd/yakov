// Game-wide tunables.

export const CONFIG = {
  // Multiplayer server. Empty -> same host as the page (useful for self-hosting/dev).
  // For Yandex Games set it to your deployed server, e.g. 'wss://horror.example.com/ws'.
  SERVER_URL: '',
  MATCHMAKING_TIMEOUT: 20, // seconds before empty slots are filled with bots
  NET_SEND_RATE: 15, // player state packets per second
  NET_WORLD_RATE: 10, // host world snapshots per second

  CELL: 2, // meters per map grid cell
  WALL_H: 3, // indoor ceiling height

  PLAYER: {
    radius: 0.32,
    height: 1.75,
    crouchHeight: 1.05,
    eye: 1.62,
    crouchEye: 0.95,
    walkSpeed: 3.0,
    sprintSpeed: 5.6,
    crouchSpeed: 1.5,
    injuredMul: 0.92,
    jumpVel: 4.2,
    staminaMax: 100,
    sprintCost: 20, // per second
    jumpCost: 12,
    staminaRegen: 16,
    staminaDelay: 1.1,
    exhaustedUntil: 30,
    batteryMax: 100,
    batteryDrain: 0.9, // per second while on
    bleedOutTime: 60,
    reviveTime: 5,
    healTime: 4,
    maxMedkits: 2,
    maxAdrenaline: 1,
    maxBatteries: 3,
  },
  MONSTER_HIT: 1, // health states removed per hit (2 states: healthy -> injured -> downed)
  XP_PER_LEVEL: (lvl) => 120 + lvl * 60,
};

export const MODES = {
  solo: { size: 1 },
  duo: { size: 2 },
  trio: { size: 3 },
  squad: { size: 4 },
};

export const MAP_IDS = ['prison', 'town', 'backrooms', 'hospital'];
