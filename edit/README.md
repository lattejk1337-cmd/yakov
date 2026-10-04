# how u feel? — photo edit

Vertical 1080x1920 edit of three photos, cut to Destroy Lonely — "how u feel?" (132 BPM).
All cuts, zoom punches, flashes and glitches sit on the beat grid.

| beats | time | part |
|---|---|---|
| 0–8 | 0.00–3.64s | intro: typewriter title, laptop fades in, whip-zoom into the screen |
| 8–16 | 3.64–7.27s | build: detail cuts on every beat, then every half beat |
| 16 | **7.27s** | **drop**: white flash, B&W selfie with the red chair kept red, HOW / U / FEEL / ? |
| 24–28 | 10.9–12.7s | three-panel split |
| 28–32 | 12.7–14.5s | full-frame cuts, 1/16 glitch roll |
| 32–36 | 14.5–16.4s | outro, fade to black |

Put the track under `out/how_u_feel_edit.mp4` so the flash at 7.27s lands on the start of the hook,
or mux it here:

    pip install pillow numpy
    python3 render.py --audio song.mp3 --offset <seconds into the song where the edit starts>
    python3 render.py --preview   # contact sheet of key frames
