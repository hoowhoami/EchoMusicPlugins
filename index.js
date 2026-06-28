// ===== 小功能 =====
// Author: 张三
// 小功能：热门排序 + 收藏歌单自动切换 + 单击播放 + 首页卡片一键播放(每日推荐/排行榜) + 歌词自动隐藏控制栏 + 隐藏听歌识曲 + 顶部插件按钮 + 10种桌面特效
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
  sakura: { label: '🌸 樱花', color: '255,182,193', sizeRange: [3, 7], speedRange: [0.3, 1.2], windRange: [-0.6, 0.6], opacityRange: [0.5, 0.9], gravity: 0.8, shape: 'sakura' },
  heart: { label: '💖 爱心', color: '255,105,180', sizeRange: [4, 9], speedRange: [0.3, 1.2], windRange: [-0.5, 0.5], opacityRange: [0.5, 0.9], gravity: 0.5, shape: 'heart' },
  confetti: { label: '🎉 彩纸', color: '', sizeRange: [2, 5], speedRange: [0.5, 1.5], windRange: [-0.8, 0.8], opacityRange: [0.6, 1.0], gravity: 1.1, shape: 'confetti' },
  fire: { label: '🔥 火花', color: '255,150,50', sizeRange: [2, 5], speedRange: [0.5, 2.0], windRange: [-0.2, 0.2], opacityRange: [0.6, 1.0], gravity: -0.5, shape: 'fire' },
  rain: { label: '🌧️ 下雨', color: '180,200,255', sizeRange: [1, 2], speedRange: [3, 6], windRange: [-0.3, 0.3], opacityRange: [0.3, 0.6], gravity: 3, shape: 'line' },
  leaf: { label: '🍁 枫叶', color: '220,80,60', sizeRange: [4, 9], speedRange: [0.2, 1.0], windRange: [-0.7, 0.7], opacityRange: [0.5, 0.9], gravity: 0.6, shape: 'maple' },
  colorstar: { label: '⭐ 星星', color: '255,215,0', sizeRange: [3, 7], speedRange: [0.3, 1.0], windRange: [-0.4, 0.4], opacityRange: [0.5, 1.0], gravity: 0.6, shape: 'colorstar' },
  petal: { label: '🌹 花瓣', color: '220,30,30', sizeRange: [3, 7], speedRange: [0.3, 1.2], windRange: [-0.5, 0.5], opacityRange: [0.5, 0.9], gravity: 0.7, shape: 'petal' },

  aurora: { label: '🌌 极光', color: '100,200,255', sizeRange: [8, 16], speedRange: [0.1, 0.3], windRange: [-0.2, 0.2], opacityRange: [0.1, 0.4], gravity: 0, shape: 'aurora' },
};

function _erand(min, max) { return min + Math.random() * (max - min); }

function _ecreateParticle(w, h, m) {
  var cfg = _effectModes[m];
  var sz = _erand(cfg.sizeRange[0], cfg.sizeRange[1]);
  return { x: Math.random() * w, y: m === 'fire' ? h + Math.random() * h * 0.2 : -sz - Math.random() * h * 0.4, r: sz, speed: _erand(cfg.speedRange[0], cfg.speedRange[1]), wind: _erand(cfg.windRange[0], cfg.windRange[1]), opacity: _erand(cfg.opacityRange[0], cfg.opacityRange[1]), gravity: cfg.gravity, rot: Math.random() * Math.PI * 2, rotSpeed: _erand(-0.03, 0.03), phase: Math.random() * Math.PI * 2 };
}

function _edrawOval(g, p, c) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.4); g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawHeart(g, p, c) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(p.r * 0.06, p.r * 0.06); g.beginPath(); g.moveTo(0, -3); g.bezierCurveTo(-5, -8, -12, -3, 0, 5); g.bezierCurveTo(12, -3, 5, -8, 0, -3); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawConfetti(g, p) { var cs = ['255,100,100','100,200,100','100,150,255','255,200,50','200,100,255','255,150,50']; var cc = cs[Math.floor(Math.abs(p.x + p.y + p.rot) % cs.length)]; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = 'rgba(' + cc + ',' + p.opacity + ')'; g.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r); g.restore(); }
function _edrawSnowflake(g, p, c) { var r = p.r; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); for (var i = 0; i < 6; i++) { var a = i * Math.PI / 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.strokeStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.lineWidth = Math.max(2, r * 0.3); g.stroke(); var bx = Math.cos(a) * r * 0.5, by = Math.sin(a) * r * 0.5; for (var s = -1; s <= 1; s += 2) { var sa = a + s * Math.PI / 6; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(sa) * r * 0.4, by + Math.sin(sa) * r * 0.4); g.strokeStyle = 'rgba(' + c + ',' + (p.opacity * 0.7) + ')'; g.lineWidth = Math.max(1.5, r * 0.2); g.stroke(); } } g.restore(); }
function _edrawStar(g, p, c) { var r = p.r; var cs = ['255,215,0','255,100,100','100,200,255','255,200,50','200,100,255','100,255,100']; var cc = cs[Math.floor(Math.abs(p.x + p.y + p.rot) % cs.length)]; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); for (var i = 0; i < 5; i++) { var a = (i * 4 * Math.PI / 5) - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fillStyle = 'rgba(' + cc + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawMaple(g, p, c) { var r = p.r * 0.8; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.7); g.beginPath(); for (var i = 0; i < 5; i++) { var a = (i * 2 * Math.PI / 5) - Math.PI / 2; g.lineTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); var a2 = a + Math.PI / 5; g.lineTo(Math.cos(a2) * r * 0.5, Math.sin(a2) * r * 0.5); } g.closePath(); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawSakura(g, p, c) { var r = p.r * 0.6; g.save(); g.translate(p.x, p.y); for (var i = 0; i < 5; i++) { var a = (i * 2 * Math.PI / 5) - Math.PI / 2; g.save(); g.rotate(a); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(r * 0.4, -r * 0.15, r * 0.7, -r * 0.35); g.quadraticCurveTo(r * 0.85, -r * 0.2, r, 0); g.quadraticCurveTo(r * 0.85, r * 0.2, r * 0.7, r * 0.35); g.quadraticCurveTo(r * 0.4, r * 0.15, 0, 0); g.closePath(); g.fillStyle = 'rgba(' + c + ',' + p.opacity + ')'; g.fill(); g.beginPath(); g.moveTo(r * 0.65, 0); g.lineTo(r, 0); g.strokeStyle = 'rgba(255,255,255,' + (p.opacity * 0.15) + ')'; g.lineWidth = 0.5; g.stroke(); g.restore(); } g.beginPath(); g.arc(0, 0, r * 0.12, 0, Math.PI * 2); g.fillStyle = 'rgba(255,220,220,' + p.opacity + ')'; g.fill(); g.restore(); }
function _edrawRosePetal(g, p, c) { var r = p.r * 0.75; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(r * 0.8, -r * 0.6, r * 0.85, r * 0.1, r * 0.4, r * 0.85); g.bezierCurveTo(r * 0.2, r, 0, r * 0.9, 0, r * 0.75); g.bezierCurveTo(0, r * 0.9, -r * 0.2, r, -r * 0.4, r * 0.85); g.bezierCurveTo(-r * 0.85, r * 0.1, -r * 0.8, -r * 0.6, 0, -r); g.closePath(); var grd = g.createRadialGradient(0, r * 0.2, 0, 0, r * 0.2, r * 1.2); grd.addColorStop(0, 'rgba(255,200,200,' + p.opacity + ')'); grd.addColorStop(0.3, 'rgba(240,30,30,' + p.opacity + ')'); grd.addColorStop(0.7, 'rgba(200,10,10,' + p.opacity + ')'); grd.addColorStop(1, 'rgba(120,0,0,' + (p.opacity * 0.8) + ')'); g.fillStyle = grd; g.fill(); g.beginPath(); g.moveTo(0, -r * 0.3); g.quadraticCurveTo(r * 0.15, r * 0.1, 0, r * 0.5); g.quadraticCurveTo(-r * 0.15, r * 0.1, 0, -r * 0.3); g.fillStyle = 'rgba(255,220,220,' + (p.opacity * 0.2) + ')'; g.fill(); g.restore(); }
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
  if (_effectMode === newMode && _effectAnimId) return;
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
        case 'maple': _edrawMaple(g, p, color); break;
        case 'petal': _edrawRosePetal(g, p, color); break;
        case 'sakura': _edrawSakura(g, p, color); break;
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
  pbCheckLoop = setInterval(function() {
    var nav = document.querySelector('.titlebar-nav');
    if (!nav) return;
    var searchBox = nav.querySelector('.tb-search');
    if (!searchBox) return;
    if (document.getElementById('zhs-pb-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'zhs-pb-btn';
    btn.className = 'zhs-plugin-btn nav-btn';
    btn.title = '插件管理';
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

var _asTimer = null;
var _asLoop = null;
var _asDoneUrl = '';

function startArtistSort() {
  if (_asLoop) return;
  
  _asTimer = setTimeout(function() {
    _asTimer = null;
    
    _asLoop = setInterval(function() {
      try {
        var container = document.querySelector('.artist-detail-container');
        if (!container) {
          _asDoneUrl = '';
          return;
        }
        
        var currentUrl = window.location.pathname;
        
        if (_asDoneUrl === currentUrl) return;
        
        var trigger = container.querySelector('.artist-sort-trigger');
        if (!trigger) return;
        
        var triggerText = trigger.textContent || '';
        var isHot = triggerText.indexOf('热门') !== -1;
        
        if (isHot) {
          _asDoneUrl = currentUrl;
          return;
        }
        
        trigger.click();
        
        _asDoneUrl = currentUrl;
        
        setTimeout(function() {
          try {
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
  _asDoneUrl = '';
}

// ================= 2. 收藏歌单自动切换 =================
// 启动后等 sidebar 渲染，自动切换到收藏歌单 tab
// 点击成功后会一直保持，直到用户手动切回

function hpClickFavorite() {
  var tabs = document.querySelectorAll('.sidebar-playlist-tab');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].textContent.indexOf('收藏歌单') !== -1) {
      tabs[i].click();
      return true;
    }
  }
  var rail = document.querySelector('.sidebar-rail-tabs');
  if (rail) {
    var rTabs = rail.querySelectorAll('.sidebar-rail-tab');
    for (var j = 0; j < rTabs.length; j++) {
      if (rTabs[j].textContent.indexOf('收藏歌单') !== -1) {
        rTabs[j].click();
        return true;
      }
    }
  }
  return false;
}

var _hpTimer = null;

function startHidePlaylist() {
  if (_hpTimer) return;
  function tryClick(attempts) {
    if (hpClickFavorite()) { _hpTimer = null; return; }
    if (attempts < 50) {
      _hpTimer = setTimeout(function() { tryClick(attempts + 1); }, 200);
    }
  }
  setTimeout(function() { tryClick(0); }, 1000); // 给 sidebar 1 秒渲染时间
}

function stopHidePlaylist() {
  if (_hpTimer) { clearTimeout(_hpTimer); _hpTimer = null; }
}

// ================ 3. 单击任意位置播放 ================
// 单击歌曲列表的任意位置（歌名、歌手等）即可播放
// 不影响已有按钮操作（播放图标、菜单等）

var _clickDispose = null;

function skipClick(el) {
  if (!el) return true;
  if (el.closest('button, a, [role="menuitem"]')) return true;
  if (el.closest('.context-menu, .song-context-menu, .song-list-meta-link')) return true;
  if (el.matches('.cursor-pointer') || el.closest('.cursor-pointer')) return true;
  return false;
}

function startClickToPlay() {
  if (_clickDispose) return;
  function onRowClick(e) {
    var row = e.target.closest('[data-song-row]');
    if (!row) return;
    if (skipClick(e.target)) return;
    var firstCol = row.querySelector('.song-list-row-inner > div:first-child');
    if (!firstCol) return;
    var playBtn = firstCol.querySelector('.cursor-pointer');
    if (!playBtn) return;
    playBtn.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true,
      clientX: e.clientX, clientY: e.clientY,
    }));
  }
  document.addEventListener('click', onRowClick, true);
  _clickDispose = function() { document.removeEventListener('click', onRowClick, true); };
}

function stopClickToPlay() {
  if (_clickDispose) { _clickDispose(); _clickDispose = null; }
}

// ================ 4. 首页每日推荐一键播放 ================
// 点击每日推荐卡片的播放按钮，直接播放今日推荐，不跳转页面

var _dailyDispose = null;
var _dailyPlaying = false;

function extractDailySongs(body) {
  // 模仿 extractList 逻辑，从 Kugou API 响应中提取歌曲列表
  if (!body || typeof body !== 'object') {
    console.log('[xiaotoolkit] extractDailySongs: body不是对象', typeof body);
    return [];
  }
  var data = body.data;
  console.log('[xiaotoolkit] extractDailySongs: body keys=', Object.keys(body), '有data=', !!data);

  if (!data || typeof data !== 'object') return [];

  var candidates = [
    data.songs && data.songs.list,
    data.songs && data.songs.songs,
    data.list,
    data.info,
    data.song_list,
    data.songlist,
    data.songs,
  ];

  for (var i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i]) && candidates[i].length > 0) {
      console.log('[xiaotoolkit] 在 candidates[' + i + '] 找到歌曲:', candidates[i].length);
      return candidates[i];
    }
  }

  // 也检查顶层数组
  if (Array.isArray(body.list)) { console.log('[xiaotoolkit] 在 body.list 找到'); return body.list; }
  if (Array.isArray(body.songs)) { console.log('[xiaotoolkit] 在 body.songs 找到'); return body.songs; }
  if (Array.isArray(body.data)) { console.log('[xiaotoolkit] 在 body.data 找到'); return body.data; }

  console.log('[xiaotoolkit] extractDailySongs 未找到任何歌曲列表');
  return [];
}

function pickValue() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

function parseIntSafe(v, fallback) {
  if (v === undefined || v === null) return fallback || 0;
  var n = parseInt(v, 10);
  return isNaN(n) ? (fallback || 0) : n;
}

function mapDailySong(item) {
  var record = item || {};
  var singer = pickValue(record.author_name, record.singername, record.singer, record.artist, '');
  var name = pickValue(record.songname, record.filename, record.name, record.title, '未知歌曲');
  var hash = pickValue(record.hash, record.FileHash, record.hash_128, '');
  var id = pickValue(record.mixsongid, record.audio_id, record.album_audio_id, hash, '');
  var durationRaw = parseIntSafe(pickValue(record.time_length, record.timelength, record.duration, 0));
  var duration = durationRaw > 100000 ? Math.floor(durationRaw / 1000) : durationRaw;
  var cover = pickValue(record.album_sizable_cover, record.cover, record.pic, '');
  var album = pickValue(record.album_name, record.albumname, record.album, '');

  return {
    id: String(id),
    songId: String(pickValue(record.songid, record.song_id, record.audio_id, '')),
    title: name,
    name: name,
    artist: String(singer || '未知歌手'),
    duration: duration,
    coverUrl: String(cover),
    cover: String(cover),
    audioUrl: '',
    hash: String(hash),
    mixSongId: parseIntSafe(id, 0),
    album: String(album),
    albumName: String(album),
    singers: singer ? [{ name: String(singer) }] : [],
    artists: singer ? [{ name: String(singer) }] : [],
  };
}

function mapRankSong(item) {
  // 简版 mapRankSong
  var record = item || {};
  var audioInfo = record.audio_info || {};
  var albumInfo = record.album_info || {};
  var transParam = record.trans_param || {};

  var singer = record.author_name || record.singername || record.singer || '';
  var name = record.songname || record.name || '未知歌曲';
  var hash = audioInfo.hash_128 || audioInfo.hash || record.hash || '';
  var id = record.audio_id || record.mixsongid || audioInfo.audio_id || hash;
  var durationRaw = parseIntSafe(audioInfo.duration_128 || audioInfo.duration || 0);
  var duration = durationRaw > 100000 ? Math.floor(durationRaw / 1000) : durationRaw;
  var cover = albumInfo.sizable_cover || transParam.union_cover || record.img || record.pic || '';
  var album = albumInfo.album_name || record.album_name || '';

  return {
    id: String(id),
    songId: String(record.audio_id || ''),
    title: name,
    name: name,
    artist: String(singer || '未知歌手'),
    duration: duration,
    coverUrl: String(cover),
    cover: String(cover),
    audioUrl: '',
    hash: String(hash),
    mixSongId: parseIntSafe(id, 0),
    album: String(album),
    albumName: String(album),
    singers: singer ? [{ name: String(singer) }] : [],
    artists: singer ? [{ name: String(singer) }] : [],
  };
}

async function playDailyRecommend() {
  if (_dailyPlaying) return;
  _dailyPlaying = true;

  try {
    // 从 pinia store 构建认证头（复刻 buildAuthHeader 逻辑）
    var piniaState = ctx.pinia.state.value;
    var userInfo = piniaState.user && piniaState.user.info;
    var deviceInfo = piniaState.device && piniaState.device.info;

    var authParts = [];
    if (userInfo) {
      if (userInfo.token) authParts.push('token=' + userInfo.token);
      if (userInfo.userid) authParts.push('userid=' + userInfo.userid);
      if (userInfo.t1) authParts.push('t1=' + userInfo.t1);
    }
    if (deviceInfo) {
      if (deviceInfo.dfid) authParts.push('dfid=' + deviceInfo.dfid);
      if (deviceInfo.mid) authParts.push('KUGOU_API_MID=' + deviceInfo.mid);
      if (deviceInfo.uuid) authParts.push('uuid=' + deviceInfo.uuid);
      if (deviceInfo.guid) authParts.push('KUGOU_API_GUID=' + deviceInfo.guid);
      if (deviceInfo.serverDev) authParts.push('KUGOU_API_DEV=' + deviceInfo.serverDev);
      if (deviceInfo.mac) authParts.push('KUGOU_API_MAC=' + deviceInfo.mac);
    }

    var headers = {};
    if (authParts.length > 0) {
      headers['Authorization'] = authParts.join(';');
    }

    console.log('[xiaotoolkit] 获取每日推荐, auth:', authParts.length, '项');

    var res = await ctx.electron.api.request({
      method: 'GET',
      url: '/everyday/recommend',
      headers: headers,
    });

    console.log('[xiaotoolkit] API返回:', res.status, typeof res.body);

    var body = res.body || res;
    var rawList = extractDailySongs(body);

    console.log('[xiaotoolkit] 解析到歌曲:', rawList ? rawList.length : 0, '首');

    if (!rawList || rawList.length === 0) {
      ctx.toast.danger('今日暂无推荐歌曲');
      _dailyPlaying = false;
      return;
    }

    var songs = rawList.map(mapDailySong);

    await ctx.playlist.replaceAndPlay(songs, {
      queueId: 'queue:daily-recommend',
      title: '每日推荐',
      subtitle: '为你量身定制',
      type: 'daily-recommend',
      dynamic: false,
    });

    ctx.toast.success('正在播放今日推荐 (' + songs.length + '首)');
  } catch (err) {
    console.error('[xiaotoolkit] 每日推荐播放失败:', err);
    ctx.toast.danger('获取每日推荐失败');
  }

  _dailyPlaying = false;
}

async function playRankingTop() {
  if (_dailyPlaying) return;
  _dailyPlaying = true;

  try {
    var piniaState = ctx.pinia.state.value;
    var userInfo = piniaState.user && piniaState.user.info;
    var deviceInfo = piniaState.device && piniaState.device.info;
    var authParts = [];
    if (userInfo) {
      if (userInfo.token) authParts.push('token=' + userInfo.token);
      if (userInfo.userid) authParts.push('userid=' + userInfo.userid);
      if (userInfo.t1) authParts.push('t1=' + userInfo.t1);
    }
    if (deviceInfo) {
      if (deviceInfo.dfid) authParts.push('dfid=' + deviceInfo.dfid);
      if (deviceInfo.mid) authParts.push('KUGOU_API_MID=' + deviceInfo.mid);
      if (deviceInfo.uuid) authParts.push('uuid=' + deviceInfo.uuid);
      if (deviceInfo.guid) authParts.push('KUGOU_API_GUID=' + deviceInfo.guid);
      if (deviceInfo.serverDev) authParts.push('KUGOU_API_DEV=' + deviceInfo.serverDev);
      if (deviceInfo.mac) authParts.push('KUGOU_API_MAC=' + deviceInfo.mac);
    }
    var headers = {};
    if (authParts.length > 0) headers['Authorization'] = authParts.join(';');

    console.log('[xiaotoolkit] 获取排行榜');

    // 1. 取榜单列表
    var topRes = await ctx.electron.api.request({
      method: 'GET', url: '/rank/top', headers: headers,
    });
    var topBody = topRes.body || topRes;
    var topData = topBody.data || topBody;
    var rankList = topData.list || topData.info || topData.songlist || topData;
    if (!Array.isArray(rankList)) {
      // 备用：/rank/list
      var listRes = await ctx.electron.api.request({
        method: 'GET', url: '/rank/list', headers: headers,
      });
      var listBody = listRes.body || listRes;
      var listData = listBody.data || listBody;
      rankList = listData.list || listData.info || listData;
    }
    if (!Array.isArray(rankList) || rankList.length === 0) {
      ctx.toast.danger('暂无排行榜');
      _dailyPlaying = false;
      return;
    }

    // 取第一个有有效 id 的榜单
    var firstRank = null;
    for (var i = 0; i < rankList.length; i++) {
      var r = rankList[i];
      var rid = r.id || r.rankid || r.rankId || r.specialid;
      if (rid) { firstRank = { item: r, id: rid }; break; }
    }
    if (!firstRank) {
      ctx.toast.danger('无可用排行榜');
      _dailyPlaying = false;
      return;
    }

    console.log('[xiaotoolkit] 榜单:', firstRank.item.name || '未命名', 'id:', firstRank.id);

    // 2. 取榜单歌曲
    var songsRes = await ctx.electron.api.request({
      method: 'GET', url: '/rank/audio',
      params: { rankid: firstRank.id, page: 1, pagesize: 100 },
      headers: headers,
    });
    var songsBody = songsRes.body || songsRes;
    var songsData = songsBody.data || songsBody;
    var songList = songsData.list || songsData.info || songsData.songlist || songsData.songs || songsData;
    if (!Array.isArray(songList) || songList.length === 0) {
      ctx.toast.danger('排行榜暂无歌曲');
      _dailyPlaying = false;
      return;
    }

    console.log('[xiaotoolkit] 排行榜歌曲:', songList.length, '首');
    var songs = songList.map(mapRankSong);

    await ctx.playlist.replaceAndPlay(songs, {
      queueId: 'queue:ranking:' + firstRank.id,
      title: firstRank.item.name || '排行榜',
      subtitle: '实时热门趋势',
      type: 'ranking',
      dynamic: false,
    });

    ctx.toast.success('正在播放「' + (firstRank.item.name || '排行榜') + '」(' + songs.length + '首)');
  } catch (err) {
    console.error('[xiaotoolkit] 排行榜播放失败:', err);
    ctx.toast.danger('获取排行榜失败');
  }

  _dailyPlaying = false;
}

function startDailyPlay() {
  if (_dailyDispose) return;
  console.log('[xiaotoolkit] 首页一键播放已启动');

  function onFeatureActionClick(e) {
    // 拦截首页功能卡片的播放按钮 + 装饰图标区域
    var trigger = e.target.closest('.feature-action, .feature-icon');
    if (!trigger) return;

    var card = trigger.closest('.home-feature-card');
    if (!card) return;

    var isDaily = card.querySelector('.feature-icon.gradient-primary');
    var isRanking = card.querySelector('.feature-icon.gradient-secondary') && (card.querySelector('.feature-title') || {}).textContent === '排行榜';

    if (!isDaily && !isRanking) return;

    console.log('[xiaotoolkit] ' + (isDaily ? '每日推荐' : '排行榜') + '图标被点击，直接播放');
    e.stopPropagation();
    e.preventDefault();

    if (isDaily) {
      playDailyRecommend();
    } else {
      playRankingTop();
    }
  }

  document.addEventListener('click', onFeatureActionClick, true);
  _dailyDispose = function() {
    document.removeEventListener('click', onFeatureActionClick, true);
  };
}

function stopDailyPlay() {
  if (_dailyDispose) { _dailyDispose(); _dailyDispose = null; }
}

// ================ 5. 歌词自动隐藏控制栏 ================

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

// ================== 6. 隐藏顶部听歌识曲按钮 ==================

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

var featureState = {};

async function loadFeatureState() {
  var saved = await ctx.storage.get('zhs-features');
  if (saved) {
    // 兼容旧版本，新功能默认启用
    if (saved.dailyPlay === undefined) saved.dailyPlay = true;
    if (saved.clickToPlay === undefined) saved.clickToPlay = true;
    featureState = saved;
  } else {
    featureState = {
      artistSort: true,
      hidePlaylist: true,
      clickToPlay: true,
      dailyPlay: true,
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

// ================== 入口 ==================

export async function activate(_ctx) {
  ctx = _ctx;

  await loadFeatureState();

  if (featureState.artistSort) startArtistSort();
  if (featureState.hidePlaylist) startHidePlaylist();
  if (featureState.clickToPlay) startClickToPlay();
  if (featureState.dailyPlay) startDailyPlay();
  if (featureState.lyricHide) startLyricHide();
  if (featureState.hideRecognize) startHideRecognize();
  if (featureState.pluginBtn) startPluginBtn();
  if (featureState.effect) startEffect(featureState.effectMode || 'snow');

  var h = ctx.vue.h;

  var SettingsComp = ctx.vue.defineComponent({
    name: 'ZhsSettings',
    setup: function() {
      var state = ctx.vue.reactive({
        features: [
          { id: 'artistSort', icon: '🔥', label: '歌手热门排序', desc: '歌手详情页默认按热门排序', enabled: featureState.artistSort },
          { id: 'hidePlaylist', icon: '📋', label: '收藏歌单自动切换', desc: '启动时自动切换到收藏歌单', enabled: featureState.hidePlaylist },
          { id: 'clickToPlay', icon: '👆', label: '单击播放', desc: '单击歌曲任意位置即可播放', enabled: featureState.clickToPlay },
          { id: 'dailyPlay', icon: '🎵', label: '首页卡片一键播放', desc: '每日推荐/排行榜卡片上直接播放，不跳转', enabled: featureState.dailyPlay },
          { id: 'lyricHide', icon: '🙈', label: '歌词隐藏控制栏', desc: '歌词全屏时控制栏2秒无操作自动隐藏', enabled: featureState.lyricHide },
          { id: 'hideRecognize', icon: '🚫', label: '隐藏听歌识曲', desc: '隐藏顶部导航栏的听歌识曲按钮', enabled: featureState.hideRecognize },
          { id: 'pluginBtn', icon: '🔧', label: '顶部插件管理入口', desc: '搜索框右侧添加插件快捷按钮', enabled: featureState.pluginBtn },
          { id: 'effect', icon: '🎆', label: '桌面特效', desc: '10种粒子特效', enabled: featureState.effect },
        ],
      });
      var currentEffectMode = ctx.vue.ref(featureState.effectMode || 'snow');

      function switchEffectMode(mode) {
        currentEffectMode.value = mode;
        featureState.effectMode = mode;
        featureState.effect = true;
        state.features[6].enabled = true;
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
          else if (f.id === 'clickToPlay') { f.enabled ? startClickToPlay() : stopClickToPlay(); }
          else if (f.id === 'dailyPlay') { f.enabled ? startDailyPlay() : stopDailyPlay(); }
          else if (f.id === 'lyricHide') { f.enabled ? startLyricHide() : stopLyricHide(); }
          else if (f.id === 'hideRecognize') { f.enabled ? startHideRecognize() : stopHideRecognize(); }
          else if (f.id === 'pluginBtn') { f.enabled ? startPluginBtn() : stopPluginBtn(); }
          else if (f.id === 'effect') { f.enabled ? startEffect(currentEffectMode.value) : stopEffect(); }
        });
      }, { deep: true });

      var effectHotkeys = [
        { mode: 'snow', icon: '❄️' },
        { mode: 'sakura', icon: '🌸' },
        { mode: 'heart', icon: '💖' },
        { mode: 'confetti', icon: '🎉' },
        { mode: 'fire', icon: '🔥' },
        { mode: 'rain', icon: '🌧️' },
        { mode: 'leaf', icon: '🍁' },
        { mode: 'colorstar', icon: '⭐' },
        { mode: 'petal', icon: '🌺' },
        { mode: 'aurora', icon: '🌌' },
      ];

      function toggleRow(icon, label, desc, isOn, onClick) {
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
            h('span', { style: { 'font-size': '14px', 'flex-shrink': '0', opacity: isOn ? '1' : '0.4' } }, icon),
            h('span', { style: { 'font-size': '13px', 'font-weight': '600', color: isOn ? 'var(--color-primary, #4caf50)' : 'var(--color-text-main)' } }, label),
          ]),
          h('span', { style: { 'font-size': '11px', color: 'var(--color-text-secondary)', 'line-height': '1.3', 'padding-left': '20px' } }, desc),
        ]);
      }

      return function() {
        return h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '6px' } }, [
          h('div', { style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '6px' } },
            state.features.map(function(f) {
              return toggleRow(f.icon, f.label, f.desc, f.enabled, function() { f.enabled = !f.enabled; });
            })
          ),
          h('div', {
            style: {
              display: 'flex', gap: '3px',
              padding: '6px 8px', 'border-radius': '8px',
              'overflow-x': 'auto', 'flex-shrink': '0',
              background: 'var(--card-bg, rgba(255,255,255,0.04))',
            },
          },
            effectHotkeys.map(function(item) {
              var key = item.mode;
              var active = currentEffectMode.value === key;
              return h('div', {
                key: key,
                style: { display: 'flex', 'align-items': 'center', gap: '2px', cursor: 'pointer', padding: '2px 6px', 'border-radius': '5px', background: active ? 'var(--hover-bg, rgba(128,128,128,0.1))' : 'transparent', 'font-size': '11px', color: active ? 'var(--color-primary, #4caf50)' : 'var(--color-text-secondary)', border: active ? '1px solid var(--color-primary, #4caf50)' : '1px solid transparent' },
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
  stopClickToPlay();
  stopDailyPlay();
  stopLyricHide();
  stopHideRecognize();
  stopPluginBtn();
  stopEffect();

  if (disposeSettings) { disposeSettings(); disposeSettings = null; }
  ctx = null;
}
