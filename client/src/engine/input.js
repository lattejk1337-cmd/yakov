// Unified input: keyboard + mouse (pointer lock), touch (virtual stick + look pad + buttons), gamepad.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyC: 'crouch', ControlLeft: 'crouch',
  Space: 'jump',
  KeyE: 'interact',
  KeyF: 'flashlight',
  KeyQ: 'heal', Digit1: 'heal',
  KeyX: 'adrenaline', Digit2: 'adrenaline',
  KeyR: 'reload',
  KeyG: 'throw',
  KeyZ: 'ping',
  Escape: 'pause', KeyP: 'pause',
  Tab: 'score',
  Digit5: 'chat1', Digit6: 'chat2', Digit7: 'chat3', Digit8: 'chat4',
  KeyV: 'chat',
};

export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;
    this.downSet = new Set();
    this.pressedSet = new Set();
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = false;
    this.locked = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.usingTouch = this.isTouch;
    this.touchButtons = {};
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = { id: null, x: 0, y: 0 };
    this.onPauseRequest = null;
    this.bind();
    if (this.isTouch) this.buildTouchUI();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!a) return;
      this.usingTouch = false;
      if (!this.downSet.has(a)) this.pressedSet.add(a);
      this.downSet.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.downSet.delete(a);
    });
    window.addEventListener('blur', () => this.downSet.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // ignore absurd spikes some browsers produce on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.look.x += e.movementX * 0.0022 * this.sensitivity;
      this.look.y += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.usingTouch = false;
      if (!this.locked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.press('interact');
      if (e.button === 2) this.press('throw');
      if (e.button === 1) this.press('ping');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.downSet.delete('interact');
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked && this.enabled && this.onPauseRequest) this.onPauseRequest();
    });
    window.addEventListener('gamepadconnected', () => (this.hasGamepad = true));
  }

  press(a) {
    this.pressedSet.add(a);
    this.downSet.add(a);
  }

  requestLock() {
    if (this.usingTouch || this.isTouch) return;
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (r && r.catch) r.catch(() => {});
    } catch (e) {
      /* pointer lock unavailable (iframe without permission) */
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setEnabled(on) {
    this.enabled = on;
    this.downSet.clear();
    this.pressedSet.clear();
    this.look.x = this.look.y = 0;
    if (this.touchRoot) this.touchRoot.classList.toggle('active', on && this.isTouch);
    if (!on) this.releaseLock();
  }

  down(a) {
    return this.enabled && this.downSet.has(a);
  }
  pressed(a) {
    return this.enabled && this.pressedSet.has(a);
  }

  // Call once per frame before reading; returns look delta and clears edges at endFrame()
  update() {
    let mx = 0, my = 0;
    if (this.down('up')) my += 1;
    if (this.down('down')) my -= 1;
    if (this.down('left')) mx -= 1;
    if (this.down('right')) mx += 1;
    if (this.stick.id !== null) {
      mx = this.stick.x;
      my = -this.stick.y;
      // pushing the stick far = sprint (mobile convenience)
      const mag = Math.hypot(this.stick.x, this.stick.y);
      if (mag > 0.95 && this.autoSprint) this.downSet.add('sprintStick');
      else this.downSet.delete('sprintStick');
    }
    this.pollGamepad();
    if (this.gp) {
      if (Math.abs(this.gp.lx) > 0.15 || Math.abs(this.gp.ly) > 0.15) {
        mx = this.gp.lx;
        my = -this.gp.ly;
      }
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.move.x = mx;
    this.move.y = my;
  }
  consumeLook() {
    const x = this.look.x, y = this.look.y;
    this.look.x = this.look.y = 0;
    return [x, y];
  }
  endFrame() {
    this.pressedSet.clear();
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) {
      this.gp = null;
      return;
    }
    const prev = this.gpButtons || [];
    const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    const map = { 0: 'jump', 1: 'crouch', 2: 'interact', 3: 'flashlight', 4: 'heal', 5: 'throw', 6: 'adrenaline', 7: 'interact', 9: 'pause', 10: 'sprint', 12: 'ping', 13: 'reload' };
    const now = [];
    for (const [i, a] of Object.entries(map)) {
      const p = btn(+i);
      now[i] = p;
      if (p && !prev[i]) this.pressedSet.add(a);
      if (p) this.downSet.add(a);
      else if (prev[i]) this.downSet.delete(a);
    }
    this.gpButtons = now;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    this.gp = { lx: dz(gp.axes[0] || 0), ly: dz(gp.axes[1] || 0) };
    if (this.enabled) {
      this.look.x += dz(gp.axes[2] || 0) * 0.05 * this.sensitivity;
      this.look.y += dz(gp.axes[3] || 0) * 0.04 * this.sensitivity * (this.invertY ? -1 : 1);
    }
    this.usingTouch = false;
  }

  // ------------------------------------------------------------------ touch controls
  buildTouchUI() {
    const root = this.touchRoot;
    if (!root) return;
    root.innerHTML = `
      <div class="t-stick-zone"></div>
      <div class="t-look-zone"></div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-buttons">
        <button data-a="interact" class="t-btn t-big t-interact">✋</button>
        <button data-a="sprint" class="t-btn t-sprint" data-hold="1">⚡</button>
        <button data-a="crouch" class="t-btn t-crouch">⤓</button>
        <button data-a="jump" class="t-btn t-jump">⤒</button>
        <button data-a="flashlight" class="t-btn t-flash">🔦</button>
        <button data-a="heal" class="t-btn t-heal" data-hold="1">✚</button>
        <button data-a="adrenaline" class="t-btn t-adr">💉</button>
        <button data-a="throw" class="t-btn t-throw">➶</button>
        <button data-a="reload" class="t-btn t-reload">🔋</button>
        <button data-a="ping" class="t-btn t-ping">📍</button>
        <button data-a="chat" class="t-btn t-chat">💬</button>
        <button data-a="pause" class="t-btn t-pause">❚❚</button>
      </div>`;
    const stickEl = root.querySelector('.t-stick');
    const knob = root.querySelector('.t-knob');
    const stickZone = root.querySelector('.t-stick-zone');
    const lookZone = root.querySelector('.t-look-zone');
    const R = 60;
    stickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.usingTouch = true;
      this.stick.id = t.identifier;
      this.stick.ox = t.clientX;
      this.stick.oy = t.clientY;
      this.stick.x = this.stick.y = 0;
      stickEl.style.left = t.clientX - R + 'px';
      stickEl.style.top = t.clientY - R + 'px';
      stickEl.classList.add('on');
      knob.style.transform = 'translate(0px,0px)';
    }, { passive: false });
    const moveStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
          this.stick.x = dx / R;
          this.stick.y = dy / R;
          knob.style.transform = `translate(${dx}px,${dy}px)`;
        }
        if (t.identifier === this.lookTouch.id) {
          const dx = t.clientX - this.lookTouch.x, dy = t.clientY - this.lookTouch.y;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
          this.look.x += dx * 0.0045 * this.sensitivity;
          this.look.y += dy * 0.0045 * this.sensitivity * (this.invertY ? -1 : 1);
        }
      }
    };
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.id = null;
          this.stick.x = this.stick.y = 0;
          stickEl.classList.remove('on');
        }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = null;
      }
    };
    root.addEventListener('touchmove', (e) => { e.preventDefault(); moveStick(e); }, { passive: false });
    root.addEventListener('touchend', endTouch);
    root.addEventListener('touchcancel', endTouch);
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.usingTouch = true;
      this.lookTouch.id = t.identifier;
      this.lookTouch.x = t.clientX;
      this.lookTouch.y = t.clientY;
    }, { passive: false });
    for (const b of root.querySelectorAll('.t-btn')) {
      const a = b.dataset.a;
      this.touchButtons[a] = b;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.usingTouch = true;
        b.classList.add('down');
        if (a === 'crouch' || a === 'sprint') {
          // toggles on touch for comfort
          if (this.downSet.has(a + 'Toggle')) this.downSet.delete(a + 'Toggle');
          else this.downSet.add(a + 'Toggle');
          b.classList.toggle('toggled', this.downSet.has(a + 'Toggle'));
          this.pressedSet.add(a);
          return;
        }
        this.press(a);
        // allow look-drag starting on a button (thumb slides)
        const t = e.changedTouches[0];
        if (this.lookTouch.id === null && (a === 'interact' || a === 'throw')) {
          this.lookTouch.id = t.identifier;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('down');
        if (a !== 'crouch' && a !== 'sprint') this.downSet.delete(a);
        endTouch(e);
      };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    }
  }

  setTouchVisible(action, visible) {
    const b = this.touchButtons[action];
    if (b) b.classList.toggle('hidden', !visible);
  }
  setTouchLabel(action, html) {
    const b = this.touchButtons[action];
    if (b && b._label !== html) {
      b._label = html;
      b.innerHTML = html;
    }
  }
  resetToggles() {
    this.downSet.delete('crouchToggle');
    this.downSet.delete('sprintToggle');
    for (const b of Object.values(this.touchButtons)) b.classList.remove('toggled');
  }
}
