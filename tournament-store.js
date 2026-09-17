(function () {
  "use strict";

  const DB_NAME = "music-bp-tournament";
  const DB_VERSION = 1;
  const STORE_NAME = "app-state";
  const STATE_KEY = "tournament";
  const FALLBACK_KEY = "musicBpTournamentStateV1";
  const WINDOW_PREFIX = "music-bp-state:";

  function createDefaultState() {
    return {
      version: 1,
      eventName: "",
      players: [],
      songs: [],
      brackets: {},
      activeMatchId: null,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeState(raw) {
    const base = createDefaultState();
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      ...raw,
      players: Array.isArray(raw.players) ? raw.players : [],
      songs: Array.isArray(raw.songs) ? raw.songs : [],
      brackets: raw.brackets && typeof raw.brackets === "object" ? raw.brackets : {}
    };
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
  }

  function readTransferredState() {
    try {
      const transferred = String(window.name || "");
      if (!transferred.startsWith(WINDOW_PREFIX)) return null;
      return normalizeState(JSON.parse(transferred.slice(WINDOW_PREFIX.length)));
    } catch (error) {
      console.warn("Transferred tournament state is invalid.", error);
      return null;
    }
  }

  function transferState(state) {
    try {
      window.name = `${WINDOW_PREFIX}${JSON.stringify(normalizeState(state))}`;
      return true;
    } catch (error) {
      console.warn("Unable to transfer tournament state between local pages.", error);
      return false;
    }
  }

  function newestState(first, second) {
    if (!first) return second;
    if (!second) return first;
    const firstTime = Date.parse(first.updatedAt || "") || 0;
    const secondTime = Date.parse(second.updatedAt || "") || 0;
    return secondTime > firstTime ? second : first;
  }

  async function loadState() {
    let persisted = null;
    try {
      const db = await openDatabase();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (value) persisted = normalizeState(value);
    } catch (error) {
      console.warn("IndexedDB load failed; using localStorage fallback.", error);
    }

    if (!persisted) {
      try {
        const value = localStorage.getItem(FALLBACK_KEY);
        persisted = value ? normalizeState(JSON.parse(value)) : null;
      } catch (error) {
        console.warn("localStorage load failed.", error);
      }
    }

    const resolved = newestState(persisted, readTransferredState()) || createDefaultState();
    transferState(resolved);
    return resolved;
  }

  async function saveState(state) {
    const normalized = normalizeState(state);
    normalized.updatedAt = new Date().toISOString();
    let indexedDbSaved = false;

    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(normalized, STATE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      });
      db.close();
      indexedDbSaved = true;
    } catch (error) {
      console.warn("IndexedDB save failed; using localStorage fallback.", error);
    }

    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(normalized));
    } catch (error) {
      if (!indexedDbSaved) throw error;
      console.warn("localStorage mirror failed.", error);
    }

    transferState(normalized);
    return normalized;
  }

  function getAllMatches(state) {
    return Object.values(state.brackets || {}).flatMap(bracket =>
      (bracket.rounds || []).flatMap(round => round || [])
    );
  }

  function findMatch(state, matchId) {
    if (!matchId) return null;
    return getAllMatches(state).find(match => match.id === matchId) || null;
  }

  function getMatchContext(state, matchId) {
    const match = findMatch(state, matchId);
    if (!match) return null;
    const playerMap = new Map((state.players || []).map(player => [player.id, player]));
    const playerA = playerMap.get(match.playerAId);
    const playerB = playerMap.get(match.playerBId);
    if (!playerA || !playerB) return null;
    const summarize = player => ({
      id: player.id,
      nickname: player.nickname,
      group: player.group,
      avatarFile: player.avatarFile || "",
      avatarDataUrl: player.avatarDataUrl || ""
    });
    return {
      matchId: match.id,
      eventName: state.eventName || "",
      group: match.group,
      round: match.round,
      slot: match.slot,
      playerA: summarize(playerA),
      playerB: summarize(playerB)
    };
  }

  window.TournamentStore = {
    createDefaultState,
    loadState,
    saveState,
    getAllMatches,
    findMatch,
    getMatchContext,
    readTransferredState,
    transferState
  };
})();
