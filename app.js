    // ===================================================
    // ASYNC PRELOADER ENGINE
    // ===================================================
    const preloadedImageCache = new Map();
    let isPreloadActive = false;

    async function preloadAllCardImages(items = []) {
      if (!items || !items.length) return;

      const queue = [...items];
      const CONCURRENCY = 6;

      async function preloadWorker() {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || !item.imgUrl || preloadedImageCache.has(item.imgUrl)) continue;

          try {
            const cached = await getCachedBlob(item.imgUrl);
            if (cached) {
              const objUrl = URL.createObjectURL(cached);
              blobUrlMap.set(item.imgUrl, objUrl);
              preloadedImageCache.set(item.imgUrl, objUrl);
            } else {
              const img = new Image();
              if (item.platform === 'twitter') img.crossOrigin = 'anonymous';
              img.decoding = 'async';
              img.src = item.imgUrl;
              await new Promise(r => {
                img.onload = r;
                img.onerror = r;
              });
              preloadedImageCache.set(item.imgUrl, item.imgUrl);
            }
          } catch (e) {}
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, () => preloadWorker()));
    }

    // ===================================================
    // RULE34 & BOORU HIGH-DEFINITION RESOLVER ENGINE
    // ===================================================
    function generateHdCandidates(item) {
      const candidates = [];
      const primaryUrl = item.imgUrl || item.mediaUrl || '';
      const fallbackUrl = item.fallbackUrl || item.videoPoster || '';
      const id = String(item.id || item.postId || '').toLowerCase();
      const combined = `${primaryUrl} ${fallbackUrl}`;

      // 1. Rule 34 HD Resolution Ladder
      if (id.startsWith('rule34') || combined.includes('rule34.xxx')) {
        const match = combined.match(/(?:thumbnails|images|samples)\/(\d+)\/(?:thumbnail_|sample_)?([a-f0-9]{32})/i);
        if (match) {
          const dir = match[1];
          const hash = match[2];

          // Priority 1: Full-res original files on CDN (.jpeg & .png)
          candidates.push(`https://wimg.rule34.xxx/images/${dir}/${hash}.jpeg`);
          candidates.push(`https://api-cdn.rule34.xxx/images/${dir}/${hash}.jpeg`);
          candidates.push(`https://us.rule34.xxx/images/${dir}/${hash}.jpeg`);
          candidates.push(`https://rule34.xxx/images/${dir}/${hash}.jpeg`);

          candidates.push(`https://wimg.rule34.xxx/images/${dir}/${hash}.png`);
          candidates.push(`https://api-cdn.rule34.xxx/images/${dir}/${hash}.png`);
          candidates.push(`https://us.rule34.xxx/images/${dir}/${hash}.png`);
          candidates.push(`https://rule34.xxx/images/${dir}/${hash}.png`);

          // Priority 2: High-Resolution Sample previews
          candidates.push(`https://rule34.xxx/samples/${dir}/sample_${hash}.jpg`);
          candidates.push(`https://wimg.rule34.xxx/samples/${dir}/sample_${hash}.jpg`);
          candidates.push(`https://api-cdn.rule34.xxx/samples/${dir}/sample_${hash}.jpg`);
          candidates.push(`https://us.rule34.xxx/samples/${dir}/sample_${hash}.jpg`);

          // Priority 3: Standard .jpg fallbacks
          candidates.push(`https://wimg.rule34.xxx/images/${dir}/${hash}.jpg`);
          candidates.push(`https://api-cdn.rule34.xxx/images/${dir}/${hash}.jpg`);
          candidates.push(`https://rule34.xxx/images/${dir}/${hash}.jpg`);

          if (item.isVideo || combined.includes('.mp4') || combined.includes('.webm')) {
            candidates.unshift(`https://wimg.rule34.xxx/images/${dir}/${hash}.mp4`);
            candidates.unshift(`https://rule34.xxx/images/${dir}/${hash}.mp4`);
            candidates.unshift(`https://wimg.rule34.xxx/images/${dir}/${hash}.webm`);
          }
        }
      }

      // 2. Safebooru HD Resolution Ladder
      if (id.startsWith('safebooru') || combined.includes('safebooru.org')) {
        const match = combined.match(/(?:thumbnails|images|samples)\/(\d+)\/(?:thumbnail_|sample_)?([a-f0-9]{32})/i);
        if (match) {
          const dir = match[1];
          const hash = match[2];
          candidates.push(`https://safebooru.org/images/${dir}/${hash}.jpeg`);
          candidates.push(`https://safebooru.org/images/${dir}/${hash}.png`);
          candidates.push(`https://safebooru.org/images/${dir}/${hash}.jpg`);
          candidates.push(`https://safebooru.org/samples/${dir}/sample_${hash}.jpg`);
        }
      }

      if (primaryUrl && !candidates.includes(primaryUrl)) candidates.push(primaryUrl);
      if (fallbackUrl && !candidates.includes(fallbackUrl)) candidates.push(fallbackUrl);

      return Array.from(new Set(candidates.filter(Boolean)));
    }

    function probeImageCandidate(url, timeoutMs = 3800) {
      return new Promise((resolve, reject) => {
        if (!url) return reject(new Error("No candidate URL"));
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        let isSettled = false;

        const timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            img.src = "";
            reject(new Error("Probe timeout"));
          }
        }, timeoutMs);

        img.onload = () => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolve({
              url: url,
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0
            });
          }
        };

        img.onerror = () => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            reject(new Error("Candidate load 404 or blocked"));
          }
        };

        img.src = url;
      });
    }

    async function resolvePostHdQuality(item) {
      if (item._hdResolved && item.imgUrl && !item.imgUrl.includes('/thumbnails/') && !item.imgUrl.includes('/thumbnail_')) {
        return item.imgUrl;
      }

      const candidates = generateHdCandidates(item);
      if (!candidates.length) return item.imgUrl || item.fallbackUrl;

      for (const candUrl of candidates) {
        try {
          const res = await probeImageCandidate(candUrl, 3200);
          if (res && res.width > 0) {
            item.imgUrl = res.url;
            item._hdResolved = true;
            item._width = res.width;
            item._height = res.height;

            if (res.width && res.height) {
              const ratio = res.width / res.height;
              item.aspectRatio = ratio;
              item.aspectFamily = ratio < 0.82 ? 'portrait' : (ratio > 1.22 ? 'landscape' : 'square');
            }

            if (res.width >= 800 || res.height >= 800) {
              break;
            }
          }
        } catch (e) {}
      }

      if (!item.imgUrl) {
        item.imgUrl = item.fallbackUrl || candidates[0];
      }

      return item.imgUrl;
    }

    async function ensureCardImageReady(card) {
      if (!card) return Promise.resolve('');

      if (!card._hdResolved && (card.platform === 'rule34' || card.platform === 'safebooru')) {
        await resolvePostHdQuality(card);
      }

      if (!card.imgUrl) return Promise.resolve('');
      
      if (blobUrlMap.has(card.imgUrl)) {
        return Promise.resolve(blobUrlMap.get(card.imgUrl));
      }

      return new Promise(async (resolve) => {
        let resolved = false;
        const finish = (url) => {
          if (resolved) return;
          resolved = true;
          resolve(url);
        };

        const timer = setTimeout(() => finish(card.imgUrl), 600);

        try {
          const cached = await getCachedBlob(card.imgUrl);
          if (cached) {
            const objUrl = URL.createObjectURL(cached);
            blobUrlMap.set(card.imgUrl, objUrl);
            preloadedImageCache.set(card.imgUrl, objUrl);
            clearTimeout(timer);
            return finish(objUrl);
          }
        } catch (e) {}

        const offscreenImg = new Image();
        if (card.platform === 'twitter') offscreenImg.crossOrigin = 'anonymous';
        offscreenImg.decoding = 'async';
        offscreenImg.referrerPolicy = 'no-referrer';

        offscreenImg.onload = async () => {
          try {
            if ('decode' in offscreenImg) await offscreenImg.decode();
          } catch (_) {}
          clearTimeout(timer);
          preloadedImageCache.set(card.imgUrl, offscreenImg.src);
          finish(offscreenImg.src);
        };

        offscreenImg.onerror = () => {
          clearTimeout(timer);
          finish(card.fallbackUrl || card.imgUrl);
        };

        offscreenImg.src = card.imgUrl;
      });
    }

    function eagerPrefetchNextCards(startIndex = 0) {
      if (!pendingSummonPull || !pendingSummonPull.length) return;
      const lookahead = pendingSummonPull.slice(startIndex, startIndex + 4);
      lookahead.forEach(c => ensureCardImageReady(c));
    }

    // ===================================================
    // PROFILE MANAGEMENT ENGINE
    // ===================================================
    const PROFILES_STORAGE_KEY = 'universal_gallery_profiles';
    const ACTIVE_PROFILE_KEY = 'universal_gallery_active_profile';

    function getStoredProfiles() {
      try {
        const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return [{ id: 'default', name: 'Default Profile', createdAt: Date.now() }];
    }

    function saveProfilesList(list) {
      try {
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(list));
      } catch (e) {}
    }

    function getActiveProfileId() {
      return localStorage.getItem(ACTIVE_PROFILE_KEY) || 'default';
    }

    function setActiveProfileId(id) {
      localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    }

    function getProfileDataKey(keyName, profileId = null) {
      const pid = profileId || getActiveProfileId();
      return `profile_${pid}_${keyName}`;
    }

    function getProfileCurrentName() {
      const activeId = getActiveProfileId();
      const list = getStoredProfiles();
      const p = list.find(x => x.id === activeId);
      return p ? p.name : 'Default';
    }

    function updateProfileUI() {
      const name = getProfileCurrentName();
      const label = document.getElementById('activeProfileLabel');
      if (label) label.textContent = name;

      const listEl = document.getElementById('profileListItems');
      if (!listEl) return;
      listEl.innerHTML = '';

      const profiles = getStoredProfiles();
      const activeId = getActiveProfileId();

      profiles.forEach(p => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'dropdown-item' + (p.id === activeId ? ' selected' : '');
        item.innerHTML = `<span>${p.id === activeId ? '✓ ' : ''}${p.name}</span>`;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          document.getElementById('profileMenu').classList.remove('open');
          if (p.id !== activeId) {
            switchProfile(p.id);
          }
        });
        listEl.appendChild(item);
      });
    }

    async function switchProfile(targetProfileId) {
      await persistActiveProfileData();
      setActiveProfileId(targetProfileId);
      updateProfileUI();
      await loadProfileData(targetProfileId);
      recordActionLog('profile', `Switched to profile "${getProfileCurrentName()}"`);
      showToast(`Switched to "${getProfileCurrentName()}"`, 'success', '👤');
    }

    async function persistActiveProfileData() {
      const pid = getActiveProfileId();
      const postsArray = Array.from(allImportedPosts.values());
      try {
        localStorage.setItem(getProfileDataKey('posts', pid), JSON.stringify(postsArray));
        localStorage.setItem(getProfileDataKey('custom_collections', pid), JSON.stringify(customCollections));
        localStorage.setItem(getProfileDataKey('gacha_history', pid), JSON.stringify(gachaSummonHistory));
        localStorage.setItem(getProfileDataKey('gacha_unlocked', pid), JSON.stringify(Array.from(unlockedGachaSet)));
        localStorage.setItem(getProfileDataKey('gacha_rolls', pid), gachaTotalRolls);
        localStorage.setItem(getProfileDataKey('gacha_pity', pid), gachaPityCounter);
        localStorage.setItem(getProfileDataKey('action_logs', pid), JSON.stringify(actionLogs));
      } catch (e) {}
    }

    async function loadProfileData(targetProfileId = null) {
      const pid = targetProfileId || getActiveProfileId();

      try {
        actionLogs = JSON.parse(localStorage.getItem(getProfileDataKey('action_logs', pid)) || '[]');
      } catch (e) { actionLogs = []; }
      renderActionLogs();

      try {
        customCollections = JSON.parse(localStorage.getItem(getProfileDataKey('custom_collections', pid)) || '{}');
      } catch (e) { customCollections = {}; }
      activeCollectionId = null;
      if (activeCollectionDetails) activeCollectionDetails.style.display = 'none';
      renderCollectionsShelf();

      try {
        gachaSummonHistory = JSON.parse(localStorage.getItem(getProfileDataKey('gacha_history', pid)) || '[]');
        unlockedGachaSet = new Set(JSON.parse(localStorage.getItem(getProfileDataKey('gacha_unlocked', pid)) || '[]'));
        gachaTotalRolls = parseInt(localStorage.getItem(getProfileDataKey('gacha_rolls', pid)) || '0');
        gachaPityCounter = parseInt(localStorage.getItem(getProfileDataKey('gacha_pity', pid)) || '0');
      } catch (e) {
        gachaSummonHistory = [];
        unlockedGachaSet = new Set();
        gachaTotalRolls = 0;
        gachaPityCounter = 0;
      }
      updatePityUI();
      updateGachaStats();

      allImportedPosts.clear();
      currentItems = [];
      selectedItemsSet.clear();
      selectedGachaSet.clear();
      updateSelectionVisuals();
      updateGachaSelectionVisuals();

      let savedPosts = [];
      try {
        savedPosts = JSON.parse(localStorage.getItem(getProfileDataKey('posts', pid)) || '[]');
      } catch (e) { savedPosts = []; }

      if (savedPosts.length > 0) {
        savedPosts.forEach(p => {
          if (p.platform === 'pinterest' || detectPlatform(p) === 'pinterest') {
            p.authorName = 'Pinterest creator';
            p.authorHandle = '@pinterest';
          }
        });
        dropzone.style.display = 'none';
        gallerySubBar.style.display = 'flex';
        await processIncomingItems(savedPosts);
      } else {
        dropzone.style.display = 'block';
        gallerySubBar.style.display = 'none';
        extractTopKeywords();
        extractAllUserTags();
        updateBannerCounts();
        rebuildDeterministicPools();
        renderColumns();
      }

      renderGachaResults();
      if (gachaSubTabCompendium.classList.contains('active')) renderCompendium();
    }

    async function createNewProfile() {
      const name = await showCustomPrompt('Enter name for the new profile:', '', 'New Profile');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      const newId = 'prof_' + Date.now();
      const list = getStoredProfiles();
      list.push({ id: newId, name: cleanName, createdAt: Date.now() });
      saveProfilesList(list);

      await switchProfile(newId);
      recordActionLog('profile', `Created new profile "${cleanName}"`);
      showToast(`Created profile "${cleanName}"`, 'success', '➕');
    }

    async function renameCurrentProfile() {
      const currentName = getProfileCurrentName();
      const newName = await showCustomPrompt('Rename active profile:', currentName, 'Rename Profile');
      if (!newName || !newName.trim() || newName.trim() === currentName) return;

      const clean = newName.trim();
      const activeId = getActiveProfileId();
      const list = getStoredProfiles();
      const p = list.find(x => x.id === activeId);
      if (p) {
        p.name = clean;
        saveProfilesList(list);
        updateProfileUI();
        recordActionLog('profile', `Renamed profile to "${clean}"`);
        showToast(`Profile renamed to "${clean}"`, 'success', '✏️');
      }
    }

    async function resetCurrentProfile() {
      const name = getProfileCurrentName();
      const ok = await showCustomConfirm(
        `Completely reset profile <strong>"${name}"</strong>?<br><br>This will permanently remove all imported artworks, collections, custom tags, and gacha progress in this profile.`,
        'Reset Active Profile'
      );
      if (!ok) return;

      const pid = getActiveProfileId();
      localStorage.removeItem(getProfileDataKey('posts', pid));
      localStorage.removeItem(getProfileDataKey('custom_collections', pid));
      localStorage.removeItem(getProfileDataKey('gacha_history', pid));
      localStorage.removeItem(getProfileDataKey('gacha_unlocked', pid));
      localStorage.removeItem(getProfileDataKey('gacha_rolls', pid));
      localStorage.removeItem(getProfileDataKey('gacha_pity', pid));
      localStorage.removeItem(getProfileDataKey('action_logs', pid));

      allImportedPosts.clear();
      currentItems = [];
      customCollections = {};
      gachaSummonHistory = [];
      unlockedGachaSet.clear();
      gachaTotalRolls = 0;
      gachaPityCounter = 0;
      selectedItemsSet.clear();
      selectedGachaSet.clear();
      actionLogs = [];

      dropzone.style.display = 'block';
      gallerySubBar.style.display = 'none';

      updateSelectionVisuals();
      updateGachaSelectionVisuals();
      renderCollectionsShelf();
      updatePityUI();
      updateGachaStats();
      extractTopKeywords();
      extractAllUserTags();
      updateBannerCounts();
      rebuildDeterministicPools();
      renderColumns();
      renderGachaResults();
      renderActionLogs();

      recordActionLog('profile', `Reset profile "${name}" to empty state`);
      showToast(`Profile "${name}" completely reset`, 'info', '🔄');
    }

    async function deleteCurrentProfile() {
      const list = getStoredProfiles();
      if (list.length <= 1) {
        await showCustomAlert('You cannot delete the only existing profile. You can reset it instead.', 'Delete Profile', 'warn');
        return;
      }

      const activeId = getActiveProfileId();
      const name = getProfileCurrentName();
      const ok = await showCustomConfirm(
        `Are you sure you want to delete profile <strong>"${name}"</strong> and all its stored artworks?`,
        'Delete Profile'
      );
      if (!ok) return;

      const pid = activeId;
      localStorage.removeItem(getProfileDataKey('posts', pid));
      localStorage.removeItem(getProfileDataKey('custom_collections', pid));
      localStorage.removeItem(getProfileDataKey('gacha_history', pid));
      localStorage.removeItem(getProfileDataKey('gacha_unlocked', pid));
      localStorage.removeItem(getProfileDataKey('gacha_rolls', pid));
      localStorage.removeItem(getProfileDataKey('gacha_pity', pid));
      localStorage.removeItem(getProfileDataKey('action_logs', pid));

      const updatedList = list.filter(p => p.id !== activeId);
      saveProfilesList(updatedList);
      const nextProfileId = updatedList[0].id;
      setActiveProfileId(nextProfileId);
      updateProfileUI();
      await loadProfileData(nextProfileId);

      recordActionLog('profile', `Deleted profile "${name}"`);
      showToast(`Deleted profile "${name}"`, 'info', '🗑️');
    }

    async function exportCurrentProfile() {
      await persistActiveProfileData();
      const pid = getActiveProfileId();
      const pName = getProfileCurrentName();

      const postsArray = Array.from(allImportedPosts.values()).map(formatPostForTemplateExport);
      const payload = {
        app: 'UniversalArtGallery',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        profile: {
          id: pid,
          name: pName
        },
        posts: postsArray,
        collections: customCollections,
        gacha: {
          history: gachaSummonHistory,
          unlockedIds: Array.from(unlockedGachaSet),
          totalRolls: gachaTotalRolls,
          pityCounter: gachaPityCounter
        },
        actionLogs: actionLogs
      };

      downloadExportPayload(payload, `profile_${pName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_backup.json`);
      recordActionLog('export', `Exported full profile "${pName}"`);
      showToast(`Exported profile "${pName}"`, 'success', '📤');
    }

    function setupProfileFileInput() {
      const input = document.getElementById('profileFileInput');
      if (!input) return;

      input.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const data = JSON.parse(event.target.result);
            if (!data || (!data.posts && !data.tweets && !data.profile)) {
              throw new Error('Unrecognized profile backup format');
            }

            const importedProfileName = data.profile?.name || file.name.replace(/\.json$/i, '');
            const choice = await showCustomSelectPrompt(
              `Profile <strong>"${importedProfileName}"</strong> ready to import:`,
              [
                { value: 'new', label: `➕ Create as New Profile ("${importedProfileName}")` },
                { value: 'overwrite', label: `⚠️ Overwrite Current Profile ("${getProfileCurrentName()}")` }
              ],
              'Import Profile'
            );

            if (!choice) return;

            let targetId = getActiveProfileId();
            if (choice === 'new') {
              targetId = 'prof_' + Date.now();
              const list = getStoredProfiles();
              list.push({ id: targetId, name: importedProfileName, createdAt: Date.now() });
              saveProfilesList(list);
              setActiveProfileId(targetId);
            }

            const incomingPosts = data.posts || data.tweets || [];
            incomingPosts.forEach(p => {
              if (p.platform === 'pinterest' || detectPlatform(p) === 'pinterest') {
                p.authorName = 'Pinterest creator';
                p.authorHandle = '@pinterest';
              }
            });
            const incomingCols = data.collections || {};
            const incomingGacha = data.gacha || {};
            const incomingLogs = data.actionLogs || [];

            localStorage.setItem(getProfileDataKey('posts', targetId), JSON.stringify(incomingPosts));
            localStorage.setItem(getProfileDataKey('custom_collections', targetId), JSON.stringify(incomingCols));
            localStorage.setItem(getProfileDataKey('gacha_history', targetId), JSON.stringify(incomingGacha.history || []));
            localStorage.setItem(getProfileDataKey('gacha_unlocked', targetId), JSON.stringify(incomingGacha.unlockedIds || []));
            localStorage.setItem(getProfileDataKey('gacha_rolls', targetId), incomingGacha.totalRolls || 0);
            localStorage.setItem(getProfileDataKey('gacha_pity', targetId), incomingGacha.pityCounter || 0);
            localStorage.setItem(getProfileDataKey('action_logs', targetId), JSON.stringify(incomingLogs));

            updateProfileUI();
            await loadProfileData(targetId);

            recordActionLog('import', `Imported profile "${importedProfileName}" (${incomingPosts.length} artworks)`);
            await showCustomAlert(`Profile "${importedProfileName}" imported successfully!<br>Artworks: ${incomingPosts.length}`, 'Import Profile', 'success');
          } catch (err) {
            showCustomAlert('Failed to import profile: ' + err.message, 'Import Error', 'error');
          }
          input.value = '';
        };
        reader.readAsText(file);
      });
    }

    // ===================================================
    // ACTION LOGS ENGINE
    // ===================================================
    let actionLogs = [];
    const MAX_LOGS = 150;

    function recordActionLog(type, message) {
      const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type,
        message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: new Date().toLocaleDateString()
      };
      actionLogs.unshift(entry);
      if (actionLogs.length > MAX_LOGS) actionLogs.pop();
      try {
        localStorage.setItem(getProfileDataKey('action_logs'), JSON.stringify(actionLogs));
      } catch (e) {}
      renderActionLogs();
    }

    function renderActionLogs() {
      const listEl = document.getElementById('actionLogsList');
      const countEl = document.getElementById('actionLogsCountLabel');
      if (!listEl || !countEl) return;
      countEl.textContent = `${actionLogs.length} events recorded`;
      listEl.innerHTML = '';

      if (!actionLogs.length) {
        listEl.innerHTML = `<div style="text-align:center; padding: 2.5rem 1rem; color:var(--subtext); font-size:0.85rem;">No action logs recorded yet.</div>`;
        return;
      }

      actionLogs.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'action-log-entry';
        item.innerHTML = `
          <div class="action-log-top">
            <span class="action-log-type ${entry.type}">${entry.type.toUpperCase()}</span>
            <span class="action-log-time">${entry.date} ${entry.timestamp}</span>
          </div>
          <div class="action-log-msg">${entry.message}</div>
        `;
        listEl.appendChild(item);
      });
    }

    // ===================================================
    // CUSTOM NOTIFICATIONS & DIALOG ENGINE
    // ===================================================
    const toastContainer = document.getElementById('toastContainer');
    const MAX_ACTIVE_TOASTS = 5;

    function showToast(message, type = 'info', icon = '') {
      if (!toastContainer) return;
      const icons = {
        success: icon || '✅',
        error: icon || '⚠️',
        warn: icon || '🔔',
        info: icon || 'ℹ️'
      };

      while (toastContainer.children.length >= MAX_ACTIVE_TOASTS) {
        toastContainer.firstElementChild.remove();
      }

      const toast = document.createElement('div');
      toast.className = `custom-toast toast-${type}`;
      toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <div class="toast-body">${message}</div>
        <button class="toast-close" title="Dismiss">&times;</button>
      `;
      toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 200);
      });
      toastContainer.appendChild(toast);

      setTimeout(() => {
        if (toast.parentElement) {
          toast.classList.add('fade-out');
          setTimeout(() => toast.remove(), 200);
        }
      }, 2400);
    }

    const customDialogModal = document.getElementById('customDialogModal');
    const customDialogTitle = document.getElementById('customDialogTitle');
    const customDialogMessage = document.getElementById('customDialogMessage');
    const customDialogInput = document.getElementById('customDialogInput');
    const customDialogSelect = document.getElementById('customDialogSelect');
    const customDialogSelectWrapper = document.getElementById('customDialogSelectWrapper');
    const customDialogSelectTrigger = document.getElementById('customDialogSelectTrigger');
    const customDialogSelectLabel = document.getElementById('customDialogSelectLabel');
    const customDialogSelectMenu = document.getElementById('customDialogSelectMenu');
    const customDialogConfirmBtn = document.getElementById('customDialogConfirmBtn');
    const customDialogCancelBtn = document.getElementById('customDialogCancelBtn');
    const customDialogCloseX = document.getElementById('customDialogCloseX');

    let dialogResolve = null;
    let customDialogSelectedValue = null;

    if (customDialogSelectTrigger) {
      customDialogSelectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = customDialogSelectMenu.classList.contains('open');
        if (isOpen) {
          customDialogSelectMenu.classList.remove('open');
          customDialogSelectTrigger.classList.remove('active');
        } else {
          customDialogSelectMenu.classList.add('open');
          customDialogSelectTrigger.classList.add('active');
        }
      });
    }

    function openCustomDialog({ title = 'Notification', message = '', mode = 'alert', defaultValue = '', selectOptions = null, allowCreateCollection = false }) {
      return new Promise((resolve) => {
        dialogResolve = resolve;
        customDialogTitle.textContent = title;
        customDialogMessage.innerHTML = message;

        customDialogInput.style.display = (mode === 'prompt') ? 'block' : 'none';
        customDialogInput.value = defaultValue || '';

        const inlineWrap = document.getElementById('dialogInlineColWrap');
        if (inlineWrap) inlineWrap.style.display = 'none';

        if (mode === 'select' && Array.isArray(selectOptions)) {
          customDialogSelectWrapper.style.display = 'block';
          customDialogSelectMenu.classList.remove('open');
          customDialogSelectTrigger.classList.remove('active');

          const populateSelectMenu = (currentOpts, selectedVal = null) => {
            customDialogSelectMenu.innerHTML = '';

            if (allowCreateCollection) {
              const topCreateBtn = document.createElement('button');
              topCreateBtn.type = 'button';
              topCreateBtn.className = 'dialog-create-col-top-btn';
              topCreateBtn.innerHTML = `<span>➕ Create New Collection...</span>`;
              
              topCreateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                customDialogSelectMenu.classList.remove('open');
                customDialogSelectTrigger.classList.remove('active');

                let inlineRow = document.getElementById('dialogInlineColWrap');
                if (!inlineRow) {
                  inlineRow = document.createElement('div');
                  inlineRow.id = 'dialogInlineColWrap';
                  inlineRow.style.cssText = 'display:flex; gap:6px; margin-top:8px; width:100%;';
                  inlineRow.innerHTML = `
                    <input type="text" id="dialogInlineColInput" placeholder="New collection name..." style="flex:1; background:var(--bg); border:1.5px solid var(--accent-cyan); color:var(--text-bold); padding:6px 10px; border-radius:6px; font-size:0.82rem; outline:none;">
                    <button type="button" id="dialogInlineColAddBtn" class="btn" style="background:var(--accent-cyan); color:#06111e; font-weight:700; padding:6px 14px; font-size:0.8rem;">Add</button>
                    <button type="button" id="dialogInlineColCancelBtn" class="btn" style="padding:6px 10px; font-size:0.8rem;">✕</button>
                  `;
                  customDialogSelectWrapper.insertAdjacentElement('afterend', inlineRow);

                  const inputEl = inlineRow.querySelector('#dialogInlineColInput');
                  const addBtn = inlineRow.querySelector('#dialogInlineColAddBtn');
                  const cancelBtn = inlineRow.querySelector('#dialogInlineColCancelBtn');

                  const commitInlineCol = () => {
                    const nameVal = inputEl.value.trim();
                    if (nameVal) {
                      const newColId = 'col_' + Date.now();
                      customCollections[newColId] = { id: newColId, name: nameVal, desc: '', itemIds: [] };
                      saveCollections();
                      recordActionLog('collection', `Created collection "${nameVal}"`);
                      showToast(`Created "${nameVal}"`, 'success', '📁');

                      inputEl.value = '';
                      inlineRow.style.display = 'none';

                      const updatedOpts = Object.values(customCollections).map(c => ({
                        value: c.id,
                        label: `${c.name} (${c.itemIds.length} items)`
                      }));
                      populateSelectMenu(updatedOpts, newColId);
                    }
                  };

                  addBtn.addEventListener('click', commitInlineCol);
                  inputEl.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault();
                      commitInlineCol();
                    }
                  });
                  cancelBtn.addEventListener('click', () => {
                    inputEl.value = '';
                    inlineRow.style.display = 'none';
                  });
                }

                inlineRow.style.display = 'flex';
                const inputEl = inlineRow.querySelector('#dialogInlineColInput');
                if (inputEl) setTimeout(() => inputEl.focus(), 50);
              });

              customDialogSelectMenu.appendChild(topCreateBtn);
            }
            
            if (currentOpts.length > 0) {
              const activeVal = selectedVal || currentOpts[0].value;
              customDialogSelectedValue = activeVal;
              const activeOpt = currentOpts.find(o => o.value === activeVal) || currentOpts[0];
              customDialogSelectLabel.textContent = activeOpt.label;

              currentOpts.forEach(opt => {
                const optBtn = document.createElement('div');
                optBtn.className = 'dialog-select-option' + (opt.value === activeVal ? ' selected' : '');

                const countMatch = opt.label.match(/\((\d+\s*items?)\)/i);
                let displayText = opt.label;
                let countBadgeHTML = '';

                if (countMatch) {
                  displayText = opt.label.replace(/\s*\(\d+\s*items?\)/i, '').trim();
                  countBadgeHTML = `<span class="dialog-opt-count">${countMatch[1]}</span>`;
                }

                optBtn.innerHTML = `
                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📁 ${displayText}</span>
                  ${countBadgeHTML}
                `;

                optBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  customDialogSelectedValue = opt.value;
                  customDialogSelectLabel.textContent = opt.label;
                  customDialogSelectMenu.querySelectorAll('.dialog-select-option').forEach(el => el.classList.remove('selected'));
                  optBtn.classList.add('selected');
                  customDialogSelectMenu.classList.remove('open');
                  customDialogSelectTrigger.classList.remove('active');
                });

                customDialogSelectMenu.appendChild(optBtn);
              });
            } else {
              customDialogSelectedValue = null;
              customDialogSelectLabel.textContent = 'No collections found...';
            }
          };

          populateSelectMenu(selectOptions);
        } else {
          customDialogSelectWrapper.style.display = 'none';
          customDialogSelect.style.display = 'none';
        }

        customDialogCancelBtn.style.display = (mode === 'alert') ? 'none' : 'inline-flex';
        customDialogConfirmBtn.textContent = (mode === 'confirm' && title.toLowerCase().includes('delete')) ? 'Delete' : 'Confirm';
        customDialogConfirmBtn.style.background = (mode === 'confirm' && (title.toLowerCase().includes('delete') || title.toLowerCase().includes('reset'))) ? '#da3633' : 'var(--accent)';

        customDialogModal.classList.add('open');
        if (mode === 'prompt') setTimeout(() => customDialogInput.focus(), 60);
      });
    }

    function closeCustomDialog(result) {
      customDialogModal.classList.remove('open');
      customDialogSelectMenu.classList.remove('open');
      customDialogSelectTrigger.classList.remove('active');
      const inlineWrap = document.getElementById('dialogInlineColWrap');
      if (inlineWrap) inlineWrap.style.display = 'none';
      if (dialogResolve) {
        const resolveFn = dialogResolve;
        dialogResolve = null;
        resolveFn(result);
      }
    }

    customDialogConfirmBtn.addEventListener('click', () => {
      if (customDialogInput.style.display !== 'none') {
        closeCustomDialog(customDialogInput.value);
      } else if (customDialogSelectWrapper.style.display !== 'none') {
        closeCustomDialog(customDialogSelectedValue);
      } else {
        closeCustomDialog(true);
      }
    });

    customDialogCancelBtn.addEventListener('click', () => closeCustomDialog(null));
    customDialogCloseX.addEventListener('click', () => closeCustomDialog(null));

    function showCustomAlert(message, title = 'Notice', type = 'info') {
      showToast(message, type);
      recordActionLog('storage', `${title}: ${message}`);
      return openCustomDialog({ title, message, mode: 'alert' });
    }

    function showCustomConfirm(message, title = 'Please Confirm') {
      return openCustomDialog({ title, message, mode: 'confirm' });
    }

    function showCustomPrompt(message, defaultValue = '', title = 'Enter Value') {
      return openCustomDialog({ title, message, mode: 'prompt', defaultValue });
    }

    function showCustomSelectPrompt(message, options = [], title = 'Select Option', allowCreateCollection = false) {
      return openCustomDialog({ title, message, mode: 'select', selectOptions: options, allowCreateCollection });
    }

    function adjustDropdownPlacement(menu) {
      if (!menu) return;
      menu.style.left = '';
      menu.style.right = '';

      if (window.innerWidth <= 800) {
        menu.style.position = 'fixed';
        menu.style.left = '8px';
        menu.style.right = '8px';
        menu.style.width = 'auto';
        menu.style.maxWidth = `${window.innerWidth - 16}px`;
        return;
      }

      menu.style.position = 'absolute';
      const rect = menu.getBoundingClientRect();
      const pad = 10;

      if (rect.right > window.innerWidth - pad) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      }

      const postRect = menu.getBoundingClientRect();
      if (postRect.left < pad) {
        menu.style.left = '0';
        menu.style.right = 'auto';
      }
    }

    // ===================================================
    // PLATFORMS & URL HELPERS
    // ===================================================
    const PLATFORMS = {
      twitter: { name: 'Twitter / X', letter: 'X' },
      pixiv: { name: 'Pixiv', letter: 'P' },
      pinterest: { name: 'Pinterest', letter: 'P' },
      deviantart: { name: 'DeviantArt', letter: 'DA' },
      safebooru: { name: 'Safebooru', letter: 'SB' },
      rule34: { name: 'Rule 34', letter: 'R34' }
    };

    function detectPlatform(item) {
      if (item.id && String(item.id).startsWith('rule34_')) return 'rule34';
      if (item.url && item.url.includes('rule34.xxx')) return 'rule34';
      if (item.imgUrl && item.imgUrl.includes('rule34.xxx')) return 'rule34';
      if (item.mediaUrl && item.mediaUrl.includes('rule34.xxx')) return 'rule34';

      if (item.id && String(item.id).startsWith('safebooru_')) return 'safebooru';
      if (item.url && item.url.includes('safebooru.org')) return 'safebooru';
      if (item.imgUrl && item.imgUrl.includes('safebooru.org')) return 'safebooru';
      if (item.mediaUrl && item.mediaUrl.includes('safebooru.org')) return 'safebooru';

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
      if (platform === 'safebooru') {
        return rawItem.url || 'https://safebooru.org';
      }
      if (platform === 'rule34') {
        return rawItem.url || 'https://rule34.xxx';
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
    // INDEXEDDB STORAGE
    // ===================================================
    const DB_NAME = 'UniversalGalleryDB';
    const DB_VERSION = 3;
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

    async function getCachedMeta(key) {
      try {
        const db = await getDB();
        return new Promise((resolve) => {
          const tx = db.transaction(META_STORE, 'readonly');
          const store = tx.objectStore(META_STORE);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch { return null; }
    }

    async function saveMetaToDB(key, meta) {
      try {
        const db = await getDB();
        return new Promise((resolve) => {
          const tx = db.transaction(META_STORE, 'readwrite');
          const store = tx.objectStore(META_STORE);
          store.put(meta, key);
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

      if (val < 0.03) return { tier: 'SSR', score: val };
      if (val < 0.20) return { tier: 'SR', score: val };
      if (val < 0.55) return { tier: 'R', score: val };
      return { tier: 'C', score: val };
    }

    // ===================================================
    // APPLICATION STATE
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

    const activeKeywordsSet = new Set();
    let isKeywordMatchAll = true;
    const allExtractedKeywordsMap = new Map();
    let allExtractedKeywordsList = [];

    const activeUserTagsSet = new Set();
    const allExtractedUserTagsMap = new Map();
    let allExtractedUserTagsList = [];

    let customCollections = {};
    let activeCollectionId = null;

    let isSelectionMode = false;
    const selectedItemsSet = new Set();

    // Gacha Selection Mode State
    let isGachaSelectionMode = false;
    const selectedGachaSet = new Set();

    const PITY_LIMIT = 50;
    let gachaPityCounter = 0;
    let activeGachaBanner = 'all';
    const gachaPools = { ssr: [], sr: [], r: [], n: [] };
    let gachaSummonHistory = [];
    let gachaTotalRolls = 0;
    let unlockedGachaSet = new Set();
    let pendingSummonPull = [];
    let inspectCurrentIndex = 0;
    let isInspectTransitioning = false;
    let activeGachaSort = 'recent';
    let activeGachaRarityFilter = 'all';

    // Gacha custom columns & layout state
    let gachaColCount = parseInt(localStorage.getItem('gacha_col_count') || '5');
    let isGachaMasonry = localStorage.getItem('gacha_layout_masonry') === 'true';

    let galleryColCount = parseInt(localStorage.getItem('gallery_col_count') || '4');
    let renderedCount = 0;
    const BATCH_SIZE = 50;
    let isBatchRendering = false;
    let batchTimeout = null;
    let currentRenderCycle = 0;
    let fullyLoadedImages = 0;
    let totalTargetImages = 0;

    // ===================================================
    // DOM ELEMENT REFERENCES
    // ===================================================
    const tabGallery = document.getElementById('tabGallery');
    const tabCollections = document.getElementById('tabCollections');
    const tabGacha = document.getElementById('tabGacha');
    const gachaSummonedBadge = document.getElementById('gachaSummonedBadge');
    const collectionsCountBadge = document.getElementById('collectionsCountBadge');

    const galleryView = document.getElementById('galleryView');
    const collectionsView = document.getElementById('collectionsView');
    const gachaView = document.getElementById('gachaView');

    const profileMenuBtn = document.getElementById('profileMenuBtn');
    const profileMenu = document.getElementById('profileMenu');
    const createProfileBtn = document.getElementById('createProfileBtn');
    const renameProfileBtn = document.getElementById('renameProfileBtn');
    const resetProfileBtn = document.getElementById('resetProfileBtn');
    const deleteProfileBtn = document.getElementById('deleteProfileBtn');
    const exportProfileBtn = document.getElementById('exportProfileBtn');
    const importProfileBtn = document.getElementById('importProfileBtn');

    const multiSelectToggleBtn = document.getElementById('multiSelectToggleBtn');
    const batchActionBar = document.getElementById('batchActionBar');
    const batchSelectedCount = document.getElementById('batchSelectedCount');
    const batchAddToColBtn = document.getElementById('batchAddToColBtn');
    const batchRemoveFromColBtn = document.getElementById('batchRemoveFromColBtn');
    const batchTagBtn = document.getElementById('batchTagBtn');
    const batchExportBtn = document.getElementById('batchExportBtn');
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const batchCancelBtn = document.getElementById('batchCancelBtn');

    const collectionsShelf = document.getElementById('collectionsShelf');
    const createNewColBtn = document.getElementById('createNewColBtn');
    const exportColsBtn = document.getElementById('exportColsBtn');
    const importColsBtn = document.getElementById('importColsBtn');
    const activeCollectionDetails = document.getElementById('activeCollectionDetails');
    const activeColTitle = document.getElementById('activeColTitle');
    const activeColDesc = document.getElementById('activeColDesc');
    const renameActiveColBtn = document.getElementById('renameActiveColBtn');
    const deleteActiveColBtn = document.getElementById('deleteActiveColBtn');
    const collectionGalleryGrid = document.getElementById('collectionGalleryGrid');

    const gachaSubTabSummon = document.getElementById('gachaSubTabSummon');
    const gachaSubTabCompendium = document.getElementById('gachaSubTabCompendium');
    const gachaSummonStageContainer = document.getElementById('gachaSummonStageContainer');
    const compendiumContainer = document.getElementById('compendiumContainer');
    const compendiumStatsBar = document.getElementById('compendiumStatsBar');
    const compGridSSR = document.getElementById('compGridSSR');
    const compGridSR = document.getElementById('compGridSR');
    const compGridR = document.getElementById('compGridR');
    const compGridN = document.getElementById('compGridN');
    const compProgressSSR = document.getElementById('compProgressSSR');
    const compProgressSR = document.getElementById('compProgressSR');
    const compProgressR = document.getElementById('compProgressR');
    const compProgressN = document.getElementById('compProgressN');
    const pityProgressBar = document.getElementById('pityProgressBar');
    const pityProgressLabel = document.getElementById('pityProgressLabel');

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

    const createNewTagInput = document.getElementById('createNewTagInput');
    const createNewTagBtn = document.getElementById('createNewTagBtn');
    const customTagsMultiBtn = document.getElementById('customTagsMultiBtn');
    const customTagsMultiMenu = document.getElementById('customTagsMultiMenu');
    const activeUserTagsBadge = document.getElementById('activeUserTagsBadge');
    const customTagDropdownSearch = document.getElementById('customTagDropdownSearch');
    const clearUserTagsFilterBtn = document.getElementById('clearUserTagsFilterBtn');
    const wipeAllUserTagsBtn = document.getElementById('wipeAllUserTagsBtn');
    const customTagDropdownList = document.getElementById('customTagDropdownList');

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

    const gachaRoll1Btn = document.getElementById('gachaRoll1Btn');
    const gachaRoll10Btn = document.getElementById('gachaRoll10Btn');
    const gachaClearInventoryBtn = document.getElementById('gachaClearInventoryBtn');
    const gachaExportBtn = document.getElementById('gachaExportBtn');
    const gachaImportBtn = document.getElementById('gachaImportBtn');
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

    // GACHA CONTROLS
    const gachaZoomMinus = document.getElementById('gachaZoomMinus');
    const gachaZoomPlus = document.getElementById('gachaZoomPlus');
    const gachaColCountLabel = document.getElementById('gachaColCountLabel');
    const gachaGridToggleOpt = document.getElementById('gachaGridToggleOpt');
    const gachaMasonryToggleOpt = document.getElementById('gachaMasonryToggleOpt');
    const gachaMultiSelectToggleBtn = document.getElementById('gachaMultiSelectToggleBtn');

    const bannerPoolCountAll = document.getElementById('bannerPoolCountAll');
    const bannerPoolCountTwitter = document.getElementById('bannerPoolCountTwitter');
    const bannerPoolCountPixiv = document.getElementById('bannerPoolCountPixiv');
    const bannerPoolCountDeviantArt = document.getElementById('bannerPoolCountDeviantArt');
    const bannerPoolCountPinterest = document.getElementById('bannerPoolCountPinterest');
    const bannerPoolCountSafebooru = document.getElementById('bannerPoolCountSafebooru');
    const bannerPoolCountRule34 = document.getElementById('bannerPoolCountRule34');

    const gachaSummonOverlay = document.getElementById('gachaSummonOverlay');
    const summonParticlesCanvas = document.getElementById('summonParticlesCanvas');
    const summonStageOrb = document.getElementById('summonStageOrb');
    
    const summonStageInspect = document.getElementById('summonStageInspect');
    const summonInspectAtmosphereCanvas = document.getElementById('summonInspectAtmosphereCanvas');
    const summonInspectSkipBtn = document.getElementById('summonInspectSkipBtn');
    const summonInspectWrapper = document.getElementById('summonInspectWrapper');
    const summonInspectCardStage = document.getElementById('summonInspectCardStage');
    const ssrShroudedBack = document.getElementById('ssrShroudedBack');
    const summonInspectRarityPill = document.getElementById('summonInspectRarityPill');
    const summonInspectHolo = document.getElementById('summonInspectHolo');
    const summonInspectArt = document.getElementById('summonInspectArt');
    const summonInspectCounter = document.getElementById('summonInspectCounter');
    const summonInspectPrevBtn = document.getElementById('summonInspectPrevBtn');
    const summonInspectNextBtn = document.getElementById('summonInspectNextBtn');

    const summonStageShowcase = document.getElementById('summonStageShowcase');
    const summonCrystalWrap = document.getElementById('summonCrystalWrap');
    const summonCrystal = document.getElementById('summonCrystal');
    const summonCardsContainer = document.getElementById('summonCardsContainer');
    const summonCloseBtn = document.getElementById('summonCloseBtn');

    const pokemonModal = document.getElementById('pokemonModal');
    const pokemonAtmosphereCanvas = document.getElementById('pokemonAtmosphereCanvas');
    const pokemonCardWrapper = document.getElementById('pokemonCardWrapper');
    const pokemonCardStage = document.getElementById('pokemonCardStage');
    const pokemonCardRarityPill = document.getElementById('pokemonCardRarityPill');
    const pokemonCardHolo = document.getElementById('pokemonCardHolo');
    const pokemonCardArt = document.getElementById('pokemonCardArt');
    const pokemonCloseBtn = document.getElementById('pokemonCloseBtn');
    const pokemonSwitchGalleryBtn = document.getElementById('pokemonSwitchGalleryBtn');
    const pokemonPrevBtn = document.getElementById('pokemonPrevBtn');
    const pokemonNextBtn = document.getElementById('pokemonNextBtn');

    const focusBlurOverlay = document.getElementById('focusBlurOverlay');
    const focusBlurImg = document.getElementById('focusBlurImg');
    const focusBlurCloseBtn = document.getElementById('focusBlurCloseBtn');

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
    const gachaFileInput = document.getElementById('gachaFileInput');
    const collectionsFileInput = document.getElementById('collectionsFileInput');
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
    const importGachaMenuBtn = document.getElementById('importGachaMenuBtn');
    const importColsMenuBtn = document.getElementById('importColsMenuBtn');
    const actionLogsMenuBtn = document.getElementById('actionLogsMenuBtn');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const saveProgress = document.getElementById('saveProgress');

    const exportMenuBtn = document.getElementById('exportMenuBtn');
    const exportMenu = document.getElementById('exportMenu');
    const exportAllBtn = document.getElementById('exportAllBtn');
    const exportFilteredBtn = document.getElementById('exportFilteredBtn');
    const exportGachaMenuBtn = document.getElementById('exportGachaMenuBtn');
    const exportColsMenuBtn = document.getElementById('exportColsMenuBtn');

    const actionLogsModal = document.getElementById('actionLogsModal');
    const closeActionLogsBtn = document.getElementById('closeActionLogsBtn');
    const clearActionLogsBtn = document.getElementById('clearActionLogsBtn');

    // LIGHTBOX REFERENCES & ARROW CONTROLS & DIMENSION BADGE
    const modal = document.getElementById('modal');
    const modalMedia = document.getElementById('modalMedia');
    const modalImg = document.getElementById('modalImg');
    const modalDetails = document.getElementById('modalDetails');
    const modalDetailsToggle = document.getElementById('modalDetailsToggle');
    const drawerAuthorPreview = document.getElementById('drawerAuthorPreview');
    const closeBtn = document.getElementById('closeBtn');
    const multiMediaWrap = document.getElementById('multiMediaWrap');
    const postThumbs = document.getElementById('postThumbs');
    const modalPagePill = document.getElementById('modalPagePill');
    const modalDimensionBadge = document.getElementById('modalDimensionBadge');
    const modalDimText = document.getElementById('modalDimText');
    const modalAddToColBtn = document.getElementById('modalAddToColBtn');
    const modalDeleteBtn = document.getElementById('modalDeleteBtn');
    const modalPrevBtn = document.getElementById('modalPrevBtn');
    const modalNextBtn = document.getElementById('modalNextBtn');

    const userNotesModal = document.getElementById('userNotesModal');
    const openUserMetaModalBtn = document.getElementById('openUserMetaModalBtn');
    const closeUserNotesModalBtn = document.getElementById('closeUserNotesModalBtn');
    const saveUserNotesDoneBtn = document.getElementById('saveUserNotesDoneBtn');
    const modalTagsSummaryList = document.getElementById('modalTagsSummaryList');
    const modalNotePreview = document.getElementById('modalNotePreview');

    const modalTagsContainer = document.getElementById('modalTagsContainer');
    const modalTagPickerWrap = document.getElementById('modalTagPickerWrap');
    const modalTagPickerBtn = document.getElementById('modalTagPickerBtn');
    const modalTagPickerLabel = document.getElementById('modalTagPickerLabel');
    const modalTagPickerMenu = document.getElementById('modalTagPickerMenu');
    const modalTagPickerSearch = document.getElementById('modalTagPickerSearch');
    const modalTagPickerList = document.getElementById('modalTagPickerList');
    const modalNoteInput = document.getElementById('modalNoteInput');
    const modalNoteStatus = document.getElementById('modalNoteStatus');

    // ===================================================
    // GACHA COLUMN ZOOM & SCREEN-LIMIT CONTROLS
    // ===================================================
    function getGachaScreenColLimits() {
      const w = window.innerWidth;
      const isPortrait = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > w;
      if (w < 480) return { min: 1, max: isPortrait ? 2 : 3 };
      if (w < 768) return { min: 1, max: isPortrait ? 2 : 4 };
      if (w < 1024) return { min: 2, max: isPortrait ? 4 : 5 };
      if (w < 1400) return { min: 2, max: 6 };
      return { min: 2, max: 8 };
    }

    function updateGachaColZoomUI() {
      const { min, max } = getGachaScreenColLimits();
      gachaColCount = Math.max(min, Math.min(gachaColCount, max));
      if (gachaColCountLabel) gachaColCountLabel.textContent = `${gachaColCount} col${gachaColCount > 1 ? 's' : ''}`;
      if (gachaResultsGrid) {
        gachaResultsGrid.style.setProperty('--gacha-cols', gachaColCount);
      }
      if (gachaZoomMinus) {
        gachaZoomMinus.disabled = gachaColCount <= min;
        gachaZoomMinus.style.opacity = gachaColCount <= min ? '0.35' : '1';
      }
      if (gachaZoomPlus) {
        gachaZoomPlus.disabled = gachaColCount >= max;
        gachaZoomPlus.style.opacity = gachaColCount >= max ? '0.35' : '1';
      }
    }

    if (gachaZoomMinus) {
      gachaZoomMinus.addEventListener('click', () => {
        const { min } = getGachaScreenColLimits();
        if (gachaColCount > min) {
          gachaColCount = Math.max(gachaColCount - 1, min);
          localStorage.setItem('gacha_col_count', gachaColCount);
          updateGachaColZoomUI();
          renderGachaResults();
        }
      });
    }

    if (gachaZoomPlus) {
      gachaZoomPlus.addEventListener('click', () => {
        const { max } = getGachaScreenColLimits();
        if (gachaColCount < max) {
          gachaColCount = Math.min(gachaColCount + 1, max);
          localStorage.setItem('gacha_col_count', gachaColCount);
          updateGachaColZoomUI();
          renderGachaResults();
        }
      });
    }

    // GACHA GRID / MASONRY TOGGLE WITHOUT EMOJIS
    function updateGachaLayoutToggleButtons() {
      if (!gachaGridToggleOpt || !gachaMasonryToggleOpt) return;
      if (isGachaMasonry) {
        gachaMasonryToggleOpt.classList.add('active');
        gachaGridToggleOpt.classList.remove('active');
      } else {
        gachaGridToggleOpt.classList.add('active');
        gachaMasonryToggleOpt.classList.remove('active');
      }
    }

    if (gachaGridToggleOpt && gachaMasonryToggleOpt) {
      updateGachaLayoutToggleButtons();

      gachaGridToggleOpt.addEventListener('click', () => {
        if (!isGachaMasonry) return;
        isGachaMasonry = false;
        localStorage.setItem('gacha_layout_masonry', 'false');
        updateGachaLayoutToggleButtons();
        renderGachaResults();
      });

      gachaMasonryToggleOpt.addEventListener('click', () => {
        if (isGachaMasonry) return;
        isGachaMasonry = true;
        localStorage.setItem('gacha_layout_masonry', 'true');
        updateGachaLayoutToggleButtons();
        renderGachaResults();
      });
    }

    // ===================================================
    // GACHA SELECTION MODE & CARD REMOVAL ENGINE
    // ===================================================
    function setGachaSelectionMode(active) {
      isGachaSelectionMode = active;
      document.body.classList.toggle('gacha-selection-active', isGachaSelectionMode);
      if (gachaMultiSelectToggleBtn) {
        gachaMultiSelectToggleBtn.style.color = isGachaSelectionMode ? 'var(--accent)' : 'var(--subtext)';
        gachaMultiSelectToggleBtn.style.borderColor = isGachaSelectionMode ? 'var(--accent)' : 'var(--border)';
      }
      if (!isGachaSelectionMode) {
        selectedGachaSet.clear();
      }
      updateGachaSelectionVisuals();
    }

    if (gachaMultiSelectToggleBtn) {
      gachaMultiSelectToggleBtn.addEventListener('click', () => {
        setGachaSelectionMode(!isGachaSelectionMode);
      });
    }

    function toggleGachaCardSelection(summonId) {
      if (!summonId) return;
      if (selectedGachaSet.has(summonId)) {
        selectedGachaSet.delete(summonId);
      } else {
        selectedGachaSet.add(summonId);
      }
      updateGachaSelectionVisuals();
    }

    function updateGachaSelectionVisuals() {
      if (!gachaResultsGrid) return;
      gachaResultsGrid.querySelectorAll('.gacha-card').forEach(el => {
        const id = el.dataset.summonId;
        const cb = el.querySelector('.card-select-checkbox');
        const isSel = selectedGachaSet.has(id);
        if (cb) cb.checked = isSel;
        el.classList.toggle('card-selected-highlight', isSel);
      });

      if (gachaView.style.display !== 'none' && isGachaSelectionMode) {
        batchSelectedCount.textContent = selectedGachaSet.size;
        batchActionBar.classList.toggle('visible', selectedGachaSet.size > 0);
        batchAddToColBtn.style.display = 'none';
        batchRemoveFromColBtn.style.display = 'none';
        batchTagBtn.style.display = 'none';
        batchExportBtn.style.display = 'none';
        batchDeleteBtn.textContent = '🗑️ Remove Card(s)';
      } else if (galleryView.style.display !== 'none' || collectionsView.style.display !== 'none') {
        batchDeleteBtn.textContent = '🗑️ Delete';
      }
    }

    async function removeSelectedGachaCards() {
      if (!selectedGachaSet.size) return;
      const count = selectedGachaSet.size;
      const ok = await showCustomConfirm(
        `Remove <strong>${count}</strong> summoned card${count > 1 ? 's' : ''} from gacha history?`,
        'Remove Summoned Cards'
      );
      if (!ok) return;

      const removeIds = new Set(selectedGachaSet);
      gachaSummonHistory = gachaSummonHistory.filter(item => {
        const sid = item.summonId || (item.postId + '_' + item.summonedAt);
        return !removeIds.has(sid);
      });

      // Recalculate unlocked catalog IDs
      unlockedGachaSet = new Set(gachaSummonHistory.map(i => i.postId || i.id));

      selectedGachaSet.clear();
      saveGachaStateToStorage(false);
      updateGachaStats();
      renderGachaResults();
      updateGachaSelectionVisuals();
      recordActionLog('gacha', `Removed ${count} cards from gacha inventory`);
      showToast(`Removed ${count} cards from inventory`, 'info', '🎰');
    }

    // FOCUS BLUR QUICK ZOOM OVERLAY LOGIC
    function openFocusBlurView(imageUrl) {
      if (!imageUrl) return;
      focusBlurImg.src = imageUrl;
      focusBlurOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeFocusBlurView() {
      focusBlurOverlay.classList.remove('open');
      focusBlurImg.src = '';
      if (!modal.classList.contains('open') && !pokemonModal.classList.contains('open') && !gachaSummonOverlay.classList.contains('active')) {
        document.body.style.overflow = '';
      }
    }

    focusBlurOverlay.addEventListener('click', closeFocusBlurView);
    focusBlurCloseBtn.addEventListener('click', closeFocusBlurView);

    profileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = profileMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        updateProfileUI();
        profileMenu.classList.add('open');
        adjustDropdownPlacement(profileMenu);
      }
    });

    createProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      createNewProfile();
    });
    renameProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      renameCurrentProfile();
    });
    resetProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      resetCurrentProfile();
    });
    deleteProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      deleteCurrentProfile();
    });
    exportProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      exportCurrentProfile();
    });
    importProfileBtn.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      document.getElementById('profileFileInput').click();
    });

    // Themes & Secret Codes
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
      document.body.classList.remove('theme-grayscale', 'theme-ptit', 'theme-zen3', 'theme-kazuki');

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
      } else if (themeName === 'KAZUKI') {
        document.body.classList.add('theme-kazuki');
        activeSecretTheme = 'KAZUKI';
        localStorage.setItem('gallery_secret_theme', 'KAZUKI');
      }
    }

    function clearSecretTheme() {
      document.documentElement.classList.remove('theme-grayscale');
      document.body.classList.remove('theme-grayscale', 'theme-ptit', 'theme-zen3', 'theme-kazuki');
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

    if (activeSecretTheme) applySecretTheme(activeSecretTheme);

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
        recordActionLog('storage', 'Secret code applied: GRAYSCALE');
        setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
      } else if (code === 'PTIT') {
        applySecretTheme('PTIT');
        secretCodeMsg.style.display = 'block';
        secretCodeMsg.style.color = '#00F0FF';
        secretCodeMsg.textContent = '✓ PTIT Red theme applied';
        recordActionLog('storage', 'Secret code applied: PTIT Red');
        setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
      } else if (code === 'ZEN3') {
        applySecretTheme('ZEN3');
        secretCodeMsg.style.display = 'block';
        secretCodeMsg.style.color = '#FF3366';
        secretCodeMsg.textContent = '✓ Zen 3 Purple theme applied';
        recordActionLog('storage', 'Secret code applied: Zen 3 Purple');
        setTimeout(() => secretCodeMenu.classList.remove('open'), 700);
      } else if (code === 'KAZUKI') {
        applySecretTheme('KAZUKI');
        secretCodeMsg.style.display = 'block';
        secretCodeMsg.style.color = '#00FF9D';
        secretCodeMsg.textContent = '✓ Kazuki Dark Blue theme applied';
        recordActionLog('storage', 'Secret code applied: Kazuki Dark Blue');
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
        adjustDropdownPlacement(secretCodeMenu);
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

    // Navigation & Tab Switching
    function activateTab(tabBtn, viewEl) {
      if (isSelectionMode) setSelectionMode(false);
      if (isGachaSelectionMode) setGachaSelectionMode(false);

      [tabGallery, tabCollections, tabGacha].forEach(t => t.classList.remove('active'));
      [galleryView, collectionsView, gachaView].forEach(v => v.style.display = 'none');

      tabBtn.classList.add('active');
      viewEl.style.display = 'block';

      const isGridTab = (tabBtn === tabGallery || tabBtn === tabCollections);
      galleryViewToggles.style.display = isGridTab ? 'inline-flex' : 'none';
      galleryZoomWrap.style.display = isGridTab ? 'inline-flex' : 'none';
      multiSelectToggleBtn.style.display = isGridTab ? 'inline-flex' : 'none';

      if (tabBtn === tabCollections) {
        batchRemoveFromColBtn.style.display = 'inline-flex';
        batchAddToColBtn.style.display = 'none';
      } else {
        batchRemoveFromColBtn.style.display = 'none';
        batchAddToColBtn.style.display = 'inline-flex';
      }
    }

    tabGallery.addEventListener('click', () => {
      activateTab(tabGallery, galleryView);
      renderColumns();
    });

    tabCollections.addEventListener('click', () => {
      activateTab(tabCollections, collectionsView);
      renderCollectionsShelf();
      if (activeCollectionId && customCollections[activeCollectionId]) {
        openCollection(activeCollectionId);
      }
    });

    tabGacha.addEventListener('click', () => {
      activateTab(tabGacha, gachaView);
      updateBannerCounts();
      rebuildDeterministicPools();
      updatePityUI();
      updateGachaColZoomUI();
      if (gachaSubTabCompendium.classList.contains('active')) {
        renderCompendium();
      } else {
        renderGachaResults();
      }
      preloadAllCardImages(currentItems);
    });

    actionLogsMenuBtn.addEventListener('click', () => {
      storageMenu.classList.remove('open');
      renderActionLogs();
      actionLogsModal.classList.add('open');
    });
    closeActionLogsBtn.addEventListener('click', () => actionLogsModal.classList.remove('open'));
    actionLogsModal.addEventListener('click', (e) => {
      if (e.target === actionLogsModal) actionLogsModal.classList.remove('open');
    });
    clearActionLogsBtn.addEventListener('click', async () => {
      const ok = await showCustomConfirm('Clear all activity logs for this profile?', 'Clear Action Logs');
      if (ok) {
        actionLogs = [];
        try {
          localStorage.removeItem(getProfileDataKey('action_logs'));
        } catch (e) {}
        renderActionLogs();
        showToast('Action logs cleared', 'info');
      }
    });

    gachaSubTabSummon.addEventListener('click', () => {
      gachaSubTabSummon.classList.add('active');
      gachaSubTabCompendium.classList.remove('active');
      gachaSummonStageContainer.style.display = 'block';
      compendiumContainer.style.display = 'none';
    });

    gachaSubTabCompendium.addEventListener('click', () => {
      gachaSubTabCompendium.classList.add('active');
      gachaSubTabSummon.classList.remove('active');
      gachaSummonStageContainer.style.display = 'none';
      compendiumContainer.style.display = 'block';
      renderCompendium();
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
      if (modalTagPickerMenu) modalTagPickerMenu.classList.remove('open');
      if (modalTagPickerBtn) modalTagPickerBtn.classList.remove('active');
      if (customDialogSelectMenu) customDialogSelectMenu.classList.remove('open');
      if (customDialogSelectTrigger) customDialogSelectTrigger.classList.remove('active');
    }

    badgeVisibilityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = badgeVisibilityMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        badgeVisibilityMenu.classList.add('open');
        adjustDropdownPlacement(badgeVisibilityMenu);
      }
    });

    badgeVisibilityMenu.addEventListener('click', (e) => e.stopPropagation());
    skipLoadingBtn.addEventListener('click', () => importLoadingOverlay.classList.remove('active'));

    function getScreenColLimits() {
      const w = window.innerWidth;
      const isPortrait = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > w;
      if (w < 480) return { min: 1, max: isPortrait ? 2 : 3 };
      if (w < 768) return { min: 1, max: isPortrait ? 2 : 4 };
      if (w < 1024) return { min: 2, max: isPortrait ? 4 : 5 };
      if (w < 1400) return { min: 2, max: 6 };
      return { min: 2, max: 8 };
    }

    function updateColZoomUI() {
      const { min, max } = getScreenColLimits();
      galleryColCount = Math.max(min, Math.min(galleryColCount, max));
      colCountLabel.textContent = `${galleryColCount} col${galleryColCount > 1 ? 's' : ''}`;
      galZoomMinus.disabled = (galleryColCount <= min);
      galZoomPlus.disabled = (galleryColCount >= max);
      galZoomMinus.style.opacity = (galleryColCount <= min) ? '0.35' : '1';
      galZoomPlus.style.opacity = (galleryColCount >= max) ? '0.35' : '1';
    }

    function onZoomChange() {
      updateColZoomUI();
      if (galleryView.style.display !== 'none') {
        renderColumns();
      } else if (collectionsView.style.display !== 'none' && activeCollectionId) {
        openCollection(activeCollectionId);
      }
    }

    galZoomMinus.addEventListener('click', () => {
      const { min } = getScreenColLimits();
      if (galleryColCount > min) {
        galleryColCount = Math.max(galleryColCount - 1, min);
        localStorage.setItem('gallery_col_count', galleryColCount);
        onZoomChange();
      }
    });

    galZoomPlus.addEventListener('click', () => {
      const { max } = getScreenColLimits();
      if (galleryColCount < max) {
        galleryColCount = Math.min(galleryColCount + 1, max);
        localStorage.setItem('gallery_col_count', galleryColCount);
        onZoomChange();
      }
    });

    storageMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = storageMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        storageMenu.classList.add('open');
        adjustDropdownPlacement(storageMenu);
      }
    });

    exportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = exportMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        exportMenu.classList.add('open');
        adjustDropdownPlacement(exportMenu);
      }
    });

    exportMenu.addEventListener('click', (e) => e.stopPropagation());
    loadFilesBtn.addEventListener('click', () => fileInput.click());
    window.addEventListener('click', () => closeAllDropdowns());

    // Atmosphere Particles
    let atmosphereParticles = [];
    let atmosphereAnimId = null;
    let targetAtmosphereCanvas = null;
    let atmCtx = null;

    function resizeAtmosphereCanvas() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (pokemonAtmosphereCanvas) {
        pokemonAtmosphereCanvas.width = w;
        pokemonAtmosphereCanvas.height = h;
      }
      if (summonInspectAtmosphereCanvas) {
        summonInspectAtmosphereCanvas.width = w;
        summonInspectAtmosphereCanvas.height = h;
      }
    }
    window.addEventListener('resize', resizeAtmosphereCanvas);

    class AtmosphereParticle {
      constructor(tier, canvasEl) {
        this.tier = tier;
        this.canvas = canvasEl;
        this.reset(true);
      }

      reset(init = false) {
        const w = this.canvas ? this.canvas.width : window.innerWidth;
        const h = this.canvas ? this.canvas.height : window.innerHeight;
        this.x = Math.random() * w;
        this.y = init ? Math.random() * h : h + 15;
        this.size = Math.random() * 3 + 1.2;
        this.alpha = Math.random() * 0.6 + 0.2;
        this.sparklePhase = Math.random() * Math.PI * 2;

        const themeRarityColor = getComputedRarityColor(this.tier);

        if (this.tier === 'ssr') {
          this.vx = (Math.random() - 0.5) * 1.8;
          this.vy = -(Math.random() * 1.8 + 1.0);
          this.size = Math.random() * 3.8 + 1.8;
          this.color = Math.random() > 0.25 ? themeRarityColor : '#FFFFFF';
          this.glow = 15;
        } else if (this.tier === 'sr') {
          this.vx = Math.sin(Math.random() * Math.PI * 2) * 1.2;
          this.vy = -(Math.random() * 1.2 + 0.5);
          this.size = Math.random() * 3.5 + 1.2;
          this.color = Math.random() > 0.35 ? themeRarityColor : '#FFFFFF';
          this.glow = 10;
        } else if (this.tier === 'r') {
          this.vx = (Math.random() - 0.5) * 1.0;
          this.vy = -(Math.random() * 1.0 + 0.4);
          this.size = Math.random() * 2.8 + 1.0;
          this.color = Math.random() > 0.3 ? themeRarityColor : '#FFFFFF';
          this.glow = 8;
        } else {
          this.vx = (Math.random() - 0.5) * 0.6;
          this.vy = -(Math.random() * 0.5 + 0.2);
          this.size = Math.random() * 2.2 + 0.8;
          this.color = themeRarityColor;
          this.glow = 4;
        }
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.sparklePhase += (this.tier === 'ssr' ? 0.08 : 0.05);

        if (this.tier === 'ssr' || this.tier === 'sr') {
          this.alpha = 0.35 + Math.abs(Math.sin(this.sparklePhase)) * 0.55;
        }

        const h = this.canvas ? this.canvas.height : window.innerHeight;
        const w = this.canvas ? this.canvas.width : window.innerWidth;
        if (this.y < -25 || this.x < -25 || this.x > (w + 25)) {
          this.reset(false);
        }
      }

      draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
        ctx.fillStyle = this.color;
        ctx.shadowBlur = this.glow;
        ctx.shadowColor = this.color;

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function initAtmosphereParticles(tier, canvasEl = pokemonAtmosphereCanvas) {
      resizeAtmosphereCanvas();
      targetAtmosphereCanvas = canvasEl;
      if (!targetAtmosphereCanvas) return;
      atmCtx = targetAtmosphereCanvas.getContext('2d');
      atmosphereParticles = [];

      const count = (tier === 'ssr') ? 75 : (tier === 'sr' ? 50 : (tier === 'r' ? 35 : 20));
      for (let i = 0; i < count; i++) {
        atmosphereParticles.push(new AtmosphereParticle(tier, targetAtmosphereCanvas));
      }
      loopAtmosphereParticles();
    }

    function clearAtmosphereParticles(canvasEl = targetAtmosphereCanvas) {
      if (atmosphereAnimId) {
        cancelAnimationFrame(atmosphereAnimId);
        atmosphereAnimId = null;
      }
      atmosphereParticles = [];
      if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      }
    }

    function loopAtmosphereParticles() {
      const isPokeModalOpen = pokemonModal && pokemonModal.classList.contains('open');
      const isInspectOpen = summonStageInspect && summonStageInspect.style.display === 'flex';

      if ((!isPokeModalOpen && !isInspectOpen) || !atmCtx || !targetAtmosphereCanvas) {
        if (atmosphereAnimId) cancelAnimationFrame(atmosphereAnimId);
        atmosphereAnimId = null;
        return;
      }

      atmCtx.clearRect(0, 0, targetAtmosphereCanvas.width, targetAtmosphereCanvas.height);
      atmosphereParticles.forEach(p => {
        p.update();
        p.draw(atmCtx);
      });
      atmosphereAnimId = requestAnimationFrame(loopAtmosphereParticles);
    }

    // MULTI-SELECT ENGINE & BATCH ACTIONS
    function setSelectionMode(active) {
      isSelectionMode = active;
      document.body.classList.toggle('selection-mode-active', isSelectionMode);
      multiSelectToggleBtn.style.color = isSelectionMode ? 'var(--accent)' : 'var(--subtext)';
      multiSelectToggleBtn.style.borderColor = isSelectionMode ? 'var(--accent)' : 'var(--border)';
      if (!isSelectionMode) deselectAll();
    }

    multiSelectToggleBtn.addEventListener('click', () => {
      setSelectionMode(!isSelectionMode);
    });

    function toggleCardSelection(id) {
      if (selectedItemsSet.has(id)) {
        selectedItemsSet.delete(id);
      } else {
        selectedItemsSet.add(id);
      }
      updateSelectionVisuals();
    }

    function updateSelectionVisuals() {
      document.querySelectorAll('[data-post-id]').forEach(el => {
        const id = el.dataset.postId;
        const cb = el.querySelector('.card-select-checkbox');
        const isSel = selectedItemsSet.has(id);
        if (cb) cb.checked = isSel;
        el.classList.toggle('card-selected-highlight', isSel);
      });

      if (gachaView.style.display === 'none') {
        batchSelectedCount.textContent = selectedItemsSet.size;
        batchActionBar.classList.toggle('visible', selectedItemsSet.size > 0);
        batchDeleteBtn.textContent = '🗑️ Delete';
      }
    }

    function deselectAll() {
      selectedItemsSet.clear();
      selectedGachaSet.clear();
      updateSelectionVisuals();
      updateGachaSelectionVisuals();
    }

    batchCancelBtn.addEventListener('click', deselectAll);

    batchDeleteBtn.addEventListener('click', async () => {
      if (gachaView.style.display !== 'none' && isGachaSelectionMode) {
        await removeSelectedGachaCards();
        return;
      }
      if (!selectedItemsSet.size) return;
      const count = selectedItemsSet.size;
      const ok = await showCustomConfirm(
        `Are you sure you want to delete <strong>${count}</strong> selected artwork${count > 1 ? 's' : ''}?`,
        'Delete Selected Items'
      );
      if (ok) {
        const ids = Array.from(selectedItemsSet);
        for (const id of ids) {
          await deletePost(id, false);
        }
        deselectAll();
        showToast(`Deleted ${count} item${count > 1 ? 's' : ''}`, 'success', '🗑️');
      }
    });

    batchExportBtn.addEventListener('click', () => {
      if (!selectedItemsSet.size) return;
      const postsToExport = [];
      allImportedPosts.forEach((post, id) => {
        if (selectedItemsSet.has(id)) postsToExport.push(post);
      });
      executePostsExport(postsToExport, `selected_posts_${postsToExport.length}`);
    });

    batchTagBtn.addEventListener('click', async () => {
      if (!selectedItemsSet.size) return;
      const tag = await showCustomPrompt('Enter custom tag to apply to all selected items:', '', 'Batch Add Tag');
      if (!tag || !tag.trim()) return;
      const cleanTag = tag.trim().replace(/^#/, '');

      for (const id of selectedItemsSet) {
        const key = 'user_meta_' + id;
        const meta = (await getCachedMeta(key)) || { tags: [], note: '' };
        if (!meta.tags.includes(cleanTag)) {
          meta.tags.push(cleanTag);
          await saveMetaToDB(key, meta);
        }
        if (allImportedPosts.has(id)) {
          const p = allImportedPosts.get(id);
          if (!p.userTags) p.userTags = [];
          if (!p.userTags.includes(cleanTag)) p.userTags.push(cleanTag);
        }
        currentItems.filter(i => (i.postId === id || i.id === id)).forEach(i => {
          if (!i.userTags) i.userTags = [];
          if (!i.userTags.includes(cleanTag)) i.userTags.push(cleanTag);
        });
      }
      extractAllUserTags();
      recordActionLog('tag', `Added tag #${cleanTag} to ${selectedItemsSet.size} items`);
      showToast(`Tag #${cleanTag} applied to ${selectedItemsSet.size} items`, 'success', '🏷️');
      deselectAll();
      if (galleryView.style.display !== 'none') renderColumns();
      else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
    });

    async function openAddToCollectionFlow(itemIdsToAdd) {
      if (!itemIdsToAdd || !itemIdsToAdd.length) return;

      const buildOptions = () => {
        return Object.values(customCollections).map(c => ({
          value: c.id,
          label: `${c.name} (${c.itemIds.length} items)`
        }));
      };

      let options = buildOptions();
      if (!options.length) {
        const defId = 'col_' + Date.now();
        customCollections[defId] = { id: defId, name: 'Favorites', desc: '', itemIds: [] };
        saveCollections();
        options = buildOptions();
      }

      const pickedId = await showCustomSelectPrompt(
        'Select target collection to add artwork(s):',
        options,
        'Add to Collection',
        true
      );

      if (!pickedId) return;

      const target = customCollections[pickedId];
      if (target) {
        let addedCount = 0;
        itemIdsToAdd.forEach(id => {
          if (!target.itemIds.includes(id)) {
            target.itemIds.push(id);
            addedCount++;
          }
        });
        saveCollections();
        recordActionLog('collection', `Added ${addedCount} items to collection "${target.name}"`);
        showToast(`Added ${addedCount} artwork(s) to "${target.name}"`, 'success', '📁');
      }
    }

    batchAddToColBtn.addEventListener('click', async () => {
      if (!selectedItemsSet.size) return;
      await openAddToCollectionFlow(Array.from(selectedItemsSet));
      deselectAll();
    });

    if (modalAddToColBtn) {
      modalAddToColBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!activeModalItem) return;
        const pId = activeModalItem.postId || activeModalItem.id;
        await openAddToCollectionFlow([pId]);
      });
    }

    batchRemoveFromColBtn.addEventListener('click', async () => {
      if (!selectedItemsSet.size || !activeCollectionId || !customCollections[activeCollectionId]) return;
      const col = customCollections[activeCollectionId];
      const count = selectedItemsSet.size;
      const ok = await showCustomConfirm(
        `Remove <strong>${count}</strong> item${count > 1 ? 's' : ''} from collection <strong>"${col.name}"</strong>?`,
        'Remove from Collection'
      );
      if (ok) {
        const removeIds = new Set(selectedItemsSet);
        col.itemIds = col.itemIds.filter(id => !removeIds.has(id));
        saveCollections();
        recordActionLog('collection', `Removed ${count} items from collection "${col.name}"`);
        showToast(`Removed ${count} artworks from "${col.name}"`, 'info', '❌');
        deselectAll();
        openCollection(activeCollectionId);
      }
    });

    // ===================================================
    // COLLECTIONS SHELF MANAGEMENT
    // ===================================================
    function saveCollections() {
      try {
        localStorage.setItem(getProfileDataKey('custom_collections'), JSON.stringify(customCollections));
      } catch (e) {}
      renderCollectionsShelf();
      collectionsCountBadge.textContent = Object.keys(customCollections).length;
    }

    function renderCollectionsShelf() {
      collectionsShelf.innerHTML = '';
      const list = Object.values(customCollections);
      collectionsCountBadge.textContent = list.length;

      if (!list.length) {
        collectionsShelf.innerHTML = `<div style="font-size:0.85rem; color:var(--subtext); padding: 6px 0;">No collections created yet. Click "+ New Collection" to organize your library.</div>`;
        return;
      }

      list.forEach(col => {
        const chip = document.createElement('div');
        chip.className = `col-card-chip ${activeCollectionId === col.id ? 'active' : ''}`;
        chip.innerHTML = `
          <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-bold);">${col.name}</div>
          <div style="font-size: 0.75rem; color: var(--subtext);">${col.itemIds.length} items</div>
        `;
        chip.addEventListener('click', () => openCollection(col.id));
        collectionsShelf.appendChild(chip);
      });
    }

    // REMOVE SINGLE POST SPECIFICALLY FROM CURRENT ACTIVE COLLECTION
    async function removePostFromCollection(postId) {
      if (!activeCollectionId || !customCollections[activeCollectionId]) return;
      const col = customCollections[activeCollectionId];
      const ok = await showCustomConfirm(
        `Remove this post from collection <strong>"${col.name}"</strong>? (The artwork will remain saved in your gallery)`,
        'Remove from Collection'
      );
      if (!ok) return;

      col.itemIds = col.itemIds.filter(id => id !== postId);
      saveCollections();
      recordActionLog('collection', `Removed post ID ${postId} from collection "${col.name}"`);
      showToast(`Removed from "${col.name}"`, 'info', '❌');
      openCollection(activeCollectionId);
    }

    function openCollection(colId) {
      activeCollectionId = colId;
      renderCollectionsShelf();
      const col = customCollections[colId];
      if (!col) return;

      activeCollectionDetails.style.display = 'block';
      activeColTitle.textContent = col.name;
      activeColDesc.textContent = col.desc || `${col.itemIds.length} artworks collected`;

      collectionGalleryGrid.innerHTML = '';

      const colIdSet = new Set(col.itemIds);
      const colItems = [];

      allImportedPosts.forEach((post, id) => {
        if (colIdSet.has(id)) {
          const matchingMedia = currentItems.filter(i => (i.postId === id || i.id === id));
          if (matchingMedia.length) {
            matchingMedia.forEach(m => colItems.push(m));
          } else {
            colItems.push({
              id: post.id,
              postId: post.id,
              platform: post.platform,
              imgUrl: post.mediaUrl,
              fallbackUrl: post.fallbackUrl || post.mediaUrl,
              authorName: post.platform === 'pinterest' ? 'Pinterest creator' : post.authorName,
              authorHandle: post.authorHandle,
              text: post.text,
              timestamp: post.timestamp,
              url: post.url,
              totalPages: 1,
              pageIndex: 0
            });
          }
        }
      });

      if (!colItems.length) {
        collectionGalleryGrid.innerHTML = `
          <div class="empty-state-notice">
            <div>This collection is currently empty.</div>
            <div style="font-size:0.8rem; color:var(--subtext);">Use the Select tool in the Gallery tab or click "📁 Add to Collection" while viewing any artwork.</div>
          </div>
        `;
        return;
      }

      updateColZoomUI();
      const numCols = galleryColCount;
      for (let i = 0; i < numCols; i++) {
        const colDiv = document.createElement('div');
        colDiv.className = 'gallery-column';
        collectionGalleryGrid.appendChild(colDiv);
      }
      const cols = collectionGalleryGrid.querySelectorAll('.gallery-column');

      colItems.forEach((item, idx) => {
        // Pass isCollectionContext = true to wire the trash icon to remove from collection
        const card = (currentViewMode === 'posts') ? createPostCard(item, 0, true) : createMediaCard(item, 0, true);
        cols[idx % cols.length].appendChild(card);
      });

      updateSelectionVisuals();
    }

    createNewColBtn.addEventListener('click', async () => {
      const name = await showCustomPrompt('Enter a name for the new collection:', '', 'New Collection');
      if (name && name.trim()) {
        const desc = (await showCustomPrompt('Enter an optional description:', '', 'Collection Description')) || '';
        const id = 'col_' + Date.now();
        customCollections[id] = { id, name: name.trim(), desc: desc.trim(), itemIds: [] };
        saveCollections();
        recordActionLog('collection', `Created collection "${name.trim()}"`);
        showToast(`Created collection "${name.trim()}"`, 'success', '📁');
        openCollection(id);
      }
    });

    renameActiveColBtn.addEventListener('click', async () => {
      if (!activeCollectionId || !customCollections[activeCollectionId]) return;
      const col = customCollections[activeCollectionId];
      const newName = await showCustomPrompt('Rename collection to:', col.name, 'Rename Collection');
      if (newName && newName.trim()) {
        const oldName = col.name;
        col.name = newName.trim();
        saveCollections();
        recordActionLog('collection', `Renamed collection "${oldName}" to "${col.name}"`);
        showToast(`Renamed to "${col.name}"`, 'info', '✏️');
        openCollection(col.id);
      }
    });

    deleteActiveColBtn.addEventListener('click', async () => {
      if (!activeCollectionId || !customCollections[activeCollectionId]) return;
      const colName = customCollections[activeCollectionId].name;
      const ok = await showCustomConfirm(
        `Delete collection <strong>"${colName}"</strong>?<br><span style="font-size:0.8rem; color:var(--subtext);">Artworks will stay safe in your library.</span>`,
        'Delete Collection'
      );
      if (ok) {
        delete customCollections[activeCollectionId];
        activeCollectionId = null;
        activeCollectionDetails.style.display = 'none';
        saveCollections();
        recordActionLog('collection', `Deleted collection "${colName}"`);
        showToast(`Collection "${colName}" deleted`, 'info', '🗑️');
      }
    });

    function exportCollectionsJSON() {
      const keys = Object.keys(customCollections);
      if (!keys.length) {
        showCustomAlert('No collections found to export.', 'Export Collections', 'warn');
        return;
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        collectionsCount: keys.length,
        collections: customCollections
      };
      downloadExportPayload(payload, `collections_backup_${Date.now()}.json`);
      recordActionLog('export', `Exported ${keys.length} collections`);
      showToast(`Exported ${keys.length} collections`, 'success', '📤');
    }

    exportColsBtn.addEventListener('click', exportCollectionsJSON);
    exportColsMenuBtn.addEventListener('click', () => {
      exportMenu.classList.remove('open');
      exportCollectionsJSON();
    });

    importColsBtn.addEventListener('click', () => collectionsFileInput.click());
    importColsMenuBtn.addEventListener('click', () => {
      storageMenu.classList.remove('open');
      collectionsFileInput.click();
    });

    collectionsFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          const incoming = data.collections || (typeof data === 'object' && !Array.isArray(data) ? data : null);

          if (!incoming || typeof incoming !== 'object') {
            throw new Error('Invalid collection format');
          }

          let added = 0;
          let merged = 0;

          Object.values(incoming).forEach(col => {
            if (!col || !col.name) return;
            const existingId = Object.keys(customCollections).find(k => customCollections[k].name === col.name);

            if (existingId) {
              const existingSet = new Set(customCollections[existingId].itemIds || []);
              (col.itemIds || []).forEach(id => existingSet.add(id));
              customCollections[existingId].itemIds = Array.from(existingSet);
              merged++;
            } else {
              const newId = col.id || ('col_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
              customCollections[newId] = {
                id: newId,
                name: col.name,
                desc: col.desc || '',
                itemIds: Array.isArray(col.itemIds) ? [...col.itemIds] : []
              };
              added++;
            }
          });

          saveCollections();
          recordActionLog('import', `Imported collections: ${added} new, ${merged} merged`);
          await showCustomAlert(`Collections imported successfully!<br>New: ${added}<br>Merged: ${merged}`, 'Import Collections', 'success');
        } catch (err) {
          showCustomAlert('Failed to parse collections JSON: ' + err.message, 'Import Error', 'error');
        }
        collectionsFileInput.value = '';
      };
      reader.readAsText(file);
    });

    // ===================================================
    // USER TAGS MANAGEMENT
    // ===================================================
    function extractAllUserTags() {
      allExtractedUserTagsMap.clear();

      currentItems.forEach(item => {
        if (Array.isArray(item.userTags)) {
          item.userTags.forEach(t => {
            const clean = t.trim();
            if (clean) {
              allExtractedUserTagsMap.set(clean, (allExtractedUserTagsMap.get(clean) || 0) + 1);
            }
          });
        }
      });

      allExtractedUserTagsList = Array.from(allExtractedUserTagsMap.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag]) => tag);

      renderUserTagDropdownOptions();
      renderModalTagPickerOptions();
      updateActiveFilterChips();
    }

    function createNewGlobalTag(tagName) {
      if (!tagName || !tagName.trim()) return;
      const clean = tagName.trim().replace(/^#/, '');
      if (!clean) return;

      if (!allExtractedUserTagsMap.has(clean)) {
        allExtractedUserTagsMap.set(clean, 0);
        allExtractedUserTagsList.unshift(clean);
      }
      activeUserTagsSet.add(clean);
      renderUserTagDropdownOptions();
      updateActiveFilterChips();
      renderColumns();
      showToast(`Created tag #${clean}`, 'success', '🏷️');
    }

    if (createNewTagBtn && createNewTagInput) {
      createNewTagBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = createNewTagInput.value;
        if (val) {
          createNewGlobalTag(val);
          createNewTagInput.value = '';
        }
      });

      createNewTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = createNewTagInput.value;
          if (val) {
            createNewGlobalTag(val);
            createNewTagInput.value = '';
          }
        }
      });
    }

    function setupModalTagPicker() {
      if (!modalTagPickerBtn || !modalTagPickerMenu) return;

      modalTagPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = modalTagPickerMenu.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
          modalTagPickerMenu.classList.add('open');
          modalTagPickerBtn.classList.add('active');
          if (modalTagPickerSearch) {
            modalTagPickerSearch.value = '';
            setTimeout(() => modalTagPickerSearch.focus(), 60);
          }
          renderModalTagPickerOptions();
        }
      });

      modalTagPickerMenu.addEventListener('click', (e) => e.stopPropagation());

      if (modalTagPickerSearch) {
        modalTagPickerSearch.addEventListener('input', () => renderModalTagPickerOptions());
        modalTagPickerSearch.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const val = modalTagPickerSearch.value.trim().replace(/^#/, '');
            if (val) {
              await addTagToActiveCard(val);
              modalTagPickerSearch.value = '';
              renderModalTagPickerOptions();
            }
          }
        });
      }
    }

    async function addTagToActiveCard(tagVal) {
      if (!tagVal) return;
      const clean = tagVal.trim().replace(/^#/, '');
      if (!clean) return;
      if (!activeModalUserMeta.tags) activeModalUserMeta.tags = [];
      if (!activeModalUserMeta.tags.includes(clean)) {
        activeModalUserMeta.tags.push(clean);
        await saveActiveUserMeta();
        renderModalTags();
        renderModalTagPickerOptions();
        showToast(`Tag #${clean} added`, 'success', '🏷️');
      }
    }

    function renderModalTagPickerOptions() {
      if (!modalTagPickerList) return;
      modalTagPickerList.innerHTML = '';

      const query = (modalTagPickerSearch ? modalTagPickerSearch.value : '').trim().toLowerCase().replace(/^#/, '');
      const assigned = new Set(activeModalUserMeta?.tags || []);

      let candidateTags = allExtractedUserTagsList.filter(t => !assigned.has(t));
      if (query) {
        candidateTags = candidateTags.filter(t => t.toLowerCase().includes(query));
      }

      if (query && !candidateTags.some(t => t.toLowerCase() === query) && !assigned.has(query)) {
        const createItem = document.createElement('button');
        createItem.type = 'button';
        createItem.className = 'user-tag-picker-item';
        createItem.style.color = 'var(--accent)';
        createItem.style.fontWeight = '700';
        createItem.innerHTML = `<span>➕ Create tag "#${query}"</span>`;
        createItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          await addTagToActiveCard(query);
          if (modalTagPickerSearch) modalTagPickerSearch.value = '';
          renderModalTagPickerOptions();
        });
        modalTagPickerList.appendChild(createItem);
      }

      if (!candidateTags.length && (!query || assigned.has(query))) {
        if (!modalTagPickerList.children.length) {
          modalTagPickerList.innerHTML = `<div style="font-size:0.75rem; color:var(--subtext); padding:8px; text-align:center;">No tags available</div>`;
        }
        return;
      }

      candidateTags.forEach(tag => {
        const count = allExtractedUserTagsMap.get(tag) || 0;
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = 'user-tag-picker-item';
        itemBtn.innerHTML = `
          <span>#${tag}</span>
          <span class="badge">${count}</span>
        `;
        itemBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await addTagToActiveCard(tag);
          if (modalTagPickerSearch) modalTagPickerSearch.value = '';
          renderModalTagPickerOptions();
        });
        modalTagPickerList.appendChild(itemBtn);
      });
    }

    customTagsMultiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = customTagsMultiMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        customTagsMultiMenu.classList.add('open');
        adjustDropdownPlacement(customTagsMultiMenu);
        customTagDropdownSearch.focus();
      }
    });
    customTagsMultiMenu.addEventListener('click', (e) => e.stopPropagation());
    customTagDropdownSearch.addEventListener('input', () => renderUserTagDropdownOptions());

    clearUserTagsFilterBtn.addEventListener('click', () => {
      activeUserTagsSet.clear();
      renderUserTagDropdownOptions();
      updateActiveFilterChips();
      renderColumns();
    });

    if (wipeAllUserTagsBtn) {
      wipeAllUserTagsBtn.addEventListener('click', async () => {
        const totalTags = allExtractedUserTagsList.length;
        if (totalTags === 0) {
          showToast('No custom tags exist to wipe', 'info');
          return;
        }

        const ok = await showCustomConfirm(
          `Completely remove and wipe <strong>ALL (${totalTags}) custom tags</strong> from every single card in your gallery?`,
          'Wipe All Custom Tags'
        );
        if (!ok) return;

        for (const [id, post] of allImportedPosts.entries()) {
          post.userTags = [];
          const key = 'user_meta_' + id;
          const meta = (await getCachedMeta(key)) || { tags: [], note: '' };
          meta.tags = [];
          await saveMetaToDB(key, meta);
        }

        currentItems.forEach(item => {
          item.userTags = [];
        });

        activeUserTagsSet.clear();
        if (activeModalUserMeta) {
          activeModalUserMeta.tags = [];
          renderModalSummary();
          renderModalTags();
          renderModalTagPickerOptions();
        }

        extractAllUserTags();
        recordActionLog('tag', `Wiped all ${totalTags} custom tags globally`);
        showToast(`Successfully wiped all ${totalTags} custom tags`, 'info', '🗑️');

        if (galleryView.style.display !== 'none') renderColumns();
        else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
      });
    }

    function toggleUserTagFilter(tag) {
      if (activeUserTagsSet.has(tag)) activeUserTagsSet.delete(tag);
      else activeUserTagsSet.add(tag);
      renderUserTagDropdownOptions();
      updateActiveFilterChips();
      renderColumns();
    }

    async function deleteGlobalCustomTag(tag) {
      const ok = await showCustomConfirm(
        `Permanently remove custom tag <strong>#${tag}</strong> from all artworks?`,
        'Delete Custom Tag'
      );
      if (!ok) return;

      let modifiedCount = 0;

      for (const [id, post] of allImportedPosts.entries()) {
        if (Array.isArray(post.userTags) && post.userTags.includes(tag)) {
          post.userTags = post.userTags.filter(t => t !== tag);
          const key = 'user_meta_' + id;
          const meta = (await getCachedMeta(key)) || { tags: [], note: '' };
          meta.tags = (meta.tags || []).filter(t => t !== tag);
          await saveMetaToDB(key, meta);
          modifiedCount++;
        }
      }

      currentItems.forEach(item => {
        if (Array.isArray(item.userTags)) {
          item.userTags = item.userTags.filter(t => t !== tag);
        }
      });

      activeUserTagsSet.delete(tag);
      extractAllUserTags();

      if (activeModalUserMeta && Array.isArray(activeModalUserMeta.tags)) {
        activeModalUserMeta.tags = activeModalUserMeta.tags.filter(t => t !== tag);
        renderModalSummary();
        renderModalTags();
        renderModalTagPickerOptions();
      }

      recordActionLog('tag', `Permanently deleted tag #${tag} from ${modifiedCount} artworks`);
      showToast(`Removed #${tag} from ${modifiedCount} artworks`, 'info', '🏷️');

      if (galleryView.style.display !== 'none') renderColumns();
      else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
    }

    function renderUserTagDropdownOptions() {
      const q = customTagDropdownSearch.value.trim().toLowerCase();
      customTagDropdownList.innerHTML = '';

      let list = allExtractedUserTagsList;
      if (q) list = list.filter(t => t.toLowerCase().includes(q));

      if (!list.length) {
        customTagDropdownList.innerHTML = `<div style="font-size:0.75rem; color:var(--subtext); padding:8px; text-align:center;">No custom tags found</div>`;
        return;
      }

      list.forEach(tag => {
        const count = allExtractedUserTagsMap.get(tag) || 0;
        const isChecked = activeUserTagsSet.has(tag);

        const itemRow = document.createElement('div');
        itemRow.className = 'dropdown-item';
        itemRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 6px;';

        itemRow.innerHTML = `
          <label style="display:flex; align-items:center; gap:6px; overflow:hidden; cursor:pointer; flex:1;">
            <input type="checkbox" ${isChecked ? 'checked' : ''} style="cursor:pointer; flex-shrink:0;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">#${tag}</span>
          </label>
          <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
            <span class="badge">${count}</span>
            <button type="button" class="delete-global-tag-btn" title="Delete this custom tag globally">&times;</button>
          </div>
        `;

        const chk = itemRow.querySelector('input');
        chk.addEventListener('change', () => toggleUserTagFilter(tag));

        const delTagBtn = itemRow.querySelector('.delete-global-tag-btn');
        delTagBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteGlobalCustomTag(tag);
        });

        customTagDropdownList.appendChild(itemRow);
      });
    }

    let activeModalUserMeta = { tags: [], note: '' };

    function renderModalSummary() {
      if (!modalTagsSummaryList || !modalNotePreview) return;
      modalTagsSummaryList.innerHTML = '';

      if (!activeModalUserMeta.tags || !activeModalUserMeta.tags.length) {
        modalTagsSummaryList.innerHTML = `<span style="font-size: 0.75rem; color: var(--subtext); font-style: italic;">No custom tags assigned</span>`;
      } else {
        activeModalUserMeta.tags.forEach(tag => {
          const pill = document.createElement('span');
          pill.className = 'user-tag-pill';
          pill.textContent = '#' + tag;
          modalTagsSummaryList.appendChild(pill);
        });
      }

      if (activeModalUserMeta.note && activeModalUserMeta.note.trim()) {
        modalNotePreview.style.display = '-webkit-box';
        modalNotePreview.textContent = activeModalUserMeta.note;
      } else {
        modalNotePreview.style.display = 'none';
        modalNotePreview.textContent = '';
      }
    }

    async function loadUserMeta(itemId) {
      const meta = await getCachedMeta('user_meta_' + itemId);
      activeModalUserMeta = meta || { tags: [], note: '' };
      renderModalSummary();
      renderModalTags();
      renderModalTagPickerOptions();
      modalNoteInput.value = activeModalUserMeta.note || '';
    }

    function renderModalTags() {
      modalTagsContainer.innerHTML = '';
      if (!activeModalUserMeta.tags || !activeModalUserMeta.tags.length) {
        modalTagsContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--subtext); font-style: italic;">No custom tags assigned to this card</span>`;
      } else {
        activeModalUserMeta.tags.forEach((tag, idx) => {
          const pill = document.createElement('span');
          pill.className = 'user-tag-pill';
          pill.innerHTML = `<span>#${tag}</span><span class="tag-close" data-idx="${idx}" title="Remove tag">&times;</span>`;
          pill.querySelector('.tag-close').addEventListener('click', async (e) => {
            e.stopPropagation();
            activeModalUserMeta.tags.splice(idx, 1);
            await saveActiveUserMeta();
            renderModalTags();
            renderModalTagPickerOptions();
          });
          modalTagsContainer.appendChild(pill);
        });
      }
    }

    async function saveActiveUserMeta() {
      if (!activeModalItem) return;
      const id = activeModalItem.postId || activeModalItem.id;
      await saveMetaToDB('user_meta_' + id, activeModalUserMeta);
      activeModalItem.userTags = [...activeModalUserMeta.tags];
      activeModalItem.userNote = activeModalUserMeta.note;

      if (allImportedPosts.has(id)) {
        const p = allImportedPosts.get(id);
        p.userTags = [...activeModalUserMeta.tags];
        p.userNote = activeModalUserMeta.note;
      }

      currentItems.filter(i => (i.postId === id || i.id === id)).forEach(i => {
        i.userTags = [...activeModalUserMeta.tags];
        i.userNote = activeModalUserMeta.note;
      });

      renderModalSummary();
      extractAllUserTags();
    }

    let noteSaveTimeout = null;
    modalNoteInput.addEventListener('input', (e) => {
      clearTimeout(noteSaveTimeout);
      activeModalUserMeta.note = e.target.value;
      noteSaveTimeout = setTimeout(async () => {
        await saveActiveUserMeta();
        modalNoteStatus.style.opacity = '1';
        setTimeout(() => { modalNoteStatus.style.opacity = '0'; }, 1500);
      }, 350);
    });

    if (openUserMetaModalBtn) {
      openUserMetaModalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userNotesModal.classList.add('open');
        renderModalTagPickerOptions();
      });
    }

    if (closeUserNotesModalBtn) {
      closeUserNotesModalBtn.addEventListener('click', () => {
        userNotesModal.classList.remove('open');
      });
    }

    if (saveUserNotesDoneBtn) {
      saveUserNotesDoneBtn.addEventListener('click', () => {
        userNotesModal.classList.remove('open');
      });
    }

    if (userNotesModal) {
      userNotesModal.addEventListener('click', (e) => {
        if (e.target === userNotesModal) {
          userNotesModal.classList.remove('open');
        }
      });
    }

    setupModalTagPicker();

    // ===================================================
    // DROPDOWN SYNC ENGINE
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
            adjustDropdownPlacement(menu);
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

    // ===================================================
    // AUTOMATIC KEYWORDS ENGINE
    // ===================================================
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'your', 'what',
      'some', 'just', 'like', 'will', 'then', 'them', 'they', 'were', 'been', 'about',
      'more', 'when', 'which', 'would', 'there', 'their', 'http', 'https', 'twitter',
      'status', 'photo', 'video', 'card', 'post', 'view', 'make', 'into', 'over',
      'pixiv', 'pinterest', 'artwork', 'artworks', 'deviantart', 'image', 'safebooru', 'rule34'
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

        const words = item.text.toLowerCase().match(/\b[a-z0-9_]{3,}\b/g) || [];
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
      updateActiveFilterChips();
      updateFilterCounts();
    }

    keywordsMultiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = keywordsMultiMenu.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        keywordsMultiMenu.classList.add('open');
        adjustDropdownPlacement(keywordsMultiMenu);
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
      updateActiveFilterChips();
      renderColumns();
    });

    clearAllChipsBtn.addEventListener('click', () => {
      activeKeywordsSet.clear();
      activeUserTagsSet.clear();
      renderKeywordDropdownOptions();
      renderUserTagDropdownOptions();
      updateActiveFilterChips();
      renderColumns();
    });

    function toggleKeywordFilter(keyword) {
      if (activeKeywordsSet.has(keyword)) activeKeywordsSet.delete(keyword);
      else activeKeywordsSet.add(keyword);
      renderKeywordDropdownOptions();
      updateActiveFilterChips();
      renderColumns();
    }

    function updateActiveFilterChips() {
      const hasKeywords = activeKeywordsSet.size > 0;
      const hasTags = activeUserTagsSet.size > 0;

      activeKwBadge.style.display = hasKeywords ? 'inline-block' : 'none';
      activeKwBadge.textContent = activeKeywordsSet.size;

      activeUserTagsBadge.style.display = hasTags ? 'inline-block' : 'none';
      activeUserTagsBadge.textContent = activeUserTagsSet.size;

      if (hasKeywords || hasTags) {
        activeKeywordsBar.style.display = 'flex';
        activeKeywordsChips.innerHTML = '';

        activeUserTagsSet.forEach(tag => {
          const chip = document.createElement('div');
          chip.className = 'active-kw-chip';
          chip.style.borderColor = 'var(--accent)';
          chip.innerHTML = `
            <span>🏷️ #${tag}</span>
            <span class="active-kw-chip-remove" title="Remove tag filter">&times;</span>
          `;
          chip.querySelector('.active-kw-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserTagFilter(tag);
          });
          activeKeywordsChips.appendChild(chip);
        });

        activeKeywordsSet.forEach(kw => {
          const chip = document.createElement('div');
          chip.className = 'active-kw-chip';
          chip.innerHTML = `
            <span>#️⃣ ${kw}</span>
            <span class="active-kw-chip-remove" title="Remove keyword filter">&times;</span>
          `;
          chip.querySelector('.active-kw-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleKeywordFilter(kw);
          });
          activeKeywordsChips.appendChild(chip);
        });
      } else {
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
    // GACHA BANNERS CONFIG & SUMMONING SYSTEM
    // ===================================================
    const BANNER_INFOS = {
      all: { title: '🎰 All Sites Summoning', desc: 'Universal summoning pool combining all imported artworks across all platforms.' },
      twitter: { title: '🐦 Twitter / X Summoning', desc: 'Curated illustrations and bookmarks from Twitter / X.' },
      pixiv: { title: '🖌️ Pixiv Sanctuary Summoning', desc: 'Japanese anime and Pixiv illustration artworks.' },
      deviantart: { title: '🎨 DeviantArt Summoning', desc: 'Digital paintings, fantasy concepts, and community deviations.' },
      pinterest: { title: '📌 Pinterest Summoning', desc: 'Aesthetic pinboards, character sketches, and visual inspiration pins.' },
      safebooru: { title: '📗 Safebooru Summoning', desc: 'Safe-for-work community anime imagery and tagged archives.' },
      rule34: { title: '🔞 Rule 34 Summoning', desc: 'Curated adult deviations and high-definition tagged pinup art.' }
    };

    function getRarityBadgeText(tier) {
      return (tier === 'N' || tier === 'C') ? 'C' : tier;
    }

    function getRarityClass(tier) {
      return (tier || 'N').toLowerCase() === 'c' ? 'n' : (tier || 'N').toLowerCase();
    }

    function getComputedRarityColor(tier) {
      const t = getRarityClass(tier);
      const color = getComputedStyle(document.body).getPropertyValue(`--rarity-${t}`).trim();
      return color || '#58a6ff';
    }

    function updatePityUI() {
      const pct = Math.min(100, Math.round((gachaPityCounter / PITY_LIMIT) * 100));
      pityProgressBar.style.width = pct + '%';
      pityProgressLabel.textContent = `${gachaPityCounter} / ${PITY_LIMIT}`;
    }

    function updateBannerCounts() {
      const total = currentItems.length;
      bannerPoolCountAll.textContent = total;
      bannerPoolCountTwitter.textContent = currentItems.filter(i => i.platform === 'twitter').length;
      bannerPoolCountPixiv.textContent = currentItems.filter(i => i.platform === 'pixiv').length;
      bannerPoolCountDeviantArt.textContent = currentItems.filter(i => i.platform === 'deviantart').length;
      bannerPoolCountPinterest.textContent = currentItems.filter(i => i.platform === 'pinterest').length;
      if (bannerPoolCountSafebooru) bannerPoolCountSafebooru.textContent = currentItems.filter(i => i.platform === 'safebooru').length;
      if (bannerPoolCountRule34) bannerPoolCountRule34.textContent = currentItems.filter(i => i.platform === 'rule34').length;
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
        if (gachaSubTabCompendium.classList.contains('active')) renderCompendium();
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

        const tierLower = getRarityClass(rarityMeta.tier);
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
      gachaPityCounter++;
      let isGuaranteedSSR = false;

      if (gachaPityCounter >= PITY_LIMIT) {
        isGuaranteedSSR = true;
        gachaPityCounter = 0;
      }

      const rand = Math.random() * 100;
      let tier = 'C';

      if (isGuaranteedSSR || (rand < 3.0 && gachaPools.ssr.length)) {
        tier = 'SSR';
        gachaPityCounter = 0;
      } else if ((rand < 20.0 || pitySR) && gachaPools.sr.length) {
        tier = 'SR';
      } else if (rand < 55.0 && gachaPools.r.length) {
        tier = 'R';
      } else {
        tier = 'C';
      }

      try {
        localStorage.setItem(getProfileDataKey('gacha_pity'), gachaPityCounter);
      } catch (e) {}
      updatePityUI();

      let pool = gachaPools[getRarityClass(tier)] || [];
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
        authorName: picked.platform === 'pinterest' ? 'Pinterest creator' : (picked.authorName || 'Unknown'),
        rarity: picked.gachaRarity || tier,
        summonedAt: Date.now(),
        summonId: 'sum_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      };
    }

    function updateGalleryCardsGlow(cards) {
      cards.forEach(card => {
        const pId = card.postId || card.id;
        const rawTier = card.gachaRarity || card.rarity || 'N';
        const tierClass = getRarityClass(rawTier);
        const tierBadge = getRarityBadgeText(rawTier);

        document.querySelectorAll(`[data-post-id="${CSS.escape(pId)}"]`).forEach(el => {
          el.classList.remove('gacha-revealed-ssr', 'gacha-revealed-sr', 'gacha-revealed-r', 'gacha-revealed-n');
          el.classList.add(`gacha-revealed-${tierClass}`);
          if (card.dominantColor) {
            el.style.setProperty('--card-dom', card.dominantColor);
          }
          const badges = el.querySelector('.card-top-badges');
          if (badges && !badges.querySelector('.card-rarity-pill')) {
            const pill = document.createElement('span');
            pill.className = `card-rarity-pill ${tierClass}`;
            pill.textContent = tierBadge;
            badges.prepend(pill);
          }
        });
      });
    }

    async function executeGachaSummon(count = 1) {
      const bannerPool = getActiveBannerItems();
      if (!bannerPool.length) {
        await showCustomAlert('The selected banner has no artworks available. Please import artwork JSON or select another banner.', 'Banner Empty', 'warn');
        return;
      }

      if (!gachaPools.ssr.length && !gachaPools.n.length) {
        rebuildDeterministicPools();
      }

      const summoned = [];
      let gotSrOrBetter = false;
      const currentBatchIds = new Set();

      for (let i = 0; i < count; i++) {
        const isPitySR = count === 10 && i === 9 && !gotSrOrBetter;
        const res = rollSingleCard(isPitySR, currentBatchIds);
        if (res.rarity === 'SSR' || res.rarity === 'SR') gotSrOrBetter = true;

        currentBatchIds.add(res.postId || res.id);
        summoned.push(res);
        unlockedGachaSet.add(res.postId || res.id);
      }

      preloadAllCardImages(summoned);

      gachaTotalRolls += count;
      gachaSummonHistory = [...summoned, ...gachaSummonHistory];
      pendingSummonPull = summoned;
      inspectCurrentIndex = 0;

      saveGachaStateToStorage(false);
      updateGachaStats();
      updateGalleryCardsGlow(summoned);

      recordActionLog('gacha', `Summoned ${count}x cards on banner [${activeGachaBanner.toUpperCase()}]`);
      startSummonAnimation(summoned);
    }

    function renderCompendium() {
      compGridSSR.innerHTML = '';
      compGridSR.innerHTML = '';
      compGridR.innerHTML = '';
      compGridN.innerHTML = '';

      const pool = getActiveBannerItems();
      const unlockedCount = pool.filter(i => unlockedGachaSet.has(i.postId || i.id)).length;
      const pct = pool.length ? ((unlockedCount / pool.length) * 100).toFixed(1) : 0;

      compendiumStatsBar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-weight: 800; color: var(--text-bold); font-size: 1.15rem;">
            📖 Overall Compendium Progress: ${unlockedCount} / ${pool.length} (${pct}%)
          </div>
          <div style="font-size: 0.82rem; color: var(--subtext);">
            Artworks unlocked stay permanently cataloged across banners!
          </div>
        </div>
      `;

      const tiers = {
        SSR: { grid: compGridSSR, label: compProgressSSR, pool: [] },
        SR: { grid: compGridSR, label: compProgressSR, pool: [] },
        R: { grid: compGridR, label: compProgressR, pool: [] },
        N: { grid: compGridN, label: compProgressN, pool: [] }
      };

      pool.forEach(item => {
        const r = (item.gachaRarity || 'N').toUpperCase();
        if (tiers[r]) tiers[r].pool.push(item);
        else if (r === 'C') tiers.N.pool.push(item);
      });

      Object.entries(tiers).forEach(([tier, data]) => {
        const total = data.pool.length;
        const unlocked = data.pool.filter(i => unlockedGachaSet.has(i.postId || i.id)).length;
        const tierPct = total ? Math.round((unlocked / total) * 100) : 0;
        const displayTier = getRarityBadgeText(tier);
        data.label.textContent = `${unlocked} / ${total} (${tierPct}%)`;

        if (!total) {
          data.grid.innerHTML = `<div style="grid-column: 1/-1; font-size: 0.8rem; color: var(--subtext); padding: 1rem 0;">No ${displayTier} artworks in this banner pool.</div>`;
          return;
        }

        data.pool.forEach(item => {
          const isUnlocked = unlockedGachaSet.has(item.postId || item.id);
          const card = document.createElement('div');
          const tierLower = getRarityClass(tier);
          card.className = `gacha-card rarity-${tierLower} compendium-card ${isUnlocked ? '' : 'locked'}`;

          const author = item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorName || 'Unknown');

          card.innerHTML = `
            <div class="gacha-card-badge ${tierLower}">${isUnlocked ? displayTier : '???'}</div>
            <div class="gacha-card-thumb">
              <img alt="Compendium Art" loading="lazy" decoding="async">
            </div>
          `;

          const img = card.querySelector('img');
          setCachedOrRemoteSrc(img, item);

          if (isUnlocked) {
            card.addEventListener('click', () => openPokemonCard(item, false));
          }
          data.grid.appendChild(card);
        });
      });
    }

    // ===================================================
    // SUMMON PARTICLES & INSPECTION ENGINE
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
          this.decay = 0.02 + Math.random() * 0.03;
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
          this.color = Math.random() > 0.4 
            ? getComputedRarityColor('SSR') 
            : (Math.random() > 0.5 ? getComputedRarityColor('SR') : getComputedRarityColor('R'));
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
      let highest = 'C';
      if (cards.some(c => c.rarity === 'SSR')) highest = 'SSR';
      else if (cards.some(c => c.rarity === 'SR')) highest = 'SR';
      else if (cards.some(c => c.rarity === 'R')) highest = 'R';

      summonCrystal.className = `summon-core-crystal pulse-${getRarityClass(highest)}`;
      summonStageOrb.style.display = 'flex';
      summonStageInspect.style.display = 'none';
      summonStageShowcase.style.display = 'none';

      document.body.style.overflow = 'hidden';
      gachaSummonOverlay.classList.add('active');
      initSummonParticles();
    }

    // REVEAL CARDS
    function revealSummonCards() {
      let highestColor = getComputedRarityColor('R');
      if (pendingSummonPull.some(c => c.rarity === 'SSR')) highestColor = getComputedRarityColor('SSR');
      else if (pendingSummonPull.some(c => c.rarity === 'SR')) highestColor = getComputedRarityColor('SR');

      preloadAllCardImages(pendingSummonPull);
      eagerPrefetchNextCards(0);

      summonCrystal.classList.add('surging');
      spawnBurstSparks(highestColor);

      setTimeout(() => {
        summonCrystal.classList.remove('surging');
        summonStageOrb.style.display = 'none';
        startInspectPullSequence(pendingSummonPull);
      }, 900);
    }

    async function startInspectPullSequence(cards) {
      inspectCurrentIndex = 0;
      isInspectTransitioning = true;
      summonStageInspect.style.display = 'flex';

      eagerPrefetchNextCards(0);

      const readyUrl = await ensureCardImageReady(cards[0]);
      showInspectCard(0, readyUrl, true);
    }

    let ssrRevealTimer = null;
    let ssrRevealTimer2 = null;

    function showInspectCard(index, readyImgUrl = '', isInitialEntrance = false) {
      if (index >= pendingSummonPull.length) {
        finishInspectAndShowSummary();
        return;
      }

      if (ssrRevealTimer) clearTimeout(ssrRevealTimer);
      if (ssrRevealTimer2) clearTimeout(ssrRevealTimer2);

      const card = pendingSummonPull[index];
      const rawTier = card.gachaRarity || card.rarity || 'N';
      const tierClass = getRarityClass(rawTier);
      const tierBadge = getRarityBadgeText(rawTier);

      summonInspectCounter.textContent = `Card ${index + 1} / ${pendingSummonPull.length}`;
      summonInspectSkipBtn.style.display = 'inline-flex';

      if (summonInspectPrevBtn) {
        summonInspectPrevBtn.style.visibility = index > 0 ? 'visible' : 'hidden';
      }
      if (summonInspectNextBtn) {
        summonInspectNextBtn.style.visibility = index < pendingSummonPull.length - 1 ? 'visible' : 'hidden';
      }

      summonInspectRarityPill.className = `pokemon-card-top-pill ${tierClass}`;
      summonInspectRarityPill.textContent = tierBadge;
      summonInspectCardStage.className = `summon-inspect-card-stage rarity-${tierClass}`;

      const domColor = card.dominantColor || '#58a6ff';
      const rarityColor = getComputedRarityColor(rawTier);
      const borderMix = `color-mix(in srgb, ${domColor} 55%, ${rarityColor} 45%)`;

      summonInspectCardStage.style.setProperty('--dom-color', domColor);
      summonInspectCardStage.style.setProperty('--rarity-color', rarityColor);
      summonInspectCardStage.style.setProperty('--border-mix-color', borderMix);

      summonInspectRarityPill.style.setProperty('--dom-color', domColor);
      summonInspectRarityPill.style.setProperty('--rarity-color', rarityColor);
      summonInspectRarityPill.style.setProperty('--border-mix-color', borderMix);

      summonInspectCardStage.style.transform = `perspective(1400px) rotateX(0deg) rotateY(0deg)`;
      summonInspectCardStage.style.setProperty('--holo-angle', `135deg`);
      summonInspectCardStage.style.setProperty('--holo-x', `50%`);
      summonInspectCardStage.style.setProperty('--holo-y', `50%`);
      summonInspectCardStage.style.setProperty('--tilt-deg', `0deg`);

      summonInspectRarityPill.style.setProperty('--holo-angle', `135deg`);
      summonInspectRarityPill.style.setProperty('--holo-x', `50%`);
      summonInspectRarityPill.style.setProperty('--holo-y', `50%`);
      summonInspectRarityPill.style.setProperty('--tilt-deg', `0deg`);

      if (readyImgUrl) {
        summonInspectArt.src = readyImgUrl;
      } else {
        setCachedOrRemoteSrc(summonInspectArt, card);
      }

      summonInspectCardStage.classList.remove(
        'card-initial-entrance',
        'card-transition-out', 
        'card-transition-in', 
        'ssr-spinning-phase', 
        'ssr-landing-phase'
      );

      if (tierClass === 'ssr') {
        isInspectTransitioning = true;
        
        ssrShroudedBack.style.display = 'flex';
        ssrShroudedBack.classList.remove('revealed-hidden');
        summonInspectArt.style.opacity = '0';
        summonInspectRarityPill.style.opacity = '0';
        summonInspectHolo.style.opacity = '0';

        void summonInspectCardStage.offsetWidth;
        summonInspectCardStage.classList.add('ssr-spinning-phase');

        ssrRevealTimer = setTimeout(() => {
          summonInspectCardStage.classList.remove('ssr-spinning-phase');
          void summonInspectCardStage.offsetWidth;
          summonInspectCardStage.classList.add('ssr-landing-phase');

          spawnBurstSparks(getComputedRarityColor('SSR'));
          ssrShroudedBack.classList.add('revealed-hidden');
          summonInspectArt.style.opacity = '1';
          summonInspectRarityPill.style.opacity = '1';
          summonInspectHolo.style.opacity = '0.36';

          initAtmosphereParticles('ssr', summonInspectAtmosphereCanvas);

          ssrRevealTimer2 = setTimeout(() => {
            ssrShroudedBack.style.display = 'none';
            isInspectTransitioning = false;
            eagerPrefetchNextCards(index + 1);
          }, 550);
        }, 950);

      } else {
        ssrShroudedBack.style.display = 'none';
        summonInspectArt.style.opacity = '1';
        summonInspectRarityPill.style.opacity = '1';
        summonInspectHolo.style.opacity = tierClass === 'sr' ? '0.28' : (tierClass === 'r' ? '0.22' : '0.16');
        clearAtmosphereParticles(summonInspectAtmosphereCanvas);

        void summonInspectCardStage.offsetWidth;
        isInspectTransitioning = true;
        summonInspectCardStage.classList.add(isInitialEntrance ? 'card-initial-entrance' : 'card-transition-in');
        
        setTimeout(() => {
          isInspectTransitioning = false;
          eagerPrefetchNextCards(index + 1);
        }, 320);
      }
    }

    async function proceedNextInspectCard() {
      if (isInspectTransitioning) return;
      isInspectTransitioning = true;

      const nextIdx = inspectCurrentIndex + 1;
      if (nextIdx >= pendingSummonPull.length) {
        finishInspectAndShowSummary();
        isInspectTransitioning = false;
        return;
      }

      summonInspectCardStage.classList.remove('card-initial-entrance', 'card-transition-in', 'ssr-spinning-phase', 'ssr-landing-phase');
      summonInspectCardStage.classList.add('card-transition-out');

      const [readyUrl] = await Promise.all([
        ensureCardImageReady(pendingSummonPull[nextIdx]),
        new Promise(res => setTimeout(res, 180))
      ]);

      inspectCurrentIndex = nextIdx;
      showInspectCard(inspectCurrentIndex, readyUrl, false);
    }

    async function proceedPrevInspectCard() {
      if (isInspectTransitioning || inspectCurrentIndex <= 0) return;
      isInspectTransitioning = true;

      const prevIdx = inspectCurrentIndex - 1;
      summonInspectCardStage.classList.remove('card-initial-entrance', 'card-transition-in', 'ssr-spinning-phase', 'ssr-landing-phase');
      summonInspectCardStage.classList.add('card-transition-out');

      const [readyUrl] = await Promise.all([
        ensureCardImageReady(pendingSummonPull[prevIdx]),
        new Promise(res => setTimeout(res, 180))
      ]);

      inspectCurrentIndex = prevIdx;
      showInspectCard(inspectCurrentIndex, readyUrl, false);
    }

    if (summonInspectPrevBtn) {
      summonInspectPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        proceedPrevInspectCard();
      });
    }

    if (summonInspectNextBtn) {
      summonInspectNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        proceedNextInspectCard();
      });
    }

    summonStageInspect.addEventListener('click', (e) => {
      if (e.target.closest('#summonInspectSkipBtn') || e.target.closest('.gacha-inspect-nav-btn')) return;
      proceedNextInspectCard();
    });

    summonInspectSkipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ssrRevealTimer) clearTimeout(ssrRevealTimer);
      if (ssrRevealTimer2) clearTimeout(ssrRevealTimer2);
      finishInspectAndShowSummary();
    });

    function finishInspectAndShowSummary() {
      clearAtmosphereParticles(summonInspectAtmosphereCanvas);
      summonStageInspect.style.display = 'none';
      summonStageShowcase.style.display = 'flex';
      renderShowcaseCards(pendingSummonPull);
    }

    function renderShowcaseCards(cards) {
      summonCardsContainer.innerHTML = '';
      summonCardsContainer.classList.toggle('single-pull', cards.length === 1);

      cards.forEach((card, idx) => {
        const cardDiv = document.createElement('div');
        const tierClass = getRarityClass(card.rarity);
        const tierBadge = getRarityBadgeText(card.rarity);
        const author = card.platform === 'pinterest' ? 'Pinterest creator' : (card.authorName || 'Art');

        cardDiv.className = `gacha-card rarity-${tierClass}`;
        cardDiv.style.animationDelay = `${idx * 0.06}s`;

        cardDiv.innerHTML = `
          <div class="gacha-card-badge ${tierClass}">${tierBadge}</div>
          <div class="gacha-card-thumb">
            <img alt="${author}" loading="eager" decoding="async">
          </div>
        `;
        const img = cardDiv.querySelector('img');
        setCachedOrRemoteSrc(img, card);
        cardDiv.addEventListener('click', () => openPokemonCard(card, true));
        summonCardsContainer.appendChild(cardDiv);
      });

      renderGachaResults();
    }

    summonCrystalWrap.addEventListener('click', revealSummonCards);
    summonCloseBtn.addEventListener('click', () => {
      gachaSummonOverlay.classList.remove('active');
      document.body.style.overflow = '';
      clearAtmosphereParticles(summonInspectAtmosphereCanvas);
      if (animReqId) cancelAnimationFrame(animReqId);
    });

    // ===================================================
    // STANDALONE POKEMON 3D CARD MODAL LOGIC
    // ===================================================
    let pokemonScale = 1;
    let pokemonPanX = 0;
    let pokemonPanY = 0;
    let isPanningPokemon = false;
    let panStartPokemonX = 0;
    let panStartPokemonY = 0;
    let pokeTouchDist = 0;
    let pokeTouchStartScale = 1;
    let lastPokeTap = 0;
    let currentTiltRotX = 0;
    let currentTiltRotY = 0;

    function applyPokemonCardTransform(animate = false) {
      pokemonCardStage.style.transition = animate ? 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';

      if (pokemonScale > 1) {
        pokemonModal.classList.add('is-zoomed');
        const dampX = currentTiltRotX * 0.25;
        const dampY = currentTiltRotY * 0.25;
        pokemonCardStage.style.transform = `perspective(1400px) translate3d(${pokemonPanX}px, ${pokemonPanY}px, 0) scale3d(${pokemonScale}, ${pokemonScale}, ${pokemonScale}) rotateX(${dampX.toFixed(2)}deg) rotateY(${dampY.toFixed(2)}deg)`;
      } else {
        pokemonModal.classList.remove('is-zoomed');
        pokemonCardStage.style.transform = `perspective(1400px) translate3d(0, 0, 0) rotateX(${currentTiltRotX.toFixed(2)}deg) rotateY(${currentTiltRotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
      }
    }

    function resetPokemonZoom(animate = true) {
      pokemonScale = 1;
      pokemonPanX = 0;
      pokemonPanY = 0;
      isPanningPokemon = false;
      pokemonCardStage.classList.remove('is-panning');
      pokemonModal.classList.remove('is-zoomed');
      applyPokemonCardTransform(animate);
    }

    function setPokemonZoom(newScale) {
      const clamped = Math.max(1, Math.min(newScale, 4.5));
      pokemonScale = clamped;
      if (pokemonScale <= 1) {
        resetPokemonZoom(true);
      } else {
        pokemonModal.classList.add('is-zoomed');
        applyPokemonCardTransform(true);
      }
    }

    function openPokemonCard(card, isSummary = false, animClass = '') {
      activePokemonItem = card;
      const rawTier = card.gachaRarity || card.rarity || 'N';
      const tierClass = getRarityClass(rawTier);
      const tierBadge = getRarityBadgeText(rawTier);

      pokemonModal.dataset.rarity = tierClass;
      pokemonCardStage.className = `pokemon-card-stage rarity-${tierClass}`;
      if (animClass) {
        pokemonCardStage.classList.add(animClass);
        setTimeout(() => {
          pokemonCardStage.classList.remove('slide-in-right', 'slide-in-left');
        }, 250);
      }
      pokemonCardRarityPill.className = `pokemon-card-top-pill ${tierClass}`;
      pokemonCardRarityPill.textContent = tierBadge;

      const domColor = card.dominantColor || '#58a6ff';
      const rarityColor = getComputedRarityColor(rawTier);
      const borderMix = `color-mix(in srgb, ${domColor} 55%, ${rarityColor} 45%)`;

      pokemonCardStage.style.setProperty('--dom-color', domColor);
      pokemonCardStage.style.setProperty('--rarity-color', rarityColor);
      pokemonCardStage.style.setProperty('--border-mix-color', borderMix);

      pokemonCardRarityPill.style.setProperty('--dom-color', domColor);
      pokemonCardRarityPill.style.setProperty('--rarity-color', rarityColor);
      pokemonCardRarityPill.style.setProperty('--border-mix-color', borderMix);

      if (isSummary) {
        pokemonSwitchGalleryBtn.style.display = 'none';
        if (pokemonPrevBtn) pokemonPrevBtn.style.display = 'none';
        if (pokemonNextBtn) pokemonNextBtn.style.display = 'none';
      } else {
        pokemonSwitchGalleryBtn.style.display = 'inline-flex';
        if (pokemonPrevBtn) pokemonPrevBtn.style.display = 'flex';
        if (pokemonNextBtn) pokemonNextBtn.style.display = 'flex';
      }

      setCachedOrRemoteSrc(pokemonCardArt, card);

      currentTiltRotX = 0;
      currentTiltRotY = 0;
      resetPokemonZoom(false);

      pokemonModal.classList.add('open');
      document.body.style.overflow = 'hidden';

      initAtmosphereParticles(tierClass, pokemonAtmosphereCanvas);
    }

    function closePokemonCard() {
      pokemonModal.classList.remove('open');
      pokemonModal.classList.remove('is-zoomed');
      document.body.style.overflow = '';
      activePokemonItem = null;
      resetPokemonZoom(false);
      clearAtmosphereParticles(pokemonAtmosphereCanvas);
    }

    function navigatePokemon(direction) {
      if (!activePokemonItem) return;
      const list = getFilteredAndSortedGachaList();
      if (!list || list.length <= 1) return;

      const currId = activePokemonItem.summonId || activePokemonItem.postId || activePokemonItem.id;
      const idx = list.findIndex(c => (c.summonId || c.postId || c.id) === currId);
      if (idx !== -1) {
        const nextIdx = (idx + direction + list.length) % list.length;
        const anim = direction > 0 ? 'slide-in-right' : 'slide-in-left';
        openPokemonCard(list[nextIdx], false, anim);
      }
    }

    if (pokemonPrevBtn) pokemonPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigatePokemon(-1); });
    if (pokemonNextBtn) pokemonNextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigatePokemon(1); });

    pokemonCloseBtn.addEventListener('click', closePokemonCard);
    pokemonModal.addEventListener('click', (e) => {
      if (e.target === pokemonModal) closePokemonCard();
    });

    pokemonCardWrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = e.deltaY < 0 ? 0.25 : -0.25;
      setPokemonZoom(pokemonScale + zoomDelta);
    }, { passive: false });

    pokemonCardStage.addEventListener('mousedown', (e) => {
      if (pokemonScale <= 1) return;
      e.preventDefault();
      isPanningPokemon = true;
      panStartPokemonX = e.clientX - pokemonPanX;
      panStartPokemonY = e.clientY - pokemonPanY;
      pokemonCardStage.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanningPokemon && pokemonScale > 1) {
        pokemonPanX = e.clientX - panStartPokemonX;
        pokemonPanY = e.clientY - panStartPokemonY;
        applyPokemonCardTransform(false);
        return;
      }
      updateCard3DTilt(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (isPanningPokemon) {
        isPanningPokemon = false;
        pokemonCardStage.classList.remove('is-panning');
      }
    });

    pokemonCardStage.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (pokemonScale > 1) resetPokemonZoom(true);
      else setPokemonZoom(2.2);
    });

    function updateCard3DTilt(clientX, clientY) {
      if (!pokemonModal.classList.contains('open') || !activePokemonItem) return;

      const rect = pokemonCardStage.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const dx = (clientX - cx) / (rect.width * 0.9);
      const dy = (clientY - cy) / (rect.height * 0.9);

      const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
      const clampDx = clamp(dx, -1, 1);
      const clampDy = clamp(dy, -1, 1);

      const maxAngle = 20;
      currentTiltRotX = -clampDy * maxAngle;
      currentTiltRotY = clampDx * maxAngle;

      applyPokemonCardTransform(false);

      const lightRayDelta = clampDx * 24 - clampDy * 18;
      const holoAngle = 135 + lightRayDelta;
      const holoX = 50 + clampDx * 45;
      const holoY = 50 + clampDy * 45;
      const borderTilt = lightRayDelta;

      pokemonCardStage.style.setProperty('--holo-angle', `${holoAngle.toFixed(1)}deg`);
      pokemonCardStage.style.setProperty('--holo-x', `${holoX.toFixed(1)}%`);
      pokemonCardStage.style.setProperty('--holo-y', `${holoY.toFixed(1)}%`);
      pokemonCardStage.style.setProperty('--tilt-deg', `${borderTilt.toFixed(1)}deg`);

      pokemonCardRarityPill.style.setProperty('--holo-angle', `${holoAngle.toFixed(1)}deg`);
      pokemonCardRarityPill.style.setProperty('--holo-x', `${holoX.toFixed(1)}%`);
      pokemonCardRarityPill.style.setProperty('--holo-y', `${holoY.toFixed(1)}%`);
      pokemonCardRarityPill.style.setProperty('--tilt-deg', `${borderTilt.toFixed(1)}deg`);
    }

    pokemonCardStage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pokeTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pokeTouchStartScale = pokemonScale;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastPokeTap < 300) {
          if (pokemonScale > 1) resetPokemonZoom(true);
          else setPokemonZoom(2.2);
          lastPokeTap = 0;
          return;
        }
        lastPokeTap = now;

        if (pokemonScale > 1) {
          isPanningPokemon = true;
          panStartPokemonX = e.touches[0].clientX - pokemonPanX;
          panStartPokemonY = e.touches[0].clientY - pokemonPanY;
          pokemonCardStage.classList.add('is-panning');
        } else {
          updateCard3DTilt(e.touches[0].clientX, e.touches[0].clientY);
        }
      }
    }, { passive: false });

    pokemonCardStage.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (pokeTouchDist > 0) {
          const ratio = dist / pokeTouchDist;
          pokemonScale = Math.max(1, Math.min(pokeTouchStartScale * ratio, 4.5));
          if (pokemonScale <= 1) {
            pokemonPanX = 0;
            pokemonPanY = 0;
            pokemonModal.classList.remove('is-zoomed');
          } else {
            pokemonModal.classList.add('is-zoomed');
          }
          applyPokemonCardTransform(false);
        }
      } else if (e.touches.length === 1) {
        if (isPanningPokemon && pokemonScale > 1) {
          e.preventDefault();
          pokemonPanX = e.touches[0].clientX - panStartPokemonX;
          pokemonPanY = e.touches[0].clientY - panStartPokemonY;
          applyPokemonCardTransform(false);
        } else if (pokemonScale <= 1) {
          updateCard3DTilt(e.touches[0].clientX, e.touches[0].clientY);
        }
      }
    }, { passive: false });

    pokemonCardStage.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) pokeTouchDist = 0;
      if (e.touches.length === 0) {
        isPanningPokemon = false;
        pokemonCardStage.classList.remove('is-panning');
        if (pokemonScale <= 1) {
          pokemonModal.classList.remove('is-zoomed');
          pokemonCardStage.style.transition = 'transform 0.35s ease-out';
          currentTiltRotX = 0;
          currentTiltRotY = 0;
          applyPokemonCardTransform(false);
          pokemonCardStage.style.setProperty('--holo-angle', `135deg`);
          pokemonCardStage.style.setProperty('--holo-x', `50%`);
          pokemonCardStage.style.setProperty('--holo-y', `50%`);
          pokemonCardStage.style.setProperty('--tilt-deg', `0deg`);
          setTimeout(() => { pokemonCardStage.style.transition = 'transform 0.12s ease-out'; }, 350);
        }
      }
    });

    pokemonSwitchGalleryBtn.addEventListener('click', () => {
      if (activePokemonItem) {
        const item = activePokemonItem;
        closePokemonCard();
        openDetail(item);
      }
    });

    // ===================================================
    // GACHA RESULTS RENDER & MANAGEMENT
    // ===================================================
    function getFilteredAndSortedGachaList() {
      let list = gachaSummonHistory.slice();

      if (activeGachaRarityFilter !== 'all') {
        const targetFilter = activeGachaRarityFilter === 'C' ? 'N' : activeGachaRarityFilter;
        list = list.filter(card => {
          const r = card.rarity === 'C' ? 'N' : card.rarity;
          return r === targetFilter;
        });
      }

      const rarityWeights = { SSR: 4, SR: 3, R: 2, N: 1, C: 1 };

      if (activeGachaSort === 'recent') {
        list.sort((a, b) => (b.summonedAt || 0) - (a.summonedAt || 0));
      } else if (activeGachaSort === 'oldest') {
        list.sort((a, b) => (a.summonedAt || 0) - (b.summonedAt || 0));
      } else if (activeGachaSort === 'rarity-desc') {
        list.sort((a, b) => (rarityWeights[b.rarity] || 0) - (rarityWeights[a.rarity] || 0));
      } else if (activeGachaSort === 'rarity-asc') {
        list.sort((a, b) => (rarityWeights[a.rarity] || 0) - (rarityWeights[b.rarity] || 0));
      } else if (activeGachaSort === 'author') {
        list.sort((a, b) => {
          const nameA = a.platform === 'pinterest' ? 'Pinterest creator' : (a.authorName || '');
          const nameB = b.platform === 'pinterest' ? 'Pinterest creator' : (b.authorName || '');
          return nameA.localeCompare(nameB);
        });
      }

      return list;
    }

    function createGachaCardElement(card) {
      const div = document.createElement('div');
      const tierClass = getRarityClass(card.rarity);
      const tierBadge = getRarityBadgeText(card.rarity);
      const author = card.platform === 'pinterest' ? 'Pinterest creator' : (card.authorName || 'Unknown');
      const summonId = card.summonId || (card.postId + '_' + card.summonedAt);
      const isSelected = selectedGachaSet.has(summonId);

      div.className = `gacha-card rarity-${tierClass}` + (isSelected ? ' card-selected-highlight' : '');
      div.dataset.summonId = summonId;
      div.dataset.postId = card.postId || card.id;

      div.innerHTML = `
        <input type="checkbox" class="card-select-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="gacha-card-badge ${tierClass}">${tierBadge}</div>
        <div class="gacha-card-thumb">
          <img alt="${author}" loading="lazy" decoding="async">
        </div>
      `;

      const cb = div.querySelector('.card-select-checkbox');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGachaCardSelection(summonId);
      });

      const img = div.querySelector('img');
      setCachedOrRemoteSrc(img, card);

      div.addEventListener('click', () => {
        if (isGachaSelectionMode) {
          toggleGachaCardSelection(summonId);
        } else {
          openPokemonCard(card, false);
        }
      });
      return div;
    }

    function renderGachaResults() {
      gachaResultsGrid.innerHTML = '';
      const list = getFilteredAndSortedGachaList();

      if (!list.length) {
        gachaResultsGrid.classList.remove('masonry-mode');
        gachaResultsGrid.innerHTML = `
          <div class="empty-state-notice">
            <div>${gachaSummonHistory.length ? 'No cards match the active rarity filter.' : 'Click <strong>Roll 1x</strong> or <strong>Roll 10x</strong> to summon artwork cards!'}</div>
          </div>
        `;
        return;
      }

      updateGachaColZoomUI();

      if (isGachaMasonry) {
        gachaResultsGrid.classList.add('masonry-mode');
        const numCols = gachaColCount;
        const colElements = [];
        for (let i = 0; i < numCols; i++) {
          const col = document.createElement('div');
          col.className = 'gacha-masonry-col';
          gachaResultsGrid.appendChild(col);
          colElements.push(col);
        }
        list.forEach((card, idx) => {
          const cardEl = createGachaCardElement(card);
          colElements[idx % numCols].appendChild(cardEl);
        });
      } else {
        gachaResultsGrid.classList.remove('masonry-mode');
        list.forEach(card => {
          gachaResultsGrid.appendChild(createGachaCardElement(card));
        });
      }
      updateGachaSelectionVisuals();
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
      try {
        localStorage.setItem(getProfileDataKey('gacha_unlocked'), JSON.stringify(Array.from(unlockedGachaSet)));
        localStorage.setItem(getProfileDataKey('gacha_history'), JSON.stringify(gachaSummonHistory));
        localStorage.setItem(getProfileDataKey('gacha_rolls'), gachaTotalRolls);
        localStorage.setItem(getProfileDataKey('gacha_pity'), gachaPityCounter);
      } catch (e) {}
      if (notify) {
        recordActionLog('storage', `Saved gacha state: ${gachaTotalRolls} rolls, ${unlockedGachaSet.size} unlocked`);
        showToast(`Gacha saved! (${unlockedGachaSet.size} unlocked)`, 'success', '🎰');
      }
    }

    function exportGachaInventoryJSON() {
      if (!gachaSummonHistory.length) {
        showCustomAlert('No gacha rolls found to export. Roll some cards first!', 'Export Gacha', 'warn');
        return;
      }
      const inventoryClean = gachaSummonHistory.map(item => ({
        ...item,
        authorName: item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorName || 'Unknown')
      }));

      const payload = {
        exportedAt: new Date().toISOString(),
        totalRolls: gachaTotalRolls,
        uniqueCardsUnlocked: unlockedGachaSet.size,
        pityCounter: gachaPityCounter,
        inventory: inventoryClean
      };
      downloadExportPayload(payload, `gacha_inventory_${Date.now()}.json`);
      recordActionLog('export', `Exported ${gachaSummonHistory.length} summon records`);
      showToast(`Exported ${gachaSummonHistory.length} cards`, 'success', '🎰');
    }

    gachaExportBtn.addEventListener('click', exportGachaInventoryJSON);
    exportGachaMenuBtn.addEventListener('click', () => {
      exportMenu.classList.remove('open');
      exportGachaInventoryJSON();
    });

    gachaImportBtn.addEventListener('click', () => gachaFileInput.click());
    importGachaMenuBtn.addEventListener('click', () => {
      storageMenu.classList.remove('open');
      gachaFileInput.click();
    });

    gachaFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          const rawInventory = Array.isArray(data) ? data : (data.inventory || data.cards || []);

          if (!Array.isArray(rawInventory) || !rawInventory.length) {
            throw new Error('No valid cards found in imported file.');
          }

          const existingSummonIds = new Set(gachaSummonHistory.map(i => i.summonId || (i.postId + '_' + i.summonedAt)));
          let importedCount = 0;

          rawInventory.forEach(item => {
            if (item.platform === 'pinterest' || detectPlatform(item) === 'pinterest') {
              item.authorName = 'Pinterest creator';
              item.authorHandle = '@pinterest';
            }
            const sumId = item.summonId || (item.postId + '_' + item.summonedAt);
            if (!existingSummonIds.has(sumId)) {
              existingSummonIds.add(sumId);
              gachaSummonHistory.push(item);
              importedCount++;
            }
            if (item.postId || item.id) {
              unlockedGachaSet.add(item.postId || item.id);
            }
          });

          if (typeof data.totalRolls === 'number') {
            gachaTotalRolls = Math.max(gachaTotalRolls, data.totalRolls);
          } else {
            gachaTotalRolls = gachaSummonHistory.length;
          }

          if (typeof data.pityCounter === 'number') {
            gachaPityCounter = data.pityCounter;
          }

          saveGachaStateToStorage(false);
          updateGachaStats();
          updatePityUI();
          updateGalleryCardsGlow(rawInventory);
          renderGachaResults();
          if (gachaSubTabCompendium.classList.contains('active')) renderCompendium();

          recordActionLog('import', `Imported ${importedCount} gacha cards (Total: ${gachaSummonHistory.length})`);
          await showCustomAlert(`Gacha inventory imported successfully!<br>Imported: ${importedCount} pulls<br>Total cards: ${gachaSummonHistory.length}`, 'Import Gacha', 'success');
        } catch (err) {
          showCustomAlert('Failed to import gacha inventory: ' + err.message, 'Import Error', 'error');
        }
        gachaFileInput.value = '';
      };
      reader.readAsText(file);
    });

    saveGachaStateBtn.addEventListener('click', () => {
      storageMenu.classList.remove('open');
      saveGachaStateToStorage(true);
    });

    gachaRoll1Btn.addEventListener('click', () => executeGachaSummon(1));
    gachaRoll10Btn.addEventListener('click', () => executeGachaSummon(10));
    gachaClearInventoryBtn.addEventListener('click', async () => {
      const ok = await showCustomConfirm('Clear summon history, reset roll counters, and remove gallery glow highlights?', 'Reset Gacha Progress');
      if (ok) {
        gachaSummonHistory = [];
        gachaTotalRolls = 0;
        gachaPityCounter = 0;
        unlockedGachaSet.clear();
        saveGachaStateToStorage(false);
        updateGachaStats();
        updatePityUI();
        renderGachaResults();
        recordActionLog('gacha', 'Summon inventory & pity reset');
        showToast('Gacha history reset', 'info', '🎰');
        if (galleryView.style.display !== 'none') renderColumns();
      }
    });

    // ===================================================
    // DELETION ENGINE
    // ===================================================
    async function deletePost(postId, confirmPrompt = true) {
      if (confirmPrompt) {
        const ok = await showCustomConfirm('Are you sure you want to delete this artwork post?', 'Delete Post');
        if (!ok) return;
      }

      const p = allImportedPosts.get(postId);
      const author = p?.platform === 'pinterest' ? 'Pinterest creator' : (p?.authorName || 'Artwork');
      allImportedPosts.delete(postId);
      currentItems = currentItems.filter(item => item.postId !== postId && item.id !== postId);
      gachaSummonHistory = gachaSummonHistory.filter(item => item.postId !== postId && item.id !== postId);
      unlockedGachaSet.delete(postId);
      selectedItemsSet.delete(postId);

      Object.values(customCollections).forEach(col => {
        col.itemIds = col.itemIds.filter(id => id !== postId);
      });
      saveCollections();

      saveGachaStateToStorage(false);
      persistActiveProfileData();
      updateBannerCounts();
      extractTopKeywords();
      extractAllUserTags();
      updateFilterCounts();
      rebuildDeterministicPools();
      if (galleryView.style.display !== 'none') renderColumns();
      else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
      renderGachaResults();
      updateSelectionVisuals();

      if (activeModalItem && (activeModalItem.postId === postId || activeModalItem.id === postId)) {
        closeModal();
      }
      if (activePokemonItem && (activePokemonItem.postId === postId || activePokemonItem.id === postId)) {
        closePokemonCard();
      }

      recordActionLog('delete', `Deleted post by ${author} (ID: ${postId})`);
      if (confirmPrompt) showToast(`Deleted post by ${author}`, 'info', '🗑️');
    }

    modalDeleteBtn.addEventListener('click', () => {
      if (!activeModalItem) return;
      const pId = activeModalItem.postId || activeModalItem.id;
      if (collectionsView.style.display !== 'none' && activeCollectionId) {
        removePostFromCollection(pId);
        closeModal();
      } else {
        deletePost(pId);
      }
    });

    // ===================================================
    // FILTERS & METADATA COUNTS
    // ===================================================
    function updateFilterCounts() {
      if (!currentItems.length) return;
      const total = currentItems.length;

      const platformCounts = { twitter: 0, pixiv: 0, pinterest: 0, deviantart: 0, safebooru: 0, rule34: 0 };
      currentItems.forEach(i => {
        if (platformCounts[i.platform] !== undefined) platformCounts[i.platform]++;
      });

      platformFilterSelect.options[0].textContent = `🌐 All Platforms (${total})`;
      platformFilterSelect.options[1].textContent = `🐦 Twitter (${platformCounts.twitter})`;
      platformFilterSelect.options[2].textContent = `🖌️ Pixiv (${platformCounts.pixiv})`;
      platformFilterSelect.options[3].textContent = `📌 Pinterest (${platformCounts.pinterest})`;
      platformFilterSelect.options[4].textContent = `🎨 DeviantArt (${platformCounts.deviantart})`;
      if (platformFilterSelect.options[5]) platformFilterSelect.options[5].textContent = `📗 Safebooru (${platformCounts.safebooru})`;
      if (platformFilterSelect.options[6]) platformFilterSelect.options[6].textContent = `🔞 Rule 34 (${platformCounts.rule34})`;

      const artistMap = new Map();
      currentItems.forEach(item => {
        const name = item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorName || 'Unknown');
        const handle = item.platform === 'pinterest' ? '@pinterest' : (item.authorHandle || '');
        const key = item.platform === 'pinterest' ? 'Pinterest creator' : (handle || name);
        if (!artistMap.has(key)) {
          artistMap.set(key, { key, name, handle, count: 0 });
        }
        artistMap.get(key).count++;
      });

      const sortedArtists = Array.from(artistMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      const prevArtist = activeArtistFilter;
      artistFilterSelect.innerHTML = `<option value="all">👤 All Artists (${total})</option>`;
      sortedArtists.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.key;
        const label = a.handle && a.handle !== '@pinterest' ? `${a.name} (${a.handle})` : a.name;
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
      showToast('Gallery order shuffled', 'info', '🔀');
    }

    function getActiveFilteredList() {
      let list = currentItems.slice();

      if (activePlatformFilter !== 'all') {
        list = list.filter(item => item.platform === activePlatformFilter);
      }

      if (activeSearchQuery) {
        const q = activeSearchQuery.toLowerCase().trim();
        list = list.filter(item => {
          const inTags = item.userTags && item.userTags.some(t => t.toLowerCase().includes(q));
          const inNote = item.userNote && item.userNote.toLowerCase().includes(q);
          const author = item.platform === 'pinterest' ? 'pinterest creator' : (item.authorName || '').toLowerCase();
          const handle = item.platform === 'pinterest' ? '@pinterest' : (item.authorHandle || '').toLowerCase();
          return (item.text && item.text.toLowerCase().includes(q)) ||
                 author.includes(q) ||
                 handle.includes(q) ||
                 inTags || inNote;
        });
      }

      if (activeArtistFilter !== 'all') {
        list = list.filter(item => {
          const key = item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorHandle || item.authorName || 'Unknown');
          return key === activeArtistFilter;
        });
      }

      if (activeAspectFilter !== 'all') {
        list = list.filter(item => item.aspectFamily === activeAspectFilter);
      }

      if (activeColorFilter !== 'all') {
        list = list.filter(item => item.colorFamily === activeColorFilter);
      }

      if (activeUserTagsSet.size > 0) {
        list = list.filter(item => {
          if (!Array.isArray(item.userTags)) return false;
          for (const t of activeUserTagsSet) {
            if (item.userTags.includes(t)) return true;
          }
          return false;
        });
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
        list.sort((a, b) => {
          const nameA = a.platform === 'pinterest' ? 'Pinterest creator' : (a.authorName || '');
          const nameB = b.platform === 'pinterest' ? 'Pinterest creator' : (b.authorName || '');
          return nameA.localeCompare(nameB);
        });
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
      activeUserTagsSet.clear();
      renderKeywordDropdownOptions();
      renderUserTagDropdownOptions();
      updateActiveFilterChips();

      activeSortOrder = 'newest';
      sortSelect.value = 'newest';

      syncAllFilterDropdowns();
      renderColumns();
      showToast('All filters reset', 'info');
    }

    resetAllFiltersBtn.addEventListener('click', resetAllFilters);

    function attachColorChipToDOM(item) {
      try {
        const selector = `[data-img-url="${CSS.escape(item.imgUrl)}"]`;
        document.querySelectorAll(selector).forEach(parent => {
          parent.style.setProperty('--card-dom', item.dominantColor);
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

      if (['pinterest', 'deviantart', 'safebooru', 'rule34'].includes(item.platform)) {
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

    let isSaving = false;
    saveOfflineBtn.addEventListener('click', async () => {
      storageMenu.classList.remove('open');
      if (!currentItems.length) {
        await showCustomAlert('Please load JSON export files first.', 'Storage Notice', 'warn');
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

      recordActionLog('storage', `Offline sync completed: ${savedCount} saved, ${failedCount} errors`);
      showToast(`Saved ${savedCount} images offline!`, 'success', '💾');
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
      const ok = await showCustomConfirm('Delete all locally cached images & metadata from browser storage?', 'Clear Offline Cache');
      if (ok) {
        await clearAllIndexedDB();
        blobUrlMap.clear();
        recordActionLog('storage', 'Cleared all offline IndexedDB cache');
        showToast('Image and metadata cache cleared', 'info', '🗑️');
        renderColumns();
      }
    });

    function formatPostForTemplateExport(post) {
      const isPinterest = post.platform === 'pinterest' || detectPlatform(post) === 'pinterest';
      const author = isPinterest ? 'Pinterest creator' : (post.authorName || 'Unknown');
      const handle = isPinterest ? '@pinterest' : (post.authorHandle || '');

      const entry = {
        authorHandle: handle,
        authorName: author,
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
      
      if (Array.isArray(post.userTags) && post.userTags.length > 0) {
        entry.userTags = [...post.userTags];
      }
      if (post.userNote) {
        entry.userNote = post.userNote;
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
        showCustomAlert('No posts available to export.', 'Export Error', 'warn');
        return;
      }
      const formattedTweets = postsToExport.map(formatPostForTemplateExport);
      downloadExportPayload({ tweets: formattedTweets }, `${prefix}_${Date.now()}.json`);
      recordActionLog('export', `Exported ${formattedTweets.length} artwork posts`);
      showToast(`Exported ${formattedTweets.length} posts successfully`, 'success', '📤');
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

    // ===================================================
    // INGESTION & NORMALIZATION ENGINE
    // ===================================================
    function getNormalizedItemSignature(raw, platform) {
      if (raw.id && String(raw.id).trim() && !String(raw.id).startsWith('undefined')) {
        return `${platform}_id_${String(raw.id).trim()}`;
      }
      const rawUrl = raw.imgUrl || raw.mediaUrl || (Array.isArray(raw.mediaUrls) && raw.mediaUrls[0]) || (Array.isArray(raw.images) && raw.images[0]) || '';
      const cleanUrl = String(rawUrl).split('?')[0].replace(/\/v1\/fit\/.*$/, '').toLowerCase();
      return `${platform}_url_${cleanUrl}`;
    }

    function getHighResTwitterUrl(url) {
      if (!url) return '';
      return url.replace(/name=[^&]+/, 'name=large');
    }

    function isQuotedUrl(url) {
      return url.includes('name=120x120');
    }

    async function processIncomingItems(items) {
      const existingSignatures = new Set(currentItems.map(i => i._sig || i.id));
      let dupeCount = 0;
      let added = 0;

      for (const raw of items) {
        const platform = detectPlatform(raw);
        const sig = getNormalizedItemSignature(raw, platform);

        if (existingSignatures.has(sig)) {
          dupeCount++;
          continue;
        }
        existingSignatures.add(sig);

        const canonicalId = String(raw.id || (platform + '_' + Math.random().toString(36).slice(2)));
        const rarityMeta = getDeterministicRarity(canonicalId);

        const storedMeta = await getCachedMeta('user_meta_' + canonicalId);
        const userTags = storedMeta?.tags?.length ? storedMeta.tags : (Array.isArray(raw.userTags) ? [...raw.userTags] : []);
        const userNote = storedMeta?.note || raw.userNote || '';

        if (userTags.length || userNote) {
          await saveMetaToDB('user_meta_' + canonicalId, { tags: userTags, note: userNote });
        }

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
              userTags: userTags,
              userNote: userNote
            });
          }

          displayUrls.forEach((rawUrl, pageIdx) => {
            const itemId = canonicalId + '_' + rawUrl.split('/').pop().split('?')[0];
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
              userTags: userTags,
              userNote: userNote,
              _sig: sig,
              _rand: Math.random()
            });
            added++;
          });
        } else if (platform === 'pixiv') {
          const rawList = raw.mediaUrls && raw.mediaUrls.length > 0 ? raw.mediaUrls : (raw.mediaUrl ? [raw.mediaUrl] : []);
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
              userTags: userTags,
              userNote: userNote
            });
          }

          sanitizedList.forEach((mediaUrl, pageIdx) => {
            const pageId = sanitizedList.length > 1 ? `${canonicalId}_p${pageIdx}` : canonicalId;
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
              userTags: userTags,
              userNote: userNote,
              _sig: sig,
              _rand: Math.random()
            });
            added++;
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
              userTags: userTags,
              userNote: userNote
            });
          }

          rawList.forEach((mediaUrl, pageIdx) => {
            const pageId = rawList.length > 1 ? `${canonicalId}_p${pageIdx}` : canonicalId;
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
              userTags: userTags,
              userNote: userNote,
              _sig: sig,
              _rand: Math.random()
            });
            added++;
          });
        } else if (platform === 'pinterest') {
          const rawList = raw.mediaUrls && raw.mediaUrls.length > 0 ? raw.mediaUrls : (raw.mediaUrl ? [raw.mediaUrl] : []);

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
              authorHandle: '@pinterest',
              authorName: 'Pinterest creator',
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
              userTags: userTags,
              userNote: userNote
            });
          }

          currentItems.push({
            id: canonicalId,
            postId: canonicalId,
            platform: 'pinterest',
            imgUrl: mainMedia,
            fallbackUrl: fallback,
            authorName: 'Pinterest creator',
            authorHandle: '@pinterest',
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
            userTags: userTags,
            userNote: userNote,
            _sig: sig,
            _rand: Math.random()
          });
          added++;
        } else if (['safebooru', 'rule34'].includes(platform)) {
          const rawList = Array.isArray(raw.mediaUrls) && raw.mediaUrls.length > 0 
            ? raw.mediaUrls 
            : (raw.mediaUrl ? [raw.mediaUrl] : []);

          let mainMedia = rawList[0] || raw.mediaUrl || '';
          let fallback = raw.fallbackUrl || raw.videoPoster || mainMedia;

          if (platform === 'rule34' && (mainMedia.includes('/thumbnails/') || mainMedia.includes('thumbnail_'))) {
            const candidates = generateHdCandidates({ id: canonicalId, mediaUrl: mainMedia, fallbackUrl: fallback });
            mainMedia = candidates[0] || mainMedia;
          }

          const defaultAuthor = platform === 'safebooru' ? 'Safebooru Creator' : 'Rule34 Creator';
          const author = raw.authorName || raw.author || defaultAuthor;
          const handle = raw.authorHandle || (platform === 'safebooru' ? '@safebooru' : '@rule34');
          const textTags = (raw.text || '').trim();
          const timestamp = raw.timestamp || raw.scrapedAt || new Date().toISOString();

          if (!allImportedPosts.has(canonicalId)) {
            allImportedPosts.set(canonicalId, {
              id: canonicalId,
              platform: platform,
              authorHandle: handle,
              authorName: author,
              text: textTags,
              timestamp: timestamp,
              scrapedAt: raw.scrapedAt || new Date().toISOString(),
              url: raw.url || '#',
              isArticle: false,
              linkCard: null,
              quotedTweet: null,
              videoPoster: raw.videoPoster || fallback,
              fallbackUrl: fallback,
              mediaUrl: mainMedia,
              mediaUrls: rawList.length ? rawList : (mainMedia ? [mainMedia] : []),
              dominantColor: raw.dominantColor || null,
              colorFamily: raw.colorFamily || null,
              aspectRatio: raw.aspectRatio || null,
              aspectFamily: raw.aspectFamily || null,
              gachaRarity: rarityMeta.tier,
              userTags: userTags,
              userNote: userNote
            });
          }

          currentItems.push({
            id: canonicalId,
            postId: canonicalId,
            platform: platform,
            imgUrl: mainMedia,
            fallbackUrl: fallback,
            authorName: author,
            authorHandle: handle,
            text: textTags,
            timestamp: timestamp,
            url: raw.url || '#',
            allMedia: rawList.length ? rawList : [mainMedia],
            pageIndex: 0,
            totalPages: Math.max(rawList.length, 1),
            dominantColor: raw.dominantColor || null,
            colorFamily: raw.colorFamily || null,
            aspectRatio: raw.aspectRatio || null,
            aspectFamily: raw.aspectFamily || null,
            gachaRarity: rarityMeta.tier,
            userTags: userTags,
            userNote: userNote,
            _sig: sig,
            _rand: Math.random()
          });
          added++;
        }
      }

      recordActionLog('import', `Processed ${added} items (${dupeCount} duplicates filtered)`);
      showToast(`Loaded ${added} artworks (${dupeCount} dupes filtered)`, 'success', '📥');

      dropzone.style.display = 'none';
      gallerySubBar.style.display = 'flex';
      extractTopKeywords();
      extractAllUserTags();
      updateBannerCounts();
      rebuildDeterministicPools();
      persistActiveProfileData();

      preloadAllCardImages(currentItems);

      if (galleryView.style.display !== 'none') renderColumns();
      runAutoAnalysis();
    }

    async function handleMultipleFiles(files) {
      if (!files || !files.length) return;

      importLoadingOverlay.classList.add('active');
      loadingTitle.textContent = 'Importing Artworks';
      loadingSubtext.textContent = 'Filtering duplicates & compiling JSON data...';
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
                : (data.posts || data.tweets || data.bookmarks || data.pins || data.items || data.deviations || data.favorites || []);
              resolve(list);
            } catch {
              showToast(`Could not parse JSON in ${file.name}`, 'error', '⚠️');
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
      loadingSubtext.textContent = 'Calculating aspect ratios, palettes & deduplicating...';
      importProgressBar.style.width = '20%';
      loadingStats.textContent = 'Initializing...';

      await processIncomingItems(combined);
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

    // ===================================================
    // STABLE GRID RENDERING
    // ===================================================
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

      updateColZoomUI();

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

      for (let i = 0; i < galleryColCount; i++) {
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
          ? createPostCard(item, cycle, false) 
          : createMediaCard(item, cycle, false);

        fragments[(renderedCount + index) % numCols].appendChild(element);
      });

      cols.forEach((col, i) => col.appendChild(fragments[i]));
      renderedCount += nextSlice.length;
      isBatchRendering = false;

      if (renderedCount < itemsToRender.length) {
        batchTimeout = setTimeout(() => appendNextBatch(cycle), 25);
      }
    }

    function setCachedOrRemoteSrc(imgElement, item) {
      imgElement.dataset.errAttempt = '0';

      const attachLoadedListeners = () => {
        imgElement.addEventListener('load', () => {
          let updated = false;

          if (imgElement.naturalWidth && imgElement.naturalHeight) {
            item._width = imgElement.naturalWidth;
            item._height = imgElement.naturalHeight;
            if (!item.aspectFamily) {
              const ratio = imgElement.naturalWidth / imgElement.naturalHeight;
              item.aspectRatio = ratio;
              item.aspectFamily = ratio < 0.82 ? 'portrait' : (ratio > 1.22 ? 'landscape' : 'square');
              updated = true;
            }
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
      };

      if (blobUrlMap.has(item.imgUrl)) {
        imgElement.crossOrigin = 'anonymous';
        imgElement.src = blobUrlMap.get(item.imgUrl);
        attachLoadedListeners();
        return;
      }

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
          attachLoadedListeners();
        } else {
          if ((item.platform === 'rule34' || item.platform === 'safebooru') && !item._hdResolved) {
            resolvePostHdQuality(item).then(hdUrl => {
              if (hdUrl) imgElement.src = hdUrl;
              else imgElement.src = item.imgUrl;
            });
          } else {
            imgElement.src = item.imgUrl;
          }

          imgElement.onerror = async () => {
            const attempt = parseInt(imgElement.dataset.errAttempt || '0') + 1;
            imgElement.dataset.errAttempt = String(attempt);

            if (item.platform === 'rule34') {
              const hdCandidate = await resolvePostHdQuality(item);
              if (hdCandidate && imgElement.src !== hdCandidate) {
                imgElement.src = hdCandidate;
                return;
              }
            }

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

          attachLoadedListeners();
        }
      });
    }

    function createMediaCard(item, cycle, isCollectionContext = false) {
      const div = document.createElement('div');
      const isRevealed = unlockedGachaSet.has(item.postId) || unlockedGachaSet.has(item.id);
      const isSelected = selectedItemsSet.has(item.postId || item.id);
      const rawTier = item.gachaRarity || 'N';
      const tierClass = getRarityClass(rawTier);
      const tierBadge = getRarityBadgeText(rawTier);

      div.className = 'media-item' + 
        (isRevealed ? ` gacha-revealed-${tierClass}` : '') +
        (isSelected ? ' card-selected-highlight' : '');
      div.dataset.imgUrl = item.imgUrl;
      div.dataset.postId = item.postId || item.id;
      div.dataset.platform = item.platform;

      if (item.dominantColor) {
        div.style.setProperty('--card-dom', item.dominantColor);
      }

      const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;
      div.innerHTML = `
        <input type="checkbox" class="card-select-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="card-top-badges">
          ${isRevealed ? `<span class="card-rarity-pill ${tierClass}">${tierBadge}</span>` : ''}
          ${item.totalPages > 1 ? `<span class="page-pill">📄 ${item.pageIndex + 1}/${item.totalPages}</span>` : ''}
          ${item.dominantColor ? `<div class="color-chip" style="background:${item.dominantColor}" title="Dominant: ${item.colorFamily}"></div>` : ''}
        </div>
        <button class="card-delete-btn" title="${isCollectionContext ? 'Remove from collection' : 'Delete post'}">🗑️</button>
        <div class="platform-dot ${item.platform}" title="${pInfo.name}">${pInfo.letter}</div>
      `;

      const cb = div.querySelector('.card-select-checkbox');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCardSelection(item.postId || item.id);
      });

      const delBtn = div.querySelector('.card-delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCollectionContext) {
          removePostFromCollection(item.postId || item.id);
        } else {
          deletePost(item.postId || item.id);
        }
      });

      const img = document.createElement('img');
      img.decoding = 'async';
      img.loading = 'lazy';
      trackImageLoad(img, cycle);
      setCachedOrRemoteSrc(img, item);

      div.appendChild(img);

      div.addEventListener('click', () => {
        if (isSelectionMode) {
          toggleCardSelection(item.postId || item.id);
        } else {
          openDetail(item);
        }
      });
      return div;
    }

    function createPostCard(item, cycle, isCollectionContext = false) {
      const card = document.createElement('div');
      const isRevealed = unlockedGachaSet.has(item.postId) || unlockedGachaSet.has(item.id);
      const isSelected = selectedItemsSet.has(item.postId || item.id);
      const rawTier = item.gachaRarity || 'N';
      const tierClass = getRarityClass(rawTier);
      const tierBadge = getRarityBadgeText(rawTier);

      card.className = 'post-card' + 
        (isRevealed ? ` gacha-revealed-${tierClass}` : '') +
        (isSelected ? ' card-selected-highlight' : '');
      card.dataset.imgUrl = item.imgUrl;
      card.dataset.postId = item.postId || item.id;
      card.dataset.platform = item.platform;

      if (item.dominantColor) {
        card.style.setProperty('--card-dom', item.dominantColor);
      }

      const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;
      const author = item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorName || 'Unknown');
      const handle = item.platform === 'pinterest' ? '@pinterest' : (item.authorHandle || '');
      const initial = author.charAt(0).toUpperCase();
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric'
      }) : '';

      const profileUrl = getAuthorProfileUrl(item.platform, handle, item);

      card.innerHTML = `
        <input type="checkbox" class="card-select-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="card-top-badges">
          ${isRevealed ? `<span class="card-rarity-pill ${tierClass}">${tierBadge}</span>` : ''}
          ${item.totalPages > 1 ? `<span class="page-pill">📄 ${item.pageIndex + 1}/${item.totalPages}</span>` : ''}
          ${item.dominantColor ? `<div class="color-chip" style="background:${item.dominantColor}" title="Dominant: ${item.colorFamily}"></div>` : ''}
        </div>

        <div class="post-header">
          <div class="post-avatar">${initial}</div>
          <div class="post-author-block">
            <div class="post-author-name" title="${author}">${author}</div>
            <a href="${profileUrl}" target="_blank" class="post-author-handle">${handle}</a>
          </div>
        </div>

        ${item.text ? `<div class="post-body-text">${item.text}</div>` : ''}

        <div class="post-media-wrap">
          <img decoding="async" loading="lazy" alt="Artwork">
          <button class="card-delete-btn" title="${isCollectionContext ? 'Remove from collection' : 'Delete post'}">🗑️</button>
          <div class="platform-dot ${item.platform}" title="${pInfo.name}">${pInfo.letter}</div>
        </div>

        <div class="post-footer">
          <span>${dateStr}</span>
          <div class="post-footer-actions">
            <!-- Focus Enlarge Button -->
            <button type="button" class="post-icon-btn focus-view-btn" title="Enlarge image with background blur">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
            <!-- Sleek External Link Button -->
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="post-icon-btn" title="Open source post on ${pInfo.name}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        </div>
      `;

      const cb = card.querySelector('.card-select-checkbox');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCardSelection(item.postId || item.id);
      });

      const delBtn = card.querySelector('.card-delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCollectionContext) {
          removePostFromCollection(item.postId || item.id);
        } else {
          deletePost(item.postId || item.id);
        }
      });

      const focusBtn = card.querySelector('.focus-view-btn');
      focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fullSrc = item.imgUrl || item.mediaUrl || item.fallbackUrl;
        openFocusBlurView(fullSrc);
      });

      const img = card.querySelector('.post-media-wrap img');
      trackImageLoad(img, cycle);
      setCachedOrRemoteSrc(img, item);

      card.querySelector('.post-media-wrap').addEventListener('click', () => {
        if (isSelectionMode) {
          toggleCardSelection(item.postId || item.id);
        } else {
          openDetail(item);
        }
      });
      return card;
    }

    // ===================================================
    // MODAL ZOOM, GESTURES & ARROW NAVIGATION
    // ===================================================
    let modalScale = 1;
    let modalTranslateX = 0;
    let modalTranslateY = 0;
    let isPanningModal = false;
    let panStartX = 0;
    let panStartY = 0;
    let touchInitialDist = 0;
    let touchStartScale = 1;
    let lastTapTimestamp = 0;

    function applyModalTransform(animate = false) {
      modalImg.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
      modalImg.style.transform = `translate3d(${modalTranslateX}px, ${modalTranslateY}px, 0) scale(${modalScale})`;
      if (modalScale <= 1) {
        modalImg.classList.remove('is-panning');
        modal.classList.remove('is-zoomed');
      } else {
        modal.classList.add('is-zoomed');
      }
    }

    function resetModalZoom(animate = true) {
      modalScale = 1;
      modalTranslateX = 0;
      modalTranslateY = 0;
      isPanningModal = false;
      modalImg.classList.remove('is-panning');
      modal.classList.remove('is-zoomed');
      applyModalTransform(animate);
    }

    function setModalZoom(newScale) {
      const clamped = Math.max(1, Math.min(newScale, 5));
      if (clamped === 1) {
        resetModalZoom(true);
        return;
      }
      modalScale = clamped;
      modal.classList.add('is-zoomed');
      applyModalTransform(true);
    }

    modalMedia.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;
      setModalZoom(modalScale * zoomFactor);
    }, { passive: false });

    modalImg.addEventListener('mousedown', (e) => {
      if (modalScale <= 1) return;
      e.preventDefault();
      isPanningModal = true;
      panStartX = e.clientX - modalTranslateX;
      panStartY = e.clientY - modalTranslateY;
      modalImg.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanningModal || modalScale <= 1) return;
      modalTranslateX = e.clientX - panStartX;
      modalTranslateY = e.clientY - panStartY;
      applyModalTransform(false);
    });

    window.addEventListener('mouseup', () => {
      if (isPanningModal) {
        isPanningModal = false;
        modalImg.classList.remove('is-panning');
      }
    });

    modalImg.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (modalScale > 1) resetModalZoom(true);
      else setModalZoom(2.5);
    });

    modalMedia.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        touchInitialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartScale = modalScale;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTimestamp < 300) {
          if (modalScale > 1) resetModalZoom(true);
          else setModalZoom(2.5);
          lastTapTimestamp = 0;
          return;
        }
        lastTapTimestamp = now;

        if (modalScale > 1) {
          isPanningModal = true;
          panStartX = e.touches[0].clientX - modalTranslateX;
          panStartY = e.touches[0].clientY - modalTranslateY;
          modalImg.classList.add('is-panning');
        }
      }
    }, { passive: false });

    modalMedia.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (touchInitialDist > 0) {
          const ratio = dist / touchInitialDist;
          modalScale = Math.max(1, Math.min(touchStartScale * ratio, 5));
          if (modalScale <= 1) {
            modalTranslateX = 0;
            modalTranslateY = 0;
            modal.classList.remove('is-zoomed');
          } else {
            modal.classList.add('is-zoomed');
          }
          applyModalTransform(false);
        }
      } else if (e.touches.length === 1 && isPanningModal && modalScale > 1) {
        e.preventDefault();
        modalTranslateX = e.touches[0].clientX - panStartX;
        modalTranslateY = e.touches[0].clientY - panStartY;
        applyModalTransform(false);
      }
    }, { passive: false });

    modalMedia.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) touchInitialDist = 0;
      if (e.touches.length === 0) {
        isPanningModal = false;
        modalImg.classList.remove('is-panning');
        if (modalScale <= 1) {
          modal.classList.remove('is-zoomed');
          resetModalZoom(true);
        }
      }
    });

    if (modalDetailsToggle) {
      modalDetailsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        modalDetails.classList.toggle('expanded');
      });
    }

    modalMedia.addEventListener('click', () => {
      if (window.innerWidth <= 800 && modalDetails && modalDetails.classList.contains('expanded')) {
        modalDetails.classList.remove('expanded');
      }
    });

    // LIGHTBOX PREVIOUS / NEXT ARROW NAVIGATION WITH TRANSITION ANIMATIONS
    function navigateLightbox(direction) {
      if (!activeModalItem) return;

      let list = [];
      if (collectionsView.style.display !== 'none' && activeCollectionId && customCollections[activeCollectionId]) {
        const colIdSet = new Set(customCollections[activeCollectionId].itemIds);
        list = currentItems.filter(i => colIdSet.has(i.postId || i.id));
      } else {
        list = getActiveFilteredList();
      }

      if (!list || list.length <= 1) return;

      const currId = activeModalItem.id || activeModalItem.postId;
      const idx = list.findIndex(i => (i.id || i.postId) === currId);
      if (idx !== -1) {
        const nextIdx = (idx + direction + list.length) % list.length;
        const anim = direction > 0 ? 'slide-in-right' : 'slide-in-left';
        openDetail(list[nextIdx], anim);
      }
    }

    if (modalPrevBtn) modalPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(-1); });
    if (modalNextBtn) modalNextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(1); });

    function openDetail(item, animClass = '') {
      activeModalItem = item;
      resetModalZoom(false);
      setCachedOrRemoteSrc(modalImg, item);

      if (animClass) {
        modalImg.classList.add(animClass);
        setTimeout(() => {
          modalImg.classList.remove('slide-in-right', 'slide-in-left');
        }, 240);
      }

      // Update delete button text if in collection view
      if (collectionsView.style.display !== 'none' && activeCollectionId) {
        modalDeleteBtn.textContent = '❌ Remove from Collection';
      } else {
        modalDeleteBtn.textContent = '🗑️ Delete Post';
      }

      // DIMENSION BADGE UPDATE
      const updateDimDisplay = () => {
        if (item._width && item._height) {
          modalDimText.textContent = `${item._width} × ${item._height}`;
          modalDimensionBadge.style.display = 'inline-flex';
        } else if (modalImg.naturalWidth && modalImg.naturalHeight) {
          item._width = modalImg.naturalWidth;
          item._height = modalImg.naturalHeight;
          modalDimText.textContent = `${modalImg.naturalWidth} × ${modalImg.naturalHeight}`;
          modalDimensionBadge.style.display = 'inline-flex';
        } else {
          modalDimensionBadge.style.display = 'none';
        }
      };
      updateDimDisplay();
      modalImg.addEventListener('load', updateDimDisplay, { once: true });

      const author = item.platform === 'pinterest' ? 'Pinterest creator' : (item.authorName || 'Unknown');
      const handle = item.platform === 'pinterest' ? '@pinterest' : (item.authorHandle || '');

      if (modalDetails) modalDetails.classList.remove('expanded');
      if (drawerAuthorPreview) drawerAuthorPreview.textContent = `ℹ️ ${author}`;

      const pInfo = PLATFORMS[item.platform] || PLATFORMS.twitter;

      if (item.totalPages > 1) {
        modalPagePill.style.display = 'inline-flex';
        modalPagePill.textContent = `📄 ${item.pageIndex + 1} / ${item.totalPages}`;
      } else {
        modalPagePill.style.display = 'none';
      }

      document.getElementById('modalAuthor').textContent = author;
      const handleEl = document.getElementById('modalHandle');
      handleEl.textContent = handle;
      handleEl.href = getAuthorProfileUrl(item.platform, handle, item);

      const postTextEl = document.getElementById('modalText');
      if (item.text) {
        postTextEl.textContent = item.text;
        postTextEl.style.display = 'block';
      } else {
        postTextEl.style.display = 'none';
      }

      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '';
      document.getElementById('modalDate').textContent = dateStr;

      const linkEl = document.getElementById('modalLink');
      linkEl.href = item.url;
      linkEl.textContent = `Go to post on ${pInfo.name} \u2192`;

      // Multi-image pages thumb strip
      if (item.allMedia && item.allMedia.length > 1) {
        multiMediaWrap.style.display = 'block';
        postThumbs.innerHTML = '';
        item.allMedia.forEach((mediaUrl, idx) => {
          const thumbBtn = document.createElement('div');
          thumbBtn.className = 'thumb-btn' + (idx === item.pageIndex ? ' active' : '');
          const thumbImg = document.createElement('img');
          thumbImg.loading = 'lazy';
          setCachedOrRemoteSrc(thumbImg, { imgUrl: mediaUrl, platform: item.platform });
          thumbBtn.appendChild(thumbImg);
          thumbBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = currentItems.find(i => (i.postId === item.postId || i.id === item.postId) && i.pageIndex === idx);
            if (target) openDetail(target);
          });
          postThumbs.appendChild(thumbBtn);
        });
      } else {
        multiMediaWrap.style.display = 'none';
      }

      loadUserMeta(item.postId || item.id);

      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      modal.classList.remove('open');
      modal.classList.remove('is-zoomed');
      document.body.style.overflow = '';
      activeModalItem = null;
      resetModalZoom(false);
    }

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // ===================================================
    // GLOBAL KEYBOARD NAVIGATION SHORTCUTS
    // ===================================================
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (focusBlurOverlay.classList.contains('open')) closeFocusBlurView();
        else if (userNotesModal.classList.contains('open')) userNotesModal.classList.remove('open');
        else if (modal.classList.contains('open')) closeModal();
        else if (pokemonModal.classList.contains('open')) closePokemonCard();
        else if (gachaSummonOverlay.classList.contains('active')) summonCloseBtn.click();
        else if (isSelectionMode) setSelectionMode(false);
        else if (isGachaSelectionMode) setGachaSelectionMode(false);
      }

      if (modal.classList.contains('open')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateLightbox(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateLightbox(1);
        }
      } else if (pokemonModal.classList.contains('open')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigatePokemon(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigatePokemon(1);
        }
      } else if (summonStageInspect && summonStageInspect.style.display === 'flex') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          proceedPrevInspectCard();
        } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          proceedNextInspectCard();
        }
      }
    });

    // ===================================================
    // VIEW SWITCHERS (CARDS VS IMAGES)
    // ===================================================
    viewPostsBtn.addEventListener('click', () => {
      if (currentViewMode === 'posts') return;
      currentViewMode = 'posts';
      viewPostsBtn.classList.add('active');
      viewMediaBtn.classList.remove('active');
      if (galleryView.style.display !== 'none') renderColumns();
      else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
    });

    viewMediaBtn.addEventListener('click', () => {
      if (currentViewMode === 'media') return;
      currentViewMode = 'media';
      viewMediaBtn.classList.add('active');
      viewPostsBtn.classList.remove('active');
      if (galleryView.style.display !== 'none') renderColumns();
      else if (collectionsView.style.display !== 'none' && activeCollectionId) openCollection(activeCollectionId);
    });

    // Window Resize Handling for Columns
    window.addEventListener('resize', () => {
      updateColZoomUI();
      updateGachaColZoomUI();
      if (window.innerWidth <= 800) {
        document.querySelectorAll('.dropdown-menu.open').forEach(adjustDropdownPlacement);
      }
    });

    // ===================================================
    // INITIAL BOOTSTRAP
    // ===================================================
    window.addEventListener('DOMContentLoaded', async () => {
      initCustomDropdowns();
      setupProfileFileInput();
      updateColZoomUI();
      updateGachaColZoomUI();
      updateProfileUI();
      await loadProfileData();
    });