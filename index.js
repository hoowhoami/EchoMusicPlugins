// ===== 小功能 =====
// Author: 张三
// 小功能：热门排序 + 隐藏自建歌单 + 歌词自动隐藏控制栏 + 隐藏听歌识曲 + 顶部插件按钮 + 桌面特效
// 注意：右键下载已独立为单独插件，如需使用请安装 right-click-download
// 在插件设置面板中可独立开关每个功能

var ctx = null;
var disposeSettings = null;

// ================== 7. 桌面特效 ==================

var _effectCanvas = null;
var _effectAnimId = null;
var _effectParticles = [];
var _effectCount = 80;
var _effectMode = 'snow';

var _effectModes = {
  snow: { label: '❄️ 下雪', color: '255,255,255', sizeRange: [2, 6], speedRange: [0.4, 1.6], windRange: [-0.3, 0.8], opacityRange: [0.4, 0.9], gravity: 1, shape: 'circle' },
  sakura: { label: '🌸 樱花', color: '255,182,193', sizeRange: [3, 7], speedRange: [0.3, 1.2], windRange: [-0.6, 0.6], opacityRange: [0.5, 0.9], gravity: 0.8, shape: 'petal' },
  heart: { label: '💖 爱心', color: '255,105,180', sizeRange: [4, 9], speedRange: [0.3, 1.2], windRange: [-0.5, 0.5], opacityRange: [0.5, 0.9], gravity: 0.5, shape: 'heart' },
  confetti: { label: '🎉 彩纸', color: '', sizeRange: [2, 5], speedRange: [0.5, 1.5], windRange: [-0.8, 0.8], opacityRange: [0.6, 1.0], gravity: 1.1, shape: 'confetti' },
  fire: { label: '🔥 火花', color: '255,150,50', sizeRange: [2, 5], speedRange: [0.5, 2.0], windRange: [-0.2, 0.2], opacityRange: [0.6, 1.0], gravity: -0.5, shape: 'fire' },
  rain: { label: '🌧️ 下雨', color: '180,200,255', sizeRange: [1, 2], speedRange: [3, 6], windRange: [-0.3, 0.3], opacityRange: [0.3, 0.6], gravity: 3, shape: 'line' },
  leaf: { label: '🍁 枫叶', color: '220,80,60', sizeRange: [4, 9], speedRange: [0.2, 1.0], windRange: [-0.7, 0.7], opacityRange: [0.5, 0.9], gravity: 0.6, shape: 'petal' },
  colorstar: { label: '⭐ 星星', color: '255,215,0', sizeRange: [3, 7], speedRange: [0.3, 1.0], windRange: [-0.4, 0.4], opacityRange: [0.5, 1.0], gravity: 0.6, shape: 'colorstar' },

  aurora: { label: '🌌 极光', color: '100,200,255', sizeRange: [8, 16], speedRange: [0.1, 0.3], windRange: [-0.2, 0.2], opacityRange: [0.1, 0.4], gravity: 0, shape: 'aurora' },
};

function _erand(min, max) { return min + Math.random() * (max - min); }

function _ecreateParticle(w, h, m) {
  var cfg = _effectModes[m];
  var sz = _erand(cfg.sizeRange[0], cfg.sizeRange[1]);
  return { x: Math.random() * w, y: m === 'fire' ? h + Math.random() * h * 0.2 : -sz - Math.random() * h * 0.4, r: sz, speed: _erand(cfg.speedRange[0], cfg.speedRange[1]), wind: _erand(cfg.windRange[0], cfg.windRange[1]), opacity: _erand(cfg.opacityRange[0], cfg.opacityRange[1]), gravity: cfg.gravity, rot: Math.random() * Math.PI * 2, rotSpeed: _erand(-0.03, 0.03), phase: Math.random() * Math.PI * 2 };
}

function _edrawPetal(g, p, c) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.4); g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawHeart(g, p, c) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(p.r * 0.06, p.r * 0.06); g.beginPath(); g.moveTo(0, -3); g.bezierCurveTo(-5, -8, -12, -3, 0, 5); g.bezierCurveTo(12, -3, 5, -8, 0, -3); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawConfetti(g, p) { var cs = ['255,100,100','100,200,100','100,150,255','255,200,50','200,100,255','255,150,50']; var cc = cs[Math.floor(Math.abs(p.x + p.y + p.rot) % cs.length)]; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = 'rgba(' + cc + ',' + p.opacity + ')'; g.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r); g.restore(); }
function _edrawSnowflake(g, p, c) { var r = p.r; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); for (var i = 0; i < 6; i++) { var a = i * Math.PI / 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.strokeStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.lineWidth = Math.max(1, r * 0.25); g.stroke(); for (var j = 1; j <= 2; j++) { var t = j / 3; var bx = Math.cos(a) * r * 0.4 + (Math.cos(a) * r - Math.cos(a) * r * 0.4) * t; var by = Math.sin(a) * r * 0.4 + (Math.sin(a) * r - Math.sin(a) * r * 0.4) * t; var sa = a + (j % 2 === 0 ? -1 : 1) * Math.PI / 6; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(sa) * r * 0.35, by + Math.sin(sa) * r * 0.35); g.stroke(); } } g.restore(); }
function _edrawStar(g, p, c) { var r = p.r; var cs = ['255,215,0','255,100,100','100,200,255','255,200,50','200,100,255','100,255,100']; var cc = cs[Math.floor(Math.abs(p.x + p.y + p.rot) % cs.length)]; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); for (var i = 0; i < 5; i++) { var a = (i * 4 * Math.PI / 5) - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fillStyle = 'rgba(' + cc + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawMaple(g, p, c) { var r = p.r * 0.8; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.7); g.beginPath(); for (var i = 0; i < 5; i++) { var a = (i * 2 * Math.PI / 5) - Math.PI / 2; g.lineTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); var a2 = a + Math.PI / 5; g.lineTo(Math.cos(a2) * r * 0.5, Math.sin(a2) * r * 0.5); } g.closePath(); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawAurora(g, p) { var w = window.innerWidth; var x = p.x % w; if (x < 0) x += w; var h = window.innerHeight; g.save(); g.globalAlpha = p.opacity * 0.3; var grd = g.createRadialGradient(x, p.y, 0, x, p.y, p.r * 3); var cs = ['100,200,255','150,255,100','255,100,200','100,255,200','200,100,255']; var cc = cs[Math.floor(Math.abs(p.x * 0.01 + p.y * 0.01) % cs.length)]; grd.addColorStop(0, 'rgba(' + cc + ',1)'); grd.addColorStop(0.5, 'rgba(' + cc + ',0.3)'); grd.addColorStop(1, 'rgba(' + cc + ',0)'); g.fillStyle = grd; g.fillRect(x - p.r * 3, p.y - p.r * 3, p.r * 6, p.r * 6); g.restore(); }
function _edrawFire(g, p, c) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(0, -p.r); g.bezierCurveTo(p.r, -p.r * 0.3, p.r * 0.6, p.r * 0.5, 0, p.r); g.bezierCurveTo(-p.r * 0.6, p.r * 0.5, -p.r, -p.r * 0.3, 0, -p.r); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.beginPath(); g.arc(0, -p.r * 0.2, p.r * 0.4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,200,' + (p.opacity * 0.6) + ')'; g.fill(); g.restore(); }
function _edrawLine(g, p, c) { g.beginPath(); g.moveTo(p.x, p.y - p.r); g.lineTo(p.x, p.y + p.r); g.strokeStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.lineWidth = 1.5; g.stroke(); }

function startEffect(mode) {
  if (!_effectCanvas) {
    var c = document.createElement('canvas');
    c.id = 'zhs-effect-canvas';
    c.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
    document.body.appendChild(c);
    _effectCanvas = c;
  }
  var newMode = mode || _effectMode;
  if (!_effectModes[newMode]) newMode = 'snow';
  if (_effectMode === newMode && _effectAnimId) return; // 同模式且已在运行，不重启
  if (_effectAnimId) { cancelAnimationFrame(_effectAnimId); _effectAnimId = null; }
  _effectMode = newMode;
  var cfg = _effectModes[_effectMode];
  var c = _effectCanvas;
  var w = window.innerWidth, h = window.innerHeight;
  c.width = w; c.height = h;
  c.style.display = 'block';
  var g = c.getContext('2d');
  var shape = _effectMode === 'snow' ? 'snowflake' : cfg.shape;
  var color = cfg.color;
  _effectParticles = [];
  for (var i = 0; i < _effectCount; i++) _effectParticles.push(_ecreateParticle(w, h, _effectMode));
  function draw() {
    g.clearRect(0, 0, w, h);
    for (var i = 0; i < _effectParticles.length; i++) {
      var p = _effectParticles[i];
      p.y += p.speed * p.gravity + 0.2; p.x += p.wind + Math.sin(p.phase) * 0.2; p.rot += p.rotSpeed; p.phase += 0.01;
      if (p.y > h + p.r * 2 || (_effectMode === 'fire' && p.y < -p.r * 2)) { _effectParticles[i] = _ecreateParticle(w, h, _effectMode); continue; }
      if (p.x > w + p.r) p.x = -p.r; if (p.x < -p.r) p.x = w + p.r;
      switch (shape) {
        case 'snowflake': _edrawSnowflake(g, p, color); break;
        case 'circle': g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fillStyle = 'rgba(' + color + ',' + p.opacity + ')'; g.fill(); break;
        case 'petal': _edrawMaple(g, p, color); break;
        case 'heart': _edrawHeart(g, p, color); break;
        case 'confetti': _edrawConfetti(g, p); break;
        case 'fire': _edrawFire(g, p, color); break;
        case 'line': _edrawLine(g, p, color); break;
        case 'colorstar': _edrawStar(g, p, 'colorstar'); break;

        case 'aurora': _edrawAurora(g, p); break;
      }
    }
    _effectAnimId = requestAnimationFrame(draw);
  }
  draw();
}

function stopEffect() {
  if (_effectAnimId) { cancelAnimationFrame(_effectAnimId); _effectAnimId = null; }
  if (_effectCanvas) { _effectCanvas.style.display = 'none'; }
  _effectParticles = [];
}

// ================== 6. 顶部插件快捷按钮 ==================

var pbBtn = null;
var pbStyle = null;
var pbCheckLoop = null;

function startPluginBtn() {
  if (pbCheckLoop) return;
  // 注入 CSS
  if (!document.getElementById('zhs-pb-style')) {
    var s = document.createElement('style');
    s.id = 'zhs-pb-style';
    s.textContent = [
      '.zhs-plugin-btn {',
      '  width: 34px; height: 34px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  border-radius: 50%;',
      '  transition: all 0.2s;',
      '  background: transparent; border: none;',
      '  color: var(--color-text-main); opacity: 0.6;',
      '  cursor: pointer; flex-shrink: 0;',
      '  margin-left: 2px;',
      '}',
      '.zhs-plugin-btn:hover {',
      '  opacity: 1;',
      '  background-color: var(--control-hover-bg);',
      '}',
      '.zhs-plugin-btn svg {',
      '  width: 18px; height: 18px;',
      '}',
    ].join('\n');
    document.head.appendChild(s);
    pbStyle = s;
  }
  // 轮询插入按钮（等待标题栏渲染）
  pbCheckLoop = setInterval(function() {
    var nav = document.querySelector('.titlebar-nav');
    if (!nav) return;
    var searchBox = nav.querySelector('.tb-search');
    if (!searchBox) return;
    // 检查是否已插入
    if (document.getElementById('zhs-pb-btn')) return;
    // 在搜索框之后插入按钮
    var btn = document.createElement('button');
    btn.id = 'zhs-pb-btn';
    btn.className = 'zhs-plugin-btn nav-btn';
    btn.title = '插件管理';
    // 工具箱图标 SVG
    btn.innerHTML = [
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"',
      '  stroke-linecap="round" stroke-linejoin="round">',
      '  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
      '</svg>',
    ].join('');
    btn.addEventListener('click', function() {
      if (ctx && ctx.router) {
        ctx.router.push('/main/settings/plugins');
      }
    });
    // 插入到搜索框后面
    searchBox.parentNode.insertBefore(btn, searchBox.nextSibling);
    pbBtn = btn;
    clearInterval(pbCheckLoop);
    pbCheckLoop = null;
  }, 800);
}

function stopPluginBtn() {
  if (pbCheckLoop) {
    clearInterval(pbCheckLoop);
    pbCheckLoop = null;
  }
  if (pbBtn) {
    pbBtn.remove();
    pbBtn = null;
  }
  if (pbStyle) {
    pbStyle.remove();
    pbStyle = null;
  }
  var s = document.getElementById('zhs-pb-style');
  if (s) s.remove();
}

// ===================== 1. 热门排序 =====================
// 原理：artist-detail 页面中 j.value 初始为 'hot'（热门），
// 但排序下拉 UI 实际显示为「最新」。需要检测歌手页面的
// 排序下拉按钮（.artist-sort-trigger），如果显示不是「热门」
// 则点击展开菜单，再点击「热门」选项（.artist-sort-menu-item.is-active 或含"热门"文本）
// 点击用原生 click()

var _asTimer = null;
var _asLoop = null;

function startArtistSort() {
  if (_asLoop) return;
  
  _asTimer = setTimeout(function() {
    _asTimer = null;
    
    _asLoop = setInterval(function() {
      try {
        // 只在歌手详情页工作
        var container = document.querySelector('.artist-detail-container');
        if (!container) return;
        
        // 找排序触发按钮
        var trigger = container.querySelector('.artist-sort-trigger');
        if (!trigger) return;
        
        // 检查当前显示的文本
        var triggerText = trigger.textContent || '';
        var isHot = triggerText.indexOf('热门') !== -1;
        var isNew = triggerText.indexOf('最新') !== -1;
        
        if (isHot) return; // 已经是热门，不动
        
        // 不是热门 -> 点击展开菜单
        trigger.click();
        
        // 等 Popover 渲染后，找「热门」选项
        setTimeout(function() {
          try {
            // 菜单项直接用类名定位
            var menuItems = document.querySelectorAll('.artist-sort-menu-item');
            for (var i = 0; i < menuItems.length; i++) {
              var item = menuItems[i];
              if ((item.textContent || '').trim().indexOf('热门') !== -1) {
                item.click();
                console.log('[zhs] 已切换排序为热门');
                break;
              }
            }
          } catch(e) { /* silent */ }
        }, 80);
        
      } catch(e) { /* silent */ }
    }, 1200);
    
  }, 3000);
}

function stopArtistSort() {
  if (_asTimer) { clearTimeout(_asTimer); _asTimer = null; }
  if (_asLoop) { clearInterval(_asLoop); _asLoop = null; }
}

// ================= 2. 隐藏自建歌单 =================

var hpStyle = null;
var hpCheckLoop = null;
var hpInitTimer = null;

function hpInjectCSS() {
  if (document.getElementById('zhs-hp-style')) return;
  var s = document.createElement('style');
  s.id = 'zhs-hp-style';
  s.textContent = [
    '.sidebar-playlist-tab:first-child { display: none !important; }',
    '.sidebar-rail-tab:first-child { display: none !important; }',
    '.sidebar-tab-divider { display: none !important; }',
  ].join('\n');
  document.head.appendChild(s);
  hpStyle = s;
}

function hpRemoveCSS() {
  if (hpStyle) { hpStyle.remove(); hpStyle = null; }
}

function hpTrySwitch() {
  var didSwitch = false;
  var tabs = document.querySelectorAll('.sidebar-playlist-tab');
  if (tabs.length >= 2) {
    var favTab = tabs[1];
    if (!favTab.classList.contains('text-primary')) {
      favTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      didSwitch = true;
    }
  }
  var railPlaylists = document.querySelector('.sidebar-rail-playlists');
  if (railPlaylists) {
    var railTabs = railPlaylists.querySelectorAll('.sidebar-rail-tab');
    if (railTabs.length >= 2) {
      var favRailTab = railTabs[1];
      if (!favRailTab.classList.contains('is-active')) {
        favRailTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        didSwitch = true;
      }
    }
  }
  return didSwitch;
}

function startHidePlaylist() {
  if (hpInitTimer || hpCheckLoop) return;
  hpInjectCSS();
  var retries = 0;
  hpInitTimer = setInterval(function() {
    retries++;
    if (hpTrySwitch() || retries >= 20) {
      clearInterval(hpInitTimer);
      hpInitTimer = null;
      hpCheckLoop = setInterval(function() { hpTrySwitch(); }, 3000);
    }
  }, 1000);
}

function stopHidePlaylist() {
  if (hpCheckLoop) { clearInterval(hpCheckLoop); hpCheckLoop = null; }
  if (hpInitTimer) { clearInterval(hpInitTimer); hpInitTimer = null; }
  hpRemoveCSS();
}

// ================ 3. 歌词自动隐藏控制栏 ================

var lhStyle = null;
var lhTimer = null;
var lhLoop = null;
var lhMoveTarget = null;
var LH_IDLE_MS = 2000;

function lhInjectCSS() {
  if (document.getElementById('zhs-lh-style')) return;
  var s = document.createElement('style');
  s.id = 'zhs-lh-style';
  s.textContent = [
    '.lyric-page-body .lyric-bar {',
    '  transition: visibility 0s 0.5s, opacity 0.5s ease !important;',
    '}',
    '.lyric-page-body.idle .lyric-bar {',
    '  visibility: hidden !important;',
    '  opacity: 0 !important;',
    '  transition: visibility 0s 2s, opacity 0.5s ease !important;',
    '}',
  ].join('\n');
  document.head.appendChild(s);
  lhStyle = s;
}

function lhRemoveCSS() {
  if (lhStyle) { lhStyle.remove(); lhStyle = null; }
}

function lhReset() {
  var body = document.querySelector('.lyric-page-body');
  if (!body) return;
  body.classList.remove('idle');
  clearTimeout(lhTimer);
  lhTimer = setTimeout(function() { body.classList.add('idle'); }, LH_IDLE_MS);
}

function lhOnMove() { lhReset(); }

function lhCleanup() {
  clearTimeout(lhTimer);
  lhTimer = null;
  if (lhMoveTarget) {
    lhMoveTarget.removeEventListener('mousemove', lhOnMove);
    lhMoveTarget = null;
  }
  var body = document.querySelector('.lyric-page-body');
  if (body) body.classList.remove('idle');
}

function startLyricHide() {
  if (lhLoop) return;
  lhInjectCSS();
  lhLoop = setInterval(function() {
    var body = document.querySelector('.lyric-page-body');
    if (!body) { lhCleanup(); return; }
    if (body !== lhMoveTarget) {
      if (lhMoveTarget) lhMoveTarget.removeEventListener('mousemove', lhOnMove);
      lhMoveTarget = body;
      body.addEventListener('mousemove', lhOnMove, { passive: true });
      lhReset();
    }
  }, 800);
}

function stopLyricHide() {
  if (lhLoop) { clearInterval(lhLoop); lhLoop = null; }
  lhRemoveCSS();
  lhCleanup();
}

// ================== 5. 隐藏顶部听歌识曲按钮 ==================

// ⚠️ 注意：编号 4（右键下载）已独立为 right-click-download 插件
// 功能编号 5 保持不变，此处保留原始编号以免修改太多其他引用

var hrStyle = null;

function startHideRecognize() {
  if (document.getElementById('zhs-hr-style')) return;
  var s = document.createElement('style');
  s.id = 'zhs-hr-style';
  s.textContent = '.title-bar .nav-btn[title="听歌识曲"] { display: none !important; }';
  document.head.appendChild(s);
  hrStyle = s;
}

function stopHideRecognize() {
  if (hrStyle) { hrStyle.remove(); hrStyle = null; }
}

// ================== 设置面板 ==================

// 读取存好的功能开关
var featureState = {};

async function loadFeatureState() {
  var saved = await ctx.storage.get('zhs-features');
  if (saved) {
    featureState = saved;
  } else {
    featureState = {
      artistSort: true,
      hidePlaylist: true,
      lyricHide: true,
      hideRecognize: false,
      pluginBtn: true,
      effect: false,
      effectMode: 'snow',
    };
  }
}

async function saveFeatureState() {
  await ctx.storage.set('zhs-features', featureState);
}

function toggleFeature(id) {
  featureState[id] = !featureState[id];
  saveFeatureState();
  // 即时启停
  if (id === 'artistSort') {
    featureState.artistSort ? startArtistSort() : stopArtistSort();
  } else if (id === 'hidePlaylist') {
    featureState.hidePlaylist ? startHidePlaylist() : stopHidePlaylist();
  } else if (id === 'lyricHide') {
    featureState.lyricHide ? startLyricHide() : stopLyricHide();
  } else if (id === 'hideRecognize') {
    featureState.hideRecognize ? startHideRecognize() : stopHideRecognize();
  } else if (id === 'pluginBtn') {
    featureState.pluginBtn ? startPluginBtn() : stopPluginBtn();
  } else if (id === 'effect') {
    featureState.effect ? startEffect(featureState.effectMode || 'snow') : stopEffect();
  }
}

// ================== 入口 ==================

export async function activate(_ctx) {
  ctx = _ctx;

  await loadFeatureState();

  if (featureState.artistSort) startArtistSort();
  if (featureState.hidePlaylist) startHidePlaylist();
  if (featureState.lyricHide) startLyricHide();
  if (featureState.hideRecognize) startHideRecognize();
  if (featureState.pluginBtn) startPluginBtn();
  if (featureState.effect) startEffect(featureState.effectMode || 'snow');

  // 注册设置面板 — 使用 render 函数
  var h = ctx.vue.h;

  var SettingsComp = ctx.vue.defineComponent({
    name: 'ZhsSettings',
    setup: function() {
      var effectExpanded = ctx.vue.ref(false);
      var state = ctx.vue.reactive({
        features: [
          { id: 'artistSort', label: '歌手热门排序', desc: '歌手详情页默认按热门排序', enabled: featureState.artistSort },
          { id: 'hidePlaylist', label: '隐藏自建歌单', desc: '隐藏侧边栏自建歌单及tab按钮', enabled: featureState.hidePlaylist },
          { id: 'lyricHide', label: '歌词隐藏控制栏', desc: '歌词全屏时控制栏2秒无操作自动隐藏', enabled: featureState.lyricHide },
          { id: 'hideRecognize', label: '隐藏听歌识曲', desc: '隐藏顶部导航栏的听歌识曲按钮', enabled: featureState.hideRecognize },
          { id: 'pluginBtn', label: '顶部插件按钮', desc: '搜索框右侧添加插件快捷按钮', enabled: featureState.pluginBtn },
          { id: 'effect', label: '❄️ 桌面特效', desc: '6种粒子特效', enabled: featureState.effect },
        ],
      });
      var currentEffectMode = ctx.vue.ref(featureState.effectMode || 'snow');

      function switchEffectMode(mode) {
        currentEffectMode.value = mode;
        featureState.effectMode = mode;
        featureState.effect = true;
        state.features[5].enabled = true;
        saveFeatureState();
        startEffect(mode);
      }

      ctx.vue.watch(function() {
        return state.features.map(function(f) { return f.enabled; });
      }, function() {
        state.features.forEach(function(f) { featureState[f.id] = f.enabled; });
        saveFeatureState();
        state.features.forEach(function(f) {
          if (f.id === 'artistSort') { f.enabled ? startArtistSort() : stopArtistSort(); }
          else if (f.id === 'hidePlaylist') { f.enabled ? startHidePlaylist() : stopHidePlaylist(); }
          else if (f.id === 'lyricHide') { f.enabled ? startLyricHide() : stopLyricHide(); }
          else if (f.id === 'hideRecognize') { f.enabled ? startHideRecognize() : stopHideRecognize(); }
          else if (f.id === 'pluginBtn') { f.enabled ? startPluginBtn() : stopPluginBtn(); }
          else if (f.id === 'effect') { f.enabled ? startEffect(currentEffectMode.value) : stopEffect(); }
        });
      }, { deep: true });

      var modeList = Object.keys(_effectModes);

      var effectHotkeys = [
        { mode: 'snow', icon: '❄️' },
        { mode: 'sakura', icon: '🌸' },
        { mode: 'heart', icon: '💖' },
        { mode: 'confetti', icon: '🎉' },
        { mode: 'fire', icon: '🔥' },
        { mode: 'rain', icon: '🌧️' },
        { mode: 'leaf', icon: '🍁' },
        { mode: 'colorstar', icon: '⭐' },
        { mode: 'aurora', icon: '🌌' },
      ];

      function toggleRow(label, desc, isOn, onClick) {
        return h('div', {
          style: {
            display: 'flex', 'flex-direction': 'column', gap: '2px', cursor: 'pointer',
            padding: '8px', 'border-radius': '8px',
            background: 'var(--card-bg, rgba(255,255,255,0.04))',
            border: 'none',
            transition: 'all 0.15s',
          },
          onClick: onClick,
        }, [
          h('div', { style: { display: 'flex', 'align-items': 'center', gap: '6px' } }, [
            h('span', { style: { display: 'inline-block', width: '10px', height: '10px', 'border-radius': '50%', background: isOn ? 'var(--color-primary, #4caf50)' : '#888', 'flex-shrink': '0' } }),
            h('span', { style: { 'font-size': '13px', 'font-weight': '600', color: isOn ? 'var(--color-primary, #4caf50)' : 'var(--color-text-main)' } }, label),
          ]),
          h('span', { style: { 'font-size': '11px', color: 'var(--color-text-secondary)', 'line-height': '1.3', 'padding-left': '16px' } }, desc),
        ]);
      }

      return function() {
        return h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '6px' } }, [
          h('div', { style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '6px' } },
            state.features.map(function(f) {
              return toggleRow(f.label, f.desc, f.enabled, function() { f.enabled = !f.enabled; });
            })
          ),
          h('div', {
            style: {
              display: 'flex', 'flex-wrap': 'wrap', gap: '4px',
              padding: '8px', 'border-radius': '8px',
              background: 'var(--card-bg, rgba(255,255,255,0.04))',
            },
          },
            effectHotkeys.map(function(item) {
              var key = item.mode;
              var active = currentEffectMode.value === key;
              return h('div', {
                key: key,
                style: { display: 'flex', 'align-items': 'center', gap: '3px', cursor: 'pointer', padding: '3px 8px', 'border-radius': '6px', background: active ? 'var(--hover-bg, rgba(128,128,128,0.1))' : 'transparent', 'font-size': '12px', color: active ? 'var(--color-primary, #4caf50)' : 'var(--color-text-secondary)', border: active ? '1px solid var(--color-primary, #4caf50)' : '1px solid transparent' },
                onClick: function() {
                  currentEffectMode.value = key;
                  featureState.effectMode = key;
                  saveFeatureState();
                  if (featureState.effect) { stopEffect(); startEffect(key); }
                },
              }, [
                h('span', {}, item.icon),
                h('span', { style: { 'font-size': '11px' } }, _effectModes[key].label.replace(/^[^\s]+\s/, '')),
              ]);
            })
          ),
        ]);
      };
    },
  });

  ctx.css.inject([
    '.zhs-icon { width:18px; height:18px; flex-shrink:0; color:var(--color-text-secondary); }',
  ].join(''));

  disposeSettings = ctx.ui.settings.define({
    id: 'xiaotoolkit',
    title: '小功能',
    description: '独立开关每个功能，改动即时生效',
    component: SettingsComp,
  });
}

export function deactivate() {
  stopArtistSort();
  stopHidePlaylist();
  stopLyricHide();
  stopHideRecognize();
  stopPluginBtn();
  stopEffect();

  if (disposeSettings) { disposeSettings(); disposeSettings = null; }
  ctx = null;
}
