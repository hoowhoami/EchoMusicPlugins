let disposeSnapshot = null;
let observerRef = null;

function injectVinylStyles() {
  const old = document.getElementById('echo-vinyl-global-style');
  if (old) old.remove();
  
  const style = document.createElement('style');
  style.id = 'echo-vinyl-global-style';
  style.textContent = `
    .lyric-page .cover-wrapper,
    .lyric-page .cover-wrapper *,
    .lyric-page .cover-side,
    .lyric-page .cover-side *,
    .lyric-page .cover-container,
    .lyric-page .cover-container * {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      border: none !important;
      outline: none !important;
    }

    .lyric-page .cover-wrapper {
      overflow: visible !important;
      border-radius: 0 !important;
      width: 360px !important;
      height: 360px !important;
      min-width: 360px !important;
      min-height: 360px !important;
      padding: 0 !important;
      margin: 0 !important;
      position: relative !important;
      filter: none !important;
      --shadow-cover: none !important;
    }

    .lyric-page .cover-container {
      overflow: visible !important;
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 360px !important;
      height: 360px !important;
      min-width: 360px !important;
      min-height: 360px !important;
    }

    .lyric-page {
      overflow: visible !important;
    }

    .lyric-page .cover-container::before,
    .lyric-page .cover-container::after {
      content: none !important;
      display: none !important;
    }

    .echo-vinyl-cover-wrap {
      width: 160px !important;
      height: 160px !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      z-index: 2 !important;
      position: relative !important;
      animation: echoVinylSpin 20s linear infinite;
      animation-play-state: paused !important;
    }

    .echo-vinyl-cover-wrap img {
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
      object-fit: cover !important;
      display: block !important;
      border-radius: 50% !important;
    }

    .echo-vinyl-disc {
      position: absolute !important;
      width: 250px !important;
      height: 250px !important;
      border-radius: 50% !important;
      z-index: 1 !important;
      background: #0d0d0f !important;
      box-shadow:
        0 2px 6px rgba(0,0,0,0.6),
        0 10px 30px rgba(0,0,0,0.7),
        0 25px 70px rgba(0,0,0,0.5),
        inset 0 0 2px rgba(255,255,255,0.06) !important;
      top: 55px !important;
      left: 55px !important;
      animation: echoVinylSpin 20s linear infinite;
      animation-play-state: paused !important;
      overflow: hidden !important;
    }

    .echo-vinyl-disc::before {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-radius: 50% !important;
      background:
        repeating-radial-gradient(
          circle at center,
          rgba(16,16,18,1) 0px,
          rgba(32,32,35,1) 1.5px,
          rgba(10,10,12,1) 3px,
          rgba(14,14,16,1) 3.8px,
          rgba(26,26,29,1) 5.3px,
          rgba(8,8,10,1) 7px
        ) !important;
    }

    .echo-vinyl-disc::after {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-radius: 50% !important;
      background:
        linear-gradient(
          140deg,
          rgba(255,255,255,0.18) 0%,
          rgba(255,255,255,0.10) 10%,
          rgba(255,255,255,0.04) 20%,
          transparent 35%,
          transparent 50%,
          rgba(0,0,0,0.08) 70%,
          rgba(0,0,0,0.15) 100%
        ),
        radial-gradient(
          ellipse at 35% 20%,
          rgba(255,255,255,0.12) 0%,
          transparent 35%
        ) !important;
    }

    body.echo-vinyl-spinning .echo-vinyl-disc,
    body.echo-vinyl-spinning .echo-vinyl-cover-wrap {
      animation-play-state: running !important;
    }

    .echo-vinyl-tonearm {
      position: absolute !important;
      top: 20px !important;
      left: 80px !important;
      width: 300px !important;
      height: 200px !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      overflow: visible !important;
      transform-origin: 100px 10px !important;
      transform: rotate(-30deg) !important;
      transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }

    body.echo-vinyl-spinning .echo-vinyl-tonearm {
      transform: rotate(0deg) !important;
    }

    .echo-vinyl-tonearm svg {
      width: 100% !important;
      height: 100% !important;
      overflow: visible !important;
    }

    @keyframes echoVinylSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function setupVinylElements() {
  const coverContainer = document.querySelector('.lyric-page .cover-container');
  if (!coverContainer) return;

  let parent = coverContainer;
  while (parent && parent !== document.body) {
    parent.style.setProperty('overflow', 'visible', 'important');
    parent = parent.parentElement;
  }

  coverContainer.style.cssText = 'background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;border-radius:0!important;border:none!important;overflow:visible!important;position:relative!important;display:flex!important;align-items:center!important;justify-content:center!important;width:360px!important;height:360px!important;min-width:360px!important;min-height:360px!important;';
  
  // 彻底清除 cover-wrapper 的方形样式
  const coverWrapper = document.querySelector('.lyric-page .cover-wrapper');
  if (coverWrapper) {
    coverWrapper.className = '';
    coverWrapper.style.cssText = 'background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;overflow:visible!important;border-radius:0!important;width:360px!important;height:360px!important;min-width:360px!important;min-height:360px!important;border:none!important;padding:0!important;margin:0!important;position:relative!important;outline:none!important;filter:none!important;';
    
    coverWrapper.querySelectorAll('*:not(.echo-vinyl-disc):not(.echo-vinyl-cover-wrap):not(.echo-vinyl-tonearm)').forEach(el => {
      el.style.background = 'transparent';
      el.style.backgroundColor = 'transparent';
      el.style.backgroundImage = 'none';
      el.style.boxShadow = 'none';
      el.style.border = 'none';
      el.style.outline = 'none';
    });
    
    let pw = coverWrapper.parentElement;
    while (pw && pw !== document.body) {
      pw.style.setProperty('overflow', 'visible', 'important');
      pw = pw.parentElement;
    }
  }
  
  const coverSide = document.querySelector('.lyric-page .cover-side');
  if (coverSide) {
    coverSide.style.background = 'transparent';
    coverSide.style.backgroundColor = 'transparent';
    coverSide.style.boxShadow = 'none';
    coverSide.style.border = 'none';
  }
  
  coverContainer.querySelectorAll('*:not(.echo-vinyl-disc):not(.echo-vinyl-cover-wrap):not(.echo-vinyl-tonearm)').forEach(el => {
    el.style.background = 'transparent';
    el.style.backgroundColor = 'transparent';
    el.style.backgroundImage = 'none';
    el.style.boxShadow = 'none';
    el.style.border = 'none';
    el.style.overflow = 'visible';
  });

  let coverWrap = coverContainer.querySelector('.echo-vinyl-cover-wrap');
  if (!coverWrap) {
    coverWrap = document.createElement('div');
    coverWrap.className = 'echo-vinyl-cover-wrap';
  }
  coverWrap.style.width = '160px';
  coverWrap.style.height = '160px';
  coverWrap.style.borderRadius = '50%';
  coverWrap.style.overflow = 'hidden';
  coverWrap.style.zIndex = '2';
  coverWrap.style.position = 'relative';

  const imgs = coverContainer.querySelectorAll('img');
  imgs.forEach(img => {
    if (img.parentElement !== coverWrap) {
      coverWrap.appendChild(img);
    }
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.border = 'none';
    img.style.borderRadius = '50%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
  });

  if (!coverContainer.querySelector('.echo-vinyl-disc')) {
    const disc = document.createElement('div');
    disc.className = 'echo-vinyl-disc';
    coverContainer.appendChild(disc);
  }
  if (!coverContainer.contains(coverWrap)) {
    coverContainer.appendChild(coverWrap);
  }

  if (!coverContainer.querySelector('.echo-vinyl-tonearm')) {
    const tonearm = document.createElement('div');
    tonearm.className = 'echo-vinyl-tonearm';
    tonearm.setAttribute('data-v', '2');
    tonearm.innerHTML = `
      <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="tonearm-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.5)"/>
          </filter>
        </defs>
        <g filter="url(#tonearm-shadow)">
          <circle cx="100" cy="10" r="7" fill="#e8e8ea" stroke="#c0c0c2" stroke-width="1.2"/>
          <circle cx="100" cy="10" r="3" fill="#a0a0a3"/>
          <path d="M 100 10 C 105 25, 120 40, 130 48 C 135 52, 138 54, 140 55"
                stroke="#d0d0d3" stroke-width="5.5" fill="none" stroke-linecap="round"/>
          <path d="M 100 10 C 105 25, 120 40, 130 48 C 135 52, 138 54, 140 55"
                stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.5"/>
          <g transform="translate(140, 55) rotate(45)">
            <rect x="0" y="-7" width="14" height="14" rx="1.5" fill="#e0e0e2" stroke="#c0c0c3" stroke-width="0.8"/>
            <rect x="12" y="-4" width="10" height="8" rx="1" fill="#d0d0d3"/>
            <rect x="20" y="-2" width="6" height="4" rx="0.8" fill="#c8c8cb"/>
          </g>
        </g>
      </svg>`;
    coverContainer.appendChild(tonearm);
  }
}

function updatePlayState(isPlaying) {
  if (isPlaying) {
    document.body.classList.add('echo-vinyl-spinning');
  } else {
    document.body.classList.remove('echo-vinyl-spinning');
  }
}

export function activate(ctx) {
  document.querySelectorAll('.echo-vinyl-disc, .echo-vinyl-cover-wrap, .echo-vinyl-tonearm').forEach(el => el.remove());
  
  injectVinylStyles();
  setupVinylElements();

  if (ctx && ctx.player) {
    try {
      updatePlayState(ctx.player.isPlaying?.value);
      if (ctx.vue && ctx.vue.watch) {
        ctx.vue.watch(ctx.player.isPlaying, (val) => {
          updatePlayState(val);
        });
      }
    } catch(e) {}
  }

  if (ctx && ctx.nowPlaying) {
    ctx.nowPlaying.getSnapshot().then((snapshot) => {
      updatePlayState(snapshot?.playback?.isPlaying);
    }).catch(() => {});

    disposeSnapshot = ctx.nowPlaying.onSnapshot((snapshot) => {
      updatePlayState(snapshot?.playback?.isPlaying);
    });
  }

  observerRef = new MutationObserver(() => {
    setupVinylElements();
  });
  observerRef.observe(document.body, { childList: true, subtree: true });
}

export function deactivate(ctx) {
  if (disposeSnapshot) {
    try { disposeSnapshot(); } catch(e) {}
  }
  if (observerRef) observerRef.disconnect();
  
  document.getElementById('echo-vinyl-global-style')?.remove();
  document.body.classList.remove('echo-vinyl-spinning');
  document.querySelectorAll('.echo-vinyl-disc, .echo-vinyl-cover-wrap, .echo-vinyl-tonearm').forEach(el => el.remove());
  
  const c = document.querySelector('.lyric-page .cover-container');
  if (c) {
    c.style.cssText = '';
    c.querySelectorAll('*').forEach(el => { el.style.cssText = ''; });
  }
}
