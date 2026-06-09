let disposeSnapshot = null;

function injectVinylStyles() {
  if (document.getElementById('echo-vinyl-global-style')) return;
  
  const style = document.createElement('style');
  style.id = 'echo-vinyl-global-style';
  style.textContent = `
    .lyric-page [class*="cover"],
    .lyric-page [class*="thumb"],
    .lyric-page .album-cover,
    .lyric-page img {
      background: transparent !important;
      background-color: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }

    div:has(> img[src*="cover"]), 
    div:has(> .echo-vinyl-cover) {
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }

    .lyric-page img,
    [class*="lyric"] img,
    [class*="player"] img,
    [class*="cover"] img,
    .album-cover img,
    img[src*="cover"] {
      border-radius: 50% !important;
      border: 8px solid #141416 !important;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6) !important;
      transition: transform 0.5s ease;
      animation: echoVinylRotate 25s linear infinite !important;
      animation-play-state: paused !important;
    }

    body.echo-music-playing .lyric-page img,
    body.echo-music-playing [class*="lyric"] img,
    body.echo-music-playing [class*="player"] img,
    body.echo-music-playing [class*="cover"] img,
    body.echo-music-playing .album-cover img,
    body.echo-music-playing img[src*="cover"] {
      animation-play-state: running !important;
    }

    @keyframes echoVinylRotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export function activate(ctx) {
  injectVinylStyles();

  if (ctx && ctx.nowPlaying) {
    ctx.nowPlaying.getSnapshot().then((snapshot) => {
      if (snapshot?.playback?.isPlaying) {
        document.body.classList.add('echo-music-playing');
      }
    }).catch(() => {});

    disposeSnapshot = ctx.nowPlaying.onSnapshot((snapshot) => {
      if (snapshot?.playback?.isPlaying) {
        document.body.classList.add('echo-music-playing');
      } else {
        document.body.classList.remove('echo-music-playing');
      }
    });
  }
}

export function deactivate(ctx) {
  if (disposeSnapshot) {
    try { disposeSnapshot(); } catch(e) {}
  }
  const styleEl = document.getElementById('echo-vinyl-global-style');
  if (styleEl) styleEl.remove();
  document.body.classList.remove('echo-music-playing');
}