(function () {
  "use strict";

  const BACKUP_FORMAT = "music-bp-full-backup";
  const BACKUP_VERSION = 1;

  function summarizeState(state) {
    const brackets = state && state.brackets && typeof state.brackets === "object" ? state.brackets : {};
    const matches = Object.values(brackets).reduce((total, bracket) => {
      const rounds = Array.isArray(bracket && bracket.rounds) ? bracket.rounds : [];
      return total + rounds.reduce((roundTotal, round) => roundTotal + (Array.isArray(round) ? round.length : 0), 0);
    }, 0);
    return {
      players: Array.isArray(state && state.players) ? state.players.length : 0,
      songs: Array.isArray(state && state.songs) ? state.songs.length : 0,
      brackets: Object.keys(brackets).length,
      matches
    };
  }

  function createBackup(state) {
    return {
      format: BACKUP_FORMAT,
      backupVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      appState: state
    };
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error("备份文件不是有效的 JSON。");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("备份文件结构无效。");
    }

    const state = parsed.format === BACKUP_FORMAT ? parsed.appState : parsed;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("备份文件中没有赛事数据。");
    }
    if (!Array.isArray(state.players) || !Array.isArray(state.songs)) {
      throw new Error("备份文件缺少选手或曲库数据。");
    }
    if (!state.brackets || typeof state.brackets !== "object" || Array.isArray(state.brackets)) {
      throw new Error("备份文件缺少赛程数据。");
    }
    return state;
  }

  function timestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
  }

  function downloadBackup(state, prefix = "music-bp-full-backup") {
    const json = JSON.stringify(createBackup(state), null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${prefix}-${timestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function summaryText(summary) {
    return `${summary.players} 名选手、${summary.songs} 首曲目、${summary.brackets} 组赛程、${summary.matches} 场对局`;
  }

  window.MusicBpBackup = {
    BACKUP_FORMAT,
    BACKUP_VERSION,
    createBackup,
    parseBackup,
    summarizeState
  };

  document.addEventListener("DOMContentLoaded", () => {
    const exportButton = document.getElementById("exportBackupBtn");
    const importButton = document.getElementById("importBackupBtn");
    const importInput = document.getElementById("importBackupInput");
    const message = document.getElementById("backupMessage");
    if (!exportButton || !importButton || !importInput || !message || !window.TournamentStore) return;

    function showMessage(text, type) {
      message.textContent = text;
      message.className = `message backup-message ${type}`;
    }

    exportButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      try {
        const state = await TournamentStore.loadState();
        downloadBackup(state);
        showMessage(`已导出：${summaryText(summarizeState(state))}。`, "success");
      } catch (error) {
        showMessage(`导出失败：${error.message || error}`, "error");
      } finally {
        exportButton.disabled = false;
      }
    });

    importButton.addEventListener("click", () => importInput.click());

    importInput.addEventListener("change", async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      importButton.disabled = true;
      exportButton.disabled = true;
      try {
        const importedState = parseBackup(await file.text());
        const importedSummary = summarizeState(importedState);
        const confirmed = window.confirm(
          `即将导入：${summaryText(importedSummary)}。\n\n` +
          "现有工作台数据将被替换；导入前会先下载一份当前数据备份。是否继续？"
        );
        if (!confirmed) {
          showMessage("已取消导入。", "info");
          return;
        }

        const currentState = await TournamentStore.loadState();
        downloadBackup(currentState, "music-bp-before-import");
        const saved = await TournamentStore.saveState(importedState);
        showMessage(`导入完成：${summaryText(summarizeState(saved))}。`, "success");
      } catch (error) {
        showMessage(`导入失败：${error.message || error}`, "error");
      } finally {
        importInput.value = "";
        importButton.disabled = false;
        exportButton.disabled = false;
      }
    });
  });
})();
