// Yandex Games SDK wrapper with a graceful offline stub (local dev / other hosting).
// Covers: init, language, LoadingAPI.ready (req. 1.19.2), GameplayAPI start/stop,
// pause/resume events, fullscreen & rewarded ads with audio muting, cloud saves, leaderboard.

class GameSDK {
  constructor() {
    this.ysdk = null;
    this.player = null;
    this.lang = (navigator.language || 'ru').slice(0, 2);
    this.isYandex = false;
    this.gameplayActive = false;
    this.adActive = false;
    this.lastFullscreen = 0;
    this.listeners = { pause: [], resume: [], adStart: [], adEnd: [] };
  }

  on(evt, fn) {
    this.listeners[evt].push(fn);
  }
  emit(evt, ...a) {
    for (const fn of this.listeners[evt]) {
      try {
        fn(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async init() {
    // sdk.js is included in index.html; on Yandex it defines window.YaGames.
    const deadline = performance.now() + 4000;
    while (!window.YaGames && performance.now() < deadline && document.querySelector('script[data-ysdk]')?.dataset.failed !== '1') {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!window.YaGames) {
      console.info('[sdk] Yandex SDK not available, running standalone');
      return this;
    }
    try {
      this.ysdk = await window.YaGames.init();
      this.isYandex = true;
      this.lang = this.ysdk.environment?.i18n?.lang || this.lang;
      this.ysdk.on?.('game_api_pause', () => this.emit('pause', 'sdk'));
      this.ysdk.on?.('game_api_resume', () => this.emit('resume', 'sdk'));
      try {
        this.player = await this.ysdk.getPlayer({ scopes: false });
      } catch (e) {
        this.player = null;
      }
    } catch (e) {
      console.warn('[sdk] init failed', e);
      this.ysdk = null;
    }
    return this;
  }

  get isMobile() {
    try {
      if (this.ysdk?.deviceInfo) return this.ysdk.deviceInfo.isMobile() || this.ysdk.deviceInfo.isTablet();
    } catch (e) {
      /* ignore */
    }
    return matchMedia('(pointer: coarse)').matches;
  }

  playerName() {
    try {
      const n = this.player?.getName?.();
      if (n && this.player?.isAuthorized?.()) return n;
    } catch (e) {
      /* ignore */
    }
    return null;
  }
  playerId() {
    try {
      return this.player?.getUniqueID?.() || null;
    } catch (e) {
      return null;
    }
  }

  // Requirement 1.19.2: signal readiness once assets are loaded and the game is interactive.
  ready() {
    try {
      this.ysdk?.features?.LoadingAPI?.ready();
    } catch (e) {
      /* ignore */
    }
  }
  gameplayStart() {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    try {
      this.ysdk?.features?.GameplayAPI?.start();
    } catch (e) {
      /* ignore */
    }
  }
  gameplayStop() {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    try {
      this.ysdk?.features?.GameplayAPI?.stop();
    } catch (e) {
      /* ignore */
    }
  }

  // Fullscreen ad at a natural break (between matches). Resolves when closed.
  showFullscreen() {
    return new Promise((resolve) => {
      if (!this.ysdk?.adv || this.adActive) return resolve(false);
      // the platform throttles too, but avoid spamming requests
      if (performance.now() - this.lastFullscreen < 65000 && this.lastFullscreen) return resolve(false);
      this.adActive = true;
      let done = false;
      const finish = (shown) => {
        if (done) return;
        done = true;
        this.adActive = false;
        this.emit('adEnd');
        resolve(shown);
      };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => {
              this.lastFullscreen = performance.now();
              this.emit('adStart');
            },
            onClose: (wasShown) => finish(!!wasShown),
            onError: () => finish(false),
            onOffline: () => finish(false),
          },
        });
      } catch (e) {
        finish(false);
      }
    });
  }

  // Rewarded video. Resolves true if the reward should be granted.
  showRewarded() {
    return new Promise((resolve) => {
      if (!this.ysdk?.adv) {
        // standalone: grant immediately so the feature is testable
        return resolve(!this.isYandex);
      }
      if (this.adActive) return resolve(false);
      this.adActive = true;
      let rewarded = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.adActive = false;
        this.emit('adEnd');
        resolve(rewarded);
      };
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => this.emit('adStart'),
            onRewarded: () => (rewarded = true),
            onClose: finish,
            onError: finish,
          },
        });
      } catch (e) {
        finish();
      }
    });
  }

  async loadData() {
    let cloud = null;
    try {
      if (this.player?.getData) cloud = await this.player.getData();
    } catch (e) {
      cloud = null;
    }
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem('deadhour_save') || 'null');
    } catch (e) {
      local = null;
    }
    // prefer the most recent save
    if (cloud && cloud.profile && (!local || (cloud.profile.savedAt || 0) >= (local.profile?.savedAt || 0))) return cloud;
    return local;
  }

  async saveData(data) {
    try {
      localStorage.setItem('deadhour_save', JSON.stringify(data));
    } catch (e) {
      /* storage may be unavailable */
    }
    try {
      if (this.player?.setData) await this.player.setData(data, false);
    } catch (e) {
      /* ignore */
    }
  }

  async submitScore(board, value) {
    try {
      if (this.ysdk?.leaderboards?.setScore) await this.ysdk.leaderboards.setScore(board, value);
      else if (this.ysdk?.getLeaderboards) {
        const lb = await this.ysdk.getLeaderboards();
        await lb.setLeaderboardScore(board, value);
      }
    } catch (e) {
      /* leaderboard not configured or player not authorised */
    }
  }
}

export const sdk = new GameSDK();
