// ===================================================
// PLATFORMS & URL HELPERS
// ===================================================
const PLATFORMS = {
  twitter: { name: 'Twitter / X', letter: 'X' },
  pixiv: { name: 'Pixiv', letter: 'P' },
  pinterest: { name: 'Pinterest', letter: 'P' },
  deviantart: { name: 'DeviantArt', letter: 'DA' }
};

function detectPlatform(item) {
  if (item.id && (String(item.id).startsWith('da_') || String(item.id).startsWith('deviantart_'))) return 'deviantart';
  if (item.url && item.url.includes('deviantart.com')) return 'deviantart';
  if (item.imgUrl && (item.imgUrl.includes('wixmp.com') || item.imgUrl.includes('deviantart.net'))) return 'deviantart';
  if (Array.isArray(item.images) && item.images.some(img => {
    const u = typeof img === 'string' ? img : (img?.url || img?.fallback_url || '');
    return u.includes('wixmp.com') || u.includes('deviantart.net');
  })) return 'deviantart';

  if (item.id && String(item.id).startsWith('pin_')) return 'pinterest';
  if (item.id && String(item.id).startsWith('pixiv_')) return 'pixiv';
  if (item.url && item.url.includes('pinterest.com')) return 'pinterest';
  if (item.imgUrl && item.imgUrl.includes('pinimg.com')) return 'pinterest';
  if (item.url && (item.url.includes('pixiv.net') || item.url.includes('pximg.net') || item.url.includes('pixiv.re'))) return 'pixiv';
  if (item.imgUrl && (item.imgUrl.includes('pximg.net') || item.imgUrl.includes('pixiv.re'))) return 'pixiv';
  return 'twitter';
}

function getAuthorProfileUrl(platform, authorHandle, rawItem) {
  const cleanHandle = (authorHandle || '').replace('@', '');
  if (platform === 'twitter') {
    return cleanHandle ? `https://x.com/${cleanHandle}` : '#';
  }
  if (platform === 'pixiv') {
    if (/^\d+$/.test(cleanHandle)) {
      return `https://www.pixiv.net/users/${cleanHandle}`;
    }
    return rawItem.url || 'https://www.pixiv.net';
  }
  if (platform === 'pinterest') {
    return 'https://www.pinterest.com';
  }
  if (platform === 'deviantart') {
    return cleanHandle && cleanHandle !== 'deviantart' 
      ? `https://www.deviantart.com/${cleanHandle}` 
      : (rawItem.url || 'https://www.deviantart.com');
  }
  return '#';
}

function sanitizePixivUrl(url) {
  if (!url) return '';
  let u = url;
  u = u.replace(/https?:\/\/i\.pximg\.net/, 'https://i.pixiv.re');
  u = u.replace('/custom-thumb/', '/img-master/');
  u = u.replace(/\/c\/\d+x\d+[^/]*\//, '/');
  u = u.replace(/_(?:square|custom)1200\./, '_master1200.');
  return u;
}

function optimizeWixmpUrl(url) {
  if (!url) return '';
  let fullUrl = url.trim();

  const tokenMatch = fullUrl.match(/token=([a-zA-Z0-9_\-\.]+)/);
  if (!tokenMatch) return fullUrl;

  const tokenStr = tokenMatch[1];
  try {
    const payloadB64 = tokenStr.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    const obj = payload?.obj?.[0]?.[0];
    const isDownload = payload?.aud && payload.aud.includes("urn:service:file.download");

    if (obj && obj.path) {
      if (isDownload) {
        return `https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com${obj.path}?token=${tokenStr}`;
      }

      const maxW = obj.width ? parseInt(obj.width.replace(/[^\d]/g, ''), 10) : 1280;
      const maxH = obj.height ? parseInt(obj.height.replace(/[^\d]/g, ''), 10) : 1280;

      if (!fullUrl.startsWith("http")) {
        return `https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com${obj.path}/v1/fit/w_${maxW},h_${maxH},q_95/view.jpg?token=${tokenStr}`;
      }

      return fullUrl.replace(/\/v1\/(?:fill|crop|fit)\/[^\/]+(?=\/)/i, `/v1/fit/w_${maxW},h_${maxH},q_95`);
    }
  } catch (e) {}

  return fullUrl;
}

// ===================================================
// DOMINANT COLOR SAMPLING
// ===================================================
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function extractDominantColor(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const imgData = ctx.getImageData(0, 0, 24, 24).data;

    const buckets = {
      red: 0, orange: 0, yellow: 0, green: 0,
      blue: 0, purple: 0, pink: 0, dark: 0, light: 0
    };

    let totalR = 0, totalG = 0, totalB = 0, count = 0;

    for (let i = 0; i < imgData.length; i += 4) {
      const a = imgData[i + 3];
      if (a < 128) continue;
      const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
      totalR += r; totalG += g; totalB += b; count++;

      const [h, s, l] = rgbToHsl(r, g, b);

      if (l < 0.18) {
        buckets.dark += 1;
      } else if (l > 0.85 && s < 0.2) {
        buckets.light += 1;
      } else if (s < 0.15) {
        if (l < 0.5) buckets.dark += 0.8;
        else buckets.light += 0.8;
      } else {
        const weight = 1.2 + s;
        if (h >= 345 || h < 15) buckets.red += weight;
        else if (h >= 15 && h < 45) buckets.orange += weight;
        else if (h >= 45 && h < 70) buckets.yellow += weight;
        else if (h >= 70 && h < 165) buckets.green += weight;
        else if (h >= 165 && h < 260) buckets.blue += weight;
        else if (h >= 260 && h < 315) buckets.purple += weight;
        else if (h >= 315 && h < 345) buckets.pink += weight;
      }
    }

    if (count === 0) return null;

    let bestBucket = 'dark';
    let maxScore = -1;
    for (const [key, val] of Object.entries(buckets)) {
      if (val > maxScore) {
        maxScore = val;
        bestBucket = key;
      }
    }

    const avgR = Math.round(totalR / count);
    const avgG = Math.round(totalG / count);
    const avgB = Math.round(totalB / count);
    const hex = '#' + ((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1);

    return { hex, family: bestBucket };
  } catch (err) {
    return null;
  }
}

// ===================================================
// INDEXEDDB CACHE LAYER
// ===================================================
const DB_NAME = 'UniversalGalleryDB';
const DB_VERSION = 2;
const STORE_NAME = 'imageCache';
const META_STORE = 'metaCache';
let dbInstance = null;
const blobUrlMap = new Map();

function getDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function getCachedBlob(url) {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveBlobToDB(url, blob) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(blob, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {}
}

async function getCachedMeta(url) {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveMetaToDB(url, meta) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      store.put(meta, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {}
}

async function clearAllIndexedDB() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function fetchImageBlob(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    return await res.blob();
  } catch {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('Proxy fetch failed');
    return await res.blob();
  }
}

// ===================================================
// DETERMINISTIC SEEDED RARITY ENGINE
// ===================================================
function getDeterministicRarity(seedStr) {
  const str = String(seedStr || 'default_seed');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  const val = (h >>> 0) / 4294967296;

  if (val < 0.03) return { tier: 'SSR', stars: '⭐⭐⭐⭐⭐', score: val };
  if (val < 0.20) return { tier: 'SR', stars: '⭐⭐⭐⭐', score: val };
  if (val < 0.55) return { tier: 'R', stars: '⭐⭐⭐', score: val };
  return { tier: 'N', stars: '⭐⭐', score: val };
}

// ===================================================
// APPLICATION STATE & UI ELEMENTS
// ===================================================
let currentItems = [];
const allImportedPosts = new Map();
let currentViewMode = 'posts'; 
let activeModalItem = null;
let activePokemonItem = null;

let activeSearchQuery = '';
let activePlatformFilter = 'all';
let activeArtistFilter = 'all';
let activeColorFilter = 'all';
let activeAspectFilter = 'all';
let activeSortOrder = 'newest';

// Multi-Keyword State
const activeKeywordsSet = new Set();
let isKeywordMatchAll = true;
let allExtractedKeywordsMap = new Map();
let allExtractedKeywordsList = [];

// Gacha State & Banner State
let activeGachaBanner = 'all';
const gachaPools = { ssr: [], sr: [], r: [], n: [] };
let gachaSummonHistory = JSON.parse(localStorage.getItem('universal_gacha_history') || '[]');
let gachaTotalRolls = parseInt(localStorage.getItem('universal_gacha_rolls') || '0');
let unlockedGachaSet = new Set(JSON.parse(localStorage.getItem('universal_gacha_unlocked') || '[]'));
let pendingSummonPull = [];
let activeGachaSort = 'recent';
let activeGachaRarityFilter = 'all';

// Direct Column-Based Zooming
let galleryColCount = parseInt(localStorage.getItem('gallery_col_count') || '4');

let renderedCount = 0;
const BATCH_SIZE = 60;
let isBatchRendering = false;
let batchTimeout = null;
let currentRenderCycle = 0;
let fullyLoadedImages = 0;
let totalTargetImages = 0;

const tabGallery = document.getElementById('tabGallery');
const tabGacha = document.getElementById('tabGacha');
const gachaSummonedBadge = document.getElementById('gachaSummonedBadge');

const galleryView = document.getElementById('galleryView');
const gachaView = document.getElementById('gachaView');

const gallerySubBar = document.getElementById('gallerySubBar');
const gallerySearchInput = document.getElementById('gallerySearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const platformFilterSelect = document.getElementById('platformFilterSelect');
const artistFilterSelect = document.getElementById('artistFilterSelect');
const aspectFilterSelect = document.getElementById('aspectFilterSelect');
const colorFilterSelect = document.getElementById('colorFilterSelect');
const colorAnalysisBadge = document.getElementById('colorAnalysisBadge');
const sortSelect = document.getElementById('sortSelect');
const shuffleBtn = document.getElementById('shuffleBtn');
const resetAllFiltersBtn = document.getElementById('resetAllFiltersBtn');

// Multi-Keyword Selectors
const keywordsMultiBtn = document.getElementById('keywordsMultiBtn');
const keywordsMultiMenu = document.getElementById('keywordsMultiMenu');
const activeKwBadge = document.getElementById('activeKwBadge');
const keywordDropdownSearch = document.getElementById('keywordDropdownSearch');
const keywordModeMatchAll = document.getElementById('keywordModeMatchAll');
const clearKeywordsFilterBtn = document.getElementById('clearKeywordsFilterBtn');
const keywordDropdownList = document.getElementById('keywordDropdownList');
const activeKeywordsBar = document.getElementById('activeKeywordsBar');
const activeKeywordsChips = document.getElementById('activeKeywordsChips');
const clearAllChipsBtn = document.getElementById('clearAllChipsBtn');

// Gacha & Banner Elements
const gachaRoll1Btn = document.getElementById('gachaRoll1Btn');
const gachaRoll10Btn = document.getElementById('gachaRoll10Btn');
const gachaClearInventoryBtn = document.getElementById('gachaClearInventoryBtn');
const gachaExportBtn = document.getElementById('gachaExportBtn');
const gachaSortSelect = document.getElementById('gachaSortSelect');
const gachaRarityFilterSelect = document.getElementById('gachaRarityFilterSelect');
const gachaResultsGrid = document.getElementById('gachaResultsGrid');
const gachaResultsLabel = document.getElementById('gachaResultsLabel');
const gachaCountSSR = document.getElementById('gachaCountSSR');
const gachaCountSR = document.getElementById('gachaCountSR');
const gachaCountR = document.getElementById('gachaCountR');
const gachaCountN = document.getElementById('gachaCountN');
const gachaTotalRollsCount = document.getElementById('gachaTotalRollsCount');
const activeBannerDashboardTitle = document.getElementById('activeBannerDashboardTitle');
const activeBannerDashboardDesc = document.getElementById('activeBannerDashboardDesc');

// Banner Counts
const bannerPoolCountAll = document.getElementById('bannerPoolCountAll');
const bannerPoolCountTwitter = document.getElementById('bannerPoolCountTwitter');
const bannerPoolCountPixiv = document.getElementById('bannerPoolCountPixiv');
const bannerPoolCountDeviantArt = document.getElementById('bannerPoolCountDeviantArt');
const bannerPoolCountPinterest = document.getElementById('bannerPoolCountPinterest');

// Summoning Animation Overlay
const gachaSummonOverlay = document.getElementById('gachaSummonOverlay');
const summonParticlesCanvas = document.getElementById('summonParticlesCanvas');
const summonStageOrb = document.getElementById('summonStageOrb');
const summonStageShowcase = document.getElementById('summonStageShowcase');
const summonCrystalWrap = document.getElementById('summonCrystalWrap');
const summonCrystal = document.getElementById('summonCrystal');
const summonFlashLayer = document.getElementById('summonFlashLayer');
const summonCardsContainer = document.getElementById('summonCardsContainer');
const summonSkipBtn = document.getElementById('summonSkipBtn');
const summonCloseBtn = document.getElementById('summonCloseBtn');

// Pokemon Card Tilt Modal Elements
const pokemonModal = document.getElementById('pokemonModal');
const pokemonCardStage = document.getElementById('pokemonCardStage');
const pokemonCardRarityPill = document.getElementById('pokemonCardRarityPill');
const pokemonCardHolo = document.getElementById('pokemonCardHolo');
const pokemonCardArt = document.getElementById('pokemonCardArt');
const pokemonCloseBtn = document.getElementById('pokemonCloseBtn');
const pokemonSwitchGalleryBtn = document.getElementById('pokemonSwitchGalleryBtn');

// Overlays & Navigation
const importLoadingOverlay = document.getElementById('importLoadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingSubtext = document.getElementById('loadingSubtext');
const importProgressBar = document.getElementById('importProgressBar');
const loadingStats = document.getElementById('loadingStats');
const skipLoadingBtn = document.getElementById('skipLoadingBtn');

const badgeVisibilityBtn = document.getElementById('badgeVisibilityBtn');
const badgeVisibilityMenu = document.getElementById('badgeVisibilityMenu');
const chkShowRarity = document.getElementById('chkShowRarity');
const chkShowPage = document.getElementById('chkShowPage');
const chkShowPlatform = document.getElementById('chkShowPlatform');
const chkShowColor = document.getElementById('chkShowColor');

const gallery = document.getElementById('gallery');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const loadFilesBtn = document.getElementById('loadFilesBtn');
const countLabel = document.getElementById('count');
const loadedCountBadge = document.getElementById('loadedCountBadge');
const galleryZoomWrap = document.getElementById('galleryZoomWrap');
const galleryViewToggles = document.getElementById('galleryViewToggles');
const colCountLabel = document.getElementById('colCountLabel');
const galZoomMinus = document.getElementById('galZoomMinus');
const galZoomPlus = document.getElementById('galZoomPlus');

const viewPostsBtn = document.getElementById('viewPosts');
const viewMediaBtn = document.getElementById('viewMedia');

const storageMenuBtn = document.getElementById('storageMenuBtn');
const storageMenu = document.getElementById('storageMenu');
const saveOfflineBtn = document.getElementById('saveOfflineBtn');
const saveGachaStateBtn = document.getElementById('saveGachaStateBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const saveProgress = document.getElementById('saveProgress');

const exportMenuBtn = document.getElementById('exportMenuBtn');
const exportMenu = document.getElementById('exportMenu');
const exportAllBtn = document.getElementById('exportAllBtn');
const exportFilteredBtn = document.getElementById('exportFilteredBtn');
const exportGachaMenuBtn = document.getElementById('exportGachaMenuBtn');

const modal = document.getElementById('modal');
const modalImg = document.getElementById('modalImg');
const closeBtn = document.getElementById('closeBtn');
const multiMediaWrap = document.getElementById('multiMediaWrap');
const postThumbs = document.getElementById('postThumbs');
const modalPagePill = document.getElementById('modalPagePill');
const modalDeleteBtn = document.getElementById('modalDeleteBtn');

// ===================================================
// THEME & SECRET CODE LOGIC
// ===================================================
const themeToggleBtn = document.getElementById('themeToggle');
const secretCodeMenu = document.getElementById('secretCodeMenu');
const secretCodeInput = document.getElementById('secretCodeInput');
const applySecretCodeBtn = document.getElementById('applySecretCodeBtn');
const secretCodeMsg = document.getElementById('secretCodeMsg');
const closeSecretMenuBtn = document.getElementById('closeSecretMenuBtn');

let activeSecretTheme = localStorage.getItem('gallery_secret_theme') || null;

function applySecretTheme(themeName) {
  document.body.classList.remove('light-theme');
  themeToggleBtn.textContent = '🌙';
  localStorage.setItem('gallery_theme', 'dark');

  document.documentElement.classList.remove('theme-grayscale');
  document.body.classList.remove('theme-grayscale', 'theme-ptit', 'theme-zen3');

  if (themeName === 'GRAYSCALE') {
    document.documentElement.classList.add('theme-grayscale');
    document.body.classList.add('theme-grayscale');
    activeSecretTheme = 'GRAYSCALE';
    localStorage.setItem('gallery_secret_theme', 'GRAYSCALE');
  } else if (themeName === 'PTIT') {
    document.body.classList.add('theme-ptit');
    activeSecretTheme = 'PTIT';
    localStorage.setItem('gallery_secret_theme', 'PTIT');
  } else if (themeName === 'ZEN3') {
    document.body.classList.add('theme-zen3');
    activeSecretTheme = 'ZEN3';
    localStorage.setItem('gallery_secret_theme', 'ZEN3');
  }
}

function clearSecretTheme() {
  document.documentElement.classList.remove('theme-grayscale');
  document.body.classList.remove('theme-grayscale', 'theme-ptit', 'theme-zen3');
  activeSecretTheme = null;
  localStorage.removeItem('gallery_secret_theme');

  const isLight = document.body.classList.contains('light-theme');
  themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
}

const savedTheme = localStorage.getItem('gallery_theme') || 'dark';
if (savedTheme === 'light' && !activeSecretTheme) {
  document.body.classList.add('light-theme');
  themeToggleBtn.textContent = '☀️';
}

if (activeSecretTheme) {
  applySecretTheme(activeSecretTheme);
}

secretCodeInput.addEventListener('input', () => {
  secretCodeInput.value = secretCodeInput.value.toUpperCase();
});

function submitSecretCode() {
  const code = secretCodeInput.value.trim().toUpperCase();
  if (code === 'GRAYSCALE') {
    applySecretTheme('GRAYSCALE');
    secretCodeMsg.style.display = 'block';
    secretCodeMsg.style.color = 'var(--accent)';
    secretCodeMsg.textContent = '✓ Grayscale mode applied';
    setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
  } else if (code === 'PTIT') {
    applySecretTheme('PTIT');
    secretCodeMsg.style.display = 'block';
    secretCodeMsg.style.color = '#ff334b';
    secretCodeMsg.textContent = '✓ PTIT Red theme applied';
    setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
  } else if (code === 'ZEN3') {
    applySecretTheme('ZEN3');
    secretCodeMsg.style.display = 'block';
    secretCodeMsg.style.color = '#a855f7';
    secretCodeMsg.textContent = '✓ Zen 3 Purple theme applied';
    setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
  } else {
    secretCodeMsg.style.display = 'block';
    secretCodeMsg.style.color = '#f85149';
    secretCodeMsg.textContent = '✕ Invalid Code';
  }
}

applySecretCodeBtn.addEventListener('click', submitSecretCode);
secretCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSecretCode();
});

closeSecretMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  secretCodeMenu.classList.remove('open');
});

let holdTimer = null;
let holdFired = false;
const HOLD_MS = 500;

function onHoldStart(e) {
  if (e.button !== undefined && e.button !== 0) return;
  holdFired = false;
  holdTimer = setTimeout(() => {
    holdFired = true;
    closeAllDropdowns();
    secretCodeMenu.classList.add('open');
    secretCodeInput.value = '';
    secretCodeMsg.style.display = 'none';
    setTimeout(() => secretCodeInput.focus(), 80);
  }, HOLD_MS);
}

function onHoldEnd() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

themeToggleBtn.addEventListener('mousedown', onHoldStart);
themeToggleBtn.addEventListener('touchstart', onHoldStart, { passive: true });

window.addEventListener('mouseup', onHoldEnd);
window.addEventListener('touchend', onHoldEnd);

themeToggleBtn.addEventListener('contextmenu', (e) => {
  if (holdFired) e.preventDefault();
});

themeToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (holdFired) {
    holdFired = false;
    return;
  }
  onHoldEnd();

  if (activeSecretTheme) {
    clearSecretTheme();
    return;
  }

  const isLight = document.body.classList.toggle('light-theme');
  themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('gallery_theme', isLight ? 'light' : 'dark');
});

secretCodeMenu.addEventListener('click', (e) => e.stopPropagation());

function activateTab(tabBtn, viewEl) {
  [tabGallery, tabGacha].forEach(t => t.classList.remove('active'));
  [galleryView, gachaView].forEach(v => v.style.display = 'none');

  tabBtn.classList.add('active');
  viewEl.style.display = 'block';

  const isGal = tabBtn === tabGallery;
  galleryViewToggles.style.display = isGal ? 'inline-flex' : 'none';
  galleryZoomWrap.style.display = isGal ? 'inline-flex' : 'none';
}

tabGallery.addEventListener('click', () => {
  activateTab(tabGallery, galleryView);
  renderColumns();
});

tabGacha.addEventListener('click', () => {
  activateTab(tabGacha, gachaView);
  updateBannerCounts();
  rebuildDeterministicPools();
  renderGachaResults();
});

const showRarity = localStorage.getItem('gallery_show_rarity') !== 'false';
const showPage = localStorage.getItem('gallery_show_page') !== 'false';
const showPlatform = localStorage.getItem('gallery_show_platform') !== 'false';
const showColor = localStorage.getItem('gallery_show_color') !== 'false';

chkShowRarity.checked = showRarity;
chkShowPage.checked = showPage;
chkShowPlatform.checked = showPlatform;
chkShowColor.checked = showColor;

document.body.classList.toggle('hide-rarity-badge', !showRarity);
document.body.classList.toggle('hide-page-badge', !showPage);
document.body.classList.toggle('hide-platform-badge', !showPlatform);
document.body.classList.toggle('hide-color-badge', !showColor);

chkShowRarity.addEventListener('change', (e) => {
  document.body.classList.toggle('hide-rarity-badge', !e.target.checked);
  localStorage.setItem('gallery_show_rarity', e.target.checked);
});

chkShowPage.addEventListener('change', (e) => {
  document.body.classList.toggle('hide-page-badge', !e.target.checked);
  localStorage.setItem('gallery_show_page', e.target.checked);
});

chkShowPlatform.addEventListener('change', (e) => {
  document.body.classList.toggle('hide-platform-badge', !e.target.checked);
  localStorage.setItem('gallery_show_platform', e.target.checked);
});

chkShowColor.addEventListener('change', (e) => {
  document.body.classList.toggle('hide-color-badge', !e.target.checked);
  localStorage.setItem('gallery_show_color', e.target.checked);
});

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('open'));
}

badgeVisibilityBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = badgeVisibilityMenu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) badgeVisibilityMenu.classList.add('open');
});

badgeVisibilityMenu.addEventListener('click', (e) => e.stopPropagation());
skipLoadingBtn.addEventListener('click', () => importLoadingOverlay.classList.remove('active'));

galZoomMinus.addEventListener('click', () => {
  galleryColCount = Math.max(galleryColCount - 1, 1);
  localStorage.setItem('gallery_col_count', galleryColCount);
  renderColumns();
});

galZoomPlus.addEventListener('click', () => {
  galleryColCount = Math.min(galleryColCount + 1, 8);
  localStorage.setItem('gallery_col_count', galleryColCount);
  renderColumns();
});

storageMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = storageMenu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) storageMenu.classList.add('open');
});

exportMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = exportMenu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) exportMenu.classList.add('open');
});

exportMenu.addEventListener('click', (e) => e.stopPropagation());
loadFilesBtn.addEventListener('click', () => fileInput.click());
window.addEventListener('click', () => closeAllDropdowns());

// ===================================================
// CUSTOM DROPDOWN ENGINE
// ===================================================
function syncCustomDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const container = document.querySelector(`.custom-dropdown[data-select="${selectId}"]`);
  if (!container) return;

  const btn = container.querySelector('.custom-dropdown-btn');
  const menu = container.querySelector('.custom-dropdown-menu');
  if (!btn || !menu) return;

  const selectedOpt = select.options[select.selectedIndex] || select.options[0];
  if (selectedOpt) btn.textContent = `${selectedOpt.textContent} ▾`;

  menu.innerHTML = '';
  Array.from(select.options).forEach(opt => {
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'dropdown-item' + (opt.value === select.value ? ' selected' : '');
    itemBtn.textContent = opt.textContent;

    itemBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      syncCustomDropdown(selectId);
      menu.classList.remove('open');
      select.dispatchEvent(new Event('change'));
    });

    menu.appendChild(itemBtn);
  });
}

function initCustomDropdowns() {
  document.querySelectorAll('.custom-dropdown').forEach(container => {
    const btn = container.querySelector('.custom-dropdown-btn');
    const menu = container.querySelector('.custom-dropdown-menu');
    const selectId = container.dataset.select;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        syncCustomDropdown(selectId);
        menu.classList.add('open');
      }
    });

    menu.addEventListener('click', (e) => e.stopPropagation());
    syncCustomDropdown(selectId);
  });
}

function syncAllFilterDropdowns() {
  syncCustomDropdown('platformFilterSelect');
  syncCustomDropdown('artistFilterSelect');
  syncCustomDropdown('aspectFilterSelect');
  syncCustomDropdown('colorFilterSelect');
  syncCustomDropdown('sortSelect');
  syncCustomDropdown('gachaSortSelect');
  syncCustomDropdown('gachaRarityFilterSelect');
}

function updateLoadedCounter() {
  if (totalTargetImages === 0) {
    loadedCountBadge.textContent = '0 items';
    loadedCountBadge.style.borderColor = 'var(--border)';
  } else if (fullyLoadedImages >= totalTargetImages) {
    loadedCountBadge.textContent = `🖼️ ${totalTargetImages} items`;
    loadedCountBadge.style.borderColor = '#3fb950';
  } else {
    loadedCountBadge.textContent = `🖼️ ${fullyLoadedImages}/${totalTargetImages} loaded`;
    loadedCountBadge.style.borderColor = 'var(--accent)';
  }

  if (currentItems.length > 0) {
    countLabel.textContent = `${allImportedPosts.size} posts (${currentItems.length} media)`;
  } else {
    countLabel.textContent = '';
  }
}

function resetLoadedCounter(targetCount) {
  fullyLoadedImages = 0;
  totalTargetImages = targetCount;
  updateLoadedCounter();
}

function trackImageLoad(img, cycle) {
  let settled = false;
  const markLoaded = () => {
    if (settled || (cycle !== undefined && cycle !== currentRenderCycle)) return;
    settled = true;
    fullyLoadedImages = Math.min(fullyLoadedImages + 1, totalTargetImages);
    updateLoadedCounter();
  };

  if (img.complete && img.naturalWidth > 0) {
    markLoaded();
  } else {
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', markLoaded, { once: true });
  }
}

// ==========================================
// KEYWORD EXTRACTION & MULTI-FILTER ENGINE
// ==========================================
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'your', 'what',
  'some', 'just', 'like', 'will', 'then', 'them', 'they', 'were', 'been', 'about',
  'more', 'when', 'which', 'would', 'there', 'their', 'http', 'https', 'twitter',
  'status', 'photo', 'video', 'card', 'post', 'view', 'make', 'into', 'over',
  'pixiv', 'pinterest', 'artwork', 'artworks', 'deviantart', 'image'
]);

function extractTopKeywords() {
  allExtractedKeywordsMap.clear();

  currentItems.forEach(item => {
    if (!item.text) return;
    const hashtags = item.text.match(/#[^\s#.,!?;:()[\]{}'"]+/g) || [];
    hashtags.forEach(h => {
      const tag = h.toLowerCase();
      allExtractedKeywordsMap.set(tag, (allExtractedKeywordsMap.get(tag) || 0) + 1);
    });

    const words = item.text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    words.forEach(w => {
      if (!STOP_WORDS.has(w)) {
        allExtractedKeywordsMap.set(w, (allExtractedKeywordsMap.get(w) || 0) + 1);
      }
    });
  });

  allExtractedKeywordsList = Array.from(allExtractedKeywordsMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);

  renderKeywordDropdownOptions();
  updateActiveKeywordsUI();
  updateFilterCounts();
}

keywordsMultiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = keywordsMultiMenu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    keywordsMultiMenu.classList.add('open');
    keywordDropdownSearch.focus();
  }
});
keywordsMultiMenu.addEventListener('click', (e) => e.stopPropagation());

keywordDropdownSearch.addEventListener('input', () => renderKeywordDropdownOptions());

keywordModeMatchAll.addEventListener('change', (e) => {
  isKeywordMatchAll = e.target.checked;
  renderColumns();
});

clearKeywordsFilterBtn.addEventListener('click', () => {
  activeKeywordsSet.clear();
  renderKeywordDropdownOptions();
  updateActiveKeywordsUI();
  renderColumns();
});

clearAllChipsBtn.addEventListener('click', () => {
  activeKeywordsSet.clear();
  renderKeywordDropdownOptions();
  updateActiveKeywordsUI();
  renderColumns();
});

function toggleKeywordFilter(keyword) {
  if (activeKeywordsSet.has(keyword)) activeKeywordsSet.delete(keyword);
  else activeKeywordsSet.add(keyword);
  renderKeywordDropdownOptions();
  updateActiveKeywordsUI();
  renderColumns();
}

function updateActiveKeywordsUI() {
  if (activeKeywordsSet.size > 0) {
    activeKwBadge.style.display = 'inline-block';
    activeKwBadge.textContent = activeKeywordsSet.size;
    activeKeywordsBar.style.display = 'flex';
    activeKeywordsChips.innerHTML = '';

    activeKeywordsSet.forEach(kw => {
      const chip = document.createElement('div');
      chip.className = 'active-kw-chip';
      chip.innerHTML = `
        <span>${kw}</span>
        <span class="active-kw-chip-remove" title="Remove keyword">&times;</span>
      `;
      chip.querySelector('.active-kw-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKeywordFilter(kw);
      });
      activeKeywordsChips.appendChild(chip);
    });
  } else {
    activeKwBadge.style.display = 'none';
    activeKeywordsBar.style.display = 'none';
    activeKeywordsChips.innerHTML = '';
  }
}

function renderKeywordDropdownOptions() {
  const q = keywordDropdownSearch.value.trim().toLowerCase();
  keywordDropdownList.innerHTML = '';

  let list = allExtractedKeywordsList;
  if (q) list = list.filter(kw => kw.includes(q));

  if (!list.length) {
    keywordDropdownList.innerHTML = `<div style="font-size:0.75rem; color:var(--subtext); padding:8px; text-align:center;">No keywords found</div>`;
    return;
  }

  list.forEach(kw => {
    const count = allExtractedKeywordsMap.get(kw) || 0;
    const isChecked = activeKeywordsSet.has(kw);

    const itemLabel = document.createElement('label');
    itemLabel.className = 'dropdown-item';
    itemLabel.style.cssText = 'cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 4px 6px;';
    
    itemLabel.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
        <input type="checkbox" ${isChecked ? 'checked' : ''} style="cursor:pointer; flex-shrink:0;">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${kw}</span>
      </div>
      <span class="badge" style="margin-left:6px; flex-shrink:0;">${count}</span>
    `;

    const chk = itemLabel.querySelector('input');
    chk.addEventListener('change', () => toggleKeywordFilter(kw));
    keywordDropdownList.appendChild(itemLabel);
  });
}

// ===================================================
// BANNER SWITCHING & GACHA POOLS ENGINE
// ===================================================
const BANNER_INFOS = {
  all: { title: '🎰 All Sites Summoning', desc: 'Universal summoning pool combining all imported artworks across all platforms.' },
  twitter: { title: '🐦 Twitter / X Summoning', desc: 'Summoning exclusively from curated illustrations and bookmarks on Twitter / X.' },
  pixiv: { title: '🖌️ Pixiv Sanctuary Summoning', desc: 'Summoning exclusively from Japanese manga and Pixiv illustration artworks.' },
  deviantart: { title: '🎨 DeviantArt Summoning', desc: 'Summoning exclusively from digital community deviations and concept art.' },
  pinterest: { title: '📌 Pinterest Summoning', desc: 'Summoning exclusively from character sketches, aesthetic boards, and visual inspirations.' }
};

function updateBannerCounts() {
  const total = currentItems.length;
  const tw = currentItems.filter(i => i.platform === 'twitter').length;
  const px = currentItems.filter(i => i.platform === 'pixiv').length;
  const da = currentItems.filter(i => i.platform === 'deviantart').length;
  const pin = currentItems.filter(i => i.platform === 'pinterest').length;

  bannerPoolCountAll.textContent = total;
  bannerPoolCountTwitter.textContent = tw;
  bannerPoolCountPixiv.textContent = px;
  bannerPoolCountDeviantArt.textContent = da;
  bannerPoolCountPinterest.textContent = pin;
}

document.querySelectorAll('.gacha-banner-card').forEach(card => {
  card.addEventListener('click', () => {
    const bannerKey = card.dataset.banner;
    if (activeGachaBanner === bannerKey) return;
    
    document.querySelectorAll('.gacha-banner-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    activeGachaBanner = bannerKey;

    const info = BANNER_INFOS[bannerKey] || BANNER_INFOS.all;
    activeBannerDashboardTitle.textContent = info.title;
    activeBannerDashboardDesc.textContent = info.desc;

    rebuildDeterministicPools();
  });
});

function getActiveBannerItems() {
  if (activeGachaBanner === 'all') return currentItems;
  return currentItems.filter(item => item.platform === activeGachaBanner);
}

function rebuildDeterministicPools() {
  gachaPools.ssr = [];
  gachaPools.sr = [];
  gachaPools.r = [];
  gachaPools.n = [];

  const candidateItems = getActiveBannerItems();

  candidateItems.forEach(item => {
    const seed = String(item.postId || item.id || item.imgUrl);
    const rarityMeta = getDeterministicRarity(seed);
    item.gachaRarity = rarityMeta.tier;
    item.gachaStars = rarityMeta.stars;

    const tierLower = rarityMeta.tier.toLowerCase();
    if (gachaPools[tierLower]) {
      gachaPools[tierLower].push(item);
    }
  });

  updateGachaStats();
}

function updateGachaStats() {
  gachaCountSSR.textContent = gachaPools.ssr.length;
  gachaCountSR.textContent = gachaPools.sr.length;
  gachaCountR.textContent = gachaPools.r.length;
  gachaCountN.textContent = gachaPools.n.length;
  gachaTotalRollsCount.textContent = gachaTotalRolls;
  gachaSummonedBadge.textContent = unlockedGachaSet.size;
  gachaResultsLabel.textContent = `Summon History & Inventory (${gachaSummonHistory.length} pulls / ${unlockedGachaSet.size} unique cards)`;
}

function rollSingleCard(pitySR = false, excludedPullIds = new Set()) {
  const rand = Math.random() * 100;
  let tier = 'N';

  if (rand < 3.0 && gachaPools.ssr.length) {
    tier = 'SSR';
  } else if ((rand < 20.0 || pitySR) && gachaPools.sr.length) {
    tier = 'SR';
  } else if (rand < 55.0 && gachaPools.r.length) {
    tier = 'R';
  } else {
    tier = 'N';
  }

  let pool = gachaPools[tier.toLowerCase()] || [];
  if (!pool.length) pool = getActiveBannerItems();
  if (!pool.length) pool = currentItems;

  const uncollected = pool.filter(item => {
    const id = item.postId || item.id;
    return !unlockedGachaSet.has(id) && !excludedPullIds.has(id);
  });

  let candidatePool = pool;
  if (uncollected.length > 0) {
    candidatePool = uncollected;
  } else {
    const notInThisPull = pool.filter(item => !excludedPullIds.has(item.postId || item.id));
    candidatePool = notInThisPull.length > 0 ? notInThisPull : pool;
  }

  const picked = candidatePool[Math.floor(Math.random() * candidatePool.length)];
  return {
    ...picked,
    rarity: picked.gachaRarity || tier,
    stars: picked.gachaStars || '⭐⭐',
    summonedAt: Date.now(),
    summonId: 'sum_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  };
}

function updateGalleryCardsGlow(cards) {
  cards.forEach(card => {
    const pId = card.postId || card.id;
    const tier = (card.gachaRarity || card.rarity || 'N').toLowerCase();
    document.querySelectorAll(`[data-post-id="${CSS.escape(pId)}"]`).forEach(el => {
      el.classList.remove('gacha-revealed-ssr', 'gacha-revealed-sr', 'gacha-revealed-r', 'gacha-revealed-n');
      el.classList.add(`gacha-revealed-${tier}`);
      const badges = el.querySelector('.card-top-badges');
      if (badges && !badges.querySelector('.card-rarity-pill')) {
        const pill = document.createElement('span');
        pill.className = `card-rarity-pill ${tier}`;
        pill.textContent = tier.toUpperCase();
        badges.prepend(pill);
      }
    });
  });
}

function executeGachaSummon(count = 1) {
  const bannerPool = getActiveBannerItems();
  if (!bannerPool.length) {
    alert('The selected banner has no artworks available. Please import artwork JSON or select another banner.');
    return;
  }

  if (!gachaPools.ssr.length && !gachaPools.n.length) {
    rebuildDeterministicPools();
  }

  const summoned = [];
  let gotSrOrBetter = false;
  const currentBatchIds = new Set();

  for (let i = 0; i < count; i++) {
    const isPity = count === 10 && i === 9 && !gotSrOrBetter;
    const res = rollSingleCard(isPity, currentBatchIds);
    if (res.rarity === 'SSR' || res.rarity === 'SR') gotSrOrBetter = true;

    currentBatchIds.add(res.postId || res.id);
    summoned.push(res);
    unlockedGachaSet.add(res.postId || res.id);
  }

  gachaTotalRolls += count;
  gachaSummonHistory = [...summoned, ...gachaSummonHistory];
  pendingSummonPull = summoned;

  saveGachaStateToStorage(false);
  updateGachaStats();
  updateGalleryCardsGlow(summoned);

  startSummonAnimation(summoned);
}

// ===================================================
// REMADE INTERACTIVE SUMMON ANIMATION & PARTICLES
// ===================================================
let animParticles = [];
let animReqId = null;
let pCtx = null;

function resizeSummonCanvas() {
  if (!summonParticlesCanvas) return;
  summonParticlesCanvas.width = window.innerWidth;
  summonParticlesCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeSummonCanvas);

class SummonParticle {
  constructor(isBurst = false, burstColor = '#58a6ff') {
    const w = summonParticlesCanvas.width;
    const h = summonParticlesCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    this.isBurst = isBurst;
    if (isBurst) {
      this.x = cx;
      this.y = cy;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 8;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.size = 2 + Math.random() * 4;
      this.alpha = 1;
      this.decay = 0.015 + Math.random() * 0.02;
      this.color = burstColor;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = 140 + Math.random() * (Math.max(w, h) * 0.45);
      this.x = cx + Math.cos(angle) * dist;
      this.y = cy + Math.sin(angle) * dist;
      this.targetX = cx;
      this.targetY = cy;
      this.vx = 0;
      this.vy = 0;
      this.size = 1 + Math.random() * 2.5;
      this.alpha = 0.2 + Math.random() * 0.7;
      this.color = Math.random() > 0.4 ? '#58a6ff' : (Math.random() > 0.5 ? '#f1e05a' : '#bc8cff');
    }
  }

  update() {
    if (this.isBurst) {
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.96;
      this.vy *= 0.96;
      this.alpha -= this.decay;
    } else {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 15) {
        const w = summonParticlesCanvas.width;
        const h = summonParticlesCanvas.height;
        const angle = Math.random() * Math.PI * 2;
        const d = 140 + Math.random() * (Math.max(w, h) * 0.45);
        this.x = w / 2 + Math.cos(angle) * d;
        this.y = h / 2 + Math.sin(angle) * d;
        this.alpha = 0.2 + Math.random() * 0.7;
      } else {
        const speed = 1.2 + (1 - dist / 500) * 2.5;
        this.x += (dx / dist) * speed + (-dy / dist) * 1.5;
        this.y += (dy / dist) * speed + (dx / dist) * 1.5;
      }
    }
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function initSummonParticles() {
  resizeSummonCanvas();
  pCtx = summonParticlesCanvas.getContext('2d');
  animParticles = [];
  for (let i = 0; i < 90; i++) {
    animParticles.push(new SummonParticle(false));
  }
  loopSummonParticles();
}

function loopSummonParticles() {
  if (!gachaSummonOverlay.classList.contains('active')) {
    if (animReqId) cancelAnimationFrame(animReqId);
    return;
  }
  pCtx.clearRect(0, 0, summonParticlesCanvas.width, summonParticlesCanvas.height);
  
  for (let i = animParticles.length - 1; i >= 0; i--) {
    const p = animParticles[i];
    p.update();
    p.draw(pCtx);
    if (p.isBurst && p.alpha <= 0) {
      animParticles.splice(i, 1);
    }
  }
  animReqId = requestAnimationFrame(loopSummonParticles);
}

function spawnBurstSparks(color) {
  for (let i = 0; i < 60; i++) {
    animParticles.push(new SummonParticle(true, color));
  }
}

function startSummonAnimation(cards) {
  let highest = 'N';
  if (cards.some(c => c.rarity === 'SSR')) highest = 'SSR';
  else if (cards.some(c => c.rarity === 'SR')) highest = 'SR';
  else if (cards.some(c => c.rarity === 'R')) highest = 'R';

  summonCrystal.className = `summon-core-crystal pulse-${highest.toLowerCase()}`;
  summonStageOrb.style.display = 'flex';
  summonStageShowcase.style.display = 'none';

  document.body.style.overflow = 'hidden';
  gachaSummonOverlay.classList.add('active');
  initSummonParticles();
}

function revealSummonCards() {
  let highestColor = '#58a6ff';
  if (pendingSummonPull.some(c => c.rarity === 'SSR')) highestColor = '#f1e05a';
  else if (pendingSummonPull.some(c => c.rarity === 'SR')) highestColor = '#bc8cff';

  spawnBurstSparks(highestColor);

  gachaSummonOverlay.classList.add('screen-shake');
  summonFlashLayer.classList.remove('flashing');
  void summonFlashLayer.offsetWidth;
  summonFlashLayer.classList.add('flashing');

  setTimeout(() => {
    gachaSummonOverlay.classList.remove('screen-shake');
    summonStageOrb.style.display = 'none';
    summonStageShowcase.style.display = 'flex';
    renderShowcaseCards(pendingSummonPull);
  }, 300);
}

function renderShowcaseCards(cards) {
  summonCardsContainer.innerHTML = '';
  cards.forEach((card, idx) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = `gacha-card rarity-${card.rarity.toLowerCase()}`;
    cardDiv.style.animationDelay = `${idx * 0.08}s`;

    cardDiv.innerHTML = `
      <div class="gacha-card-badge ${card.rarity.toLowerCase()}">${card.rarity}</div>
      <div class="gacha-card-thumb">
        <img alt="${card.authorName || 'Art'}" loading="eager" decoding="async">
      </div>
      <div class="gacha-card-body">
        <span class="gacha-card-stars">${card.stars}</span>
        <span class="gacha-card-author" title="${card.authorName}">${card.authorName || 'Unknown'}</span>
      </div>
    `;
    const img = cardDiv.querySelector('img');
    setCachedOrRemoteSrc(img, card);
    summonCardsContainer.appendChild(cardDiv);
  });

  renderGachaResults();
}

summonCrystalWrap.addEventListener('click', revealSummonCards);
summonSkipBtn.addEventListener('click', revealSummonCards);
summonCloseBtn.addEventListener('click', () => {
  gachaSummonOverlay.classList.remove('active');
  document.body.style.overflow = '';
  if (animReqId) cancelAnimationFrame(animReqId);
});

// ===================================================
// POKEMON CARD 3D TILT ENGINE (GLOBAL MOUSE TRACKING)
// ===================================================
function openPokemonCard(card) {
  activePokemonItem = card;
  const tier = (card.gachaRarity || card.rarity || 'N').toLowerCase();

  pokemonCardStage.className = `pokemon-card-stage rarity-${tier}`;
  pokemonCardRarityPill.className = `pokemon-card-top-pill ${tier}`;
  pokemonCardRarityPill.textContent = tier.toUpperCase();

  setCachedOrRemoteSrc(pokemonCardArt, card);

  pokemonCardStage.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
  pokemonCardHolo.style.opacity = '0.4';

  pokemonModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePokemonCard() {
  pokemonModal.classList.remove('open');
  document.body.style.overflow = '';
  activePokemonItem = null;
}

pokemonCloseBtn.addEventListener('click', closePokemonCard);
pokemonModal.addEventListener('click', (e) => {
  if (e.target === pokemonModal) closePokemonCard();
});

window.addEventListener('mousemove', (e) => {
  if (!pokemonModal.classList.contains('open') || !activePokemonItem) return;

  const rect = pokemonCardStage.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const dx = (e.clientX - cx) / (window.innerWidth / 2);
  const dy = (e.clientY - cy) / (window.innerHeight / 2);

  const maxAngle = 20;
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const rotX = clamp(-dy * maxAngle, -maxAngle, maxAngle);
  const rotY = clamp(dx * maxAngle, -maxAngle, maxAngle);

  pokemonCardStage.style.transform = `perspective(1200px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;

  const px = clamp(((e.clientX - rect.left) / rect.width) * 100, -20, 120);
  const py = clamp(((e.clientY - rect.top) / rect.height) * 100, -20, 120);
  pokemonCardHolo.style.backgroundPosition = `${px}% ${py}%`;
  pokemonCardHolo.style.opacity = '0.88';
});

pokemonSwitchGalleryBtn.addEventListener('click', () => {
  if (activePokemonItem) {
    const item = activePokemonItem;
    closePokemonCard();
    openDetail(item);
  }
});

// ===================================================
// GACHA RESULTS LISTING & FILTERING
// ===================================================
function getFilteredAndSortedGachaList() {
  let list = gachaSummonHistory.slice();

  if (activeGachaRarityFilter !== 'all') {
    list = list.filter(card => card.rarity === activeGachaRarityFilter);
  }

  const rarityWeights = { SSR: 4, SR: 3, R: 2, N: 1 };

  if (activeGachaSort === 'recent') {
    list.sort((a, b) => (b.summonedAt || 0) - (a.summonedAt || 0));
  } else if (activeGachaSort === 'oldest') {
    list.sort((a, b) => (a.summonedAt || 0) - (b.summonedAt || 0));
  } else if (activeGachaSort === 'rarity-desc') {
    list.sort((a, b) => (rarityWeights[b.rarity] || 0) - (rarityWeights[a.rarity] || 0));
  } else if (activeGachaSort === 'rarity-asc') {
    list.sort((a, b) => (rarityWeights[a.rarity] || 0) - (rarityWeights[b.rarity] || 0));
  } else if (activeGachaSort === 'author') {
    list.sort((a, b) => (a.authorName || '').localeCompare(b.authorName || ''));
  }

  return list;
}

function renderGachaResults() {
  gachaResultsGrid.innerHTML = '';
  const list = getFilteredAndSortedGachaList();

  if (!list.length) {
    gachaResultsGrid.innerHTML = `
      <div class="empty-state-notice">
        <div>${gachaSummonHistory.length ? 'No cards match the active rarity filter.' : 'Click <strong>Roll 1x</strong> or <strong>Roll 10x</strong> to summon artwork cards!'}</div>
      </div>
    `;
    return;
  }

  list.forEach(card => {
    const div = document.createElement('div');
    div.className = `gacha-card rarity-${card.rarity.toLowerCase()}`;
    div.innerHTML = `
      <div class="gacha-card-badge ${card.rarity.toLowerCase()}">${card.rarity}</div>
      <div class="gacha-card-thumb">
        <img alt="${card.authorName || 'Art'}" loading="lazy" decoding="async">
      </div>
      <div class="gacha-card-body">
        <span class="gacha-card-stars">${card.stars}</span>
        <span class="gacha-card-author" title="${card.authorName}">${card.authorName || 'Unknown'}</span>
      </div>
    `;
    const img = div.querySelector('img');
    setCachedOrRemoteSrc(img, card);
    div.addEventListener('click', () => openPokemonCard(card));
    gachaResultsGrid.appendChild(div);
  });
}

gachaSortSelect.addEventListener('change', (e) => {
  activeGachaSort = e.target.value;
  renderGachaResults();
});

gachaRarityFilterSelect.addEventListener('change', (e) => {
  activeGachaRarityFilter = e.target.value;
  renderGachaResults();
});

function saveGachaStateToStorage(notify = true) {
  localStorage.setItem('universal_gacha_unlocked', JSON.stringify(Array.from(unlockedGachaSet)));
  localStorage.setItem('universal_gacha_history', JSON.stringify(gachaSummonHistory));
  localStorage.setItem('universal_gacha_rolls', gachaTotalRolls);
  if (notify) {
    alert(`Gacha progress saved!\nTotal pulls: ${gachaTotalRolls}\nUnlocked unique cards: ${unlockedGachaSet.size}`);
  }
}

function exportGachaInventoryJSON() {
  if (!gachaSummonHistory.length) {
    return alert('No gacha rolls found to export. Roll some cards first!');
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    totalRolls: gachaTotalRolls,
    uniqueCardsUnlocked: unlockedGachaSet.size,
    inventory: gachaSummonHistory
  };
  downloadExportPayload(payload, `gacha_inventory_${Date.now()}.json`);
}

gachaExportBtn.addEventListener('click', exportGachaInventoryJSON);
exportGachaMenuBtn.addEventListener('click', () => {
  exportMenu.classList.remove('open');
  exportGachaInventoryJSON();
});
saveGachaStateBtn.addEventListener('click', () => {
  storageMenu.classList.remove('open');
  saveGachaStateToStorage(true);
});

gachaRoll1Btn.addEventListener('click', () => executeGachaSummon(1));
gachaRoll10Btn.addEventListener('click', () => executeGachaSummon(10));
gachaClearInventoryBtn.addEventListener('click', () => {
  if (confirm('Clear summon history, reset roll counters, and remove gallery glow highlights?')) {
    gachaSummonHistory = [];
    gachaTotalRolls = 0;
    unlockedGachaSet.clear();
    saveGachaStateToStorage(false);
    updateGachaStats();
    renderGachaResults();
    if (galleryView.style.display !== 'none') renderColumns();
  }
});

// ===================================================
// DELETION ENGINE
// ===================================================
function deletePost(postId, confirmPrompt = true) {
  if (confirmPrompt && !confirm('Are you sure you want to delete this post?')) return;

  allImportedPosts.delete(postId);
  currentItems = currentItems.filter(item => item.postId !== postId && item.id !== postId);
  gachaSummonHistory = gachaSummonHistory.filter(item => item.postId !== postId && item.id !== postId);
  unlockedGachaSet.delete(postId);
  saveGachaStateToStorage(false);

  updateBannerCounts();
  extractTopKeywords();
  updateFilterCounts();
  rebuildDeterministicPools();
  if (galleryView.style.display !== 'none') renderColumns();
  renderGachaResults();

  if (activeModalItem && (activeModalItem.postId === postId || activeModalItem.id === postId)) {
    closeModal();
  }
  if (activePokemonItem && (activePokemonItem.postId === postId || activePokemonItem.id === postId)) {
    closePokemonCard();
  }
}

modalDeleteBtn.addEventListener('click', () => {
  if (activeModalItem) {
    deletePost(activeModalItem.postId || activeModalItem.id);
  }
});

function updateFilterCounts() {
  if (!currentItems.length) return;
  const total = currentItems.length;

  const platformCounts = { twitter: 0, pixiv: 0, pinterest: 0, deviantart: 0 };
  currentItems.forEach(i => {
    if (platformCounts[i.platform] !== undefined) platformCounts[i.platform]++;
  });

  platformFilterSelect.options[0].textContent = `🌐 All Platforms (${total})`;
  platformFilterSelect.options[1].textContent = `🐦 Twitter (${platformCounts.twitter})`;
  platformFilterSelect.options[2].textContent = `🖌️ Pixiv (${platformCounts.pixiv})`;
  platformFilterSelect.options[3].textContent = `📌 Pinterest (${platformCounts.pinterest})`;
  platformFilterSelect.options[4].textContent = `🎨 DeviantArt (${platformCounts.deviantart})`;

  const artistMap = new Map();
  currentItems.forEach(item => {
    const key = item.authorHandle || item.authorName || 'Unknown';
    if (!artistMap.has(key)) {
      artistMap.set(key, { key, name: item.authorName || 'Unknown', handle: item.authorHandle || '', count: 0 });
    }
    artistMap.get(key).count++;
  });

  const sortedArtists = Array.from(artistMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const prevArtist = activeArtistFilter;
  artistFilterSelect.innerHTML = `<option value="all">👤 All Artists (${total})</option>`;
  sortedArtists.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.key;
    const label = a.handle ? `${a.name} (${a.handle})` : a.name;
    opt.textContent = `${label} (${a.count})`;
    artistFilterSelect.appendChild(opt);
  });
  artistFilterSelect.value = prevArtist;
  if (artistFilterSelect.value !== prevArtist) activeArtistFilter = 'all';

  const aspectCounts = { portrait: 0, landscape: 0, square: 0 };
  currentItems.forEach(i => {
    if (i.aspectFamily && aspectCounts[i.aspectFamily] !== undefined) aspectCounts[i.aspectFamily]++;
  });

  aspectFilterSelect.options[0].textContent = `📐 All Ratios (${total})`;
  aspectFilterSelect.options[1].textContent = `📱 Portrait (${aspectCounts.portrait})`;
  aspectFilterSelect.options[2].textContent = `🖥️ Landscape (${aspectCounts.landscape})`;
  aspectFilterSelect.options[3].textContent = `⏹️ Square (${aspectCounts.square})`;

  const colorCounts = { red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, pink: 0, dark: 0, light: 0 };
  let itemsWithColors = 0;
  currentItems.forEach(i => {
    if (i.colorFamily && colorCounts[i.colorFamily] !== undefined) {
      itemsWithColors++;
      colorCounts[i.colorFamily]++;
    }
  });

  const colorNames = {
    red: '🔴 Red', orange: '🟠 Orange', yellow: '🟡 Yellow', green: '🟢 Green',
    blue: '🔵 Blue', purple: '🟣 Purple', pink: '🌸 Pink', dark: '⚫ Dark', light: '⚪ Light'
  };

  colorFilterSelect.options[0].textContent = `🎨 All Colors (${itemsWithColors})`;
  for (let i = 1; i < colorFilterSelect.options.length; i++) {
    const val = colorFilterSelect.options[i].value;
    colorFilterSelect.options[i].textContent = `${colorNames[val]} (${colorCounts[val] || 0})`;
  }

  syncAllFilterDropdowns();
  updateBannerCounts();
}

let filterCountTimer;
function scheduleFilterCountUpdate() {
  clearTimeout(filterCountTimer);
  filterCountTimer = setTimeout(updateFilterCounts, 250);
}

function triggerShuffleSort() {
  currentItems.forEach(item => { item._rand = Math.random(); });
  activeSortOrder = 'shuffle';
  sortSelect.value = 'shuffle';
  syncCustomDropdown('sortSelect');
  renderColumns();
}

function getActiveFilteredList() {
  let list = currentItems.slice();

  if (activePlatformFilter !== 'all') {
    list = list.filter(item => item.platform === activePlatformFilter);
  }

  if (activeSearchQuery) {
    const q = activeSearchQuery.toLowerCase().trim();
    list = list.filter(item => {
      return (item.text && item.text.toLowerCase().includes(q)) ||
             (item.authorName && item.authorName.toLowerCase().includes(q)) ||
             (item.authorHandle && item.authorHandle.toLowerCase().includes(q));
    });
  }

  if (activeArtistFilter !== 'all') {
    list = list.filter(item => (item.authorHandle || item.authorName || 'Unknown') === activeArtistFilter);
  }

  if (activeAspectFilter !== 'all') {
    list = list.filter(item => item.aspectFamily === activeAspectFilter);
  }

  if (activeColorFilter !== 'all') {
    list = list.filter(item => item.colorFamily === activeColorFilter);
  }

  if (activeKeywordsSet.size > 0) {
    list = list.filter(item => {
      const text = (item.text || '').toLowerCase();
      if (isKeywordMatchAll) {
        for (const kw of activeKeywordsSet) {
          if (!text.includes(kw)) return false;
        }
        return true;
      } else {
        for (const kw of activeKeywordsSet) {
          if (text.includes(kw)) return true;
        }
        return false;
      }
    });
  }

  if (activeSortOrder === 'newest') {
    list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  } else if (activeSortOrder === 'oldest') {
    list.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  } else if (activeSortOrder === 'author') {
    list.sort((a, b) => (a.authorName || '').localeCompare(b.authorName || ''));
  } else if (activeSortOrder === 'shuffle') {
    list.sort((a, b) => (a._rand ?? 0) - (b._rand ?? 0));
  }

  return list;
}

let searchDebounceTimer;
gallerySearchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  activeSearchQuery = e.target.value.trim();
  clearSearchBtn.style.display = activeSearchQuery ? 'block' : 'none';
  searchDebounceTimer = setTimeout(renderColumns, 180);
});

clearSearchBtn.addEventListener('click', () => {
  gallerySearchInput.value = '';
  activeSearchQuery = '';
  clearSearchBtn.style.display = 'none';
  renderColumns();
});

platformFilterSelect.addEventListener('change', (e) => {
  activePlatformFilter = e.target.value;
  renderColumns();
});

artistFilterSelect.addEventListener('change', (e) => {
  activeArtistFilter = e.target.value;
  renderColumns();
});

aspectFilterSelect.addEventListener('change', (e) => {
  activeAspectFilter = e.target.value;
  renderColumns();
});

colorFilterSelect.addEventListener('change', (e) => {
  activeColorFilter = e.target.value;
  renderColumns();
});

sortSelect.addEventListener('change', (e) => {
  activeSortOrder = e.target.value;
  if (activeSortOrder === 'shuffle') {
    currentItems.forEach(item => { item._rand = Math.random(); });
  }
  renderColumns();
});

shuffleBtn.addEventListener('click', triggerShuffleSort);

function resetAllFilters() {
  gallerySearchInput.value = '';
  activeSearchQuery = '';
  clearSearchBtn.style.display = 'none';

  activePlatformFilter = 'all';
  platformFilterSelect.value = 'all';

  activeArtistFilter = 'all';
  artistFilterSelect.value = 'all';

  activeAspectFilter = 'all';
  aspectFilterSelect.value = 'all';

  activeColorFilter = 'all';
  colorFilterSelect.value = 'all';

  activeKeywordsSet.clear();
  renderKeywordDropdownOptions();
  updateActiveKeywordsUI();

  activeSortOrder = 'newest';
  sortSelect.value = 'newest';

  syncAllFilterDropdowns();
  renderColumns();
}

resetAllFiltersBtn.addEventListener('click', resetAllFilters);

function attachColorChipToDOM(item) {
  try {
    const selector = `[data-img-url="${CSS.escape(item.imgUrl)}"]`;
    document.querySelectorAll(selector).forEach(parent => {
      const badges = parent.querySelector('.card-top-badges');
      if (badges && !badges.querySelector('.color-chip')) {
        const chip = document.createElement('div');
        chip.className = 'color-chip';
        chip.style.backgroundColor = item.dominantColor;
        chip.title = `Dominant: ${item.colorFamily}`;
        badges.appendChild(chip);
      }
    });
  } catch (e) {}
}

function sampleColorWithProxy(rawUrl) {
  return new Promise((resolve) => {
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=16&h=16&output=jpg`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(extractDominantColor(img));
    img.onerror = () => resolve(null);
    img.src = proxyUrl;
  });
}

function sampleColorDirect(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(extractDominantColor(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function sampleColorViaBlob(rawUrl) {
  try {
    const blob = await fetchImageBlob(rawUrl);
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    const res = await sampleColorDirect(objectUrl);
    URL.revokeObjectURL(objectUrl);
    return res;
  } catch (e) { return null; }
}

async function resolveItemColor(item) {
  if (blobUrlMap.has(item.imgUrl)) {
    return await sampleColorDirect(blobUrlMap.get(item.imgUrl));
  }
  const cached = await getCachedBlob(item.imgUrl);
  if (cached) {
    const bUrl = URL.createObjectURL(cached);
    blobUrlMap.set(item.imgUrl, bUrl);
    return await sampleColorDirect(bUrl);
  }

  if (item.platform === 'twitter') {
    const thumbUrl = item.imgUrl.replace(/name=[^&]+/, 'name=small');
    let res = await sampleColorDirect(thumbUrl);
    if (!res) res = await sampleColorWithProxy(thumbUrl);
    return res;
  }

  if (item.platform === 'pixiv') {
    let thumbUrl = item.imgUrl;
    if (thumbUrl.includes('/img-master/')) {
      thumbUrl = thumbUrl
        .replace('/img-master/', '/c/250x250_80_a2/img-master/')
        .replace(/_master1200\.(jpg|png|jpeg)/, '_square1200.jpg');
    }
    let res = await sampleColorWithProxy(thumbUrl);
    if (!res) {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(thumbUrl)}`;
      res = await sampleColorDirect(proxyUrl);
    }
    if (!res) res = await sampleColorViaBlob(thumbUrl);
    return res;
  }

  if (item.platform === 'pinterest' || item.platform === 'deviantart') {
    let res = await sampleColorWithProxy(item.imgUrl);
    if (!res) {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(item.imgUrl)}`;
      res = await sampleColorDirect(proxyUrl);
    }
    if (!res) res = await sampleColorViaBlob(item.imgUrl);
    return res;
  }

  return null;
}

function resolveItemAspect(item) {
  if (item.aspectFamily) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        const ratio = img.naturalWidth / img.naturalHeight;
        item.aspectRatio = ratio;
        item.aspectFamily = ratio < 0.82 ? 'portrait' : (ratio > 1.22 ? 'landscape' : 'square');
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = item.imgUrl;
  });
}

let isBackgroundAnalyzing = false;
async function runAutoAnalysis() {
  if (isBackgroundAnalyzing || !currentItems.length) return;
  isBackgroundAnalyzing = true;

  const total = currentItems.length;
  let completed = 0;
  let nextIndex = 0;

  colorAnalysisBadge.style.display = 'inline-flex';
  colorAnalysisBadge.textContent = '🎨 0%';

  async function analyzeItem(item) {
    if (!item.colorFamily || !item.aspectFamily) {
      const storedMeta = await getCachedMeta(item.imgUrl);
      if (storedMeta) {
        item.dominantColor = storedMeta.dominantColor;
        item.colorFamily = storedMeta.colorFamily;
        item.aspectRatio = storedMeta.aspectRatio;
        item.aspectFamily = storedMeta.aspectFamily;
        attachColorChipToDOM(item);

        if (item.postId && allImportedPosts.has(item.postId)) {
          const p = allImportedPosts.get(item.postId);
          if (!p.dominantColor) {
            p.dominantColor = item.dominantColor;
            p.colorFamily = item.colorFamily;
            p.aspectRatio = item.aspectRatio;
            p.aspectFamily = item.aspectFamily;
          }
        }
        return;
      }
    }

    const tasks = [];
    if (!item.aspectFamily) tasks.push(resolveItemAspect(item));
    if (!item.colorFamily) {
      tasks.push(resolveItemColor(item).then(res => {
        if (res) {
          item.dominantColor = res.hex;
          item.colorFamily = res.family;
          attachColorChipToDOM(item);
        }
      }));
    }
    await Promise.all(tasks);

    if (item.colorFamily || item.aspectFamily) {
      saveMetaToDB(item.imgUrl, {
        dominantColor: item.dominantColor,
        colorFamily: item.colorFamily,
        aspectRatio: item.aspectRatio,
        aspectFamily: item.aspectFamily
      });

      if (item.postId && allImportedPosts.has(item.postId)) {
        const p = allImportedPosts.get(item.postId);
        if (!p.dominantColor && item.dominantColor) {
          p.dominantColor = item.dominantColor;
          p.colorFamily = item.colorFamily;
        }
        if (!p.aspectFamily && item.aspectFamily) {
          p.aspectRatio = item.aspectRatio;
          p.aspectFamily = item.aspectFamily;
        }
      }
    }
  }

  const CONCURRENCY = 6;
  async function worker() {
    while (nextIndex < total) {
      const idx = nextIndex++;
      await analyzeItem(currentItems[idx]);
      completed++;

      const pct = Math.min(100, Math.round((completed / total) * 100));
      importProgressBar.style.width = pct + '%';
      loadingStats.textContent = `${pct}% (${completed} / ${total} items)`;
      colorAnalysisBadge.textContent = `🎨 ${pct}%`;

      if (completed % 4 === 0 || completed === total) {
        scheduleFilterCountUpdate();
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  isBackgroundAnalyzing = false;
  colorAnalysisBadge.style.display = 'none';
  importProgressBar.style.width = '100%';
  loadingStats.textContent = '100% Complete!';

  setTimeout(() => importLoadingOverlay.classList.remove('active'), 350);

  updateFilterCounts();
  if (activeColorFilter !== 'all' || activeAspectFilter !== 'all') {
    renderColumns();
  }
}

// Storage Management
let isSaving = false;
saveOfflineBtn.addEventListener('click', async () => {
  storageMenu.classList.remove('open');
  if (!currentItems.length) {
    alert('Please load JSON export files first.');
    return;
  }
  if (isSaving) return;

  isSaving = true;
  saveOfflineBtn.disabled = true;
  saveProgress.style.display = 'inline-block';

  const urlsToSave = Array.from(new Set(currentItems.map(i => i.imgUrl)));
  let savedCount = 0;
  let failedCount = 0;

  const CONCURRENCY = 5;
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < urlsToSave.length) {
      const index = currentIndex++;
      const url = urlsToSave[index];

      try {
        const existing = await getCachedBlob(url);
        if (!existing) {
          const blob = await fetchImageBlob(url);
          await saveBlobToDB(url, blob);
          const objectUrl = URL.createObjectURL(blob);
          blobUrlMap.set(url, objectUrl);
          applyBlobToActiveImages(url, objectUrl);
        } else if (!blobUrlMap.has(url)) {
          const objectUrl = URL.createObjectURL(existing);
          blobUrlMap.set(url, objectUrl);
          applyBlobToActiveImages(url, objectUrl);
        }
        savedCount++;
      } catch (e) {
        failedCount++;
      }

      saveProgress.textContent = `Saving: ${savedCount + failedCount} / ${urlsToSave.length}`;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  saveProgress.textContent = failedCount > 0 
    ? `Saved ${savedCount} images (${failedCount} blocked)`
    : `All ${savedCount} images saved!`;

  saveOfflineBtn.disabled = false;
  isSaving = false;

  setTimeout(() => { saveProgress.style.display = 'none'; }, 4000);
});

function applyBlobToActiveImages(originalUrl, objectUrl) {
  try {
    const selector = `[data-img-url="${CSS.escape(originalUrl)}"] img`;
    document.querySelectorAll(selector).forEach(img => {
      img.src = objectUrl;
    });
  } catch (e) {}
}

clearCacheBtn.addEventListener('click', async () => {
  storageMenu.classList.remove('open');
  if (confirm('Delete all locally cached images & color metadata from browser storage?')) {
    await clearAllIndexedDB();
    blobUrlMap.clear();
    alert('Image & Color metadata cache cleared.');
    renderColumns();
  }
});

function formatPostForTemplateExport(post) {
  const entry = {
    authorHandle: post.authorHandle || "",
    authorName: post.authorName || "Unknown",
    id: String(post.id || ""),
    isArticle: Boolean(post.isArticle),
    linkCard: post.linkCard ?? null,
    mediaUrl: post.mediaUrl || (post.mediaUrls && post.mediaUrls[0]) || "",
    mediaUrls: Array.isArray(post.mediaUrls) && post.mediaUrls.length 
      ? post.mediaUrls 
      : (post.mediaUrl ? [post.mediaUrl] : []),
    fallbackUrl: post.fallbackUrl ?? null,
    quotedTweet: post.quotedTweet ?? null,
    scrapedAt: post.scrapedAt || new Date().toISOString(),
    text: post.text || "",
    timestamp: post.timestamp || post.scrapedAt || new Date().toISOString(),
    url: post.url || "#",
    videoPoster: post.videoPoster ?? null
  };

  if (post.dominantColor) {
    entry.dominantColor = post.dominantColor;
    entry.colorFamily = post.colorFamily;
  }
  if (post.aspectRatio) {
    entry.aspectRatio = post.aspectRatio;
    entry.aspectFamily = post.aspectFamily;
  }

  return entry;
}

function downloadExportPayload(data, filename) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

function executePostsExport(postsToExport, prefix) {
  exportMenu.classList.remove('open');
  if (!postsToExport || postsToExport.length === 0) {
    alert('No posts available to export. Please import some JSON files first.');
    return;
  }
  const formattedTweets = postsToExport.map(formatPostForTemplateExport);
  downloadExportPayload({ tweets: formattedTweets }, `${prefix}_${Date.now()}.json`);
}

exportAllBtn.addEventListener('click', () => {
  const allPosts = Array.from(allImportedPosts.values());
  executePostsExport(allPosts, 'combined_social_posts');
});

exportFilteredBtn.addEventListener('click', () => {
  const activeList = getActiveFilteredList();
  const uniquePostIds = new Set(activeList.map(i => i.postId || i.id));
  const filteredPosts = [];

  allImportedPosts.forEach((post, id) => {
    if (uniquePostIds.has(id)) filteredPosts.push(post);
  });

  executePostsExport(
    filteredPosts.length ? filteredPosts : Array.from(allImportedPosts.values()),
    'filtered_social_posts'
  );
});

// ==========================================
// MULTI-FILE INGESTION & PIPELINE
// ==========================================
function getHighResTwitterUrl(url) {
  if (!url) return '';
  return url.replace(/name=[^&]+/, 'name=large');
}

function isQuotedUrl(url) {
  return url.includes('name=120x120');
}

function processIncomingItems(items) {
  const existingCardIds = new Set(currentItems.map(i => i.id));
  let added = 0;

  items.forEach(raw => {
    const platform = detectPlatform(raw);
    const canonicalId = String(raw.id || (platform + '_' + Math.random().toString(36).slice(2)));
    const rarityMeta = getDeterministicRarity(canonicalId);

    if (platform === 'twitter') {
      const rawUrls = raw.mediaUrls?.length ? raw.mediaUrls : (raw.mediaUrl ? [raw.mediaUrl] : []);
      const primaryUrls = rawUrls.filter(u => !isQuotedUrl(u));
      const quotedUrls = rawUrls.filter(u => isQuotedUrl(u));

      if (raw.quotedTweet) {
        const qMedia = raw.quotedTweet.mediaUrls || (raw.quotedTweet.mediaUrl ? [raw.quotedTweet.mediaUrl] : []);
        qMedia.forEach(u => { if (!quotedUrls.includes(u)) quotedUrls.push(u); });
      }

      const displayUrls = (primaryUrls.length > 0 ? primaryUrls : quotedUrls).map(getHighResTwitterUrl);

      if (!allImportedPosts.has(canonicalId)) {
        allImportedPosts.set(canonicalId, {
          id: canonicalId,
          platform: 'twitter',
          authorHandle: raw.authorHandle || '',
          authorName: raw.authorName || 'Unknown',
          text: raw.text || '',
          timestamp: raw.timestamp || raw.scrapedAt || '',
          scrapedAt: raw.scrapedAt || new Date().toISOString(),
          url: raw.url || '#',
          isArticle: Boolean(raw.isArticle),
          linkCard: raw.linkCard || null,
          quotedTweet: raw.quotedTweet || null,
          videoPoster: raw.videoPoster || null,
          fallbackUrl: null,
          mediaUrl: displayUrls[0] || raw.mediaUrl || '',
          mediaUrls: displayUrls,
          dominantColor: raw.dominantColor || null,
          colorFamily: raw.colorFamily || null,
          aspectRatio: raw.aspectRatio || null,
          aspectFamily: raw.aspectFamily || null,
          gachaRarity: rarityMeta.tier,
          gachaStars: rarityMeta.stars
        });
      }

      displayUrls.forEach((rawUrl, pageIdx) => {
        const itemId = canonicalId + '_' + rawUrl.split('/').pop().split('?')[0];
        if (!existingCardIds.has(itemId)) {
          existingCardIds.add(itemId);
          currentItems.push({
            id: itemId,
            postId: canonicalId,
            platform: 'twitter',
            imgUrl: rawUrl,
            fallbackUrl: rawUrl,
            authorName: raw.authorName || 'Unknown',
            authorHandle: raw.authorHandle || '',
            text: raw.text || '',
            timestamp: raw.timestamp || raw.scrapedAt || '',
            url: raw.url || '#',
            allMedia: displayUrls,
            pageIndex: pageIdx,
            totalPages: displayUrls.length,
            dominantColor: raw.dominantColor || null,
            colorFamily: raw.colorFamily || null,
            aspectRatio: raw.aspectRatio || null,
            aspectFamily: raw.aspectFamily || null,
            gachaRarity: rarityMeta.tier,
            gachaStars: rarityMeta.stars,
            _rand: Math.random()
          });
          added++;
        }
      });
    } else if (platform === 'pixiv') {
      let rawList = raw.mediaUrls && raw.mediaUrls.length > 0 ? raw.mediaUrls : (raw.mediaUrl ? [raw.mediaUrl] : []);
      const sanitizedList = rawList.map(sanitizePixivUrl);

      if (!allImportedPosts.has(canonicalId)) {
        allImportedPosts.set(canonicalId, {
          id: canonicalId,
          platform: 'pixiv',
          authorHandle: raw.authorHandle || '',
          authorName: raw.authorName || 'Unknown',
          text: raw.text || '',
          timestamp: raw.timestamp || raw.scrapedAt || '',
          scrapedAt: raw.scrapedAt || new Date().toISOString(),
          url: raw.url || '#',
          isArticle: Boolean(raw.isArticle),
          linkCard: raw.linkCard || null,
          quotedTweet: raw.quotedTweet || null,
          videoPoster: raw.videoPoster || null,
          fallbackUrl: null,
          mediaUrl: sanitizedList[0] || raw.mediaUrl || '',
          mediaUrls: sanitizedList,
          dominantColor: raw.dominantColor || null,
          colorFamily: raw.colorFamily || null,
          aspectRatio: raw.aspectRatio || null,
          aspectFamily: raw.aspectFamily || null,
          gachaRarity: rarityMeta.tier,
          gachaStars: rarityMeta.stars
        });
      }

      sanitizedList.forEach((mediaUrl, pageIdx) => {
        const pageId = sanitizedList.length > 1 ? `${canonicalId}_p${pageIdx}` : canonicalId;

        if (!existingCardIds.has(pageId)) {
          existingCardIds.add(pageId);
          currentItems.push({
            id: pageId,
            postId: canonicalId,
            platform: 'pixiv',
            imgUrl: mediaUrl,
            fallbackUrl: rawList[pageIdx] ? sanitizePixivUrl(rawList[pageIdx]) : mediaUrl,
            authorName: raw.authorName || 'Unknown',
            authorHandle: raw.authorHandle || '',
            text: raw.text || '',
            timestamp: raw.timestamp || raw.scrapedAt || '',
            url: raw.url || '#',
            allMedia: sanitizedList,
            pageIndex: pageIdx,
            totalPages: sanitizedList.length,
            dominantColor: raw.dominantColor || null,
            colorFamily: raw.colorFamily || null,
            aspectRatio: raw.aspectRatio || null,
            aspectFamily: raw.aspectFamily || null,
            gachaRarity: rarityMeta.tier,
            gachaStars: rarityMeta.stars,
            _rand: Math.random()
          });
          added++;
        }
      });
    } else if (platform === 'deviantart') {
      let rawList = [];

      if (Array.isArray(raw.images) && raw.images.length > 0) {
        rawList = raw.images.map(img => {
          const u = typeof img === 'string' ? img : (img.url || img.fallback_url || '');
          return optimizeWixmpUrl(u);
        }).filter(Boolean);
      } else if (raw.mediaUrls && raw.mediaUrls.length > 0) {
        rawList = raw.mediaUrls.map(optimizeWixmpUrl).filter(Boolean);
      } else if (raw.mediaUrl) {
        rawList = [optimizeWixmpUrl(raw.mediaUrl)].filter(Boolean);
      }

      const mainMedia = rawList[0] || '';
      let artistName = raw.author || raw.authorName || '';
      const urlAuthorMatch = raw.url && raw.url.match(/deviantart\.com\/([^\/]+)\/art\//i);
      if (urlAuthorMatch && (!artistName || artistName.toLowerCase() === 'aizawaa07')) {
        artistName = urlAuthorMatch[1];
      }
      if (!artistName) artistName = 'DeviantArt Artist';

      const cleanAuthor = artistName.replace(/^@/, '');
      const authorHandle = `@${cleanAuthor}`;
      const titleText = raw.title || raw.text || '';
      const timestamp = raw.published_time || raw.timestamp || raw.scrapedAt || '';

      if (!allImportedPosts.has(canonicalId)) {
        allImportedPosts.set(canonicalId, {
          id: canonicalId,
          platform: 'deviantart',
          authorHandle: authorHandle,
          authorName: cleanAuthor,
          text: titleText,
          timestamp: timestamp,
          scrapedAt: raw.scrapedAt || new Date().toISOString(),
          url: raw.url || '#',
          isArticle: Boolean(raw.isArticle),
          linkCard: raw.linkCard || null,
          quotedTweet: raw.quotedTweet || null,
          videoPoster: raw.videoPoster || null,
          fallbackUrl: raw.fallbackUrl ? optimizeWixmpUrl(raw.fallbackUrl) : mainMedia,
          mediaUrl: mainMedia,
          mediaUrls: rawList.length ? rawList : (mainMedia ? [mainMedia] : []),
          dominantColor: raw.dominantColor || null,
          colorFamily: raw.colorFamily || null,
          aspectRatio: raw.aspectRatio || null,
          aspectFamily: raw.aspectFamily || null,
          gachaRarity: rarityMeta.tier,
          gachaStars: rarityMeta.stars
        });
      }

      rawList.forEach((mediaUrl, pageIdx) => {
        const pageId = rawList.length > 1 ? `${canonicalId}_p${pageIdx}` : canonicalId;
        if (!existingCardIds.has(pageId)) {
          existingCardIds.add(pageId);
          currentItems.push({
            id: pageId,
            postId: canonicalId,
            platform: 'deviantart',
            imgUrl: mediaUrl,
            fallbackUrl: raw.fallbackUrl ? optimizeWixmpUrl(raw.fallbackUrl) : mediaUrl,
            authorName: cleanAuthor,
            authorHandle: authorHandle,
            text: titleText,
            timestamp: timestamp,
            url: raw.url || '#',
            allMedia: rawList,
            pageIndex: pageIdx,
            totalPages: rawList.length,
            dominantColor: raw.dominantColor || null,
            colorFamily: raw.colorFamily || null,
            aspectRatio: raw.aspectRatio || null,
            aspectFamily: raw.aspectFamily || null,
            gachaRarity: rarityMeta.tier,
            gachaStars: rarityMeta.stars,
            _rand: Math.random()
          });
          added++;
        }
      });
    } else if (platform === 'pinterest') {
      let rawList = raw.mediaUrls && raw.mediaUrls.length > 0 ? raw.mediaUrls : (raw.mediaUrl ? [raw.mediaUrl] : []);

      const cleanText = (raw.text || '')
        .replace(/^Mục này có hình ảnh của:\s*/i, '')
        .replace(/^Có thể là hình ảnh về:\s*/i, '')
        .replace(/^Hình ảnh có thể có:\s*/i, '')
        .replace(/^May be an image of:\s*/i, '')
        .replace(/^Image may contain:\s*/i, '')
        .replace(/^Photo by\s+/i, '')
        .trim();

      const mainMedia = rawList[0] || raw.mediaUrl || '';
      const fallback = raw.fallbackUrl || (mainMedia ? mainMedia.replace('/originals/', '/736x/').replace('/736x/', '/236x/') : mainMedia);

      if (!allImportedPosts.has(canonicalId)) {
        allImportedPosts.set(canonicalId, {
          id: canonicalId,
          platform: 'pinterest',
          authorHandle: raw.authorHandle || '@pinterest',
          authorName: raw.authorName || 'Pinterest Creator',
          text: cleanText,
          timestamp: raw.timestamp || raw.scrapedAt || '',
          scrapedAt: raw.scrapedAt || new Date().toISOString(),
          url: raw.url || '#',
          isArticle: Boolean(raw.isArticle),
          linkCard: raw.linkCard || null,
          quotedTweet: raw.quotedTweet || null,
          videoPoster: raw.videoPoster || null,
          fallbackUrl: fallback,
          mediaUrl: mainMedia,
          mediaUrls: rawList.length ? rawList : (mainMedia ? [mainMedia] : []),
          dominantColor: raw.dominantColor || null,
          colorFamily: raw.colorFamily || null,
          aspectRatio: raw.aspectRatio || null,
          aspectFamily: raw.aspectFamily || null,
          gachaRarity: rarityMeta.tier,
          gachaStars: rarityMeta.stars
        });
      }

      if (!existingCardIds.has(canonicalId)) {
        existingCardIds.add(canonicalId);
        currentItems.push({
          id: canonicalId,
          postId: canonicalId,
          platform: 'pinterest',
          imgUrl: mainMedia,
          fallbackUrl: fallback,
          authorName: raw.authorName || 'Pinterest Creator',
          authorHandle: raw.authorHandle || '@pinterest',
          text: cleanText,
          timestamp: raw.timestamp || raw.scrapedAt || '',
          url: raw.url || '#',
          allMedia: rawList.length ? rawList : [mainMedia],
          pageIndex: 0,
          totalPages: Math.max(rawList.length, 1),
          dominantColor: raw.dominantColor || null,
          colorFamily: raw.colorFamily || null,
          aspectRatio: raw.aspectRatio || null,
          aspectFamily: raw.aspectFamily || null,
          gachaRarity: rarityMeta.tier,
          gachaStars: rarityMeta.stars,
          _rand: Math.random()
        });
        added++;
      }
    }
  });

  dropzone.style.display = 'none';
  gallerySubBar.style.display = 'flex';
  extractTopKeywords();
  updateBannerCounts();
  rebuildDeterministicPools();
  if (galleryView.style.display !== 'none') renderColumns();
  runAutoAnalysis();
}

async function handleMultipleFiles(files) {
  if (!files || !files.length) return;

  importLoadingOverlay.classList.add('active');
  loadingTitle.textContent = 'Importing Artworks';
  loadingSubtext.textContent = 'Reading and compiling JSON data...';
  importProgressBar.style.width = '10%';
  loadingStats.textContent = 'Reading files...';

  const fileList = Array.from(files);
  const readPromises = fileList.map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const list = Array.isArray(data) 
            ? data 
            : (data.tweets || data.bookmarks || data.pins || data.items || data.deviations || data.favorites || []);
          resolve(list);
        } catch {
          alert(`Could not parse JSON in ${file.name}`);
          resolve([]);
        }
      };
      reader.onerror = () => resolve([]);
      reader.readAsText(file);
    });
  });

  const allResults = await Promise.all(readPromises);
  const combined = allResults.flat();

  if (combined.length === 0) {
    importLoadingOverlay.classList.remove('active');
    return;
  }

  loadingTitle.textContent = `Analyzing ${combined.length} Items`;
  loadingSubtext.textContent = 'Calculating aspect ratios and extracting color palettes...';
  importProgressBar.style.width = '20%';
  loadingStats.textContent = 'Initializing...';

  processIncomingItems(combined);
}

fileInput.addEventListener('change', (e) => handleMultipleFiles(e.target.files));
['dragenter', 'dragover'].forEach(name => {
  dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.add('active'); });
});
['dragleave', 'drop'].forEach(name => {
  dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.remove('active'); });
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('active');
  handleMultipleFiles(e.dataTransfer.files);
});
dropzone.addEventListener('click', () => fileInput.click());

// ==========================================
// RENDERING PIPELINE WITH ACCURATE COLUMNS
// ==========================================
function renderColumns() {
  if (galleryView.style.display === 'none' || gallery.clientWidth === 0) return;

  const itemsToRender = getActiveFilteredList();
  currentRenderCycle++;
  const thisCycle = currentRenderCycle;
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
  isBatchRendering = false;

  resetLoadedCounter(itemsToRender.length);
  gallery.innerHTML = '';
  renderedCount = 0;

  colCountLabel.textContent = `${galleryColCount} col${galleryColCount > 1 ? 's' : ''}`;

  if (!itemsToRender.length) {
    if (currentItems.length > 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state-notice';
      emptyDiv.innerHTML = `
        <div>No items match your active filters.</div>
        <button class="filter-action-btn" onclick="resetAllFilters()" style="color: var(--accent);">Reset All Filters</button>
      `;
      gallery.appendChild(emptyDiv);
    }
    return;
  }

  const maxPossibleCols = Math.max(1, Math.floor(gallery.clientWidth / 140));
  const actualCols = Math.min(galleryColCount, maxPossibleCols);

  for (let i = 0; i < actualCols; i++) {
    const col = document.createElement('div');
    col.className = 'gallery-column';
    gallery.appendChild(col);
  }

  appendNextBatch(thisCycle);
}

function appendNextBatch(cycle) {
  if (cycle !== currentRenderCycle) return;
  const itemsToRender = getActiveFilteredList();
  if (renderedCount >= itemsToRender.length || isBatchRendering) return;
  isBatchRendering = true;

  const cols = gallery.querySelectorAll('.gallery-column');
  if (!cols.length) {
    isBatchRendering = false;
    return;
  }

  const numCols = cols.length;
  const fragments = Array.from({ length: numCols }, () => document.createDocumentFragment());
  const nextSlice = itemsToRender.slice(renderedCount, renderedCount + BATCH_SIZE);

  nextSlice.forEach((item, index) => {
    const element = currentViewMode === 'posts' 
      ? createPostCard(item, cycle) 
      : createMediaCard(item, cycle);

    fragments[(renderedCount + index) % numCols].appendChild(element);
  });

  cols.forEach((col, i) => col.appendChild(fragments[i]));
  renderedCount += nextSlice.length;
  isBatchRendering = false;

  if (renderedCount < itemsToRender.length) {
    batchTimeout = setTimeout(() => appendNextBatch(cycle), 30);
  }
}

function setCachedOrRemoteSrc(imgElement, item) {
  imgElement.dataset.errAttempt = '0';

  if (blobUrlMap.has(item.imgUrl)) {
    imgElement.crossOrigin = 'anonymous';
    imgElement.src = blobUrlMap.get(item.imgUrl);
  } else {
    if (item.platform === 'twitter') {
      imgElement.crossOrigin = 'anonymous';
    } else {
      imgElement.removeAttribute('crossorigin');
    }

    getCachedBlob(item.imgUrl).then(blob => {
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        blobUrlMap.set(item.imgUrl, objectUrl);
        imgElement.crossOrigin = 'anonymous';
        imgElement.src = objectUrl;
      } else {
        imgElement.src = item.imgUrl;
        imgElement.onerror = () => {
          let attempt = parseInt(imgElement.dataset.errAttempt || '0') + 1;
          imgElement.dataset.errAttempt = String(attempt);

          if (item.platform === 'pinterest' && imgElement.src.includes('/originals/')) {
            imgElement.src = imgElement.src.replace('/originals/', '/736x/');
            return;
          }

          if (attempt === 1 && item.platform === 'pixiv') {
            if (imgElement.src.includes('.jpg')) {
              imgElement.src = imgElement.src.replace(/\.jpg(\?|$)/, '.png$1');
              return;
            }
            if (imgElement.src.includes('.png')) {
              imgElement.src = imgElement.src.replace(/\.png(\?|$)/, '.jpg$1');
              return;
            }
          }

          if (attempt <= 2 && imgElement.src.includes('custom-thumb')) {
            imgElement.src = imgElement.src.replace('/custom-thumb/', '/img-master/');
            return;
          }

          if (attempt <= 3 && item.fallbackUrl && imgElement.src !== item.fallbackUrl) {
            imgElement.src = item.fallbackUrl;
          }
        };
      }
    });
  }

  imgElement.addEventListener('load', () => {
    let updated = false;

    if (!item.aspectFamily && imgElement.naturalWidth && imgElement.naturalHeight) {
      const ratio = imgElement.naturalWidth / imgElement.naturalHeight;
      item.aspectRatio = ratio;
      item.aspectFamily = ratio < 0.82 ? 'portrait' : (ratio > 1.22 ? 'landscape' : 'square');
      updated = true;
    }

    if (!item.colorFamily && (item.platform === 'twitter' || blobUrlMap.has(item.imgUrl))) {
      try {
        const detected = extractDominantColor(imgElement);
        if (detected) {
          item.dominantColor = detected.hex;
          item.colorFamily = detected.family;
          attachColorChipToDOM(item);
          saveMetaToDB(item.imgUrl, {
            dominantColor: item.dominantColor,
            colorFamily: item.colorFamily,
            aspectRatio: item.aspectRatio,
            aspectFamily: item.aspectFamily
          });

          if (item.postId && allImportedPosts.has(item.postId)) {
            const p = allImportedPosts.get(item.postId);
            if (!p.dominantColor) {
              p.dominantColor = item.dominantColor;
              p.colorFamily = item.colorFamily;
            }
          }
          updated = true;
        }
      } catch (e) {}
    }

    if (updated) scheduleFilterCountUpdate();
  }, { once: true });
}

function createMediaCard(item, cycle) {
  const div = document.createElement('div');
  const isRevealed = unlockedGachaSet.has(item.postId) || unlockedGachaSet.has(item.id);
  const tier = item.gachaRarity || 'N';

  div.className = 'media-item' + (isRevealed ? ` gacha-revealed-${tier.toLowerCase()}` : '');
  div.dataset.imgUrl = item.imgUrl;
  div.dataset.postId = item.postId || item.id;

  const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;
  div.innerHTML = `
    <div class="card-top-badges">
      ${isRevealed ? `<span class="card-rarity-pill ${tier.toLowerCase()}">${tier}</span>` : ''}
      ${item.totalPages > 1 ? `<span class="page-pill">📄 ${item.pageIndex + 1}/${item.totalPages}</span>` : ''}
      ${item.dominantColor ? `<div class="color-chip" style="background:${item.dominantColor}" title="Dominant: ${item.colorFamily}"></div>` : ''}
    </div>
    <button class="card-delete-btn" title="Delete post">🗑️</button>
    <div class="platform-dot ${item.platform}" title="${pInfo.name}">${pInfo.letter}</div>
  `;

  const delBtn = div.querySelector('.card-delete-btn');
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePost(item.postId || item.id);
  });

  const img = document.createElement('img');
  img.decoding = 'async';
  img.loading = 'eager';
  trackImageLoad(img, cycle);
  setCachedOrRemoteSrc(img, item);

  div.appendChild(img);
  div.addEventListener('click', () => openDetail(item));
  return div;
}

function createPostCard(item, cycle) {
  const card = document.createElement('div');
  const isRevealed = unlockedGachaSet.has(item.postId) || unlockedGachaSet.has(item.id);
  const tier = item.gachaRarity || 'N';

  card.className = 'post-card' + (isRevealed ? ` gacha-revealed-${tier.toLowerCase()}` : '');
  card.dataset.imgUrl = item.imgUrl;
  card.dataset.postId = item.postId || item.id;

  const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;
  const initial = (item.authorName || item.authorHandle || '?').charAt(0).toUpperCase();
  const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  }) : '';

  const profileUrl = getAuthorProfileUrl(item.platform, item.authorHandle, item);

  card.innerHTML = `
    <div class="card-top-badges">
      ${isRevealed ? `<span class="card-rarity-pill ${tier.toLowerCase()}">${tier}</span>` : ''}
      ${item.totalPages > 1 ? `<span class="page-pill">📄 ${item.pageIndex + 1}/${item.totalPages}</span>` : ''}
      ${item.dominantColor ? `<div class="color-chip" style="background:${item.dominantColor}" title="Dominant: ${item.colorFamily}"></div>` : ''}
    </div>

    <div class="post-header">
      <div class="post-avatar">${initial}</div>
      <div class="post-author-block">
        <div class="post-author-name" title="${item.authorName}">${item.authorName}</div>
        <a href="${profileUrl}" target="_blank" class="post-author-handle">${item.authorHandle}</a>
      </div>
    </div>

    ${item.text ? `<div class="post-body-text">${item.text}</div>` : ''}

    <div class="post-media-wrap">
      <img decoding="async" loading="eager" alt="Artwork">
      <button class="card-delete-btn" title="Delete post">🗑️</button>
      <div class="platform-dot ${item.platform}" title="${pInfo.name}">${pInfo.letter}</div>
    </div>

    <div class="post-footer">
      <span>${dateStr}</span>
      <a href="${item.url}" target="_blank">View on ${pInfo.name} &rarr;</a>
    </div>
  `;

  const delBtn = card.querySelector('.card-delete-btn');
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePost(item.postId || item.id);
  });

  const img = card.querySelector('.post-media-wrap img');
  trackImageLoad(img, cycle);
  setCachedOrRemoteSrc(img, item);

  card.querySelector('.post-media-wrap').addEventListener('click', () => openDetail(item));
  return card;
}

function openDetail(item) {
  activeModalItem = item;
  setCachedOrRemoteSrc(modalImg, item);

  const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;

  if (item.totalPages > 1) {
    modalPagePill.style.display = 'inline-flex';
    modalPagePill.textContent = `Page ${item.pageIndex + 1} of ${item.totalPages}`;
  } else {
    modalPagePill.style.display = 'none';
  }

  document.getElementById('modalAuthor').textContent = item.authorName;
  const handleEl = document.getElementById('modalHandle');
  handleEl.textContent = item.authorHandle;
  handleEl.href = getAuthorProfileUrl(item.platform, item.authorHandle, item);

  document.getElementById('modalText').textContent = item.text || '(No text)';
  const dateEl = document.getElementById('modalDate');
  dateEl.textContent = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
  
  const linkEl = document.getElementById('modalLink');
  linkEl.href = item.url;
  linkEl.innerHTML = `View on ${pInfo.name} &rarr;`;

  if (item.allMedia && item.allMedia.length > 1) {
    multiMediaWrap.style.display = 'block';
    postThumbs.innerHTML = '';
    item.allMedia.forEach((mUrl, idx) => {
      const btn = document.createElement('button');
      btn.className = `thumb-btn ${mUrl === item.imgUrl ? 'active' : ''}`;
      btn.title = `Page ${idx + 1}`;
      const tImg = document.createElement('img');
      tImg.loading = 'lazy';
      tImg.decoding = 'async';
      setCachedOrRemoteSrc(tImg, { imgUrl: mUrl, fallbackUrl: mUrl, platform: item.platform });
      btn.appendChild(tImg);

      btn.onclick = () => {
        setCachedOrRemoteSrc(modalImg, { imgUrl: mUrl, fallbackUrl: mUrl, platform: item.platform });
        postThumbs.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modalPagePill.textContent = `Page ${idx + 1} of ${item.allMedia.length}`;
      };
      postThumbs.appendChild(btn);
    });
  } else {
    multiMediaWrap.style.display = 'none';
  }

  modal.classList.add('open');
}

function closeModal() { modal.classList.remove('open'); }
modal.addEventListener('click', closeModal);
closeBtn.addEventListener('click', closeModal);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (pokemonModal.classList.contains('open')) closePokemonCard();
    else closeModal();
  }
});

viewPostsBtn.addEventListener('click', () => {
  if (currentViewMode === 'posts') return;
  currentViewMode = 'posts';
  viewPostsBtn.classList.add('active');
  viewMediaBtn.classList.remove('active');
  renderColumns();
});

viewMediaBtn.addEventListener('click', () => {
  if (currentViewMode === 'media') return;
  currentViewMode = 'media';
  viewMediaBtn.classList.add('active');
  viewPostsBtn.classList.remove('active');
  renderColumns();
});

let lastClientWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (galleryView.style.display !== 'none' && window.innerWidth !== lastClientWidth) {
      lastClientWidth = window.innerWidth;
      renderColumns();
    }
  }, 150);
});

initCustomDropdowns();
