(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TournamentCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const RESOLVED_STATUSES = new Set(["completed", "bye", "empty"]);

  function normalizeGroup(value) {
    const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    if (["A", "A组", "GROUPA"].includes(text)) return "A";
    if (["B", "B组", "GROUPB"].includes(text)) return "B";
    if (["C", "C组", "GROUPC"].includes(text)) return "C";
    return "";
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        if (row.some(value => value.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    row.push(field.replace(/\r$/, ""));
    if (row.some(value => value.trim() !== "")) rows.push(row);
    return rows;
  }

  function locateHeader(headers, aliases) {
    const normalized = headers.map(header => String(header || "").trim().toLowerCase());
    return normalized.findIndex(header => aliases.includes(header));
  }

  function parsePlayerRows(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("CSV 中没有可导入的选手数据。");

    const headers = rows[0];
    const columns = {
      id: locateHeader(headers, ["player_id", "id", "编号", "选手编号"]),
      nickname: locateHeader(headers, ["nickname", "name", "昵称", "选手昵称"]),
      group: locateHeader(headers, ["group", "组别", "分组"]),
      avatar: locateHeader(headers, ["avatar", "avatar_file", "头像", "头像文件"]),
      seed: locateHeader(headers, ["seed", "种子", "种子顺位"])
    };

    const missingHeaders = [];
    if (columns.id < 0) missingHeaders.push("player_id");
    if (columns.nickname < 0) missingHeaders.push("nickname");
    if (columns.group < 0) missingHeaders.push("group");
    if (missingHeaders.length) throw new Error(`缺少必填列：${missingHeaders.join("、")}`);

    const players = [];
    const errors = [];
    const seenIds = new Set();

    rows.slice(1).forEach((row, rowIndex) => {
      const line = rowIndex + 2;
      const id = String(row[columns.id] || "").trim();
      const nickname = String(row[columns.nickname] || "").trim();
      const group = normalizeGroup(row[columns.group]);
      const avatarFile = columns.avatar >= 0 ? String(row[columns.avatar] || "").trim() : "";
      const seedText = columns.seed >= 0 ? String(row[columns.seed] || "").trim() : "";
      const seedIsValidInteger = !seedText || /^\d+$/.test(seedText);
      const seed = seedText && seedIsValidInteger ? Number(seedText) : null;

      if (!id) errors.push(`第 ${line} 行：缺少 player_id。`);
      if (!nickname) errors.push(`第 ${line} 行：缺少 nickname。`);
      if (!group) errors.push(`第 ${line} 行：group 必须是 A、B 或 C。`);
      if (id && seenIds.has(id.toLowerCase())) errors.push(`第 ${line} 行：player_id“${id}”重复。`);
      if (seedText && (!seedIsValidInteger || !Number.isInteger(seed) || seed < 1)) errors.push(`第 ${line} 行：seed 必须是正整数。`);
      if (!id || !nickname || !group) return;

      seenIds.add(id.toLowerCase());
      players.push({
        id,
        nickname,
        group,
        avatarFile,
        avatarDataUrl: "",
        seed: Number.isInteger(seed) && seed > 0 ? seed : null,
        importOrder: players.length + 1,
        createdAt: new Date().toISOString()
      });
    });

    if (errors.length) throw new Error(errors.join("\n"));
    return players;
  }

  function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
  }

  function sortPlayersForBracket(players) {
    return [...players].sort((left, right) => {
      const leftSeed = left.seed || Number.MAX_SAFE_INTEGER;
      const rightSeed = right.seed || Number.MAX_SAFE_INTEGER;
      if (leftSeed !== rightSeed) return leftSeed - rightSeed;
      return (left.importOrder || 0) - (right.importOrder || 0) || left.nickname.localeCompare(right.nickname, "zh-CN");
    });
  }

  function buildSeedOrder(size) {
    if (size <= 1) return [1];
    let order = [1, 2];
    for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
      const next = [];
      order.forEach(seed => {
        next.push(seed, currentSize + 1 - seed);
      });
      order = next;
    }
    return order;
  }

  function recomputeBracket(bracket) {
    bracket.rounds.forEach((round, roundIndex) => {
      round.forEach((match, matchIndex) => {
        let feedersResolved = true;
        if (roundIndex > 0) {
          const previousRound = bracket.rounds[roundIndex - 1];
          const feederA = previousRound[matchIndex * 2];
          const feederB = previousRound[matchIndex * 2 + 1];
          const nextPlayerAId = feederA?.winnerId || null;
          const nextPlayerBId = feederB?.winnerId || null;
          const participantsChanged = match.playerAId !== nextPlayerAId || match.playerBId !== nextPlayerBId;
          if (participantsChanged) {
            if (match.decision === "manual") {
              match.winnerId = null;
              match.decision = null;
            }
            match.bpResult = null;
            match.resultConfirmedAt = null;
          }
          match.playerAId = nextPlayerAId;
          match.playerBId = nextPlayerBId;
          feedersResolved = Boolean(feederA && feederB && RESOLVED_STATUSES.has(feederA.status) && RESOLVED_STATUSES.has(feederB.status));
        }

        const entrants = [match.playerAId, match.playerBId].filter(Boolean);
        if (match.winnerId && !entrants.includes(match.winnerId)) {
          match.winnerId = null;
          match.decision = null;
          match.bpResult = null;
          match.resultConfirmedAt = null;
        }

        if (entrants.length === 2) {
          if (match.winnerId) {
            match.status = "completed";
            match.decision = "manual";
          } else {
            match.status = "ready";
          }
        } else if (entrants.length === 1 && feedersResolved) {
          match.winnerId = entrants[0];
          match.decision = "bye";
          match.status = "bye";
        } else if (entrants.length === 0 && feedersResolved) {
          match.winnerId = null;
          match.decision = null;
          match.status = "empty";
        } else {
          match.winnerId = null;
          match.decision = null;
          match.status = "pending";
        }
      });
    });
  }

  function createBracket(group, players) {
    const ordered = sortPlayersForBracket(players);
    const size = nextPowerOfTwo(ordered.length);
    const roundCount = Math.log2(size);
    const rounds = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matchCount = size / Math.pow(2, roundIndex + 1);
      const round = [];
      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        round.push({
          id: `${group}-R${roundIndex + 1}-M${matchIndex + 1}`,
          group,
          round: roundIndex + 1,
          slot: matchIndex + 1,
          playerAId: null,
          playerBId: null,
          winnerId: null,
          decision: null,
          status: "pending",
          bpResult: null,
          resultConfirmedAt: null
        });
      }
      rounds.push(round);
    }

    const seedOrder = buildSeedOrder(size);
    rounds[0].forEach((match, index) => {
      match.playerAId = ordered[seedOrder[index * 2] - 1]?.id || null;
      match.playerBId = ordered[seedOrder[index * 2 + 1] - 1]?.id || null;
    });

    const bracket = { group, size, createdAt: new Date().toISOString(), rounds };
    recomputeBracket(bracket);
    return bracket;
  }

  function getAllMatches(state) {
    return Object.values(state?.brackets || {}).flatMap(bracket =>
      (bracket?.rounds || []).flatMap(round => round || [])
    );
  }

  function findReadyMatchForPlayers(state, group, firstPlayerId, secondPlayerId) {
    const wanted = new Set([String(firstPlayerId || ""), String(secondPlayerId || "")]);
    if (wanted.size !== 2 || wanted.has("")) return null;
    return getAllMatches(state).find(match => {
      if (match.group !== group || match.status !== "ready") return false;
      const entrants = new Set([String(match.playerAId || ""), String(match.playerBId || "")]);
      return entrants.size === 2 && [...wanted].every(id => entrants.has(id));
    }) || null;
  }

  function assignRandomSides(firstPlayer, secondPlayer, random = Math.random) {
    if (!firstPlayer || !secondPlayer || firstPlayer.id === secondPlayer.id) {
      throw new Error("随机分配 A/B 需要两名不同的选手。");
    }
    return random() < 0.5
      ? { playerA: firstPlayer, playerB: secondPlayer }
      : { playerA: secondPlayer, playerB: firstPlayer };
  }

  function collectPlayerPickHistory(state, playerId, excludeMatchId = null) {
    const pickedSongIds = new Set();
    getAllMatches(state).forEach(match => {
      if (!match?.winnerId || !match.bpResult || match.id === excludeMatchId) return;
      const result = match.bpResult;
      const playerAId = String(result.playerAId || match.playerAId || "");
      const playerBId = String(result.playerBId || match.playerBId || "");
      let picks = [];
      if (playerAId === String(playerId)) picks = result.picks?.A || [];
      else if (playerBId === String(playerId)) picks = result.picks?.B || [];
      picks.forEach(song => {
        const songId = String(song?.id || "").trim();
        if (songId) pickedSongIds.add(songId);
      });
    });
    return [...pickedSongIds];
  }

  return {
    normalizeGroup,
    parseCsv,
    parsePlayerRows,
    nextPowerOfTwo,
    sortPlayersForBracket,
    buildSeedOrder,
    createBracket,
    recomputeBracket,
    getAllMatches,
    findReadyMatchForPlayers,
    assignRandomSides,
    collectPlayerPickHistory
  };
});
