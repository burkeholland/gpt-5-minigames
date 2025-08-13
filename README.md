Bioluminescent Night Garden — Moth Drift

Files:
- index.html — game page (open in browser)
- main.js — Phaser 3 game logic

How to run:
1. Open `index.html` in a modern browser (Chrome, Edge, Firefox). Recommended: serve over HTTP (see quick servers) to avoid any file:// restrictions. Audio in this version is synthesized locally (no remote audio downloads), so the game will run without CORS audio issues.

Optional quick server (Node):

```bash
# from project root
npx http-server -c-1 .
# or python
python3 -m http.server 8000
```

Assets & Audio:
- Visuals are generated at runtime; there are no external image assets.
- Audio is synthesized in-browser using WebAudio (ambient pad + collect/hit effects). This avoids CORS problems with remote audio.

Notes:
- Click or tap once to enable audio (browsers require a user gesture to start WebAudio). If audio doesn't start, try clicking inside the game area.
- The game uses runtime-generated shapes for visuals so there are no image files to manage.
