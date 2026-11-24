const BASE = 'https://cdn.jsdelivr.net/gh/darmat1/ukraine-geo-data@main/geodata/';
const PREFIX = 'am25_';

async function checkEUkraineFont() {
  const labelEl = document.getElementById('fontStatusLabel');
  if (!document.fonts || !document.fonts.ready) return;
  await document.fonts.ready;
  const loaded = [...document.fonts].some(f => f.family.toLowerCase().includes('e-ukraine') && f.status === 'loaded');
  if (labelEl) {
    labelEl.innerHTML = loaded
      ? 'Шрифт: <b>e-Ukraine, sans-serif</b> (активний) • Реальний відлік тривалості'
      : 'Шрифт: <b>e-Ukraine, sans-serif</b> (резерв Inter — покладіть .woff2 у ./fonts/ для офлайн)';
  }
}
checkEUkraineFont();

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, accentColor = '#38bdf8') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.style.borderLeftColor = accentColor;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function pushTicker(text) {
  const feed = document.getElementById('tickerFeed');
  if (!feed) return;
  const t = new Date().toLocaleTimeString('uk-UA');
  feed.textContent = `[${t}] ${text}`;
}

function getLiveElapsedMs(zKey) {
  const s = getS(zKey);
  if (!s || !s.activeId) return null;
  const h = getH(zKey);
  const activeEv = h.find(e => e.id === s.activeId && !e.end);
  if (!activeEv || !activeEv.start) return null;
  return Math.max(0, Date.now() - activeEv.start);
}

function quickStopZoneByKey(event, zKey) {
  if (event) event.stopPropagation();
  if (!getS(zKey)) return;
  const elapsedMs = getLiveElapsedMs(zKey);
  const name = zoneFeatureMap[zKey]?.properties?._displayName || zKey;
  clearStatusForZone(zKey);
  playTone(false);
  refreshAllStyles();
  const durSuffix = elapsedMs != null ? ` (${fmt(elapsedMs)})` : '';
  const msg = `🔕 Відбій: ${name}${durSuffix}`;
  pushTicker(msg);
  showToast(msg, '#10b981');
}

let neonEnabled = localStorage.getItem(PREFIX + 'neon') === '1';

function syncNeonMode() {
  document.body.classList.toggle('neon-mode', neonEnabled);
  const btn = document.getElementById('neonToggleBtn');
  if (btn) btn.classList.toggle('active-neon', neonEnabled);
}

function toggleNeonMode() {
  neonEnabled = !neonEnabled;
  localStorage.setItem(PREFIX + 'neon', neonEnabled ? '1' : '0');
  syncNeonMode();
  showToast(neonEnabled ? 'Неоновий режим увімкнено' : 'Неоновий режим вимкнено', '#38bdf8');
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(PREFIX + 'favorites') || '[]'); } catch { return []; }
}

function saveFavorites(list) {
  localStorage.setItem(PREFIX + 'favorites', JSON.stringify(list));
}

function renderFavoritesChips() {
  const box = document.getElementById('favoritesChips');
  const pinBtn = document.getElementById('favToggleBtn');
  if (!box) return;

  const favs = getFavorites();
  const isPinned = Boolean(currentKey && favs.some(f => f.zKey === currentKey));
  if (pinBtn) {
    pinBtn.textContent = isPinned ? '★ Закріплено' : '☆ Закріпити обрану';
    pinBtn.classList.toggle('pinned', isPinned);
  }

  if (!favs.length) {
    box.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Оберіть зону та натисніть «Закріпити обрану».</span>';
    return;
  }

  box.innerHTML = favs.map(item => {
    const st = getS(item.zKey);
    const code = st ? (st.level || st.type || 'red') : null;
    const dotColor = code ? (C[code] || C.red) : '#64748b';
    return `
      <button class="active-chip" onclick="selectZoneByKey(${JSON.stringify(item.zKey)})" title="${escapeHtml(item.parentOblast || '')}">
        <span class="chip-dot" style="background:${dotColor}"></span>
        <span>${escapeHtml(item.displayName || item.zKey)}</span>
      </button>
    `;
  }).join('');
}

function toggleFavoriteCurrentZone() {
  if (!currentKey) return showToast('Спочатку обери район або місто', '#facc15');
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.zKey === currentKey);
  if (idx >= 0) {
    favs.splice(idx, 1);
    saveFavorites(favs);
    renderFavoritesChips();
    showToast(`Прибрано зі збережених: ${currentDisplayName}`, '#94a3b8');
  } else {
    favs.unshift({
      zKey: currentKey,
      displayName: currentDisplayName,
      parentOblast: currentParentOblast
    });
    saveFavorites(favs.slice(0, 12));
    renderFavoritesChips();
    showToast(`Закріплено зону: ${currentDisplayName}`, '#facc15');
  }
}

function clearFavoritesAlerts() {
  const favs = getFavorites();
  if (!favs.length) return showToast('Немає закріплених зон', '#94a3b8');
  let cleared = 0;
  favs.forEach(item => {
    if (getS(item.zKey)) {
      clearStatusForZone(item.zKey);
      cleared++;
    }
  });
  if (!cleared) return showToast('У закріплених зонах немає активних тривог', '#94a3b8');
  playTone(false);
  refreshAllStyles();
  const text = `⭐ Відбій у закріплених зонах (${cleared})`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function spinThreatWheel() {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pickZone = allZonesMeta[Math.floor(Math.random() * allZonesMeta.length)];
  const [type, level] = threats[Math.floor(Math.random() * threats.length)];
  lastSelectedThreat = { type, level };
  setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
  selectZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast);
  playTone(true);
  const msg = `🎡 Колесо: ${LABEL[level] || level} → ${pickZone._displayName}`;
  pushTicker(msg);
  showToast(msg, '#a855f7');
  pushAlertNotification({
    zKey: pickZone._zKey,
    zone: pickZone._displayName,
    oblast: pickZone._parentOblast,
    code: level,
    title: `🎡 ${LABEL[level] || level}`,
    detail: 'Випало на колесі загроз • Триває до відбою',
    isAir: type === 'air'
  });
}

function simulateBurstThreats(count = 8) {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pool = [...allZonesMeta];
  let lastPicked = null;
  const actualCount = Math.min(count, pool.length);

  for (let i = 0; i < actualCount; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const pickZone = pool.splice(idx, 1)[0];
    const [type, level] = threats[Math.floor(Math.random() * threats.length)];
    setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
    pushAlertNotification({
      zKey: pickZone._zKey,
      zone: pickZone._displayName,
      oblast: pickZone._parentOblast,
      code: level,
      title: LABEL[level] || level,
      detail: 'Хвиля тривог • Триває до відбою',
      isAir: type === 'air'
    });
    lastPicked = { pickZone, type, level };
  }
  if (lastPicked) {
    lastSelectedThreat = { type: lastPicked.type, level: lastPicked.level };
    selectZone(lastPicked.pickZone._zKey, lastPicked.pickZone._displayName, lastPicked.pickZone._parentOblast);
  }
  playTone(true);
  refreshAllStyles();
  const msg = `⚡ Хвиля з ${actualCount} різних загроз (реальний відлік часу)`;
  pushTicker(msg);
  showToast(msg, '#38bdf8');
}

function exportReportTxt() {
  const active = collectActiveZones();
  const nowStr = new Date().toLocaleString('uk-UA');
  const lines = active.map((item, idx) => {
    const code = item.level || item.type || 'red';
    const elapsed = getLiveElapsedMs(item.zKey);
    const durText = elapsed != null ? ` — триває ${fmt(elapsed)}` : '';
    return `${idx + 1}. ${item.displayName} (${item.parentOblast}) — ${LABEL[code] || code}${durText}`;
  });
  const content = [
    '========================================',
    'ALERTMAP PRO v3.0 — ОПЕРАТИВНИЙ ЗВІТ',
    `Дата та час: ${nowStr}`,
    `Активних зон: ${active.length} / ${allZonesMeta.length}`,
    '========================================',
    '',
    lines.length ? lines.join('\n') : 'Активних тривог немає.'
  ].join('\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alertmap-report-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Текстовий звіт (.TXT) завантажено', '#38bdf8');
}

let autoSimTimer = null;
let autoSimIntervalMs = 10000;
let autoSimBurstMode = 'mixed';

function updateAutoSimBurstMode(mode) {
  autoSimBurstMode = mode || 'mixed';
  const labels = {
    mixed: '1–20 подій за такт',
    small: '1–5 подій за такт',
    heavy: '8–24 події за такт'
  };
  showToast(`Режим пачки авто-ефіру: ${labels[autoSimBurstMode] || autoSimBurstMode}`, '#38bdf8');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateAutoSimInterval(val) {
  autoSimIntervalMs = Number(val) || 10000;
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = setInterval(runAutoSimStep, autoSimIntervalMs);
    showToast(`Інтервал авто-ефіру: ${autoSimIntervalMs / 1000} с`, '#34d399');
  }
}

/**
 * Авто-ефір: за один такт видає одразу декілька тривог і декілька відбоїв
 * (хоч 1, хоч 5, хоч 20+ залежно від режиму та активних зон).
 */
function runAutoSimStep() {
  if (!allZonesMeta.length) return;

  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];

  let minBatch = 1;
  let maxBatch = 20;
  if (autoSimBurstMode === 'small') {
    minBatch = 1;
    maxBatch = 5;
  } else if (autoSimBurstMode === 'heavy') {
    minBatch = 8;
    maxBatch = 24;
  }

  const desiredTotalEvents = randInt(minBatch, maxBatch);

  const activeNow = collectActiveZones();
  const inactivePool = allZonesMeta.filter(z => !getS(z._zKey));

  let clearCount = 0;
  let alertCount = 0;

  if (activeNow.length === 0) {
    alertCount = Math.min(desiredTotalEvents, inactivePool.length);
  } else if (inactivePool.length === 0) {
    clearCount = Math.min(desiredTotalEvents, activeNow.length);
  } else {
    if (desiredTotalEvents === 1) {
      if (Math.random() < 0.45 && activeNow.length > 0) {
        clearCount = 1;
      } else {
        alertCount = 1;
      }
    } else {
      const maxClears = Math.min(activeNow.length, desiredTotalEvents - 1);
      clearCount = randInt(1, Math.max(1, maxClears));
      alertCount = Math.min(inactivePool.length, Math.max(1, desiredTotalEvents - clearCount));
    }
  }

  const clearedItems = [];
  if (clearCount > 0 && activeNow.length > 0) {
    const activeCopy = [...activeNow];
    for (let i = 0; i < clearCount && activeCopy.length > 0; i++) {
      const idx = Math.floor(Math.random() * activeCopy.length);
      const target = activeCopy.splice(idx, 1)[0];
      const elapsedMs = getLiveElapsedMs(target.zKey);
      clearStatusForZone(target.zKey);
      clearedItems.push({
        name: target.displayName || target.zKey,
        dur: elapsedMs != null ? fmt(elapsedMs) : null
      });
    }
  }

  const alertedItems = [];
  if (alertCount > 0 && inactivePool.length > 0) {
    const poolCopy = [...inactivePool];
    for (let i = 0; i < alertCount && poolCopy.length > 0; i++) {
      const idx = Math.floor(Math.random() * poolCopy.length);
      const z = poolCopy.splice(idx, 1)[0];
      const [type, level] = threats[Math.floor(Math.random() * threats.length)];
      lastSelectedThreat = { type, level };
      setStatusForZone(z._zKey, z._displayName, z._parentOblast, type, level);
      pushAlertNotification({
        zKey: z._zKey,
        zone: z._displayName,
        oblast: z._parentOblast,
        code: level,
        title: LABEL[level] || level,
        detail: 'Авто-ефір • Триває до відбою',
        isAir: type === 'air'
      });
      alertedItems.push({ z, type, level });
    }
    if (alertedItems.length > 0) {
      const last = alertedItems[alertedItems.length - 1];
      selectZone(last.z._zKey, last.z._displayName, last.z._parentOblast);
    }
  }

  if (alertedItems.length > 0) {
    playTone(true);
  } else if (clearedItems.length > 0) {
    playTone(false);
  }

  refreshAllStyles();

  const parts = [];
  if (alertedItems.length > 0) {
    const sample = alertedItems.slice(0, 3).map(x => x.z._displayName).join(', ');
    parts.push(`🚨 +${alertedItems.length} тривог (${sample}${alertedItems.length > 3 ? '…' : ''})`);
  }
  if (clearedItems.length > 0) {
    const sampleOff = clearedItems.slice(0, 3).map(x => x.name).join(', ');
    parts.push(`🔕 ${clearedItems.length} відбоїв (${sampleOff}${clearedItems.length > 3 ? '…' : ''})`);
  }

  const summaryMsg = `Авто-ефір: ${parts.join(' • ') || 'без змін'}`;
  pushTicker(summaryMsg);
  showToast(summaryMsg, alertedItems.length >= clearedItems.length ? '#ef4444' : '#10b981');
}

function toggleAutoSim() {
  const btn = document.getElementById('autoSimBtn');
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = null;
    if (btn) {
      btn.textContent = '▶ Авто-ефір';
      btn.classList.remove('running');
    }
    showToast('Авто-ефір зупинено', '#94a3b8');
  } else {
    autoSimTimer = setInterval(runAutoSimStep, autoSimIntervalMs);
    if (btn) {
      btn.textContent = '⏹ Стоп ефір';
      btn.classList.add('running');
    }
    showToast(`Авто-ефір запущено (кожні ${autoSimIntervalMs / 1000} с) • Пачки тривог і відбоїв`, '#10b981');
    runAutoSimStep();
  }
}

function clearAlertsByCode(code) {
  const active = collectActiveZones().filter(item => (item.level || item.type) === code);
  if (!active.length) {
    return showToast(`Немає активних тривог рівня ${LABEL[code] || code}`, '#94a3b8');
  }
  active.forEach(item => clearStatusForZone(item.zKey));
  playTone(false);
  refreshAllStyles();
  const text = `🛡️ Знято активні тривоги рівня: ${LABEL[code] || code} (${active.length} зон)`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function showAnalyticsModal() {
  renderAnalyticsModal();
  document.getElementById('analyticsModal').style.display = 'flex';
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').style.display = 'none';
}

function getRegionStats() {
  const activeList = collectActiveZones();
  const activeSet = new Set(activeList.map(i => i.zKey));
  return OBLASTS.map(ob => {
    const raions = oblastToRaions[ob] || [];
    const total = raions.length;
    const activeCount = raions.filter(r => activeSet.has(r.key)).length;
    const pct = total ? Math.round((activeCount / total) * 100) : 0;
    return { ob, total, activeCount, pct };
  }).sort((a, b) => b.activeCount - a.activeCount || b.pct - a.pct);
}

function renderHotspotChips() {
  const box = document.getElementById('hotspotChips');
  if (!box) return;
  const hot = getRegionStats().filter(r => r.activeCount > 0).slice(0, 5);
  if (!hot.length) {
    box.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Спокійно — активних тривог по областях немає.</span>';
    return;
  }
  box.innerHTML = hot.map(r => `
    <button class="active-chip" onclick="focusOblastFromAnalytics(${JSON.stringify(r.ob)})">
      <span class="chip-dot" style="background:#ef4444"></span>
      <span>${escapeHtml(SHORT_NAMES[r.ob] || r.ob)}</span>
      <span class="tabular" style="color:#fca5a5">${r.activeCount}/${r.total}</span>
    </button>
  `).join('');
}

function renderAnalyticsModal() {
  const activeList = collectActiveZones();
  const rows = getRegionStats();

  document.getElementById('analyticsTotalSummary').textContent =
    `Активно: ${activeList.length} / ${allZonesMeta.length}`;

  const body = document.getElementById('analyticsModalBody');
  body.innerHTML = rows.map(r => `
    <div class="analytics-row">
      <div class="analytics-top">
        <span>${escapeHtml(r.ob)}</span>
        <span class="tabular">${r.activeCount} / ${r.total} (${r.pct}%)</span>
        <button class="analytics-focus-btn" onclick="focusOblastFromAnalytics(${JSON.stringify(r.ob)})">На мапу</button>
      </div>
      <div class="analytics-bar-bg">
        <div class="analytics-bar-fill" style="width:${r.pct}%"></div>
      </div>
    </div>
  `).join('');
}

function focusOblastFromAnalytics(ob) {
  closeAnalyticsModal();
  const first = (oblastToRaions[ob] || [])[0];
  if (first && zoneFeatureMap[first.key]) {
    const meta = zoneFeatureMap[first.key].properties;
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
  if (oblastFeatureMap[ob]) {
    const bounds = L.geoJSON(oblastFeatureMap[ob]).getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [24, 24], duration: 0.45 });
    }
  }
}

function showGlobalLogModal() {
  renderGlobalLogModal();
  document.getElementById('globalLogModal').style.display = 'flex';
}

function closeGlobalLogModal() {
  document.getElementById('globalLogModal').style.display = 'none';
}

function renderGlobalLogModal() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX + 'h_')) continue;
    const zKey = k.slice((PREFIX + 'h_').length);
    const meta = zoneFeatureMap[zKey]?.properties || {};
    const list = getH(zKey);
    list.forEach(ev => {
      entries.push({
        ...ev,
        zKey,
        displayName: meta._displayName || zKey,
        parentOblast: meta._parentOblast || ''
      });
    });
  }

  entries.sort((a, b) => (b.start || 0) - (a.start || 0));
  const top = entries.slice(0, 60);
  document.getElementById('globalLogCount').textContent = `Записів: ${top.length}`;

  const body = document.getElementById('globalLogBody');
  if (!top.length) {
    body.innerHTML = '<div class="event" style="border-left-color:#64748b"><b>Глобальний лог порожній</b><small>Запустіть тривогу або сценарій, щоб з’явилися події.</small></div>';
    return;
  }

  const now = Date.now();
  body.innerHTML = top.map(e => {
    const code = e.level || e.type;
    const borderColor = C[code] || '#ef4444';
    return `
      <div class="event" style="border-left-color:${borderColor}">
        <div class="event-head">
          <b>${escapeHtml(e.displayName)} — ${escapeHtml(LABEL[code] || code)}</b>
          <span class="ev-tag ${e.end ? 'done' : 'active'}">${e.end ? 'Завершено' : 'Активна'}</span>
        </div>
        <div class="ev-times">
          ${e.parentOblast && e.parentOblast !== e.displayName ? `<small>Область: ${escapeHtml(e.parentOblast)}</small>` : ''}
          <small>Початок: ${new Date(e.start).toLocaleString('uk-UA')}</small>
        </div>
        <div class="duration tabular">
          <span>${e.end ? '✅ Зафіксовано' : '🔴 Триває'}</span>
          <strong>${fmt((e.end || now) - e.start)}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function getNotifications() {
  try { return JSON.parse(localStorage.getItem(PREFIX + 'notifications') || '[]'); } catch { return []; }
}

function saveNotifications(list) {
  localStorage.setItem(PREFIX + 'notifications', JSON.stringify(list.slice(0, 120)));
}

function getUnreadCount() {
  return Number(localStorage.getItem(PREFIX + 'unread_alerts') || '0');
}

function setUnreadCount(n) {
  localStorage.setItem(PREFIX + 'unread_alerts', String(Math.max(0, n)));
  syncUnreadBadge();
}

function syncUnreadBadge() {
  const badge = document.getElementById('unreadAlertsBadge');
  if (!badge) return;
  const count = getUnreadCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('zero', count === 0);
}

function pushAlertNotification({ zKey, zone, oblast, code, title, detail, isAir }) {
  const list = getNotifications();
  const item = {
    id: 'n' + Date.now() + Math.random().toString(16).slice(2, 6),
    ts: Date.now(),
    zKey: zKey || '',
    zone: zone || 'Україна',
    oblast: oblast || '',
    code: code || 'red',
    title: title || 'Оголошено тривогу',
    detail: detail || '',
    isAir: Boolean(isAir)
  };
  list.unshift(item);
  saveNotifications(list);
  setUnreadCount(getUnreadCount() + 1);
  if (document.getElementById('alertsModal').style.display === 'flex') {
    renderAlertsCenter();
  }
}

let notifFilterMode = 'all';

function setNotifFilter(mode) {
  notifFilterMode = mode;
  document.getElementById('ntab-all').classList.toggle('active', mode === 'all');
  document.getElementById('ntab-air').classList.toggle('active', mode === 'air');
  document.getElementById('ntab-other').classList.toggle('active', mode === 'other');
  renderAlertsCenter();
}

function renderAlertsCenter() {
  const list = getNotifications();
  const filtered = list.filter(item => {
    if (notifFilterMode === 'air') return item.isAir;
    if (notifFilterMode === 'other') return !item.isAir;
    return true;
  });

  document.getElementById('notifCountLabel').textContent = `Повідомлень: ${filtered.length}`;
  const body = document.getElementById('alertsModalBody');

  if (!filtered.length) {
    body.innerHTML = '<div class="event" style="border-left-color:#64748b"><b>Сповіщень про тривоги поки немає</b><small>Коли оголошується повітряна тривога або інша загроза, повідомлення з’являться тут.</small></div>';
    return;
  }

  const now = Date.now();
  body.innerHTML = filtered.map(item => {
    const borderColor = C[item.code] || '#ef4444';
    const badgeCls = item.isAir ? 'active' : 'done';
    const badgeTxt = item.isAir ? 'Повітряна тривога' : 'Загроза';
    const st = item.zKey ? getS(item.zKey) : null;
    const isStillActive = Boolean(st && (st.level || st.type) === item.code);
    const elapsedLine = isStillActive
      ? `<small class="tabular" style="color:#fca5a5">Триває зараз: ${fmt(Math.max(0, now - item.ts))}</small>`
      : '';

    return `
      <div class="event" style="border-left-color:${borderColor}">
        <div class="event-head">
          <b>${escapeHtml(item.title)}</b>
          <span class="ev-tag ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="ev-times">
          <small>Зона: <b>${escapeHtml(item.zone)}</b>${item.oblast && item.oblast !== item.zone ? ` (${escapeHtml(item.oblast)})` : ''}</small>
          ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}
          ${elapsedLine}
          <small class="tabular">Час надходження: ${new Date(item.ts).toLocaleString('uk-UA')}</small>
        </div>
      </div>
    `;
  }).join('');
}

function showAlertsCenter() {
  setUnreadCount(0);
  renderAlertsCenter();
  document.getElementById('alertsModal').style.display = 'flex';
}

function closeAlertsCenter() {
  document.getElementById('alertsModal').style.display = 'none';
}

function clearAlertNotifications() {
  saveNotifications([]);
  setUnreadCount(0);
  renderAlertsCenter();
  showToast('Список сповіщень очищено', '#94a3b8');
}

const map = L.map('map', {
  minZoom: 5,
  maxZoom: 18,
  zoomSnap: 0.1,
  zoomControl: false,
  wheelPxPerZoomLevel: 60,
  preferCanvas: false
}).setView([48.7, 31.5], 6.4);

map.attributionControl.addAttribution('GeoJSON: darmat1/ukraine-geo-data • CartoDB • Esri • OpenTopoMap');

let legendVisible = localStorage.getItem(PREFIX + 'legend') !== '0';

function syncLegendVisibility() {
  const leg = document.getElementById('mapLegend');
  const btn = document.getElementById('legendToggleBtn');
  if (leg) leg.classList.toggle('collapsed', !legendVisible);
  if (btn) btn.classList.toggle('active-layer', legendVisible);
}

function toggleLegend() {
  legendVisible = !legendVisible;
  localStorage.setItem(PREFIX + 'legend', legendVisible ? '1' : '0');
  syncLegendVisibility();
}

const DEVICE_META = {
  phone:  { badge: '📱 Смартфон (460px)' },
  tablet: { badge: '📟 Планшет (920px)' },
  laptop: { badge: '💻 Ноутбук (1280px)' },
  tv:     { badge: '📺 Телевізор (1880px)' }
};

let deviceSetting = localStorage.getItem(PREFIX + 'device') || 'auto';

function detectAutoDevice() {
  const w = window.innerWidth;
  if (w < 640) return 'phone';
  if (w <= 1024) return 'tablet';
  if (w >= 1720) return 'tv';
  return 'laptop';
}

function applyDeviceLayout() {
  const effective = deviceSetting === 'auto' ? detectAutoDevice() : deviceSetting;
  document.body.setAttribute('data-device', effective);

  ['auto', 'phone', 'tablet', 'laptop', 'tv'].forEach(mode => {
    const el = document.getElementById('dev-' + mode);
    if (el) el.classList.toggle('active-dev', deviceSetting === mode);
  });

  const badge = document.getElementById('deviceBadge');
  if (badge) {
    const meta = DEVICE_META[effective] || DEVICE_META.laptop;
    badge.textContent = deviceSetting === 'auto' ? `🔄 Авто • ${meta.badge}` : meta.badge;
  }

  setTimeout(() => {
    map.invalidateSize({ animate: false });
  }, 260);
}

function setDeviceProfile(mode) {
  deviceSetting = mode;
  localStorage.setItem(PREFIX + 'device', mode);
  applyDeviceLayout();
  const label = mode === 'auto' ? 'Автовизначення розміру' : (DEVICE_META[mode]?.badge || mode);
  showToast(`Режим інтерфейсу: ${label}`);
}

function toggleFullscreen() {
  const elem = document.getElementById('appShell');
  if (!document.fullscreenElement) {
    (elem.requestFullscreen || document.documentElement.requestFullscreen).call(elem).catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

window.addEventListener('resize', () => {
  if (deviceSetting === 'auto') {
    applyDeviceLayout();
  }
});

map.createPane('tilesPane');
map.getPane('tilesPane').style.zIndex = 250;

map.createPane('raionsPane');
map.getPane('raionsPane').style.zIndex = 415;

map.createPane('citiesPane');
map.getPane('citiesPane').style.zIndex = 425;

map.createPane('parentOblastPane');
map.getPane('parentOblastPane').style.zIndex = 428;
map.getPane('parentOblastPane').style.pointerEvents = 'none';

map.createPane('selectedZonePane');
map.getPane('selectedZonePane').style.zIndex = 432;
map.getPane('selectedZonePane').style.pointerEvents = 'none';

map.createPane('oblastBordersPane');
map.getPane('oblastBordersPane').style.zIndex = 435;
map.getPane('oblastBordersPane').style.pointerEvents = 'none';

map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 450;
map.getPane('labelsPane').style.pointerEvents = 'none';

const lightTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 18,
  opacity: 0.95
});

const topoTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 15,
  opacity: 0.72
});

const satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 17,
  opacity: 0.96
});

let activeBaseMode = 'dark';

function switchBaseLayer(mode) {
  activeBaseMode = mode;
  document.getElementById('layer-dark').classList.toggle('active-layer', mode === 'dark');
  document.getElementById('layer-light').classList.toggle('active-layer', mode === 'light');
  document.getElementById('layer-topo').classList.toggle('active-layer', mode === 'topo');
  document.getElementById('layer-satellite').classList.toggle('active-layer', mode === 'satellite');

  document.getElementById('mapStage').classList.toggle('light-stage', mode === 'light');

  if (map.hasLayer(lightTileLayer)) map.removeLayer(lightTileLayer);
  if (map.hasLayer(topoTileLayer)) map.removeLayer(topoTileLayer);
  if (map.hasLayer(satelliteTileLayer)) map.removeLayer(satelliteTileLayer);

  if (mode === 'light') {
    lightTileLayer.addTo(map);
  } else if (mode === 'topo') {
    topoTileLayer.addTo(map);
  } else if (mode === 'satellite') {
    satelliteTileLayer.addTo(map);
  }
  refreshAllStyles();
}

function zoomStep(delta) {
  const next = Math.min(18, Math.max(5, Number((map.getZoom() + delta).toFixed(2))));
  map.setZoom(next);
}

const OBLASTS = [
  'Вінницька область','Волинська область','Дніпропетровська область','Донецька область',
  'Житомирська область','Закарпатська область','Запорізька область','Івано-Франківська область',
  'Київська область','Кіровоградська область','Луганська область','Львівська область',
  'Миколаївська область','Одеська область','Полтавська область','Рівненська область',
  'Сумська область','Тернопільська область','Харківська область','Херсонська область',
  'Хмельницька область','Черкаська область','Чернівецька область','Чернігівська область'
];

const SHORT_NAMES = {
  'Вінницька область': 'Вінницька',
  'Волинська область': 'Волинська',
  'Дніпропетровська область': 'Дніпропетровська',
  'Донецька область': 'Донецька',
  'Житомирська область': 'Житомирська',
  'Закарпатська область': 'Закарпатська',
  'Запорізька область': 'Запорізька',
  'Івано-Франківська область': 'Івано-Франківська',
  'Київська область': 'Київська',
  'Кіровоградська область': 'Кіровоградська',
  'Луганська область': 'Луганська',
  'Львівська область': 'Львівська',
  'Миколаївська область': 'Миколаївська',
  'Одеська область': 'Одеська',
  'Полтавська область': 'Полтавська',
  'Рівненська область': 'Рівненська',
  'Сумська область': 'Сумська',
  'Тернопільська область': 'Тернопільська',
  'Харківська область': 'Харківська',
  'Херсонська область': 'Херсонська',
  'Хмельницька область': 'Хмельницька',
  'Черкаська область': 'Черкаська',
  'Чернівецька область': 'Чернівецька',
  'Чернігівська область': 'Чернігівська',
  'Автономна Республіка Крим': 'АР Крим'
};

const EXTRA_CITIES_CONFIG = [
  {
    zKey: 'м. Київ',
    displayName: 'м. Київ',
    parentOblast: 'Київська область',
    nominatimQuery: 'Київ, Україна',
    polyCoords: [
      [30.24, 50.45],
      [30.36, 50.58],
      [30.55, 50.60],
      [30.78, 50.52],
      [30.82, 50.35],
      [30.67, 50.24],
      [30.42, 50.27],
      [30.26, 50.36],
      [30.24, 50.45]
    ]
  },
  {
    zKey: 'м. Запоріжжя',
    displayName: 'м. Запоріжжя',
    parentOblast: 'Запорізька область',
    nominatimQuery: 'Запоріжжя, Запорізька область, Україна',
    polyCoords: [
      [34.96, 47.82],
      [35.03, 47.92],
      [35.16, 47.94],
      [35.29, 47.89],
      [35.35, 47.79],
      [35.26, 47.72],
      [35.11, 47.73],
      [34.99, 47.76],
      [34.96, 47.82]
    ]
  },
  {
    zKey: 'м. Харків',
    displayName: 'м. Харків',
    parentOblast: 'Харківська область',
    nominatimQuery: 'Харків, Харківська область, Україна',
    polyCoords: [
      [36.06, 49.98],
      [36.12, 50.08],
      [36.26, 50.10],
      [36.41, 50.04],
      [36.43, 49.91],
      [36.32, 49.85],
      [36.15, 49.87],
      [36.07, 49.92],
      [36.06, 49.98]
    ]
  }
];

const C = {
  yellow: '#eab308',
  red: '#ef4444',
  radiation: '#facc15',
  chemical: '#a855f7',
  artillery: '#f97316',
  fighting: '#10b981',
  off: '#263144'
};

const LABEL = {
  yellow: '🟡 Жовтий рівень небезпеки',
  red: '🔴 Повітряна тривога (червоний)',
  radiation: '☢️ Радіаційна небезпека',
  chemical: '☣️ Хімічна загроза',
  artillery: '🟠 Артилерійська загроза',
  fighting: '🟢 Вуличні бої',
  off: '🔕 Відбій'
};

let currentKey = '';
let currentDisplayName = '';
let currentParentOblast = '';
let lastSelectedThreat = { type: 'air', level: 'red' };
let filterMode = 'all';
let historyFilterMode = 'all';
let soundEnabled = localStorage.getItem(PREFIX + 'sound') === '1';

let interactiveGeoLayer = null;
const cityGeoLayers = [];
let oblastBordersLayer = null;
let selectionOverlayGroup = L.layerGroup().addTo(map);
let labelsLayerGroup = L.layerGroup().addTo(map);

const oblastToRaions = {};
const oblastFeatureMap = {};
const zoneFeatureMap = {};
const allZonesMeta = [];

function slug(text) {
  const m = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};
  return [...text.toLowerCase()].map(x => m[x] ?? x).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function sKey(id) { return PREFIX + 's_' + id; }
function hKey(id) { return PREFIX + 'h_' + id; }

function getH(id) {
  try { return JSON.parse(localStorage.getItem(hKey(id)) || '[]'); } catch { return []; }
}
function putH(id, h) {
  localStorage.setItem(hKey(id), JSON.stringify(h));
}
function getS(id) {
  try { return JSON.parse(localStorage.getItem(sKey(id)) || 'null'); } catch { return null; }
}

function playTone(isAlarm) {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (isAlarm) {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(340, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(680, ctx.currentTime + 0.35);
      osc.frequency.linearRampToValueAtTime(380, ctx.currentTime + 0.72);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.78);
      osc.start();
      osc.stop(ctx.currentTime + 0.78);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
    }
  } catch (e) {}
}

function syncSoundButton() {
  const btn = document.getElementById('soundToggle');
  btn.textContent = soundEnabled ? '🔊 Звук: увімк.' : '🔇 Звук: вимк.';
  btn.classList.toggle('active-sound', soundEnabled);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(PREFIX + 'sound', soundEnabled ? '1' : '0');
  syncSoundButton();
  if (soundEnabled) playTone(false);
}

function setFilterMode(mode) {
  filterMode = mode;
  const sel = document.getElementById('threatFilter');
  if (sel) sel.value = mode;
  refreshAllStyles();
}

function syncUkraineButtonLabel() {
  const btn = document.getElementById('ukraineAlertBtn');
  if (!btn) return;
  const code = lastSelectedThreat.level || lastSelectedThreat.type || 'red';
  const shortMap = {
    yellow: '🟡 Жовтий',
    red: '🔴 Червоний',
    radiation: '☢️ Радіація',
    chemical: '☣️ Хімічна',
    artillery: '🟠 Артобстріл',
    fighting: '🟢 Бої'
  };
  btn.textContent = `🇺🇦 На всю Україну (${shortMap[code] || 'Тривога'})`;
}

function matchesCurrentFilter(s, code, zKey) {
  if (!s) return false;
  if (filterMode === 'all' || filterMode === 'active_only') return true;
  if (filterMode === 'long_1h') {
    const h = getH(zKey);
    const activeEv = h.find(e => e.id === s.activeId && !e.end);
    return Boolean(activeEv && (Date.now() - activeEv.start) >= 3600000);
  }
  return code === filterMode;
}

function getZoneStyle(f) {
  const props = f.properties || {};
  const zKey = props._zKey;
  const isCity = Boolean(props._isCityZone);
  const s = getS(zKey);
  const code = s ? (s.level || s.type || 'red') : null;
  const matchesFilter = matchesCurrentFilter(s, code, zKey);

  const isSatellite = activeBaseMode === 'satellite';
  const isLight = activeBaseMode === 'light';
  const hasTileOverlay = activeBaseMode !== 'dark';

  let fill = isCity ? '#334155' : (isLight ? '#cbd5e1' : C.off);
  let fillOpacity = isLight
    ? (isCity ? 0.35 : 0.24)
    : (hasTileOverlay ? (isCity ? 0.55 : 0.28) : (isCity ? 0.96 : 0.92));

  if (isCity && isSatellite) {
    fill = 'transparent';
    fillOpacity = 0;
  }

  if (s && matchesFilter) {
    fill = C[code] || C.red;
    fillOpacity = isCity && isSatellite ? 0.45 : (hasTileOverlay ? 0.72 : 0.88);
  } else if (s && !matchesFilter) {
    fill = isLight ? '#94a3b8' : '#1e293b';
    fillOpacity = isCity && isSatellite ? 0 : (hasTileOverlay ? 0.2 : 0.45);
  } else if (filterMode === 'active_only' || filterMode === 'long_1h') {
    fillOpacity = isSatellite ? 0 : 0.12;
  }

  const borderColor = isCity
    ? (isLight ? '#1e293b' : '#f8fafc')
    : (isLight ? '#475569' : (hasTileOverlay ? '#0f172a' : '#1e293b'));

  return {
    color: borderColor,
    weight: isCity ? 2 : (hasTileOverlay ? 1.2 : 0.85),
    opacity: 1,
    fillColor: fill,
    fillOpacity: fillOpacity,
    className: (s && matchesFilter && code === 'red') ? 'zone-red-pulse' : ''
  };
}

function applyStyleToGeoGroup(group) {
  if (!group) return;
  group.eachLayer(layer => {
    if (layer.feature && typeof layer.setStyle === 'function') {
      layer.setStyle(getZoneStyle(layer.feature));
      const el = layer.getElement?.();
      if (el) {
        const zKey = layer.feature.properties?._zKey;
        const s = getS(zKey);
        const code = s ? (s.level || s.type || 'red') : null;
        const activeRed = Boolean(s && code === 'red' && matchesCurrentFilter(s, code, zKey));
        el.classList.toggle('zone-red-pulse', activeRed);
      }
    }
  });
}

function updateSelectionOverlays() {
  selectionOverlayGroup.clearLayers();

  if (!currentKey || !zoneFeatureMap[currentKey]) return;

  if (
    currentParentOblast &&
    currentParentOblast !== currentDisplayName &&
    oblastFeatureMap[currentParentOblast]
  ) {
    L.geoJSON(oblastFeatureMap[currentParentOblast], {
      pane: 'parentOblastPane',
      interactive: false,
      style: {
        color: '#38bdf8',
        weight: 2.3,
        opacity: 0.9,
        fillColor: '#38bdf8',
        fillOpacity: 0.05
      }
    }).addTo(selectionOverlayGroup);
  }

  L.geoJSON(zoneFeatureMap[currentKey], {
    pane: 'selectedZonePane',
    interactive: false,
    style: {
      color: '#05080f',
      weight: 4.6,
      opacity: 0.96,
      fillOpacity: 0
    }
  }).addTo(selectionOverlayGroup);

  L.geoJSON(zoneFeatureMap[currentKey], {
    pane: 'selectedZonePane',
    interactive: false,
    style: {
      color: '#facc15',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 0
    }
  }).addTo(selectionOverlayGroup);
}

function collectActiveZones() {
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + 's_')) {
      const zKey = k.slice((PREFIX + 's_').length);
      const st = getS(zKey);
      if (st) {
        items.push({ zKey, ...st });
      }
    }
  }
  return items;
}

function renderActiveZonesStrip() {
  const chipsContainer = document.getElementById('activeZonesChips');
  const summaryEl = document.getElementById('activeStripSummary');
  const pctEl = document.getElementById('coveragePct');
  const barFillEl = document.getElementById('coverageBarFill');
  const activeList = collectActiveZones();

  summaryEl.textContent = activeList.length ? `${activeList.length} активних` : '0 активних';
  const total = Math.max(1, allZonesMeta.length);
  const pct = Math.round((activeList.length / total) * 100);
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (barFillEl) barFillEl.style.width = `${pct}%`;

  const counts = { red: 0, yellow: 0, artillery: 0, chemical: 0, radiation: 0, fighting: 0 };
  activeList.forEach(item => {
    const code = item.level || item.type || 'red';
    if (counts[code] !== undefined) counts[code]++;
  });

  Object.entries(counts).forEach(([code, val]) => {
    const el = document.getElementById('st-' + code);
    if (el) el.textContent = val;
  });

  renderHotspotChips();

  if (!activeList.length) {
    chipsContainer.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Наразі немає активних тривог.</span>';
    return;
  }

  chipsContainer.innerHTML = activeList.map(item => {
    const code = item.level || item.type || 'red';
    const dotColor = C[code] || C.red;
    const label = escapeHtml(item.displayName || item.zKey);
    const parent = escapeHtml(item.parentOblast || '');
    return `
      <button class="active-chip" onclick="selectZoneByKey(${JSON.stringify(item.zKey)})" title="${parent}">
        <span class="chip-dot" style="background:${dotColor}"></span>
        <span>${label}</span>
        <span class="chip-x" onclick="quickStopZoneByKey(event, ${JSON.stringify(item.zKey)})" title="Відбій у цій зоні">×</span>
      </button>
    `;
  }).join('');
}

function selectZoneByKey(zKey) {
  const meta = zoneFeatureMap[zKey]?.properties;
  if (meta) {
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
}

function refreshAllStyles() {
  syncUkraineButtonLabel();
  applyStyleToGeoGroup(interactiveGeoLayer);
  for (const cg of cityGeoLayers) {
    applyStyleToGeoGroup(cg);
  }
  if (oblastBordersLayer) {
    oblastBordersLayer.setStyle({
      color: activeBaseMode === 'light' ? '#1e293b' : '#05080f',
      weight: 2.4,
      fillOpacity: 0
    });
  }
  updateSelectionOverlays();
  updateUIState();
  updateActiveCounter();
  updateLiveDurationBadge();
  renderActiveZonesStrip();
  renderFavoritesChips();
}

function updateActiveCounter() {
  document.getElementById('activeCount').textContent = collectActiveZones().length;
}

function updateLiveDurationBadge() {
  const timerEl = document.getElementById('liveDurationBadge');
  if (!currentKey) {
    timerEl.style.display = 'none';
    return;
  }
  const elapsed = getLiveElapsedMs(currentKey);
  if (elapsed == null) {
    timerEl.style.display = 'none';
    return;
  }
  timerEl.style.display = 'inline-block';
  timerEl.textContent = '⏱ Триває: ' + fmt(elapsed);
}

function updateUIState() {
  const titleEl = document.getElementById('selected');
  const subEl = document.getElementById('parentOblastLabel');

  if (!currentKey) {
    titleEl.textContent = 'Обери район, м. Київ, м. Запоріжжя або м. Харків';
    subEl.textContent = 'Клікни по будь-якому району або місту • Клавіші: 1–6 загрози, 0 відбій, / пошук, R випадкова, W колесо, F екран, A аналітика, G лог';
  } else {
    titleEl.textContent = currentDisplayName;
    subEl.textContent = (currentParentOblast && currentParentOblast !== currentDisplayName)
      ? `У складі: ${currentParentOblast}`
      : 'Окрема адміністративна одиниця';
  }

  document.getElementById('btn-kyiv').classList.toggle('selected-city', currentKey === 'м. Київ');
  document.getElementById('btn-zaporizhzhia').classList.toggle('selected-city', currentKey === 'м. Запоріжжя');
  document.getElementById('btn-kharkiv').classList.toggle('selected-city', currentKey === 'м. Харків');

  const badge = document.getElementById('currentStatusBadge');
  document.querySelectorAll('.btn').forEach(b => b.classList.remove('active-type'));

  if (!currentKey) {
    badge.textContent = 'Статус: не обрано';
    badge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
    badge.style.color = '#cbd5e1';
  } else {
    const s = getS(currentKey);
    if (s) {
      const code = s.level || s.type;
      badge.textContent = LABEL[code] || 'Активна тривога';
      badge.style.borderColor = C[code] || '#ef4444';
      badge.style.color = '#fff';
      const activeBtn = document.getElementById('btn-' + code);
      if (activeBtn) activeBtn.classList.add('active-type');
    } else {
      badge.textContent = '🔕 Немає тривоги';
      badge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
      badge.style.color = '#94a3b8';
    }
  }

  const hasOblastRaions = Boolean(
    currentParentOblast &&
    oblastToRaions[currentParentOblast] &&
    oblastToRaions[currentParentOblast].length > 1
  );
  document.getElementById('oblastAlertBtn').style.display = hasOblastRaions ? 'inline-block' : 'none';
  document.getElementById('oblastOffBtn').style.display = hasOblastRaions ? 'inline-block' : 'none';
}

function selectZone(zKey, displayName, parentOblast) {
  currentKey = zKey;
  currentDisplayName = displayName;
  currentParentOblast = parentOblast;
  refreshAllStyles();
}

function selectCityDirect(cityName) {
  if (zoneFeatureMap[cityName]) {
    const meta = zoneFeatureMap[cityName].properties;
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
}

function zoomToSelectedZone() {
  if (!currentKey || !zoneFeatureMap[currentKey]) {
    return showToast('Спочатку обери район або місто', '#facc15');
  }
  const bounds = L.geoJSON(zoneFeatureMap[currentKey]).getBounds();
  if (bounds.isValid()) {
    map.flyToBounds(bounds, { padding: [22, 22], maxZoom: 15.5, duration: 0.45 });
  }
}

function resetMapView() {
  if (oblastBordersLayer && oblastBordersLayer.getBounds().isValid()) {
    map.flyToBounds(oblastBordersLayer.getBounds(), { padding: [8, 8], duration: 0.45 });
  } else {
    map.setView([48.7, 31.5], 6.4);
  }
}

async function fetchCityPolygonFeature(cityCfg, ukrFeatures) {
  if (cityCfg.zKey === 'м. Київ' && Array.isArray(ukrFeatures)) {
    const kyivFromUkr = ukrFeatures.find(f => {
      const n = f.properties?.name || '';
      return n === 'Київ' || n === 'м. Київ';
    });
    if (kyivFromUkr && kyivFromUkr.geometry) {
      return {
        type: 'Feature',
        properties: {
          name: cityCfg.displayName,
          _zKey: cityCfg.zKey,
          _displayName: cityCfg.displayName,
          _parentOblast: cityCfg.parentOblast,
          _isCityZone: true,
          _source: 'Ukraine GeoJSON'
        },
        geometry: kyivFromUkr.geometry
      };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const url = 'https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=1&q=' +
      encodeURIComponent(cityCfg.nominatimQuery);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const list = await res.json();
      const first = Array.isArray(list) ? list[0] : null;
      const gj = first?.geojson;
      if (gj && (gj.type === 'Polygon' || gj.type === 'MultiPolygon')) {
        return {
          type: 'Feature',
          properties: {
            name: cityCfg.displayName,
            _zKey: cityCfg.zKey,
            _displayName: cityCfg.displayName,
            _parentOblast: cityCfg.parentOblast,
            _isCityZone: true,
            _source: 'OSM GeoJSON'
          },
          geometry: gj
        };
      }
    }
  } catch (e) {}

  return {
    type: 'Feature',
    properties: {
      name: cityCfg.displayName,
      _zKey: cityCfg.zKey,
      _displayName: cityCfg.displayName,
      _parentOblast: cityCfg.parentOblast,
      _isCityZone: true,
      _source: 'GeoJSON Polygon'
    },
    geometry: {
      type: 'Polygon',
      coordinates: [cityCfg.polyCoords]
    }
  };
}

async function initMapData() {
  applyDeviceLayout();
  syncNeonMode();
  syncLegendVisibility();
  syncSoundButton();
  syncUkraineButtonLabel();
  syncUnreadBadge();
  renderFavoritesChips();
  const loader = document.getElementById('loading');
  loader.style.display = 'block';

  try {
    const ukrRes = await fetch(BASE + 'Ukraine.geojson');
    if (!ukrRes.ok) throw new Error('Ukraine.geojson error');
    const ukrData = await ukrRes.json();

    const raionPromises = OBLASTS.map(async ob => {
      try {
        const r = await fetch(BASE + slug(ob) + '.geojson');
        if (!r.ok) return { ob, features: [] };
        const d = await r.json();
        return { ob, features: d.features || [] };
      } catch {
        return { ob, features: [] };
      }
    });

    const cityGeoPromises = EXTRA_CITIES_CONFIG.map(cfg =>
      fetchCityPolygonFeature(cfg, ukrData.features || [])
    );

    const [raionResults, cityFeatures] = await Promise.all([
      Promise.all(raionPromises),
      Promise.all(cityGeoPromises)
    ]);

    const allInteractiveFeatures = [];
    allZonesMeta.length = 0;

    for (const f of (ukrData.features || [])) {
      const rawName = f.properties?.name || '';
      if (rawName) {
        oblastFeatureMap[rawName] = f;
      }
      if (rawName.includes('Крим')) {
        const clone = JSON.parse(JSON.stringify(f));
        clone.properties._zKey = 'АР Крим';
        clone.properties._displayName = 'Автономна Республіка Крим';
        clone.properties._parentOblast = 'АР Крим';
        allInteractiveFeatures.push(clone);
        zoneFeatureMap['АР Крим'] = clone;
        allZonesMeta.push(clone.properties);
      }
    }

    for (const { ob, features } of raionResults) {
      oblastToRaions[ob] = [];
      for (const f of features) {
        const rName = f.properties?.name || 'Район';
        const zKey = ob + '::' + rName;
        const clone = JSON.parse(JSON.stringify(f));
        clone.properties._zKey = zKey;
        clone.properties._displayName = rName;
        clone.properties._parentOblast = ob;
        allInteractiveFeatures.push(clone);
        zoneFeatureMap[zKey] = clone;
        allZonesMeta.push(clone.properties);
        oblastToRaions[ob].push({ key: zKey, name: rName });
      }
    }

    for (const cf of cityFeatures) {
      zoneFeatureMap[cf.properties._zKey] = cf;
      allZonesMeta.push(cf.properties);
    }

    interactiveGeoLayer = L.geoJSON(
      { type: 'FeatureCollection', features: allInteractiveFeatures },
      {
        pane: 'raionsPane',
        interactive: true,
        style: getZoneStyle,
        onEachFeature: (f, l) => {
          const { _zKey, _displayName, _parentOblast } = f.properties;
          const tip = (_parentOblast && _parentOblast !== _displayName)
            ? `<b>${escapeHtml(_displayName)}</b><br><span style="color:#94a3b8;font-size:11px">${escapeHtml(_parentOblast)}</span>`
            : `<b>${escapeHtml(_displayName)}</b>`;
          l.bindTooltip(tip, { sticky: true });

          l.on('mouseover', () => {
            if (currentKey !== _zKey) {
              l.setStyle({ weight: 1.9, color: '#38bdf8' });
            }
          });

          l.on('mouseout', () => {
            l.setStyle(getZoneStyle(f));
          });

          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectZone(_zKey, _displayName, _parentOblast);
          });
        }
      }
    ).addTo(map);

    cityGeoLayers.length = 0;
    for (const cf of cityFeatures) {
      const singleCityLayer = L.geoJSON(cf, {
        pane: 'citiesPane',
        interactive: true,
        style: getZoneStyle,
        onEachFeature: (feat, l) => {
          const { _zKey, _displayName, _parentOblast, _source } = feat.properties;
          l.bindTooltip(
            `<b>${escapeHtml(_displayName)}</b><br><span style="color:#fde047;font-size:11px">${escapeHtml(_source || 'GeoJSON')} • ${escapeHtml(_parentOblast)}</span>`,
            { sticky: true }
          );
          l.on('mouseover', () => {
            if (currentKey !== _zKey) {
              l.setStyle({ weight: 2.5, color: '#fde047' });
            }
          });
          l.on('mouseout', () => {
            l.setStyle(getZoneStyle(feat));
          });
          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectZone(_zKey, _displayName, _parentOblast);
          });
        }
      }).addTo(map);
      cityGeoLayers.push(singleCityLayer);
    }

    oblastBordersLayer = L.geoJSON(ukrData, {
      pane: 'oblastBordersPane',
      interactive: false,
      style: {
        color: '#05080f',
        weight: 2.4,
        fillOpacity: 0
      },
      onEachFeature: (f, l) => {
        const rawName = f.properties?.name || '';
        const shortTitle = SHORT_NAMES[rawName];
        if (!shortTitle) return;

        let center = l.getBounds().getCenter();
        if (rawName === 'Київська область') {
          center = L.latLng(center.lat - 0.42, center.lng - 0.15);
        } else if (rawName === 'Запорізька область') {
          center = L.latLng(center.lat - 0.14, center.lng + 0.12);
        } else if (rawName === 'Харківська область') {
          center = L.latLng(center.lat - 0.25, center.lng + 0.08);
        }

        const marker = L.marker(center, {
          pane: 'labelsPane',
          interactive: false,
          icon: L.divIcon({
            className: 'oblast-label',
            html: escapeHtml(shortTitle),
            iconSize: [116, 16],
            iconAnchor: [58, 8]
          })
        });
        labelsLayerGroup.addLayer(marker);
      }
    }).addTo(map);

    for (const cf of cityFeatures) {
      const layerBounds = L.geoJSON(cf).getBounds();
      const c = layerBounds.getCenter();
      const offsetLat = cf.properties._zKey === 'м. Київ' ? 0.18 : 0.14;
      const cityMarker = L.marker([c.lat + offsetLat, c.lng], {
        pane: 'labelsPane',
        interactive: false,
        icon: L.divIcon({
          className: 'oblast-label city-lbl',
          html: escapeHtml(cf.properties._displayName),
          iconSize: [116, 16],
          iconAnchor: [58, 8]
        })
      });
      labelsLayerGroup.addLayer(cityMarker);
    }

    map.fitBounds(oblastBordersLayer.getBounds(), { padding: [8, 8] });
    updateLabelVisibility();
    refreshAllStyles();
    pushTicker(`Завантажено ${allZonesMeta.length} адміністративних зон та міст України.`);
  } catch (e) {
    showToast('Не вдалося завантажити геодані. Перевір інтернет.', '#ef4444');
  } finally {
    loader.style.display = 'none';
  }
}

function updateLabelVisibility() {
  const z = map.getZoom();
  const labels = document.querySelectorAll('.oblast-label');
  labels.forEach(el => {
    if (z < 5.5) {
      el.style.fontSize = '8px';
    } else if (z >= 8.5) {
      el.style.fontSize = '13px';
    } else {
      el.style.fontSize = el.classList.contains('city-lbl') ? '11px' : '10px';
    }
  });
}
map.on('zoomend', updateLabelVisibility);

function setStatusForZone(zKey, displayName, parentOblast, type, level) {
  const old = getS(zKey);
  const h = getH(zKey);
  const now = Date.now();
  if (old && old.activeId) {
    const x = h.find(e => e.id === old.activeId);
    if (x && !x.end) x.end = now;
  }
  const id = 'e' + now + Math.random().toString(16).slice(2, 7);
  h.unshift({ id, type, level, start: now, end: null });
  putH(zKey, h);
  localStorage.setItem(sKey(zKey), JSON.stringify({
    type,
    level,
    activeId: id,
    displayName,
    parentOblast
  }));
}

function clearStatusForZone(zKey) {
  const s = getS(zKey);
  const h = getH(zKey);
  const now = Date.now();
  if (s?.activeId) {
    const x = h.find(e => e.id === s.activeId);
    if (x && !x.end) x.end = now;
    putH(zKey, h);
  }
  localStorage.removeItem(sKey(zKey));
}

function applyStatus(type, level) {
  lastSelectedThreat = { type, level };
  syncUkraineButtonLabel();
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  setStatusForZone(currentKey, currentDisplayName, currentParentOblast, type, level);
  playTone(true);
  refreshAllStyles();
  const text = `${LABEL[level] || level} — ${currentDisplayName}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zKey: currentKey,
    zone: currentDisplayName,
    oblast: currentParentOblast,
    code: level,
    title: LABEL[level] || level,
    detail: type === 'air' ? 'Повідомлення про повітряну тривогу у зоні' : 'Оголошено загрозу безпеки',
    isAir: type === 'air'
  });
}

function stopAlert() {
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  const elapsedMs = getLiveElapsedMs(currentKey);
  clearStatusForZone(currentKey);
  playTone(false);
  refreshAllStyles();
  const durSuffix = elapsedMs != null ? ` (${fmt(elapsedMs)})` : '';
  const text = `🔕 Відбій загрози — ${currentDisplayName}${durSuffix}`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function applyToWholeUkraine() {
  if (!allZonesMeta.length) return;
  const { type, level } = lastSelectedThreat;
  for (const meta of allZonesMeta) {
    setStatusForZone(meta._zKey, meta._displayName, meta._parentOblast, type, level);
  }
  playTone(true);
  refreshAllStyles();
  const text = `🇺🇦 Масштабна тривога по всій Україні: ${LABEL[level] || level}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zone: 'Уся Україна',
    oblast: 'Усі регіони',
    code: level,
    title: `🇺🇦 ${LABEL[level] || level} по всій Україні`,
    detail: `Задіяно ${allZonesMeta.length} зон`,
    isAir: type === 'air'
  });
}

function applyToWholeOblast() {
  if (!currentParentOblast || !oblastToRaions[currentParentOblast]) return;
  const { type, level } = lastSelectedThreat;
  for (const r of oblastToRaions[currentParentOblast]) {
    setStatusForZone(r.key, r.name, currentParentOblast, type, level);
  }
  playTone(true);
  refreshAllStyles();
  const text = `🚨 ${LABEL[level] || level} — вся ${currentParentOblast}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zone: currentParentOblast,
    oblast: currentParentOblast,
    code: level,
    title: `${LABEL[level] || level} — вся область`,
    detail: `Охоплено ${oblastToRaions[currentParentOblast].length} районів`,
    isAir: type === 'air'
  });
}

function clearWholeOblast() {
  if (!currentParentOblast || !oblastToRaions[currentParentOblast]) return;
  for (const r of oblastToRaions[currentParentOblast]) {
    clearStatusForZone(r.key);
  }
  playTone(false);
  refreshAllStyles();
  const text = `🔕 Відбій по всій області: ${currentParentOblast}`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function runPresetScenario(scenario) {
  const selectEl = document.getElementById('scenarioSelect');
  if (!scenario) return;

  if (scenario === 'capital') {
    if (zoneFeatureMap['м. Київ']) {
      setStatusForZone('м. Київ', 'м. Київ', 'Київська область', 'air', 'red');
    }
    (oblastToRaions['Київська область'] || []).forEach(r => {
      setStatusForZone(r.key, r.name, 'Київська область', 'air', 'red');
    });
    selectCityDirect('м. Київ');
    pushTicker('Сценарій: Столичний вузол (м. Київ та Київська область)');
    showToast('Активовано сценарій: Столичний вузол', '#ef4444');
    pushAlertNotification({
      zone: 'м. Київ та Київська область',
      oblast: 'Київська область',
      code: 'red',
      title: '🔴 Повітряна тривога (Столичний вузол)',
      detail: 'Активовано для м. Київ та районів Київської області',
      isAir: true
    });
  } else if (scenario === 'east_south') {
    ['м. Харків', 'м. Запоріжжя'].forEach(c => {
      if (zoneFeatureMap[c]) {
        const m = zoneFeatureMap[c].properties;
        setStatusForZone(m._zKey, m._displayName, m._parentOblast, 'air', 'red');
      }
    });
    ['Харківська область', 'Запорізька область', 'Дніпропетровська область', 'Одеська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'red'));
    });
    pushTicker('Сценарій: Схід та Південь України');
    showToast('Активовано сценарій: Схід та Південь', '#ef4444');
    pushAlertNotification({
      zone: 'Схід та Південь України',
      oblast: 'Харківська, Запорізька, Дніпропетровська, Одеська',
      code: 'red',
      title: '🔴 Повітряна тривога (Схід та Південь)',
      detail: 'Хвиля тривог у східних та південних регіонах',
      isAir: true
    });
  } else if (scenario === 'north_center') {
    ['Чернігівська область', 'Сумська область', 'Полтавська область', 'Черкаська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'yellow'));
    });
    pushTicker('Сценарій: Північ і Центр (жовтий рівень загрози БпЛА)');
    showToast('Активовано сценарій: Північ і Центр', '#eab308');
    pushAlertNotification({
      zone: 'Північ та Центр України',
      oblast: 'Чернігівська, Сумська, Полтавська, Черкаська',
      code: 'yellow',
      title: '🟡 Жовтий рівень (Північ і Центр)',
      detail: 'Підвищена увага через загрозу БпЛА',
      isAir: true
    });
  } else if (scenario === 'west_shield') {
    ['Львівська область', 'Волинська область', 'Рівненська область', 'Тернопільська область', 'Івано-Франківська область', 'Хмельницька область', 'Чернівецька область', 'Закарпатська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'yellow'));
    });
    pushTicker('Сценарій: Західний регіон (жовтий рівень)');
    showToast('Активовано сценарій: Західний регіон', '#eab308');
  }

  playTone(true);
  refreshAllStyles();
  if (selectEl) selectEl.value = '';
}

function copyAlertSummary() {
  const active = collectActiveZones();
  const nowStr = new Date().toLocaleString('uk-UA');
  if (!active.length) {
    const emptyText = `🇺🇦 AlertMap PRO v3.0 (${nowStr})\n🔕 Активних тривог немає.`;
    navigator.clipboard?.writeText(emptyText).catch(() => {});
    showToast('Зведення (відбій) скопійовано у буфер обміну', '#10b981');
    return;
  }

  const lines = active.slice(0, 35).map(item => {
    const code = item.level || item.type || 'red';
    const elapsed = getLiveElapsedMs(item.zKey);
    const durStr = elapsed != null ? ` [${fmt(elapsed)}]` : '';
    return `• ${item.displayName} (${item.parentOblast}) — ${LABEL[code] || code}${durStr}`;
  });
  if (active.length > 35) {
    lines.push(`...та ще ${active.length - 35} зон.`);
  }

  const report = `🇺🇦 Оперативне зведення AlertMap PRO v3.0 (${nowStr})\nАктивних зон: ${active.length}\n\n${lines.join('\n')}`;
  navigator.clipboard?.writeText(report).catch(() => {});
  showToast(`Зведення (${active.length} зон) скопійовано!`, '#38bdf8');
}

function simulateRandomThreat() {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pickZone = allZonesMeta[Math.floor(Math.random() * allZonesMeta.length)];
  const [type, level] = threats[Math.floor(Math.random() * threats.length)];
  lastSelectedThreat = { type, level };
  setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
  selectZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast);
  playTone(true);
  const text = `🚨 ${LABEL[level] || level} — ${pickZone._displayName}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zKey: pickZone._zKey,
    zone: pickZone._displayName,
    oblast: pickZone._parentOblast,
    code: level,
    title: LABEL[level] || level,
    detail: type === 'air' ? 'Повітряна тривога триває до відбою' : 'Загроза безпеки триває до відбою',
    isAir: type === 'air'
  });
}

function clearAllAlerts() {
  const active = collectActiveZones();
  if (!active.length) return showToast('Активних тривог уже немає', '#94a3b8');
  active.forEach(item => clearStatusForZone(item.zKey));
  playTone(false);
  refreshAllStyles();
  pushTicker('🧹 Оголошено загальний відбій по всіх зонах України.');
  showToast('Відбій оголошено по всій Україні', '#10b981');
}

function clearSearchInput() {
  const inp = document.getElementById('searchInput');
  if (inp) {
    inp.value = '';
    handleSearch('');
  }
}

function handleSearch(query) {
  const box = document.getElementById('searchResults');
  const clearBtn = document.getElementById('clearSearchBtn');
  const q = query.trim().toLowerCase();
  if (clearBtn) clearBtn.classList.toggle('visible', Boolean(query.length));

  if (!q) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const matches = allZonesMeta
    .filter(z => (z._displayName + ' ' + z._parentOblast).toLowerCase().includes(q))
    .slice(0, 12);

  if (!matches.length) {
    box.innerHTML = '<div class="search-item"><small>Нічого не знайдено</small></div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = matches.map((m, idx) => {
    const st = getS(m._zKey);
    const code = st ? (st.level || st.type || 'red') : null;
    const statusDot = code
      ? `<span class="chip-dot" style="background:${C[code] || '#ef4444'}"></span>`
      : `<span class="chip-dot" style="background:#475569"></span>`;
    return `
      <div class="search-item" data-idx="${idx}">
        <span style="display:inline-flex;align-items:center;gap:7px">${statusDot}<b>${escapeHtml(m._displayName)}</b></span>
        <small>${escapeHtml(m._isCityZone ? 'GeoJSON місто' : (m._parentOblast !== m._displayName ? m._parentOblast : 'Регіон'))}</small>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.search-item[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const item = matches[Number(el.dataset.idx)];
      if (!item) return;
      selectZone(item._zKey, item._displayName, item._parentOblast);
      box.style.display = 'none';
    });
  });

  box.style.display = 'block';
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) {
    document.getElementById('searchResults').style.display = 'none';
  }
});

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const isTyping = tag === 'input' || tag === 'select' || tag === 'textarea';

  if (e.key === 'Escape') {
    closeHistory();
    closeAlertsCenter();
    closeGlobalLogModal();
    closeAnalyticsModal();
    document.getElementById('searchResults').style.display = 'none';
  } else if (!isTyping && e.key === '/') {
    e.preventDefault();
    const inp = document.getElementById('searchInput');
    inp.focus();
    inp.select();
  } else if (!isTyping && (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К')) {
    simulateRandomThreat();
  } else if (!isTyping && (e.key === 'w' || e.key === 'W' || e.key === 'в' || e.key === 'В')) {
    spinThreatWheel();
  } else if (!isTyping && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
    toggleFullscreen();
  } else if (!isTyping && (e.key === 'g' || e.key === 'G' || e.key === 'п' || e.key === 'П')) {
    showGlobalLogModal();
  } else if (!isTyping && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
    showAnalyticsModal();
  } else if (!isTyping && e.key === '1') {
    applyStatus('air', 'yellow');
  } else if (!isTyping && e.key === '2') {
    applyStatus('air', 'red');
  } else if (!isTyping && e.key === '3') {
    applyStatus('radiation', 'radiation');
  } else if (!isTyping && e.key === '4') {
    applyStatus('chemical', 'chemical');
  } else if (!isTyping && e.key === '5') {
    applyStatus('artillery', 'artillery');
  } else if (!isTyping && e.key === '6') {
    applyStatus('fighting', 'fighting');
  } else if (!isTyping && e.key === '0') {
    stopAlert();
  }
});

function fmt(ms) {
  if (ms == null) return 'Триває';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ' год ' : '') + (m ? m + ' хв ' : '') + sec + ' с';
}

function setHistoryFilter(mode) {
  historyFilterMode = mode;
  document.getElementById('htab-all').classList.toggle('active', mode === 'all');
  document.getElementById('htab-active').classList.toggle('active', mode === 'active');
  document.getElementById('htab-done').classList.toggle('active', mode === 'done');
  renderHistoryModal();
}

function renderHistoryModal() {
  const title = (currentParentOblast && currentParentOblast !== currentDisplayName)
    ? `${currentDisplayName} (${currentParentOblast})`
    : currentDisplayName;
  document.getElementById('historyTitle').textContent = title;

  const allEvents = getH(currentKey);
  const now = Date.now();
  const totalMs = allEvents.reduce((acc, ev) => acc + Math.max(0, (ev.end || now) - ev.start), 0);
  document.getElementById('historyTotalDuration').textContent = 'Сумарно: ' + fmt(totalMs);

  const filtered = allEvents.filter(e => {
    if (historyFilterMode === 'active') return !e.end;
    if (historyFilterMode === 'done') return Boolean(e.end);
    return true;
  });

  const b = document.getElementById('historyBody');
  b.innerHTML = filtered.length
    ? filtered.map(e => {
        const end = e.end || now;
        const code = e.level || e.type;
        const borderColor = C[code] || '#ef4444';
        return `
          <div class="event" style="border-left-color:${borderColor}">
            <div class="event-head">
              <b>${escapeHtml(LABEL[code] || e.type)}</b>
              <span class="ev-tag ${e.end ? 'done' : 'active'}">${e.end ? 'Завершено' : 'Активна'}</span>
            </div>
            <div class="ev-times">
              <small>Початок: ${new Date(e.start).toLocaleString('uk-UA')}</small>
              ${e.end ? `<small>Відбій: ${new Date(e.end).toLocaleString('uk-UA')}</small>` : '<small>Статус: триває зараз</small>'}
            </div>
            <div class="duration tabular">
              <span>${e.end ? '✅ Зафіксовано' : '🔴 У реальному часі'}</span>
              <strong>Тривалість: ${fmt(end - e.start)}</strong>
            </div>
          </div>`;
      }).join('')
    : '<div class="event" style="border-left-color:#64748b"><b>Немає записів за обраним фільтром</b><small>Спробуй перемкнути вкладку фільтра або запустити тривогу для цієї зони.</small></div>';
}

function showHistory() {
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  renderHistoryModal();
  document.getElementById('modal').style.display = 'flex';
}

function clearCurrentZoneHistory() {
  if (!currentKey) return;
  localStorage.removeItem(hKey(currentKey));
  renderHistoryModal();
  showToast('Історію обраної зони очищено', '#94a3b8');
}

function clearAllHistory() {
  const toDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + 'h_')) toDelete.push(k);
  }
  if (!toDelete.length) {
    showToast('Історія вже порожня', '#94a3b8');
    return;
  }
  toDelete.forEach(k => localStorage.removeItem(k));
  if (document.getElementById('modal').style.display === 'flex' && currentKey) {
    renderHistoryModal();
  }
  showToast('Усю історію тривог очищено', '#10b981');
}

function closeHistory() {
  document.getElementById('modal').style.display = 'none';
}

function exportStateJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    statuses: {},
    history: {},
    favorites: getFavorites(),
    notifications: getNotifications()
  };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(PREFIX + 's_')) {
      payload.statuses[k.slice((PREFIX + 's_').length)] = getS(k.slice((PREFIX + 's_').length));
    } else if (k.startsWith(PREFIX + 'h_')) {
      payload.history[k.slice((PREFIX + 'h_').length)] = getH(k.slice((PREFIX + 'h_').length));
    }
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alertmap-state-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON-файл стану експортовано', '#38bdf8');
}

function importStateJson(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || '{}'));
      if (data.statuses && typeof data.statuses === 'object') {
        Object.entries(data.statuses).forEach(([zKey, val]) => {
          if (val) localStorage.setItem(sKey(zKey), JSON.stringify(val));
        });
      }
      if (data.history && typeof data.history === 'object') {
        Object.entries(data.history).forEach(([zKey, arr]) => {
          if (Array.isArray(arr)) putH(zKey, arr);
        });
      }
      if (Array.isArray(data.favorites)) {
        saveFavorites(data.favorites);
      }
      if (Array.isArray(data.notifications)) {
        saveNotifications(data.notifications);
      }
      refreshAllStyles();
      showToast('Стан та історію успішно імпортовано', '#10b981');
    } catch {
      showToast('Некоректний JSON-файл', '#ef4444');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('uk-UA');
  updateLiveDurationBadge();
  if (document.getElementById('modal').style.display === 'flex' && currentKey) {
    renderHistoryModal();
  }
  if (document.getElementById('alertsModal').style.display === 'flex') {
    renderAlertsCenter();
  }
}, 1000);
document.getElementById('clock').textContent = new Date().toLocaleTimeString('uk-UA');

initMapData();
