/* ============================================================
   本地存储
   ------------------------------------------------------------
   主存储是 data/layout.json，通过 /api/data 读写，和 origin 无关。
   没有服务器时（双击 index.html）退回 localStorage。
   localStorage 同时留一份备份，方便从旧地址迁移。
   ============================================================ */

(function (global) {
  'use strict';

  var API = '/api/data';
  var LOCAL_KEY = 'vh.state.v1';

  /* 旧版本按 key 分散存的，读取时兼容一下 */
  var LEGACY = {
    grid: 'vh.grid.v2',
    rowNotes: 'vh.rowNotes.v1',
    answers: 'vh.answers.v1',
    size: 'vh.cardSize.v1',
    showAnswers: 'vh.showAnswers.v1',
    settings: 'vh.settings.v1'
  };

  var DEFAULTS = { count: 12, limit: 15, allow: 1, sim: true };

  var state = null;
  var mode = 'local';       // 'file' | 'local'
  var saveTimer = 0;
  var available = true;

  /* ---------------------------------------------------------- 底层 */

  function readRaw(key) {
    try { return global.localStorage.getItem(key); }
    catch (e) { return null; }
  }

  function writeRaw(key, val) {
    try { global.localStorage.setItem(key, val); return true; }
    catch (e) { available = false; return false; }
  }

  function getJSON(key, fallback) {
    var raw = readRaw(key);
    if (raw == null) return fallback;
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function clampInt(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    return n < min ? min : (n > max ? max : n);
  }

  /* ---------------------------------------------------------- 读本地 */

  function readLocal() {
    var merged = getJSON(LOCAL_KEY, null);
    if (merged && typeof merged === 'object' && !Array.isArray(merged)) {
      return merged;
    }

    // 兼容旧格式
    var legacyGrid = getJSON(LEGACY.grid, null);
    var legacyNotes = getJSON(LEGACY.rowNotes, {});
    var legacyAnswers = getJSON(LEGACY.answers, {});
    var legacySize = Number(readRaw(LEGACY.size));
    var legacyShow = getJSON(LEGACY.showAnswers, true);
    var legacySettings = getJSON(LEGACY.settings, {});

    var hasAny = !!legacyGrid
      || Object.keys(legacyNotes || {}).length > 0
      || Object.keys(legacyAnswers || {}).length > 0
      || isFinite(legacySize);

    if (!hasAny) return null;

    return {
      grid: legacyGrid,
      rowNotes: legacyNotes,
      answers: legacyAnswers,
      cardSize: isFinite(legacySize) ? legacySize : 180,
      showAnswers: legacyShow !== false,
      settings: legacySettings
    };
  }

  function writeLocal() {
    writeRaw(LOCAL_KEY, JSON.stringify(state));
  }

  /* ---------------------------------------------------------- 写文件 */

  function pushToFile() {
    if (mode !== 'file') return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        }).catch(function () { /* 网络抖动就算了，本地还有备份 */ });
      } catch (e) { /* ignore */ }
    }, 220);
  }

  function persist() {
    writeLocal();
    pushToFile();
  }

  /* 立刻写入，不等防抖。刷新/跳转前要先等它完成 */
  function flush() {
    writeLocal();

    if (mode !== 'file') return Promise.resolve(false);

    clearTimeout(saveTimer);
    try {
      return fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).then(function (r) { return !!r.ok; })
        .catch(function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* 图版清单：只留必要字段，脏数据直接丢掉 */
  function cleanPlateList(list) {
    return (Array.isArray(list) ? list : []).map(function (it) {
      if (!it || it.idx == null || !it.stem) return null;
      return {
        idx: Number(it.idx),
        stem: String(it.stem),
        ext: it.ext ? String(it.ext) : 'jpg',
        name: it.name ? String(it.name) : ''
      };
    }).filter(function (it) {
      return it && isFinite(it.idx) && it.idx > 0;
    });
  }

  function platesList() {
    return cleanPlateList(ensure().plates);
  }

  function ensure() {
    if (!state) state = {};
    if (!state.rowNotes) state.rowNotes = {};
    if (!state.answers) state.answers = {};
    if (!state.rowSkip) state.rowSkip = {};
    return state;
  }

  /* ---------------------------------------------------------- 启动 */

  function boot() {
    return fetch(API, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (remote) {
        var hasRemote = remote && typeof remote === 'object' && Object.keys(remote).length > 0;

        if (hasRemote) {
          state = remote;
          mode = 'file';
          writeLocal();               // 文件为准，本地留备份
          return mode;
        }

        // 服务器上还没有文件：把浏览器里的旧数据搬过去
        var local = readLocal();
        state = local || {};
        mode = 'file';
        if (local) {
          writeLocal();
          pushToFile();
        }
        return mode;
      })
      .catch(function () {
        // 没有服务器（file:// 打开）：退回 localStorage
        state = readLocal() || {};
        mode = 'local';
        return mode;
      });
  }

  /* ---------------------------------------------------------- 对外 */

  global.VH = global.VH || {};

  global.VH.store = {

    boot: boot,

    /* --- 学习页布局 --- */
    loadGrid: function () {
      var s = ensure();
      return (s.grid && typeof s.grid === 'object' && !Array.isArray(s.grid)) ? s.grid : null;
    },

    saveGrid: function (g) {
      ensure().grid = g;
      persist();
    },

    clearGrid: function () {
      delete ensure().grid;
      persist();
    },

    /* --- 行备注 --- */
    loadRowNotes: function () {
      var m = ensure().rowNotes;
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    },

    saveRowNotes: function (m) {
      ensure().rowNotes = m || {};
      persist();
    },

    /* --- 整行不参与考试（行索引 -> true） --- */
    loadRowSkip: function () {
      var m = ensure().rowSkip;
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    },

    saveRowSkip: function (m) {
      ensure().rowSkip = m || {};
      persist();
    },

    /* --- 答案开关 --- */
    showAnswers: function () {
      return ensure().showAnswers !== false;
    },

    saveShowAnswers: function (on) {
      ensure().showAnswers = !!on;
      persist();
    },

    /* --- 卡片尺寸 --- */
    cardSize: function () {
      var v = Number(ensure().cardSize);
      return (isFinite(v) && v >= 100 && v <= 400) ? v : 180;
    },

    saveCardSize: function (v) {
      ensure().cardSize = Number(v);
      persist();
    },

    /* --- 考试参数 --- */
    settings: function () {
      var s = ensure().settings || {};
      return {
        count: clampInt(s.count, 4, 60, DEFAULTS.count),
        limit: clampInt(s.limit, 3, 30, DEFAULTS.limit),
        allow: clampInt(s.allow, 0, 10, DEFAULTS.allow),
        sim: s.sim !== false
      };
    },

    saveSettings: function (s) {
      ensure().settings = {
        count: clampInt(s.count, 4, 60, DEFAULTS.count),
        limit: clampInt(s.limit, 3, 30, DEFAULTS.limit),
        allow: clampInt(s.allow, 0, 10, DEFAULTS.allow),
        sim: s.sim !== false
      };
      persist();
    },

    /* --- 答案覆盖 --- */
    answers: function () {
      var m = ensure().answers;
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    },

    saveAnswers: function (m) {
      ensure().answers = m || {};
      persist();
    },

    answerOverride: function (idx) {
      var m = ensure().answers || {};
      var v = m[String(idx)];
      return v == null ? null : String(v);
    },

    setAnswerOverride: function (idx, val) {
      var s = ensure();
      if (!s.answers) s.answers = {};
      if (val === '' || val == null) delete s.answers[String(idx)];
      else s.answers[String(idx)] = String(val);
      persist();
    },

    clearAnswerOverrides: function () {
      ensure().answers = {};
      persist();
    },

    answerCount: function () {
      return Object.keys(ensure().answers || {}).length;
    },

    /* --- 导入的图版清单 ---
       图片本身在 temp/plates/（映射目录，不入库），
       这里只记「导入了哪几张、各自是什么扩展名」，页面按清单取图。 */
    platesList: platesList,

    savePlatesList: function (list) {
      var s = ensure();
      var clean = cleanPlateList(list);

      if (clean.length) s.plates = clean;
      else delete s.plates;

      persist();
    },

    platesSourceDir: function () {
      var d = ensure().platesSource;
      return typeof d === 'string' ? d : '';
    },

    savePlatesSourceDir: function (dir) {
      var s = ensure();
      if (dir) s.platesSource = String(dir);
      else delete s.platesSource;
      persist();
    },

    customPlates: function () {
      return platesList().length > 0;
    },

    platesCount: function () {
      return platesList().length;
    },

    /* 立刻提交待写的数据，返回 Promise */
    flush: flush,

    /* 换一套新图版时，旧的排列、行备注、行勾选、答案都不再有意义 */
    resetForNewPlates: function () {
      var s = ensure();
      delete s.grid;
      delete s.rowNotes;
      delete s.rowSkip;
      s.answers = {};
      persist();
    },

    /* --- 状态 --- */
    mode: function () { return mode; },

    isAvailable: function () { return available; },

    /* 导出当前全量数据（备份用） */
    snapshot: function () {
      return JSON.parse(JSON.stringify(ensure()));
    },

    /* 用一份数据覆盖当前状态 */
    restore: function (data) {
      if (!data || typeof data !== 'object') return false;
      state = data;
      ensure();
      persist();
      return true;
    }
  };

})(window);
