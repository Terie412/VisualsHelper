/* ============================================================
   相似度：按视觉相近程度挑干扰项
   ------------------------------------------------------------
   data/similarity.json 里是 48×48 的矩阵（LAB 颜色直方图交集）。
   出题时从「和当前图最相似的 10 张」里挑干扰项，
   不够 3 个不同答案就往外扩到 20、30…
   ============================================================ */

(function (global) {
  'use strict';

  var VH = global.VH = global.VH || {};

  var matrix = null;
  var count = 0;
  var orderCache = {};   // idx -> 按相似度降序的图号数组

  var state = {
    ready: false,
    reason: ''
  };

  function load() {
    return fetch('data/similarity.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.matrix)) throw new Error('bad data');

        matrix = data.matrix;
        count = data.count || matrix.length;

        if (VH.data && count !== VH.data.total) {
          // 图版数量变了，矩阵对不上，停用
          matrix = null;
          state.ready = false;
          state.reason = '图版数量与相似度矩阵不一致';
          return state;
        }

        state.ready = true;
        state.reason = '';
        return state;
      })
      .catch(function (err) {
        matrix = null;
        state.ready = false;
        state.reason = String(err && err.message || err);
        return state;
      });
  }

  /* 按相似度降序排好的图号（不含自己），结果缓存 */
  function ranked(idx) {
    if (orderCache[idx]) return orderCache[idx];

    var row = matrix[idx - 1];
    var list = [];

    for (var j = 0; j < row.length; j++) {
      if (j === idx - 1) continue;
      list.push(j + 1);
    }

    list.sort(function (a, b) {
      return row[b - 1] - row[a - 1];
    });

    orderCache[idx] = list;
    return list;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* 返回 [正确答案, 干扰1, 干扰2, 干扰3]；凑不齐则返回 null */
  function pickOptions(plate, answer, total) {
    if (!state.ready || !matrix) return null;

    var idx = plate.idx;
    if (idx < 1 || idx > matrix.length) return null;

    var rankedList = ranked(idx);
    var want = total - 1;
    var answerKey = VH.data.normalize(answer);

    for (var limit = 10; limit <= rankedList.length; limit += 10) {
      var seen = {};
      seen[answerKey] = true;

      var cands = [];

      for (var k = 0; k < limit && k < rankedList.length; k++) {
        var other = VH.data.plates[rankedList[k] - 1];
        if (!other) continue;

        var a = VH.data.answerOf(other);
        var key = VH.data.normalize(a);
        if (!key || seen[key]) continue;

        seen[key] = true;
        cands.push(a);
      }

      if (cands.length >= want) {
        shuffle(cands);
        return [answer].concat(cands.slice(0, want));
      }
    }

    return null;
  }

  VH.sim = {
    load: load,
    pickOptions: pickOptions,
    isReady: function () { return state.ready; },
    reason: function () { return state.reason; },
    /* 给调试用：某张图最像的 N 张 */
    topOf: function (idx, n) {
      if (!state.ready) return [];
      var list = ranked(idx).slice(0, n || 10);
      return list.map(function (j) {
        return { idx: j, score: matrix[idx - 1][j - 1] };
      });
    }
  };

})(window);
