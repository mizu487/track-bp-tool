(function (root, factory) {
  const tournamentCore = root?.TournamentCore || (typeof require === "function" ? require("./tournament-core.js") : null);
  const api = factory(tournamentCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SongCore = api;
})(typeof window !== "undefined" ? window : globalThis, function (TournamentCore) {
  "use strict";

  if (!TournamentCore) throw new Error("TournamentCore is required before SongCore.");

  const GROUPS = ["A", "B", "C"];
  const POOLS = ["self", "random"];
  const DIFFICULTIES = ["Basic", "Advanced", "Expert", "Master", "Re:Master"];
  const DIVING_FISH_MUSIC_URL = "https://www.diving-fish.com/api/maimaidxprober/music_data";

  function splitMultiValue(value) {
    return String(value || "")
      .split(/[|;；、/]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizePool(value) {
    const text = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    if (["self", "pick", "select", "自选", "自选池"].includes(text)) return "self";
    if (["random", "rand", "随机", "随机池"].includes(text)) return "random";
    return "";
  }

  function normalizeDifficulty(value) {
    const text = String(value || "").trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
    if (text === "expert" || text === "exp") return "Expert";
    if (text === "master" || text === "mas") return "Master";
    if (["re:master", "re master", "remaster", "remas"].includes(text)) return "Re:Master";
    return "";
  }

  function locateHeader(headers, aliases) {
    const normalized = headers.map(header => String(header || "").trim().toLowerCase());
    return normalized.findIndex(header => aliases.includes(header));
  }

  function parseBoolean(value) {
    const text = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "y", "是"].includes(text);
  }

  function parseOptionalNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function parseSongRows(text) {
    const rows = TournamentCore.parseCsv(text);
    if (rows.length < 2) throw new Error("CSV 中没有可导入的曲目数据。");

    const headers = rows[0];
    const columns = {
      id: locateHeader(headers, ["song_id", "id", "曲目编号", "歌曲编号"]),
      title: locateHeader(headers, ["title", "song", "曲名", "歌曲名"]),
      groups: locateHeader(headers, ["groups", "group", "组别", "所属组别"]),
      pools: locateHeader(headers, ["pools", "pool", "曲池", "所属曲池"]),
      difficulty: locateHeader(headers, ["difficulty", "diff", "难度"]),
      level: locateHeader(headers, ["level", "具体等级", "等级"]),
      cover: locateHeader(headers, ["cover", "cover_file", "封面", "封面文件"]),
      source: locateHeader(headers, ["source", "数据来源"]),
      sourceSongId: locateHeader(headers, ["source_song_id", "external_song_id", "来源歌曲id"]),
      sourceChartId: locateHeader(headers, ["source_chart_id", "external_chart_id", "来源谱面id"]),
      chartType: locateHeader(headers, ["type", "chart_type", "谱面类型"]),
      ds: locateHeader(headers, ["ds", "constant", "定数"]),
      artist: locateHeader(headers, ["artist", "曲师"]),
      genre: locateHeader(headers, ["genre", "分类"]),
      bpm: locateHeader(headers, ["bpm"]),
      version: locateHeader(headers, ["version", "from", "收录版本"]),
      isNew: locateHeader(headers, ["is_new", "是否新曲"])
    };

    const required = ["id", "title", "groups", "pools", "difficulty", "level"];
    const missing = required.filter(key => columns[key] < 0).map(key => ({
      id: "song_id",
      title: "title",
      groups: "groups",
      pools: "pools",
      difficulty: "difficulty",
      level: "level"
    })[key]);
    if (missing.length) throw new Error(`缺少必填列：${missing.join("、")}`);

    const songs = [];
    const errors = [];
    const seenIds = new Set();

    rows.slice(1).forEach((row, rowIndex) => {
      const line = rowIndex + 2;
      const id = String(row[columns.id] || "").trim();
      const title = String(row[columns.title] || "").trim();
      const groupTokens = splitMultiValue(row[columns.groups]);
      const poolTokens = splitMultiValue(row[columns.pools]);
      const groups = [...new Set(groupTokens.map(TournamentCore.normalizeGroup).filter(Boolean))];
      const pools = [...new Set(poolTokens.map(normalizePool).filter(Boolean))];
      const difficulty = normalizeDifficulty(row[columns.difficulty]);
      const level = String(row[columns.level] || "").trim();
      const coverFile = columns.cover >= 0 ? String(row[columns.cover] || "").trim() : "";
      const source = columns.source >= 0 ? String(row[columns.source] || "").trim() : "";
      const sourceSongId = columns.sourceSongId >= 0 ? String(row[columns.sourceSongId] || "").trim() : "";
      const sourceChartId = columns.sourceChartId >= 0 ? String(row[columns.sourceChartId] || "").trim() : "";
      const chartType = columns.chartType >= 0 ? String(row[columns.chartType] || "").trim().toUpperCase() : "";
      const dsValue = columns.ds >= 0 ? parseOptionalNumber(row[columns.ds]) : null;
      const bpmValue = columns.bpm >= 0 ? parseOptionalNumber(row[columns.bpm]) : null;

      if (!id) errors.push(`第 ${line} 行：缺少 song_id。`);
      if (!title) errors.push(`第 ${line} 行：缺少 title。`);
      if (!groupTokens.length || groups.length !== new Set(groupTokens.map(item => item.trim().toUpperCase())).size) {
        const invalidGroups = groupTokens.filter(item => !TournamentCore.normalizeGroup(item));
        if (!groupTokens.length || invalidGroups.length) errors.push(`第 ${line} 行：groups 只能包含 A、B、C，并用 | 分隔。`);
      }
      if (!poolTokens.length || poolTokens.some(item => !normalizePool(item))) {
        errors.push(`第 ${line} 行：pools 只能包含 self、random，并用 | 分隔。`);
      }
      if (!difficulty) errors.push(`第 ${line} 行：difficulty 必须是 Expert、Master 或 Re:Master。`);
      if (!level) errors.push(`第 ${line} 行：缺少 level。`);
      if (id && seenIds.has(id.toLowerCase())) errors.push(`第 ${line} 行：song_id“${id}”重复。`);
      if (!id || !title || !groups.length || !pools.length || !difficulty || !level) return;

      seenIds.add(id.toLowerCase());
      songs.push({
        id,
        title,
        groups: groups.filter(group => GROUPS.includes(group)),
        pools: pools.filter(pool => POOLS.includes(pool)),
        difficulty,
        level,
        coverFile,
        coverDataUrl: "",
        source,
        sourceSongId,
        sourceChartId,
        chartType: ["SD", "DX"].includes(chartType) ? chartType : "",
        ds: dsValue,
        artist: columns.artist >= 0 ? String(row[columns.artist] || "").trim() : "",
        genre: columns.genre >= 0 ? String(row[columns.genre] || "").trim() : "",
        bpm: bpmValue,
        version: columns.version >= 0 ? String(row[columns.version] || "").trim() : "",
        isNew: columns.isNew >= 0 ? parseBoolean(row[columns.isNew]) : false,
        importOrder: songs.length + 1,
        createdAt: new Date().toISOString()
      });
    });

    if (errors.length) throw new Error(errors.join("\n"));
    return songs;
  }

  function divingFishCoverId(songId) {
    let numericId = Number.parseInt(songId, 10);
    if (!Number.isFinite(numericId)) return "";
    if (numericId > 10000 && numericId <= 11000) numericId -= 10000;
    return String(numericId).padStart(5, "0");
  }

  function divingFishCoverUrl(songId) {
    const coverId = divingFishCoverId(songId);
    return coverId ? `https://www.diving-fish.com/covers/${coverId}.png` : "";
  }

  function fromDivingFishMusicData(payload, difficultyIndexes = [2, 3, 4]) {
    if (!Array.isArray(payload)) throw new Error("Diving-Fish 返回的数据不是歌曲列表。");
    const wantedIndexes = [...new Set(difficultyIndexes)]
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < DIFFICULTIES.length);
    if (!wantedIndexes.length) throw new Error("请至少选择一个要导入的难度。");

    const songs = [];
    const seenChartIds = new Set();
    payload.forEach(music => {
      if (!music || typeof music !== "object") return;
      const sourceSongId = String(music.id ?? "").trim();
      const title = String(music.title || music.basic_info?.title || "").trim();
      const chartType = String(music.type || "").trim().toUpperCase();
      if (!sourceSongId || !title || !["SD", "DX"].includes(chartType)) return;

      wantedIndexes.forEach(index => {
        const sourceChartId = String(music.cids?.[index] ?? "").trim();
        const level = String(music.level?.[index] ?? "").trim();
        if (!sourceChartId || !level || seenChartIds.has(sourceChartId)) return;
        const dsValue = Number(music.ds?.[index]);
        const bpmValue = Number(music.basic_info?.bpm);
        seenChartIds.add(sourceChartId);
        songs.push({
          id: `df-${sourceChartId}`,
          title,
          groups: [],
          pools: [],
          difficulty: DIFFICULTIES[index],
          level,
          coverFile: divingFishCoverUrl(sourceSongId),
          coverDataUrl: "",
          source: "diving-fish",
          sourceSongId,
          sourceChartId,
          chartIndex: index,
          chartType,
          ds: Number.isFinite(dsValue) ? dsValue : null,
          artist: String(music.basic_info?.artist || "").trim(),
          genre: String(music.basic_info?.genre || "").trim(),
          bpm: Number.isFinite(bpmValue) ? bpmValue : null,
          version: String(music.basic_info?.from || "").trim(),
          isNew: Boolean(music.basic_info?.is_new)
        });
      });
    });

    if (!songs.length) throw new Error("没有从 Diving-Fish 数据中找到符合所选难度的谱面。");
    return songs;
  }

  function getSongsFor(songs, group, pool) {
    return (songs || []).filter(song => song.groups?.includes(group) && song.pools?.includes(pool));
  }

  function getPoolCounts(songs) {
    const counts = {};
    GROUPS.forEach(group => {
      counts[group] = {
        self: getSongsFor(songs, group, "self").length,
        random: getSongsFor(songs, group, "random").length
      };
    });
    return counts;
  }

  function sampleWithoutReplacement(items, count, random = Math.random) {
    if (!Number.isInteger(count) || count < 0) throw new Error("抽取数量必须是非负整数。");
    if (items.length < count) throw new Error(`随机池只有 ${items.length} 首，无法抽取 ${count} 首不重复曲目。`);
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy.slice(0, count);
  }

  return {
    GROUPS,
    POOLS,
    DIFFICULTIES,
    DIVING_FISH_MUSIC_URL,
    splitMultiValue,
    normalizePool,
    normalizeDifficulty,
    parseSongRows,
    divingFishCoverId,
    divingFishCoverUrl,
    fromDivingFishMusicData,
    getSongsFor,
    getPoolCounts,
    sampleWithoutReplacement
  };
});
