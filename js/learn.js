/* ============================================================
   学习页：无限二维格子拖拽
   ------------------------------------------------------------
   位置用稀疏坐标存：{ id: [row, col] }，行列不设上限。
   改尺寸只改像素大小；拖到边缘画布自动扩展并滚动。
   ============================================================ */

(function (global) {
  'use strict';

  var VH = global.VH;

  var PAD = 28;        // 画布内边距
  var GAP = 18;        // 格子间距
  var ANSWER_H = 32;   // 答案条高度，与 CSS 保持一致
  var MAX_COORD = 999; // 行列上限，纯粹防手滑
  var NOTE_W = 96;     // 行备注框宽度
  var NOTE_GAP = 20;   // 备注框与第一列卡片的间距

  var wrap, canvas, preview, ghost;
  var plates = [];
  var cardMap = {};    // id -> 卡片元素
  var posMap = {};     // id -> {r, c}
  var cellMap = {};    // "r,c" -> id
  var rowNotes = {};   // 行索引 -> 备注文字
  var rowSkip = {};    // 行索引 -> true 表示这一行不参与考试
  var noteEls = [];    // 行索引 -> 备注框元素
  var size = 180;
  var cols = 6;          // 初始列数，只用于默认排布和补位
  var showAnswers = true;
  var built = false;

  function cardHeight() { return size + ANSWER_H; }
  function cellW() { return size + GAP; }
  function cellH() { return cardHeight() + GAP; }
  function cellKey(r, c) { return r + ',' + c; }

  /* 第一列卡片的左边缘，给行备注让出位置 */
  function gridOrigin() { return PAD + NOTE_W + NOTE_GAP; }

  /* ---------------------------------------------------------- 坐标 */

  function occupantAt(r, c) {
    return cellMap[cellKey(r, c)] || null;
  }

  function moveCard(id, r, c) {
    var old = posMap[id];
    if (old) delete cellMap[cellKey(old.r, old.c)];
    posMap[id] = { r: r, c: c };
    cellMap[cellKey(r, c)] = id;
  }

  function computeInitialCols() {
    var w = (wrap && wrap.clientWidth) || 1200;
    return Math.max(1, Math.floor((w - PAD * 2 + GAP) / cellW()));
  }

  function extent() {
    var maxR = 0;
    var maxC = cols - 1;
    Object.keys(posMap).forEach(function (id) {
      var p = posMap[id];
      if (p.r > maxR) maxR = p.r;
      if (p.c > maxC) maxC = p.c;
    });
    return { maxR: maxR, maxC: maxC };
  }

  function nearestCell(cx, cy) {
    var c = Math.round((cx - gridOrigin() - size / 2) / cellW());
    var r = Math.round((cy - PAD - cardHeight() / 2) / cellH());
    c = Math.max(0, Math.min(MAX_COORD, c));
    r = Math.max(0, Math.min(MAX_COORD, r));
    return { r: r, c: c };
  }

  /* ---------------------------------------------------------- 状态 */

  function normalizeState(saved) {
    var valid = {};
    var seen = {};
    plates.forEach(function (p) { valid[p.id] = true; });

    var width = (saved && Number(saved.cols) > 0) ? Math.min(60, Math.round(saved.cols)) : computeInitialCols();
    var cells = {};
    var raw = (saved && saved.cells && typeof saved.cells === 'object') ? saved.cells : null;

    if (raw) {
      Object.keys(raw).forEach(function (id) {
        var v = raw[id];
        if (!valid[id] || seen[id] || !Array.isArray(v)) return;
        var r = Math.round(Number(v[0]));
        var c = Math.round(Number(v[1]));
        if (!isFinite(r) || !isFinite(c) || r < 0 || c < 0 || r > MAX_COORD || c > MAX_COORD) return;
        if (cells[cellKey(r, c)]) return;
        cells[cellKey(r, c)] = id;
        seen[id] = true;
      });
    }

    // 没有位置的图补到第一个空格
    plates.forEach(function (p) {
      if (seen[p.id]) return;
      var spot = firstFree(width, cells);
      cells[cellKey(spot.r, spot.c)] = p.id;
      seen[p.id] = true;
    });

    return { cols: width, cells: cells };
  }

  function firstFree(width, cells) {
    for (var r = 0; r <= MAX_COORD; r++) {
      for (var c = 0; c < width; c++) {
        if (!cells[cellKey(r, c)]) return { r: r, c: c };
      }
    }
    return { r: 0, c: 0 };
  }

  function loadState() {
    var saved = VH.store.loadGrid();
    var st = normalizeState(saved);

    posMap = {};
    cellMap = {};
    Object.keys(st.cells).forEach(function (k) {
      var id = st.cells[k];
      var parts = k.split(',');
      var r = Number(parts[0]);
      var c = Number(parts[1]);
      posMap[id] = { r: r, c: c };
      cellMap[k] = id;
    });

    cols = st.cols;
  }

  function saveState() {
    var cells = {};
    Object.keys(posMap).forEach(function (id) {
      cells[id] = [posMap[id].r, posMap[id].c];
    });
    VH.store.saveGrid({ cols: cols, cells: cells });
  }

  /* ---------------------------------------------------------- 排版 */

  function layoutAll() {
    Object.keys(posMap).forEach(function (id) {
      var p = posMap[id];
      var el = cardMap[id];
      if (!el) return;
      el.style.left = (gridOrigin() + p.c * cellW()) + 'px';
      el.style.top = (PAD + p.r * cellH()) + 'px';
    });

    updateCanvasSize();
    syncRowNotes();
    applyRowSkip();
  }

  function updateCanvasSize() {
    var e = extent();
    var w = Math.max(gridOrigin() + (e.maxC + 2) * cellW() + PAD, (wrap && wrap.clientWidth) || 0);
    var h = Math.max((e.maxR + 2) * cellH() + PAD, (wrap && wrap.clientHeight) || 0);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  /* 拖动过程中把画布撑开到目标位置附近，好继续往远处拖 */
  function growCanvas(cell) {
    var needW = gridOrigin() + (cell.c + 3) * cellW() + PAD;
    var needH = (cell.r + 3) * cellH() + PAD;
    if (parseFloat(canvas.style.width) < needW) canvas.style.width = needW + 'px';
    if (parseFloat(canvas.style.height) < needH) canvas.style.height = needH + 'px';
  }

  /* ---------------------------------------------------------- 行备注 */

  function isPlateSkipped(p) {
    var pos = posMap[p.id];
    return !!(pos && rowSkip[pos.r]);
  }

  /* 行勾了「不考」就等于这一行的图都不参与考试，跟卡片当下在第几行走 */
  function examPool() {
    return VH.data.examinable().filter(function (p) { return !isPlateSkipped(p); });
  }

  function applyRowSkip() {
    plates.forEach(function (p) {
      var el = cardMap[p.id];
      if (!el) return;
      el.classList.toggle('is-skipped', isPlateSkipped(p));
    });
  }

  function setRowSkip(r, on) {
    if (on) rowSkip[r] = true;
    else delete rowSkip[r];

    VH.store.saveRowSkip(rowSkip);

    var ref = noteEls[r];
    if (ref) ref.box.classList.toggle('is-skip', !!on);

    applyRowSkip();
    updateStat();
    document.dispatchEvent(new CustomEvent('vh:pool-changed'));
  }

  function createNote(r) {
    var box = document.createElement('div');
    box.className = 'row-note';
    box.style.left = PAD + 'px';
    box.style.width = NOTE_W + 'px';
    box.style.top = (PAD + r * cellH()) + 'px';
    box.style.height = cardHeight() + 'px';
    if (rowSkip[r]) box.classList.add('is-skip');

    var skip = document.createElement('label');
    skip.className = 'row-skip';
    skip.title = '勾选后这一行的图都不参与考试（仍然可以在学习页看）';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!rowSkip[r];

    var skipText = document.createElement('span');
    skipText.textContent = '不考';

    skip.appendChild(cb);
    skip.appendChild(skipText);

    cb.addEventListener('change', function () {
      setRowSkip(r, cb.checked);
    });
    cb.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    var ta = document.createElement('textarea');
    ta.placeholder = '行备注';
    ta.spellcheck = false;
    ta.value = rowNotes[r] || '';
    if (ta.value) box.classList.add('has-text');

    ta.addEventListener('input', function () {
      var v = ta.value;
      if (v.trim()) rowNotes[r] = v;
      else delete rowNotes[r];
      box.classList.toggle('has-text', !!v.trim());
      VH.store.saveRowNotes(rowNotes);
    });

    ta.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); });
    ta.addEventListener('wheel', function (e) { e.stopPropagation(); });

    box.appendChild(skip);
    box.appendChild(ta);
    canvas.appendChild(box);
    return { box: box, ta: ta, cb: cb };
  }

  function syncRowNotes() {
    var rows = extent().maxR + 2;

    while (noteEls.length < rows) {
      noteEls.push(createNote(noteEls.length));
    }

    noteEls.forEach(function (ref, r) {
      if (!ref) return;
      var on = r < rows;
      ref.box.hidden = !on;
      if (!on) return;
      ref.box.style.top = (PAD + r * cellH()) + 'px';
      ref.box.style.height = cardHeight() + 'px';
    });
  }

  /* ---------------------------------------------------------- 卡片 */

  function createCard(p) {
    var card = document.createElement('div');
    card.className = 'plate-card';
    card.dataset.id = p.id;
    card.style.width = size + 'px';
    card.style.left = '0px';
    card.style.top = '0px';

    var media = document.createElement('div');
    media.className = 'plate-media';

    var img = document.createElement('img');
    img.alt = '第 ' + p.idx + ' 张';
    img.draggable = false;

    var missing = document.createElement('div');
    missing.className = 'plate-missing';
    var mb = document.createElement('b');
    mb.textContent = '缺图';
    var ms = document.createElement('span');
    ms.textContent = p.fileName || p.stem;
    missing.appendChild(mb);
    missing.appendChild(ms);

    var no = document.createElement('span');
    no.className = 'plate-no';
    no.textContent = p.idx;

    media.appendChild(img);
    media.appendChild(missing);
    media.appendChild(no);

    var ans = document.createElement('div');
    ans.className = 'plate-answer';

    card.appendChild(media);
    card.appendChild(ans);

    paintAnswer(ans, p);

    VH.data.applyImage(img, p, function (isMissing) {
      card.classList.toggle('is-missing', isMissing);
    });

    bindDrag(card, p);
    bindAnswerEdit(ans, p);

    return card;
  }

  function paintAnswer(node, p) {
    while (node.firstChild) node.removeChild(node.firstChild);
    var a = VH.data.answerOf(p);
    node.textContent = a || '请点击编辑答案';
    node.classList.toggle('is-empty', !a);
    node.title = '点击修改答案';
  }

  function bindAnswerEdit(node, p) {
    node.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (node.querySelector('input')) return;
      startEdit(node, p);
    });
  }

  function startEdit(node, p) {
    var input = document.createElement('input');
    input.className = 'plate-answer-input';
    input.type = 'text';
    input.maxLength = 10;
    input.value = VH.data.answerOf(p);

    node.textContent = '';
    node.appendChild(input);
    input.focus();
    input.select();

    var closed = false;

    function commit() {
      if (closed) return;
      closed = true;
      var val = input.value.trim();
      VH.store.setAnswerOverride(p.idx, val);
      paintAnswer(node, p);
      document.dispatchEvent(new CustomEvent('vh:answers-changed'));
    }

    function cancel() {
      if (closed) return;
      closed = true;
      paintAnswer(node, p);
    }

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    input.addEventListener('blur', commit);
    input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  /* ---------------------------------------------------------- 拖动 */

  function showGhost(cell) {
    ghost.hidden = false;
    ghost.style.left = (gridOrigin() + cell.c * cellW() - 3) + 'px';
    ghost.style.top = (PAD + cell.r * cellH() - 3) + 'px';
    ghost.style.width = (size + 6) + 'px';
    ghost.style.height = (cardHeight() + 6) + 'px';
  }

  function hideGhost() {
    ghost.hidden = true;
  }

  function showPreview(cell, from) {
    preview.hidden = false;
    preview.style.left = (gridOrigin() + cell.c * cellW() - 5) + 'px';
    preview.style.top = (PAD + cell.r * cellH() - 5) + 'px';
    preview.style.width = (size + 10) + 'px';
    preview.style.height = (cardHeight() + 10) + 'px';

    var same = cell.r === from.r && cell.c === from.c;
    preview.classList.toggle('is-origin', same);

    clearSwapTarget();
    if (!same) {
      var id = occupantAt(cell.r, cell.c);
      preview.classList.toggle('is-occupied', !!id);
      if (id && cardMap[id]) cardMap[id].classList.add('is-swap-target');
    } else {
      preview.classList.remove('is-occupied');
    }
  }

  function hidePreview() {
    preview.hidden = true;
  }

  function clearSwapTarget() {
    Object.keys(cardMap).forEach(function (id) {
      cardMap[id].classList.remove('is-swap-target');
    });
  }

  function bindDrag(card, plate) {
    card.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.detail >= 2) return;
      if (e.target.closest && e.target.closest('.plate-answer')) return;
      if (e.target.closest && e.target.closest('.plate-answer-input')) return;

      var from = posMap[plate.id];
      if (!from) return;

      e.preventDefault();

      var originX = gridOrigin() + from.c * cellW();
      var originY = PAD + from.r * cellH();

      var mouse = { x: e.clientX, y: e.clientY };
      var offX = e.clientX - canvas.getBoundingClientRect().left - originX;
      var offY = e.clientY - canvas.getBoundingClientRect().top - originY;

      var startX = e.clientX;
      var startY = e.clientY;
      var moved = false;
      var target = { r: from.r, c: from.c };
      var timer = 0;

      card.classList.add('is-dragging');
      card.style.zIndex = 500;

      showGhost(from);
      showPreview(from, from);

      function updatePosition() {
        var rect = canvas.getBoundingClientRect();
        var nx = mouse.x - rect.left - offX;
        var ny = mouse.y - rect.top - offY;

        card.style.left = nx + 'px';
        card.style.top = ny + 'px';

        target = nearestCell(nx + size / 2, ny + cardHeight() / 2);
        growCanvas(target);
        showPreview(target, from);
      }

      /* 鼠标停在边缘时持续滚动画布，好把卡片拖到远处 */
      function autoScroll() {
        var r = wrap.getBoundingClientRect();
        var edge = 90;
        var speed = 24;
        var dx = 0;
        var dy = 0;

        if (mouse.x > r.right - edge) dx = speed;
        else if (mouse.x < r.left + edge) dx = -speed;

        if (mouse.y > r.bottom - edge) dy = speed;
        else if (mouse.y < r.top + edge) dy = -speed;

        if (dx || dy) {
          var beforeL = wrap.scrollLeft;
          var beforeT = wrap.scrollTop;
          wrap.scrollLeft += dx;
          wrap.scrollTop += dy;
          if (wrap.scrollLeft !== beforeL || wrap.scrollTop !== beforeT) {
            updatePosition();
          }
        }
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;

        mouse.x = ev.clientX;
        mouse.y = ev.clientY;

        if (!moved && (Math.abs(dx) + Math.abs(dy)) < 4) return;
        moved = true;

        updatePosition();
        if (!timer) timer = setInterval(autoScroll, 16);
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        if (timer) clearInterval(timer);
        timer = 0;

        card.classList.remove('is-dragging');
        card.style.zIndex = '';
        hideGhost();
        hidePreview();
        clearSwapTarget();

        if (!moved) {
          layoutAll();
          openLightbox(plate);
          return;
        }

        var same = target.r === from.r && target.c === from.c;
        if (!same) {
          var me = occupantAt(from.r, from.c);
          var other = occupantAt(target.r, target.c);

          // 先清空两个格子，再各自回填，避免后一次写入把前一次覆盖掉
          delete cellMap[cellKey(from.r, from.c)];
          delete cellMap[cellKey(target.r, target.c)];

          if (other) {
            posMap[other] = { r: from.r, c: from.c };
            cellMap[cellKey(from.r, from.c)] = other;
          }
          if (me) {
            posMap[me] = { r: target.r, c: target.c };
            cellMap[cellKey(target.r, target.c)] = me;
          }

          saveState();
        }

        void card.offsetWidth;
        layoutAll();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  /* ---------------------------------------------------------- 灯箱 */

  function openLightbox(p) {
    var lb = document.getElementById('lightbox');
    var img = document.getElementById('lb-img');
    var no = document.getElementById('lb-no');
    var answer = document.getElementById('lb-answer');
    var note = document.getElementById('lb-note');
    var media = lb.querySelector('.lb-media');

    var answerText = p.answerText != null ? p.answerText : VH.data.answerOf(p);

    no.textContent = p.label || ('第 ' + p.idx + ' 张');
    answer.textContent = answerText || '未设置答案';
    answer.style.opacity = answerText ? '1' : '.4';
    note.textContent = p.note || '';
    media.style.background = '#fff';

    // 先显示灯箱，后面的像素处理出错也不会让它打不开
    lb.hidden = false;

    if (p.src) {
      img.style.display = '';
      img.src = p.src;
      safeSetup();
    } else {
      VH.data.applyImage(img, p, function (isMissing) {
        if (isMissing) {
          media.style.background = '#171d28';
          no.textContent = '第 ' + p.idx + ' 张 · 缺图';
        }
        safeSetup();
      });
    }
  }

  function safeSetup() {
    if (!VH.compensate) return;
    try {
      VH.compensate.setup();
    } catch (err) {
      /* 读不到像素（比如 file:// 打开）就保持原图，不影响其他功能 */
    }
  }

  function closeLightbox() {
    document.getElementById('lightbox').hidden = true;
  }

  /* ---------------------------------------------------------- 尺寸 */

  function setCardSize(next) {
    size = next;
    VH.store.saveCardSize(size);

    plates.forEach(function (p) {
      var el = cardMap[p.id];
      if (el) el.style.width = size + 'px';
    });

    layoutAll();
  }

  /* ---------------------------------------------------------- 渲染 */

  function render() {
    size = VH.store.cardSize();
    loadState();

    canvas.innerHTML = '';
    cardMap = {};
    noteEls = [];
    rowNotes = VH.store.loadRowNotes();
    rowSkip = VH.store.loadRowSkip();

    ghost = document.createElement('div');
    ghost.className = 'cell-ghost';
    ghost.hidden = true;
    canvas.appendChild(ghost);

    preview = document.createElement('div');
    preview.className = 'cell-preview';
    preview.hidden = true;
    canvas.appendChild(preview);

    plates.forEach(function (p) {
      var el = createCard(p);
      cardMap[p.id] = el;
      canvas.appendChild(el);
    });

    layoutAll();
    saveState();
    updateStat();
  }

  function updateStat() {
    var total = plates.length;
    var ready = examPool().length;
    var skipped = VH.data.examinable().length - ready;
    var el = document.getElementById('learn-stat');
    if (!el) return;
    el.textContent = total + ' 张图 · 可考 ' + ready + ' 张' +
      (skipped > 0 ? ' · ' + skipped + ' 张不考' : '');
    el.style.color = ready === 0 ? 'var(--warn)' : '';
  }

  /* ---------------------------------------------------------- 排序 */

  function sortByNumber() {
    var width = Math.max(1, cols);
    posMap = {};
    cellMap = {};
    plates.forEach(function (p, i) {
      moveCard(p.id, Math.floor(i / width), i % width);
    });
    saveState();
    layoutAll();
  }

  /* ---------------------------------------------------------- 对外 */

  function mount() {
    wrap = document.getElementById('canvas-wrap');
    canvas = document.getElementById('canvas');
    plates = VH.data.plates;

    if (!canvas || !wrap) return;
    if (built) { layoutAll(); return; }
    built = true;

    showAnswers = VH.store.showAnswers();
    document.body.classList.toggle('hide-answers', !showAnswers);

    render();

    var toggle = document.getElementById('toggle-answers');
    if (toggle) {
      toggle.checked = showAnswers;
      toggle.addEventListener('change', function () {
        showAnswers = this.checked;
        VH.store.saveShowAnswers(showAnswers);
        document.body.classList.toggle('hide-answers', !showAnswers);
        layoutAll();
      });
    }

    var sizeInput = document.getElementById('card-size');
    sizeInput.value = size;
    sizeInput.addEventListener('input', function () {
      setCardSize(Number(this.value));
    });

    document.getElementById('btn-tidy').addEventListener('click', sortByNumber);

    document.getElementById('lightbox').addEventListener('click', function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute('data-close')) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !document.getElementById('lightbox').hidden) closeLightbox();
    });

    document.addEventListener('vh:answers-changed', function () {
      updateStat();
      if (VH.exam) VH.exam.refreshIdle();
    });

    // 勾选「不考」后考试待机页的数字也要跟着变
    document.addEventListener('vh:pool-changed', function () {
      if (VH.exam) VH.exam.refreshIdle();
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        updateCanvasSize();
      }, 160);
    });
  }

  function refresh() {
    size = VH.store.cardSize();
    var sizeInput = document.getElementById('card-size');
    if (sizeInput) sizeInput.value = size;
    if (!canvas) return;
    render();
  }

  function onShow() {
    layoutAll();
  }

  VH.learn = {
    mount: mount,
    onShow: onShow,
    refresh: refresh,
    updateStat: updateStat,
    examPool: examPool,
    openLightbox: openLightbox,
    sortByNumber: sortByNumber
  };

})(window);
