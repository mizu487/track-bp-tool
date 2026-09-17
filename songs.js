(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const GROUP_LABELS = { A: "A组", B: "B组", C: "C组" };
  const POOL_LABELS = { self: "自选池", random: "随机池" };
  const els = {
    songCount: $("songCount"),
    selfCount: $("selfCount"),
    randomCount: $("randomCount"),
    readyGroupCount: $("readyGroupCount"),
    poolStats: $("poolStats"),
    syncDivingFishBtn: $("syncDivingFishBtn"),
    dfLastSync: $("dfLastSync"),
    dfMessage: $("dfMessage"),
    dfCatalogPanel: $("dfCatalogPanel"),
    dfCatalogSummary: $("dfCatalogSummary"),
    dfSearchInput: $("dfSearchInput"),
    dfTypeFilter: $("dfTypeFilter"),
    dfDifficultyFilter: $("dfDifficultyFilter"),
    dfImportStatusFilter: $("dfImportStatusFilter"),
    dfSelectFilteredBtn: $("dfSelectFilteredBtn"),
    dfClearSelectionBtn: $("dfClearSelectionBtn"),
    dfSelectedCount: $("dfSelectedCount"),
    dfPreviewBody: $("dfPreviewBody"),
    dfRenderNote: $("dfRenderNote"),
    importDivingFishBtn: $("importDivingFishBtn"),
    songCsvInput: $("songCsvInput"),
    coverFolderInput: $("coverFolderInput"),
    songImportMode: $("songImportMode"),
    importSongsBtn: $("importSongsBtn"),
    exportSongsBtn: $("exportSongsBtn"),
    downloadTemplateBtn: $("downloadTemplateBtn"),
    importMessage: $("importMessage"),
    filterSearch: $("filterSearch"),
    filterGroup: $("filterGroup"),
    filterPool: $("filterPool"),
    filterDifficulty: $("filterDifficulty"),
    songTableBody: $("songTableBody"),
    songRenderNote: $("songRenderNote"),
    songForm: $("songForm"),
    songEditorTitle: $("songEditorTitle"),
    songIdInput: $("songIdInput"),
    songTitleInput: $("songTitleInput"),
    difficultyInput: $("difficultyInput"),
    levelInput: $("levelInput"),
    singleCoverInput: $("singleCoverInput"),
    cancelSongEditBtn: $("cancelSongEditBtn"),
    editorMessage: $("editorMessage"),
    saveStatus: $("saveStatus")
  };

  let state = TournamentStore.createDefaultState();
  let editingSongId = null;
  let divingFishCatalog = [];
  const selectedDivingFishIds = new Set();
  const DIVING_FISH_RENDER_LIMIT = 250;
  const SONG_TABLE_RENDER_LIMIT = 300;

  function showMessage(element, text, kind = "info") {
    element.className = `message ${kind}`;
    element.textContent = text;
  }

  function hideMessage(element) {
    element.className = "message hidden";
    element.textContent = "";
  }

  async function persist(message = "已自动保存") {
    state = await TournamentStore.saveState(state);
    els.saveStatus.textContent = `${message} · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  }

  async function readCsvFile(file) {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) {
      try {
        text = new TextDecoder("gb18030").decode(buffer);
      } catch (error) {
        console.warn("GB18030 decoding unavailable.", error);
      }
    }
    return text.replace(/^\uFEFF/, "");
  }

  function fileBasename(path) {
    return String(path || "").split(/[\\/]/).pop().toLowerCase();
  }

  function buildCoverMap(fileList) {
    const map = new Map();
    Array.from(fileList || []).forEach(file => {
      if (!file.type.startsWith("image/")) return;
      const key = file.name.toLowerCase();
      if (!map.has(key)) map.set(key, file);
    });
    return map;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`无法读取封面：${file.name}`));
      };
      image.src = url;
    });
  }

  async function resizeCover(file) {
    const image = await loadImage(file);
    const size = 420;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL("image/webp", 0.88);
  }

  async function attachCovers(songs, coverMap, existingMap = new Map()) {
    const missing = [];
    for (const song of songs) {
      if (song.coverFile) {
        const file = coverMap.get(fileBasename(song.coverFile));
        if (file) {
          song.coverDataUrl = await resizeCover(file);
        } else {
          const existing = existingMap.get(song.id.toLowerCase());
          if (existing && existing.coverFile === song.coverFile) {
            song.coverDataUrl = existing.coverDataUrl || "";
          } else if (!song.coverFile.includes("/") && !song.coverFile.includes("\\")) {
            missing.push(`${song.title}：${song.coverFile}`);
          }
        }
      } else {
        const existing = existingMap.get(song.id.toLowerCase());
        if (existing) {
          song.coverFile = existing.coverFile || "";
          song.coverDataUrl = existing.coverDataUrl || "";
        }
      }
    }
    return missing;
  }

  function coverPath(song) {
    if (song.coverDataUrl) return song.coverDataUrl;
    if (!song.coverFile) return "";
    return /[\\/]/.test(song.coverFile) ? song.coverFile.replace(/\\/g, "/") : `covers/${song.coverFile}`;
  }

  function createCover(song) {
    const source = coverPath(song);
    if (source) {
      const image = document.createElement("img");
      image.className = "song-cover";
      image.src = source;
      image.alt = song.title;
      image.onerror = () => {
        const placeholder = document.createElement("div");
        placeholder.className = "song-cover placeholder";
        placeholder.textContent = song.title.slice(0, 1) || "?";
        image.replaceWith(placeholder);
      };
      return image;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "song-cover placeholder";
    placeholder.textContent = song.title.slice(0, 1) || "?";
    return placeholder;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadText(filename, text, type = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    const rows = [
      "song_id,title,groups,pools,difficulty,level,cover",
      "001,示例自选曲,A|B,self,Master,13+,001.jpg",
      "002,示例共用曲,A|B|C,self|random,Re:Master,14,002.jpg",
      "003,示例随机曲,A,random,Expert,12+,003.jpg"
    ];
    downloadText("songs-template.csv", `\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8");
  }

  function exportSongs() {
    const rows = ["song_id,title,groups,pools,difficulty,level,cover,source,source_song_id,source_chart_id,type,ds,artist,genre,bpm,version,is_new"];
    state.songs.forEach(song => {
      rows.push([
        song.id,
        song.title,
        song.groups.join("|"),
        song.pools.join("|"),
        song.difficulty,
        song.level,
        song.coverFile || "",
        song.source || "",
        song.sourceSongId || "",
        song.sourceChartId || "",
        song.chartType || "",
        song.ds ?? "",
        song.artist || "",
        song.genre || "",
        song.bpm ?? "",
        song.version || "",
        song.isNew ? "true" : "false"
      ].map(csvEscape).join(","));
    });
    downloadText("songs.csv", `\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8");
  }

  function selectedDivingFishDifficulties() {
    return Array.from(document.querySelectorAll('input[name="dfDifficulty"]:checked')).map(input => Number(input.value));
  }

  function divingFishExistingMap() {
    const map = new Map();
    state.songs.forEach(song => {
      if (song.source === "diving-fish" && song.sourceChartId) map.set(String(song.sourceChartId), song);
      if (String(song.id || "").startsWith("df-")) map.set(String(song.id).slice(3), song);
    });
    return map;
  }

  function filteredDivingFishCatalog() {
    const query = els.dfSearchInput.value.trim().toLocaleLowerCase("zh-CN");
    const chartType = els.dfTypeFilter.value;
    const difficulty = els.dfDifficultyFilter.value;
    const status = els.dfImportStatusFilter.value;
    const existingMap = divingFishExistingMap();
    return divingFishCatalog.filter(song => {
      const searchable = [song.title, song.artist, song.sourceSongId, song.sourceChartId, song.version]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      const exists = existingMap.has(song.sourceChartId);
      return (!query || searchable.includes(query)) &&
        (chartType === "all" || song.chartType === chartType) &&
        (difficulty === "all" || song.difficulty === difficulty) &&
        (status === "all" || (status === "existing" ? exists : !exists));
    });
  }

  function renderDivingFishSummary() {
    const existingMap = divingFishExistingMap();
    const existingCount = divingFishCatalog.filter(song => existingMap.has(song.sourceChartId)).length;
    const values = [
      ["可导入谱面", divingFishCatalog.length],
      ["尚未导入", divingFishCatalog.length - existingCount],
      ["已在本地", existingCount]
    ];
    els.dfCatalogSummary.innerHTML = "";
    values.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "catalog-summary-item";
      const caption = document.createElement("span");
      caption.className = "muted small";
      caption.textContent = label;
      const number = document.createElement("strong");
      number.textContent = value;
      item.append(caption, number);
      els.dfCatalogSummary.appendChild(item);
    });
  }

  function updateDivingFishSelectionLabel() {
    els.dfSelectedCount.textContent = `已选择 ${selectedDivingFishIds.size} 首谱面`;
    els.importDivingFishBtn.disabled = selectedDivingFishIds.size === 0;
  }

  function renderDivingFishPreview() {
    const filtered = filteredDivingFishCatalog();
    const existingMap = divingFishExistingMap();
    const visible = filtered.slice(0, DIVING_FISH_RENDER_LIMIT);
    els.dfPreviewBody.innerHTML = "";

    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "muted";
      cell.textContent = "没有符合当前筛选条件的谱面。";
      row.appendChild(cell);
      els.dfPreviewBody.appendChild(row);
    }

    visible.forEach(song => {
      const exists = existingMap.has(song.sourceChartId);
      const row = document.createElement("tr");
      if (exists) row.classList.add("existing");
      if (selectedDivingFishIds.has(song.id)) row.classList.add("selected");

      const checkCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedDivingFishIds.has(song.id);
      checkbox.setAttribute("aria-label", `选择 ${song.title} ${song.difficulty}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedDivingFishIds.add(song.id);
        else selectedDivingFishIds.delete(song.id);
        row.classList.toggle("selected", checkbox.checked);
        updateDivingFishSelectionLabel();
      });
      checkCell.appendChild(checkbox);

      const titleCell = document.createElement("td");
      const title = document.createElement("strong");
      title.className = "catalog-title";
      title.textContent = song.title;
      const ids = document.createElement("span");
      ids.className = "catalog-sub";
      ids.textContent = `歌曲 ${song.sourceSongId} · 谱面 ${song.sourceChartId}`;
      titleCell.append(title, ids);

      const chartCell = document.createElement("td");
      chartCell.appendChild(tag(song.chartType, song.chartType.toLowerCase()));
      chartCell.appendChild(tag(song.difficulty, song.difficulty === "Expert" ? "expert" : song.difficulty === "Master" ? "master" : "remaster"));

      const levelCell = document.createElement("td");
      const level = document.createElement("strong");
      level.textContent = song.level;
      const ds = document.createElement("span");
      ds.className = "catalog-sub";
      ds.textContent = song.ds == null ? "定数未知" : `定数 ${song.ds.toFixed(1)}`;
      levelCell.append(level, ds);

      const infoCell = document.createElement("td");
      infoCell.textContent = song.artist || "曲师未知";
      const version = document.createElement("span");
      version.className = "catalog-sub";
      version.textContent = song.version || "版本未知";
      infoCell.appendChild(version);

      const statusCell = document.createElement("td");
      statusCell.className = exists ? "status-existing" : "status-new";
      statusCell.textContent = exists ? "已导入，可刷新" : "未导入";
      row.append(checkCell, titleCell, chartCell, levelCell, infoCell, statusCell);
      els.dfPreviewBody.appendChild(row);
    });

    els.dfRenderNote.textContent = filtered.length > DIVING_FISH_RENDER_LIMIT
      ? `共 ${filtered.length} 条结果，当前显示前 ${DIVING_FISH_RENDER_LIMIT} 条；“选择筛选结果”会选择全部 ${filtered.length} 条。请继续输入关键词缩小范围。`
      : `当前筛选结果 ${filtered.length} 条。`;
    renderDivingFishSummary();
    updateDivingFishSelectionLabel();
  }

  async function syncDivingFish() {
    hideMessage(els.dfMessage);
    const difficultyIndexes = selectedDivingFishDifficulties();
    if (!difficultyIndexes.length) {
      showMessage(els.dfMessage, "请至少选择一个需要载入的难度。", "error");
      return;
    }
    els.syncDivingFishBtn.disabled = true;
    els.syncDivingFishBtn.textContent = "正在获取曲库……";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(SongCore.DIVING_FISH_MUSIC_URL, {
        method: "GET",
        mode: "cors",
        cache: "default",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
      divingFishCatalog = SongCore.fromDivingFishMusicData(await response.json(), difficultyIndexes);
      selectedDivingFishIds.clear();
      els.dfCatalogPanel.classList.remove("hidden");
      const fetchedAt = new Date().toISOString();
      els.dfLastSync.textContent = `获取时间：${new Date(fetchedAt).toLocaleString("zh-CN")}`;
      showMessage(els.dfMessage, `已读取 ${divingFishCatalog.length} 首谱面。请筛选、选择，并在下方指定赛事组别与曲池。`, "success");
      renderDivingFishPreview();
    } catch (error) {
      const detail = error?.name === "AbortError" ? "连接超时，请稍后重试。" : (error.message || String(error));
      showMessage(els.dfMessage, `无法读取 Diving-Fish 曲库：${detail}\n仍可继续使用 CSV 导入。`, "error");
    } finally {
      clearTimeout(timeout);
      els.syncDivingFishBtn.disabled = false;
      els.syncDivingFishBtn.textContent = "获取曲库并预览";
    }
  }

  function selectFilteredDivingFish() {
    filteredDivingFishCatalog().forEach(song => selectedDivingFishIds.add(song.id));
    renderDivingFishPreview();
  }

  function clearDivingFishSelection() {
    selectedDivingFishIds.clear();
    renderDivingFishPreview();
  }

  async function importDivingFish() {
    hideMessage(els.dfMessage);
    const selected = divingFishCatalog.filter(song => selectedDivingFishIds.has(song.id));
    if (!selected.length) {
      showMessage(els.dfMessage, "请先选择需要导入或刷新的谱面。", "error");
      return;
    }
    const groups = selectedValues("dfGroup");
    const pools = selectedValues("dfPool");
    const existingById = new Map(state.songs.map(song => [String(song.id).toLowerCase(), song]));
    const newCount = selected.filter(song => !existingById.has(song.id.toLowerCase())).length;
    if (newCount > 0 && (!groups.length || !pools.length)) {
      showMessage(els.dfMessage, `选中项中有 ${newCount} 首新谱面。新谱面至少需要一个组别和一个曲池。`, "error");
      return;
    }

    els.importDivingFishBtn.disabled = true;
    els.importDivingFishBtn.textContent = "正在导入……";
    try {
      const syncedAt = new Date().toISOString();
      let added = 0;
      let updated = 0;
      const nextImportOrder = state.songs.length + 1;
      selected.forEach(candidate => {
        const key = candidate.id.toLowerCase();
        const existing = existingById.get(key);
        const merged = {
          ...candidate,
          groups: [...new Set([...(existing?.groups || []), ...groups])],
          pools: [...new Set([...(existing?.pools || []), ...pools])],
          coverFile: existing?.coverFile || candidate.coverFile,
          coverDataUrl: existing?.coverDataUrl || "",
          importOrder: existing?.importOrder || nextImportOrder + added,
          createdAt: existing?.createdAt || syncedAt,
          officialSyncedAt: syncedAt
        };
        if (existing) {
          const index = state.songs.findIndex(song => String(song.id).toLowerCase() === key);
          state.songs[index] = merged;
          updated += 1;
        } else {
          state.songs.push(merged);
          existingById.set(key, merged);
          added += 1;
        }
      });
      state.dataSources = {
        ...(state.dataSources || {}),
        divingFish: { lastImportedAt: syncedAt, endpoint: SongCore.DIVING_FISH_MUSIC_URL }
      };
      await persist("Diving-Fish 曲库已导入");
      selectedDivingFishIds.clear();
      renderAll();
      renderDivingFishPreview();
      showMessage(els.dfMessage, `导入完成：新增 ${added} 首，刷新 ${updated} 首。赛事分组、曲池和已有封面均已保留。`, "success");
    } catch (error) {
      showMessage(els.dfMessage, error.message || String(error), "error");
    } finally {
      els.importDivingFishBtn.textContent = "导入选中谱面";
      updateDivingFishSelectionLabel();
    }
  }

  function renderPoolStats() {
    const counts = SongCore.getPoolCounts(state.songs);
    els.poolStats.innerHTML = "";
    let selfTotal = 0;
    let randomTotal = 0;
    let readyGroups = 0;

    SongCore.GROUPS.forEach(group => {
      selfTotal += counts[group].self;
      randomTotal += counts[group].random;
      if (counts[group].random === 10) readyGroups += 1;
      const card = document.createElement("article");
      card.className = "pool-stat";
      const heading = document.createElement("h3");
      heading.textContent = GROUP_LABELS[group];
      const selfLine = document.createElement("div");
      selfLine.className = "pool-line";
      selfLine.innerHTML = `<span>自选池</span><strong>${counts[group].self} 首</strong>`;
      const randomLine = document.createElement("div");
      randomLine.className = "pool-line";
      const randomClass = counts[group].random === 10 ? "count-ok" : "count-warn";
      randomLine.innerHTML = `<span>随机池</span><strong class="${randomClass}">${counts[group].random}/10 首</strong>`;
      card.append(heading, selfLine, randomLine);
      els.poolStats.appendChild(card);
    });

    els.songCount.textContent = state.songs.length;
    els.selfCount.textContent = selfTotal;
    els.randomCount.textContent = randomTotal;
    els.readyGroupCount.textContent = `${readyGroups}/3`;
  }

  function tag(text, extraClass = "") {
    const element = document.createElement("span");
    element.className = `tag ${extraClass}`.trim();
    element.textContent = text;
    return element;
  }

  function renderSongTable() {
    const query = els.filterSearch.value.trim().toLocaleLowerCase("zh-CN");
    const group = els.filterGroup.value;
    const pool = els.filterPool.value;
    const difficulty = els.filterDifficulty.value;
    const filteredSongs = state.songs.filter(song =>
      (!query || [song.title, song.id, song.artist, song.sourceSongId, song.sourceChartId].join(" ").toLocaleLowerCase("zh-CN").includes(query)) &&
      (group === "all" || song.groups.includes(group)) &&
      (pool === "all" || song.pools.includes(pool)) &&
      (difficulty === "all" || song.difficulty === difficulty)
    );
    const songs = filteredSongs.slice(0, SONG_TABLE_RENDER_LIMIT);
    els.songTableBody.innerHTML = "";
    els.songRenderNote.textContent = filteredSongs.length > SONG_TABLE_RENDER_LIMIT
      ? `共 ${filteredSongs.length} 条结果，当前显示前 ${SONG_TABLE_RENDER_LIMIT} 条；请使用搜索或筛选缩小范围。`
      : `当前筛选结果 ${filteredSongs.length} 条。`;

    if (!songs.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "muted";
      cell.textContent = "暂无符合条件的曲目。";
      row.appendChild(cell);
      els.songTableBody.appendChild(row);
      return;
    }

    songs.forEach(song => {
      const row = document.createElement("tr");
      const coverCell = document.createElement("td");
      coverCell.appendChild(createCover(song));
      const titleCell = document.createElement("td");
      const title = document.createElement("strong");
      title.textContent = song.title;
      const id = document.createElement("div");
      id.className = "muted small";
      id.textContent = song.source === "diving-fish"
        ? `${song.id} · ${song.chartType || ""}${song.ds == null ? "" : ` · 定数 ${Number(song.ds).toFixed(1)}`}`
        : song.id;
      titleCell.append(title, id);
      if (song.artist) {
        const artist = document.createElement("div");
        artist.className = "muted small";
        artist.textContent = song.artist;
        titleCell.appendChild(artist);
      }
      const groupCell = document.createElement("td");
      song.groups.forEach(item => groupCell.appendChild(tag(GROUP_LABELS[item])));
      const poolCell = document.createElement("td");
      song.pools.forEach(item => poolCell.appendChild(tag(POOL_LABELS[item], item)));
      const diffCell = document.createElement("td");
      const diffClass = song.difficulty === "Expert" ? "expert" : song.difficulty === "Master" ? "master" : "remaster";
      diffCell.appendChild(tag(`${song.difficulty} ${song.level}`, diffClass));
      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.style.marginTop = "0";
      const edit = document.createElement("button");
      edit.className = "secondary small";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => startEditSong(song.id));
      const remove = document.createElement("button");
      remove.className = "danger small";
      remove.textContent = "删除";
      remove.addEventListener("click", () => deleteSong(song.id));
      actions.append(edit, remove);
      actionCell.appendChild(actions);
      row.append(coverCell, titleCell, groupCell, poolCell, diffCell, actionCell);
      els.songTableBody.appendChild(row);
    });
  }

  function renderAll() {
    renderPoolStats();
    renderSongTable();
  }

  async function importSongs() {
    hideMessage(els.importMessage);
    const csvFile = els.songCsvInput.files[0];
    if (!csvFile) {
      showMessage(els.importMessage, "请先选择曲目 CSV 文件。", "error");
      return;
    }
    els.importSongsBtn.disabled = true;
    els.importSongsBtn.textContent = "正在导入……";
    try {
      const imported = SongCore.parseSongRows(await readCsvFile(csvFile));
      const existingMap = new Map(state.songs.map(song => [song.id.toLowerCase(), song]));
      const missingCovers = await attachCovers(imported, buildCoverMap(els.coverFolderInput.files), existingMap);

      if (els.songImportMode.value === "merge") {
        const merged = new Map(state.songs.map(song => [song.id.toLowerCase(), song]));
        imported.forEach(song => merged.set(song.id.toLowerCase(), { ...merged.get(song.id.toLowerCase()), ...song }));
        state.songs = Array.from(merged.values());
      } else {
        state.songs = imported;
      }
      await persist("曲库已导入");
      renderAll();

      const counts = SongCore.getPoolCounts(state.songs);
      const poolWarnings = SongCore.GROUPS
        .filter(group => counts[group].random !== 10)
        .map(group => `${GROUP_LABELS[group]}随机池：${counts[group].random}/10 首`);
      const details = [];
      if (missingCovers.length) details.push(`未在所选文件夹找到 ${missingCovers.length} 个封面：\n${missingCovers.join("\n")}`);
      if (poolWarnings.length) details.push(`随机池数量提示：\n${poolWarnings.join("\n")}`);
      showMessage(
        els.importMessage,
        `成功导入 ${imported.length} 首曲目。${details.length ? `\n\n${details.join("\n\n")}` : "\n三个组别的随机池均为 10 首。"}`,
        details.length ? "info" : "success"
      );
    } catch (error) {
      showMessage(els.importMessage, error.message || String(error), "error");
    } finally {
      els.importSongsBtn.disabled = false;
      els.importSongsBtn.textContent = "导入并检查";
    }
  }

  function selectedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(input => input.value);
  }

  function setCheckedValues(name, values) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
      input.checked = values.includes(input.value);
    });
  }

  function resetEditor() {
    editingSongId = null;
    els.songForm.reset();
    els.difficultyInput.value = "Master";
    els.songIdInput.disabled = false;
    els.songEditorTitle.textContent = "手动添加曲目";
    els.cancelSongEditBtn.classList.add("hidden");
    hideMessage(els.editorMessage);
  }

  function startEditSong(songId) {
    const song = state.songs.find(item => item.id === songId);
    if (!song) return;
    editingSongId = songId;
    els.songEditorTitle.textContent = `编辑曲目：${song.title}`;
    els.songIdInput.value = song.id;
    els.songIdInput.disabled = true;
    els.songTitleInput.value = song.title;
    els.difficultyInput.value = song.difficulty;
    els.levelInput.value = song.level;
    els.singleCoverInput.value = "";
    setCheckedValues("songGroup", song.groups);
    setCheckedValues("songPool", song.pools);
    els.cancelSongEditBtn.classList.remove("hidden");
    hideMessage(els.editorMessage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSong(event) {
    event.preventDefault();
    hideMessage(els.editorMessage);
    const id = els.songIdInput.value.trim();
    const title = els.songTitleInput.value.trim();
    const groups = selectedValues("songGroup");
    const pools = selectedValues("songPool");
    const difficulty = els.difficultyInput.value;
    const level = els.levelInput.value.trim();

    if (!id || !title || !level || !groups.length || !pools.length) {
      showMessage(els.editorMessage, "请填写编号、曲名、等级，并至少选择一个组别和一个曲池。", "error");
      return;
    }
    if (!editingSongId && state.songs.some(song => song.id.toLowerCase() === id.toLowerCase())) {
      showMessage(els.editorMessage, `曲目编号“${id}”已存在。`, "error");
      return;
    }

    const existing = editingSongId ? state.songs.find(song => song.id === editingSongId) : null;
    let coverFile = existing?.coverFile || "";
    let coverDataUrl = existing?.coverDataUrl || "";
    const cover = els.singleCoverInput.files[0];
    if (cover) {
      coverFile = cover.name;
      coverDataUrl = await resizeCover(cover);
    }

    const song = {
      ...(existing || {}),
      id,
      title,
      groups,
      pools,
      difficulty,
      level,
      coverFile,
      coverDataUrl,
      importOrder: existing?.importOrder || state.songs.length + 1,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) state.songs = state.songs.map(item => item.id === existing.id ? song : item);
    else state.songs.push(song);
    await persist(existing ? "曲目信息已更新" : "曲目已添加");
    renderAll();
    resetEditor();
  }

  async function deleteSong(songId) {
    const song = state.songs.find(item => item.id === songId);
    if (!song || !confirm(`确定删除曲目“${song.title}”吗？`)) return;
    state.songs = state.songs.filter(item => item.id !== songId);
    await persist("曲目已删除");
    if (editingSongId === songId) resetEditor();
    renderAll();
  }

  els.downloadTemplateBtn.addEventListener("click", downloadTemplate);
  els.syncDivingFishBtn.addEventListener("click", syncDivingFish);
  els.dfSelectFilteredBtn.addEventListener("click", selectFilteredDivingFish);
  els.dfClearSelectionBtn.addEventListener("click", clearDivingFishSelection);
  els.importDivingFishBtn.addEventListener("click", importDivingFish);
  els.dfSearchInput.addEventListener("input", renderDivingFishPreview);
  [els.dfTypeFilter, els.dfDifficultyFilter, els.dfImportStatusFilter]
    .forEach(element => element.addEventListener("change", renderDivingFishPreview));
  els.importSongsBtn.addEventListener("click", importSongs);
  els.exportSongsBtn.addEventListener("click", exportSongs);
  els.filterSearch.addEventListener("input", renderSongTable);
  [els.filterGroup, els.filterPool, els.filterDifficulty].forEach(element => element.addEventListener("change", renderSongTable));
  els.songForm.addEventListener("submit", saveSong);
  els.cancelSongEditBtn.addEventListener("click", resetEditor);

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      state = await TournamentStore.loadState();
      els.saveStatus.textContent = state.updatedAt ? `上次保存：${new Date(state.updatedAt).toLocaleString("zh-CN")}` : "尚无保存记录";
      const lastImportedAt = state.dataSources?.divingFish?.lastImportedAt;
      if (lastImportedAt) els.dfLastSync.textContent = `上次导入：${new Date(lastImportedAt).toLocaleString("zh-CN")}`;
      updateDivingFishSelectionLabel();
      renderAll();
    } catch (error) {
      showMessage(els.importMessage, `无法载入曲库：${error.message || error}`, "error");
      els.saveStatus.textContent = "载入失败";
    }
  });
})();
