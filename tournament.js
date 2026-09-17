(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const GROUPS = ["A", "B", "C"];
  const GROUP_LABELS = { A: "A组", B: "B组", C: "C组" };
  const { normalizeGroup, parsePlayerRows, createBracket, recomputeBracket } = TournamentCore;

  const els = {
    playerCount: $("playerCount"),
    bracketCount: $("bracketCount"),
    completedCount: $("completedCount"),
    activeMatchLabel: $("activeMatchLabel"),
    csvFileInput: $("csvFileInput"),
    avatarFolderInput: $("avatarFolderInput"),
    importModeSelect: $("importModeSelect"),
    importPlayersBtn: $("importPlayersBtn"),
    exportPlayersBtn: $("exportPlayersBtn"),
    downloadTemplateBtn: $("downloadTemplateBtn"),
    importMessage: $("importMessage"),
    playerGroupFilter: $("playerGroupFilter"),
    playerTableBody: $("playerTableBody"),
    playerForm: $("playerForm"),
    editorTitle: $("editorTitle"),
    playerIdInput: $("playerIdInput"),
    nicknameInput: $("nicknameInput"),
    groupInput: $("groupInput"),
    seedInput: $("seedInput"),
    singleAvatarInput: $("singleAvatarInput"),
    cancelEditBtn: $("cancelEditBtn"),
    editorMessage: $("editorMessage"),
    eventNameInput: $("eventNameInput"),
    saveEventNameBtn: $("saveEventNameBtn"),
    saveStatus: $("saveStatus"),
    bracketGroupSelect: $("bracketGroupSelect"),
    generateBracketBtn: $("generateBracketBtn"),
    clearBracketBtn: $("clearBracketBtn"),
    bracketMessage: $("bracketMessage"),
    bracketBoard: $("bracketBoard"),
    activeMatchCard: $("activeMatchCard"),
    openBpBtn: $("openBpBtn"),
    clearActiveMatchBtn: $("clearActiveMatchBtn")
  };

  let state = TournamentStore.createDefaultState();
  let editingPlayerId = null;

  function showMessage(element, text, kind = "info") {
    element.className = `message ${kind}`;
    element.textContent = text;
  }

  function hideMessage(element) {
    element.className = "message hidden";
    element.textContent = "";
  }

  function setSaveStatus(text) {
    els.saveStatus.textContent = text;
  }

  async function persist(message = "已自动保存") {
    state = await TournamentStore.saveState(state);
    setSaveStatus(`${message} · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
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

  function buildAvatarFileMap(fileList) {
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
        reject(new Error(`无法读取头像：${file.name}`));
      };
      image.src = url;
    });
  }

  async function resizeAvatar(file) {
    const image = await loadImage(file);
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (size - width) / 2;
    const y = (size - height) / 2;
    context.drawImage(image, x, y, width, height);
    return canvas.toDataURL("image/webp", 0.86);
  }

  async function attachAvatars(players, avatarMap, existingMap = new Map()) {
    const missing = [];
    for (const player of players) {
      if (player.avatarFile) {
        const file = avatarMap.get(player.avatarFile.toLowerCase());
        if (file) {
          player.avatarDataUrl = await resizeAvatar(file);
        } else {
          const existing = existingMap.get(player.id);
          if (existing && existing.avatarFile === player.avatarFile) {
            player.avatarDataUrl = existing.avatarDataUrl || "";
          } else {
            missing.push(`${player.nickname}：${player.avatarFile}`);
          }
        }
      } else {
        const existing = existingMap.get(player.id);
        if (existing) {
          player.avatarFile = existing.avatarFile || "";
          player.avatarDataUrl = existing.avatarDataUrl || "";
        }
      }
    }
    return missing;
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

  function exportPlayers() {
    const header = ["player_id", "nickname", "group", "avatar", "seed"];
    const lines = [header.join(",")];
    state.players.forEach(player => {
      lines.push([
        player.id,
        player.nickname,
        player.group,
        player.avatarFile || "",
        player.seed || ""
      ].map(csvEscape).join(","));
    });
    downloadText("players.csv", `\uFEFF${lines.join("\r\n")}`, "text/csv;charset=utf-8");
  }

  function downloadTemplate() {
    const template = [
      "player_id,nickname,group,avatar,seed",
      "001,选手甲,A,001.png,1",
      "002,选手乙,A,002.jpg,2"
    ].join("\r\n");
    downloadText("players-template.csv", `\uFEFF${template}`, "text/csv;charset=utf-8");
  }

  function getPlayerMap() {
    return new Map(state.players.map(player => [player.id, player]));
  }

  function getRoundTitle(roundIndex, totalRounds) {
    if (roundIndex === totalRounds - 1) return "决赛";
    if (roundIndex === totalRounds - 2) return "半决赛";
    return `第 ${roundIndex + 1} 轮`;
  }

  function statusLabel(match) {
    if (match.status === "ready") return "待比赛";
    if (match.status === "completed") return "已完赛";
    if (match.status === "bye") return "轮空晋级";
    if (match.status === "empty") return "空位";
    return "等待前序比赛";
  }

  function createAvatar(player, sizeClass = "avatar") {
    if (player?.avatarDataUrl) {
      const image = document.createElement("img");
      image.className = sizeClass;
      image.src = player.avatarDataUrl;
      image.alt = player.nickname;
      return image;
    }
    const placeholder = document.createElement("div");
    placeholder.className = `${sizeClass} avatar-placeholder`;
    placeholder.textContent = player?.nickname?.slice(0, 1) || "?";
    return placeholder;
  }

  function renderPlayerTable() {
    const filter = els.playerGroupFilter.value;
    const players = state.players.filter(player => filter === "all" || player.group === filter);
    els.playerTableBody.innerHTML = "";

    if (!players.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "muted";
      cell.textContent = "暂无选手。可从 CSV 导入或在右侧手动添加。";
      row.appendChild(cell);
      els.playerTableBody.appendChild(row);
      return;
    }

    players.forEach(player => {
      const row = document.createElement("tr");
      const avatarCell = document.createElement("td");
      avatarCell.appendChild(createAvatar(player));
      row.appendChild(avatarCell);

      [player.id, player.nickname].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      const groupCell = document.createElement("td");
      const groupTag = document.createElement("span");
      groupTag.className = "tag";
      groupTag.textContent = GROUP_LABELS[player.group] || player.group;
      groupCell.appendChild(groupTag);
      row.appendChild(groupCell);

      const seedCell = document.createElement("td");
      seedCell.textContent = player.seed || "—";
      row.appendChild(seedCell);

      const actionsCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.style.marginTop = "0";
      const editButton = document.createElement("button");
      editButton.className = "secondary small";
      editButton.textContent = "编辑";
      editButton.addEventListener("click", () => startEditPlayer(player.id));
      const deleteButton = document.createElement("button");
      deleteButton.className = "danger small";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => deletePlayer(player.id));
      actions.append(editButton, deleteButton);
      actionsCell.appendChild(actions);
      row.appendChild(actionsCell);
      els.playerTableBody.appendChild(row);
    });
  }

  function renderMatchPlayer(match, player, side) {
    const row = document.createElement("div");
    row.className = "match-player";
    if (player && match.winnerId === player.id) row.classList.add("winner");

    const label = document.createElement("span");
    label.textContent = player ? `${side} · ${player.nickname}` : `${side} · 待定`;
    if (!player) label.className = "empty";
    row.appendChild(label);

    if (player && match.playerAId && match.playerBId) {
      const button = document.createElement("button");
      button.className = "secondary small";
      button.textContent = match.winnerId === player.id ? "胜者" : "判胜";
      button.disabled = match.winnerId === player.id;
      button.addEventListener("click", () => setMatchWinner(match.id, player.id));
      row.appendChild(button);
    }
    return row;
  }

  function renderBracket() {
    const group = els.bracketGroupSelect.value;
    const bracket = state.brackets[group];
    els.bracketBoard.innerHTML = "";

    if (!bracket) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = `${GROUP_LABELS[group]}尚未生成赛程。`;
      els.bracketBoard.appendChild(empty);
      return;
    }

    recomputeBracket(bracket);
    const playerMap = getPlayerMap();
    bracket.rounds.forEach((round, roundIndex) => {
      const roundColumn = document.createElement("section");
      roundColumn.className = "round";
      const heading = document.createElement("h3");
      heading.textContent = getRoundTitle(roundIndex, bracket.rounds.length);
      roundColumn.appendChild(heading);
      const matches = document.createElement("div");
      matches.className = "round-matches";

      round.forEach(match => {
        const card = document.createElement("article");
        card.className = "match";
        if (state.activeMatchId === match.id) card.classList.add("active");

        const title = document.createElement("div");
        title.className = "match-title";
        const matchName = document.createElement("span");
        matchName.textContent = match.id;
        const status = document.createElement("span");
        status.className = `tag ${match.status === "ready" ? "ready" : match.status === "completed" ? "done" : ""}`;
        status.textContent = statusLabel(match);
        title.append(matchName, status);
        card.appendChild(title);
        card.appendChild(renderMatchPlayer(match, playerMap.get(match.playerAId), "A"));
        card.appendChild(renderMatchPlayer(match, playerMap.get(match.playerBId), "B"));

        if (match.status === "ready") {
          const actions = document.createElement("div");
          actions.className = "match-actions";
          const selectButton = document.createElement("button");
          selectButton.className = "small";
          selectButton.textContent = state.activeMatchId === match.id ? "当前场次" : "设为当前场次";
          selectButton.disabled = state.activeMatchId === match.id;
          selectButton.addEventListener("click", () => selectActiveMatch(match.id));
          actions.appendChild(selectButton);
          card.appendChild(actions);
        }
        matches.appendChild(card);
      });

      roundColumn.appendChild(matches);
      els.bracketBoard.appendChild(roundColumn);
    });
  }

  function renderActiveMatch() {
    const match = TournamentStore.findMatch(state, state.activeMatchId);
    const context = TournamentStore.getMatchContext(state, state.activeMatchId);
    els.activeMatchCard.innerHTML = "";

    if (!match || !context) {
      if (state.activeMatchId) state.activeMatchId = null;
      els.activeMatchCard.className = "muted";
      els.activeMatchCard.textContent = "尚未选择当前场次。";
      els.openBpBtn.classList.add("hidden");
      els.clearActiveMatchBtn.classList.add("hidden");
      return;
    }

    els.activeMatchCard.className = "";
    const title = document.createElement("p");
    title.style.margin = "0 0 10px";
    title.innerHTML = `<strong>${GROUP_LABELS[context.group]} · 第 ${context.round} 轮</strong><br><span class="muted small">${context.matchId}</span>`;
    const matchup = document.createElement("div");
    matchup.style.display = "grid";
    matchup.style.gridTemplateColumns = "1fr auto 1fr";
    matchup.style.alignItems = "center";
    matchup.style.gap = "10px";

    [context.playerA, context.playerB].forEach((player, index) => {
      const side = document.createElement("div");
      side.style.textAlign = "center";
      side.appendChild(createAvatar(player));
      side.lastChild.style.margin = "0 auto 6px";
      const name = document.createElement("strong");
      name.textContent = player.nickname;
      side.appendChild(name);
      if (index === 0) {
        matchup.appendChild(side);
        const versus = document.createElement("strong");
        versus.textContent = "VS";
        versus.style.color = "var(--gold)";
        matchup.appendChild(versus);
      } else {
        matchup.appendChild(side);
      }
    });
    els.activeMatchCard.append(title, matchup);
    els.openBpBtn.href = `index.html?portal=referee&match=${encodeURIComponent(match.id)}`;
    els.openBpBtn.classList.remove("hidden");
    els.clearActiveMatchBtn.classList.remove("hidden");
  }

  function renderStats() {
    const allMatches = TournamentStore.getAllMatches(state);
    els.playerCount.textContent = state.players.length;
    els.bracketCount.textContent = Object.keys(state.brackets).length;
    els.completedCount.textContent = allMatches.filter(match => match.status === "completed").length;
    els.activeMatchLabel.textContent = state.activeMatchId || "—";
  }

  function renderAll() {
    renderStats();
    renderPlayerTable();
    renderBracket();
    renderActiveMatch();
  }

  function clearBracketsForGroups(groups) {
    const targetGroups = new Set(groups);
    const activeMatch = TournamentStore.findMatch(state, state.activeMatchId);
    if (activeMatch && targetGroups.has(activeMatch.group)) state.activeMatchId = null;
    targetGroups.forEach(group => delete state.brackets[group]);
  }

  async function importPlayers() {
    hideMessage(els.importMessage);
    const csvFile = els.csvFileInput.files[0];
    if (!csvFile) {
      showMessage(els.importMessage, "请先选择选手 CSV 文件。", "error");
      return;
    }

    els.importPlayersBtn.disabled = true;
    els.importPlayersBtn.textContent = "正在导入……";
    try {
      const text = await readCsvFile(csvFile);
      const imported = parsePlayerRows(text);
      const avatarMap = buildAvatarFileMap(els.avatarFolderInput.files);
      const existingMap = new Map(state.players.map(player => [player.id, player]));
      const missingAvatars = await attachAvatars(imported, avatarMap, existingMap);

      if (els.importModeSelect.value === "merge") {
        const merged = new Map(state.players.map(player => [player.id, player]));
        imported.forEach(player => merged.set(player.id, { ...merged.get(player.id), ...player }));
        state.players = Array.from(merged.values());
      } else {
        state.players = imported;
      }

      state.brackets = {};
      state.activeMatchId = null;
      await persist("选手名单已导入");
      renderAll();
      const warningText = missingAvatars.length
        ? `\n未找到 ${missingAvatars.length} 个头像：\n${missingAvatars.join("\n")}`
        : "\n所有已填写头像均匹配成功。";
      showMessage(els.importMessage, `成功导入 ${imported.length} 名选手。为避免旧对阵引用错误，已有赛程已清空。${warningText}`, missingAvatars.length ? "info" : "success");
    } catch (error) {
      showMessage(els.importMessage, error.message || String(error), "error");
    } finally {
      els.importPlayersBtn.disabled = false;
      els.importPlayersBtn.textContent = "导入并检查";
    }
  }

  function resetEditor() {
    editingPlayerId = null;
    els.playerForm.reset();
    els.groupInput.value = "A";
    els.playerIdInput.disabled = false;
    els.editorTitle.textContent = "手动添加选手";
    els.cancelEditBtn.classList.add("hidden");
    hideMessage(els.editorMessage);
  }

  function startEditPlayer(playerId) {
    const player = state.players.find(item => item.id === playerId);
    if (!player) return;
    editingPlayerId = playerId;
    els.editorTitle.textContent = `编辑选手：${player.nickname}`;
    els.playerIdInput.value = player.id;
    els.playerIdInput.disabled = true;
    els.nicknameInput.value = player.nickname;
    els.groupInput.value = player.group;
    els.seedInput.value = player.seed || "";
    els.singleAvatarInput.value = "";
    els.cancelEditBtn.classList.remove("hidden");
    hideMessage(els.editorMessage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePlayer(event) {
    event.preventDefault();
    hideMessage(els.editorMessage);
    const id = els.playerIdInput.value.trim();
    const nickname = els.nicknameInput.value.trim();
    const group = normalizeGroup(els.groupInput.value);
    const seedText = els.seedInput.value.trim();
    const seed = seedText ? Number.parseInt(seedText, 10) : null;

    if (!id || !nickname || !group) {
      showMessage(els.editorMessage, "请填写选手编号、昵称和组别。", "error");
      return;
    }
    if (seedText && (!Number.isInteger(seed) || seed < 1)) {
      showMessage(els.editorMessage, "种子顺位必须是正整数。", "error");
      return;
    }
    if (!editingPlayerId && state.players.some(player => player.id.toLowerCase() === id.toLowerCase())) {
      showMessage(els.editorMessage, `选手编号“${id}”已存在。`, "error");
      return;
    }

    const existing = editingPlayerId ? state.players.find(player => player.id === editingPlayerId) : null;
    const affectedGroups = new Set();
    if (!existing && state.brackets[group]) affectedGroups.add(group);
    if (existing && existing.group !== group) {
      if (state.brackets[existing.group]) affectedGroups.add(existing.group);
      if (state.brackets[group]) affectedGroups.add(group);
    }
    if (affectedGroups.size) {
      const labels = Array.from(affectedGroups).map(item => GROUP_LABELS[item]).join("、");
      if (!confirm(`这次修改会使${labels}的现有赛程失效。继续后将清除对应组别的赛程，是否继续？`)) return;
    }

    let avatarDataUrl = existing?.avatarDataUrl || "";
    let avatarFile = existing?.avatarFile || "";
    const avatar = els.singleAvatarInput.files[0];
    if (avatar) {
      avatarDataUrl = await resizeAvatar(avatar);
      avatarFile = avatar.name;
    }

    const player = {
      id,
      nickname,
      group,
      avatarFile,
      avatarDataUrl,
      seed: Number.isInteger(seed) && seed > 0 ? seed : null,
      importOrder: existing?.importOrder || state.players.length + 1,
      createdAt: existing?.createdAt || new Date().toISOString()
    };

    if (existing) {
      state.players = state.players.map(item => item.id === existing.id ? player : item);
    } else {
      state.players.push(player);
    }
    clearBracketsForGroups(affectedGroups);
    await persist(existing ? "选手信息已更新" : "选手已添加");
    renderAll();
    resetEditor();
  }

  async function deletePlayer(playerId) {
    const player = state.players.find(item => item.id === playerId);
    if (!player) return;
    const bracketWarning = state.brackets[player.group]
      ? `\n\n为避免引用错误，${GROUP_LABELS[player.group]}的现有赛程也会被清空；其他组别不受影响。`
      : "";
    if (!confirm(`确定删除选手“${player.nickname}”吗？${bracketWarning}`)) return;
    state.players = state.players.filter(item => item.id !== playerId);
    clearBracketsForGroups([player.group]);
    await persist("选手已删除");
    if (editingPlayerId === playerId) resetEditor();
    renderAll();
  }

  async function generateBracket() {
    hideMessage(els.bracketMessage);
    const group = els.bracketGroupSelect.value;
    const players = state.players.filter(player => player.group === group);
    if (players.length < 2) {
      showMessage(els.bracketMessage, `${GROUP_LABELS[group]}至少需要 2 名选手才能生成赛程。`, "error");
      return;
    }
    if (state.brackets[group] && !confirm(`${GROUP_LABELS[group]}已有赛程。重建会清除该组已有胜负与晋级信息，是否继续？`)) return;
    state.brackets[group] = createBracket(group, players);
    if (state.activeMatchId?.startsWith(`${group}-`)) state.activeMatchId = null;
    await persist(`${GROUP_LABELS[group]}赛程已生成`);
    renderAll();
    showMessage(els.bracketMessage, `已为 ${players.length} 名选手生成单败淘汰赛程。轮空位已自动晋级。`, "success");
  }

  async function clearBracket() {
    const group = els.bracketGroupSelect.value;
    if (!state.brackets[group]) {
      showMessage(els.bracketMessage, `${GROUP_LABELS[group]}目前没有赛程。`, "info");
      return;
    }
    if (!confirm(`确定清除${GROUP_LABELS[group]}的全部赛程与结果吗？`)) return;
    delete state.brackets[group];
    if (state.activeMatchId?.startsWith(`${group}-`)) state.activeMatchId = null;
    await persist(`${GROUP_LABELS[group]}赛程已清除`);
    renderAll();
  }

  async function setMatchWinner(matchId, playerId) {
    state = await TournamentStore.loadState();
    const match = TournamentStore.findMatch(state, matchId);
    const player = state.players.find(item => item.id === playerId);
    if (!match || !player) return;
    if (!match.bpResult?.picks) {
      const proceed = confirm(`${match.id} 尚未保存 BP 选曲记录。现在确认胜者后，本场 Pick 无法自动加入选手历史。仍要继续吗？`);
      if (!proceed) return;
    }
    if (match.winnerId && match.winnerId !== playerId) {
      if (!confirm(`确定把 ${match.id} 的胜者改为“${player.nickname}”吗？后续对阵将自动重新计算。`)) return;
    }
    match.winnerId = playerId;
    match.decision = "manual";
    match.resultConfirmedAt = new Date().toISOString();
    const bracket = state.brackets[match.group];
    recomputeBracket(bracket);
    if (state.activeMatchId === matchId) state.activeMatchId = null;
    await persist(`${match.id} 胜者已记录`);
    renderAll();
  }

  async function selectActiveMatch(matchId) {
    const match = TournamentStore.findMatch(state, matchId);
    if (!match || match.status !== "ready") return;
    state.activeMatchId = matchId;
    await persist(`${matchId} 已设为当前场次`);
    renderAll();
  }

  async function clearActiveMatch() {
    state.activeMatchId = null;
    await persist("已取消当前场次");
    renderAll();
  }

  function transferActiveMatchToBp() {
    const context = TournamentStore.getMatchContext(state, state.activeMatchId);
    if (!context) return;
    if (!TournamentStore.transferState(state)) {
      window.name = `music-bp-match:${JSON.stringify(context)}`;
    }
  }

  async function saveEventName() {
    state.eventName = els.eventNameInput.value.trim();
    await persist("赛事名称已保存");
    renderActiveMatch();
  }

  els.importPlayersBtn.addEventListener("click", importPlayers);
  els.exportPlayersBtn.addEventListener("click", exportPlayers);
  els.downloadTemplateBtn.addEventListener("click", downloadTemplate);
  els.playerGroupFilter.addEventListener("change", renderPlayerTable);
  els.playerForm.addEventListener("submit", savePlayer);
  els.cancelEditBtn.addEventListener("click", resetEditor);
  els.generateBracketBtn.addEventListener("click", generateBracket);
  els.clearBracketBtn.addEventListener("click", clearBracket);
  els.bracketGroupSelect.addEventListener("change", () => {
    hideMessage(els.bracketMessage);
    renderBracket();
  });
  els.saveEventNameBtn.addEventListener("click", saveEventName);
  els.clearActiveMatchBtn.addEventListener("click", clearActiveMatch);
  els.openBpBtn.addEventListener("click", transferActiveMatchToBp);

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      state = await TournamentStore.loadState();
      GROUPS.forEach(group => {
        if (state.brackets[group]) recomputeBracket(state.brackets[group]);
      });
      els.eventNameInput.value = state.eventName || "";
      setSaveStatus(state.updatedAt ? `上次保存：${new Date(state.updatedAt).toLocaleString("zh-CN")}` : "尚无保存记录");
      renderAll();
    } catch (error) {
      setSaveStatus("载入失败");
      showMessage(els.importMessage, `无法载入赛事数据：${error.message || error}`, "error");
    }
  });
})();
