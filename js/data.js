/* ============================================================
   题库配置
   ------------------------------------------------------------
   图由使用者自己导入，落在 temp/plates/，文件名 001.jpg … 048.jpg
   答案在学习页点答案条逐张标注，存在 data/layout.json

   数字答案 → 考试用数字键盘判分
   图形答案 → 只出现在学习页，不参与自动判分（体检时由医生口述判断）
   空答案   → 图版本身对比度极低，正常色觉通常看不出，留空待你自己确认
   ============================================================ */

var VH_CONFIG = {

  /* 图的总张数：没导入图版时，就按这个数摆占位格子 */
  plateCount: 48,

  /* 文件名数字补零位数 */
  namePad: 3,

  /* 导入的图片被复制到这个映射目录（相对项目根），实际读哪张由导入清单决定 */
  plateDir: 'temp/plates/',

  /* ======= 答案 ======= */
  answers: {
    1: '21',
    2: '52',
    3: '69',
    4: '00',
    5: '三角形和方形',
    6: '三角形和方形',
    7: '86',
    8: '茶壶',
    9: '两个五角星',
    10: '522',

    11: '825',
    12: '58',
    13: '09',
    14: '圆',
    15: '圆',
    16: '圆',
    17: '圆',
    18: '圆',
    19: '兔子',
    20: '蝴蝶',

    21: '圈和剪刀',
    22: '899022',
    23: '621989',
    24: '蜻蜓',
    25: '鸭子',
    26: '金鱼',
    27: '飞鸟',
    28: '羊',
    29: '8609',
    30: '熊猫',

    31: '三角形和圆',
    32: '圆环',
    33: '牛',
    34: '268',
    35: '985',
    36: '6289',
    37: '6098',
    38: '2901',
    39: '162',
    40: '916',

    41: '56',
    42: '628',
    43: '602',
    44: '909',
    45: '29',
    46: '69',
    47: '88',
    48: '60'
  },

  /* 非数字答案的图，想让它进考试就在这里配选项；不配就只在学习页展示 */
  choices: {
    // 8: ['茶壶', '杯子', '锅', '看不清'],
  },

  /* 每张图的备注，显示在学习页灯箱里 */
  notes: {
    4: '两个零，注意区分 0 和 O。',
    22: '六位数字，对比度极低——把红绿补偿拉到 100% 才看得清。',
    23: '六位数字，对比度极低——把红绿补偿拉到 100% 才看得清。',
    38: '四位数字，对比度很低，三角形拼成的笔画要盯几秒才出来。',
    5: '图形题：看清左右两个图形分别是什么。',
    6: '图形题：看清左右两个图形分别是什么。',
    9: '图形题：两个五角星。',
    14: '整版只有一个圆，没有隐藏数字。'
  }
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

  /* 图版是不是自己导入的（导入后就不再套用配置里的默认答案） */
  function customPlates() {
    var st = global.VH && global.VH.store;
    return !!(st && st.customPlates && st.customPlates());
  }

  function padNum(n) {
    var s = String(n);
    while (s.length < PAD) s = '0' + s;
    return s;
  }

  function plainNumberAnswer(v) {
    return /^[0-9]+$/.test(v);
  }

  function choicesOf(idx) {
    var c = C.choices && C.choices[idx];
    return Array.isArray(c) ? c.slice() : null;
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
      src: src,
      choices: choicesOf(idx),
      note: (C.notes && C.notes[idx]) || ''
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

  /* 正式答案：配置里的值 */
  function configAnswer(idx) {
    var a = C.answers ? C.answers[idx] : '';
    return a == null ? '' : String(a).trim();
  }

  /* 有效答案：学习页手动改过的优先 */
  function answerOf(plate) {
    var store = global.VH && global.VH.store;
    var ov = store ? store.answerOverride(plate.idx) : null;
    if (ov != null && ov !== '') return ov;
    // 自备图版和书上的图不是一套，配置里的答案对不上，只认手动标注
    if (customPlates()) return '';
    return configAnswer(plate.idx);
  }

  /* 判分用的归一化：全角转半角、去空白和标点 */
  function normalize(v) {
    if (v == null) return '';
    var s = String(v).replace(/[\uFF10-\uFF19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    return s.replace(/[\s,，。、.·:：;；'"“”‘’]/g, '').toUpperCase();
  }

  /* 答题形式：number 数字键盘 / choice 选项按钮 / none 不参与考试 */
  function kindOf(plate) {
    var a = normalize(answerOf(plate));
    if (!a) return 'none';
    if (plate.choices && plate.choices.length) return 'choice';
    if (plainNumberAnswer(a)) return 'number';
    return 'none';
  }

  function examinable() {
    return plates.filter(function (p) {
      return normalize(answerOf(p)) !== '';
    });
  }

  /* 候选答案池：数字和图形分开，避免出现「21 / 牛 / 茶壶」这种一眼能排除的选项 */
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
    kindOf: kindOf,
    examinable: examinable,
    applyImage: applyImage,
    imageUrl: imageUrl,
    answerPools: answerPools,
    isCustom: customPlates,
    rebuild: rebuild
  };

})(window);
