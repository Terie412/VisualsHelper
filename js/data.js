/* ============================================================
   题库配置
   ------------------------------------------------------------
   图由使用者自己导入，复制到 temp/plates/，编号 001、002 …
   答案在学习页点答案条逐张标注，存在 data/layout.json
   没导入图版时，就按 plateCount 摆同样多的占位格子
   ============================================================ */

var VH_CONFIG = {

  /* 没导入图版时摆多少个占位格子 */
  plateCount: 48,

  /* 文件名数字补零位数 */
  namePad: 3,

  /* 导入的图片存放在这里（相对项目根），实际读哪张由导入清单决定 */
  plateDir: 'temp/plates/'
};

/* ============================================================
   以下为程序逻辑，一般不用改
   ============================================================ */

(function (global) {
  'use strict';

  var C = global.VH_CONFIG || {};

  var PLATE_DIR = C.plateDir != null ? C.plateDir : 'temp/plates/';
  var PAD = C.namePad != null ? C.namePad : 3;
  var SLOTS = C.plateCount != null ? Number(C.plateCount) : 48;

  function padNum(n) {
    var s = String(n);
    while (s.length < PAD) s = '0' + s;
    return s;
  }

  function plainNumberAnswer(v) {
    return /^[0-9]+$/.test(v);
  }

  /* 一张图：entry 来自导入清单（{idx, stem, ext}），没有 entry 就是空位 */
  function makePlate(idx, entry) {
    var stem = entry && entry.stem ? String(entry.stem) : padNum(idx);
    var src = '';

    if (entry) {
      if (entry.src) src = entry.src;
      else if (stem) src = PLATE_DIR + stem + '.' + (entry.ext || 'jpg');
    }

    return {
      idx: idx,
      id: 'p' + idx,
      stem: stem,
      fileName: entry && entry.name ? String(entry.name) : '',
      src: src
    };
  }

  /* 没有任何导入记录时：只摆出占位格子，不猜任何文件 */
  function emptySlots(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(makePlate(i, null));
    return out;
  }

  /* 有导入记录时：读哪几张、顺序如何，完全由清单决定 */
  function buildPlates() {
    var st = global.VH && global.VH.store;
    var list = (st && st.platesList) ? st.platesList() : [];

    if (list && list.length) {
      return list.map(function (entry) {
        return makePlate(Number(entry.idx), entry);
      });
    }
    return emptySlots(isFinite(SLOTS) && SLOTS > 0 ? SLOTS : 0);
  }

  var plates = buildPlates();

  /* 答案只有一处来源：学习页手动标注的（存在 data/layout.json） */
  function answerOf(plate) {
    var store = global.VH && global.VH.store;
    var ov = store ? store.answerOverride(plate.idx) : null;
    return (ov == null || ov === '') ? '' : String(ov);
  }

  /* 判分用的归一化：全角转半角、去空白和标点 */
  function normalize(v) {
    if (v == null) return '';
    var s = String(v).replace(/[\uFF10-\uFF19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    return s.replace(/[\s,，。、.·:：;；'"“”‘’]/g, '').toUpperCase();
  }

  function examinable() {
    return plates.filter(function (p) {
      return normalize(answerOf(p)) !== '';
    });
  }

  /* 候选答案池：数字和文字分开，避免「21 / 牛 / 茶壶」这种一眼能排除的组合 */
  function answerPools() {
    var nums = [];
    var figs = [];
    var seen = {};

    plates.forEach(function (p) {
      var raw = answerOf(p);
      var key = normalize(raw);
      if (!key || seen[key]) return;
      seen[key] = true;

      if (plainNumberAnswer(key)) nums.push(raw);
      else figs.push(raw);
    });

    return { numbers: nums, figures: figs };
  }

  /* 图片地址：清单里写的是哪张就读哪张，不做任何猜测 */
  function imageUrl(plate) {
    return plate.src || '';
  }

  /* ------------------------------------------------------------
     图片加载：一张图只有一个地址，加载失败就是缺图
     ------------------------------------------------------------ */

  var resolveCache = {};   // id -> url | null
  var pending = {};        // id -> [callbacks]

  function resolveImage(plate, cb) {
    if (plate.id in resolveCache) {
      cb(resolveCache[plate.id]);
      return;
    }

    if (!plate.src) {
      resolveCache[plate.id] = null;
      cb(null);
      return;
    }

    if (pending[plate.id]) {
      pending[plate.id].push(cb);
      return;
    }
    pending[plate.id] = [cb];

    var probe = new Image();

    function done(url) {
      resolveCache[plate.id] = url;
      var queue = pending[plate.id] || [];
      delete pending[plate.id];
      queue.forEach(function (fn) { fn(url); });
    }

    probe.onload = function () { done(probe.src); };
    probe.onerror = function () { done(null); };
    probe.src = plate.src;
  }

  function applyImage(img, plate, onMissing) {
    resolveImage(plate, function (url) {
      if (url) {
        img.src = url;
        img.style.display = '';
        if (onMissing) onMissing(false);
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        if (onMissing) onMissing(true);
      }
    });
  }

  /* ------------------------------------------------------------
     导入 / 清空图版后重建清单，并清掉图片加载缓存
     ------------------------------------------------------------ */

  function rebuild() {
    plates = buildPlates();
    resolveCache = {};
    pending = {};

    var api = global.VH && global.VH.data;
    if (api) {
      api.plates = plates;
      api.total = plates.length;
    }
    return plates;
  }

  global.VH = global.VH || {};
  global.VH.data = {
    plates: plates,
    total: plates.length,
    answerOf: answerOf,
    normalize: normalize,
    examinable: examinable,
    applyImage: applyImage,
    imageUrl: imageUrl,
    answerPools: answerPools,
    rebuild: rebuild
  };

})(window);
