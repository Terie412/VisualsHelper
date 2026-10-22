/* ============================================================
   考试页：随机抽题 + 候选答案 + 单图限时（自助机风格）
   ============================================================ */

(function (global) {
  'use strict';

  var VH = global.VH;

  var dom = {};
  var settings = { count: 12, limit: 15, allow: 1, sim: true };

  var st = {
    built: false,
    running: false,
    quitOpen: false,
    lastPane: 'idle',
    queue: [],
    idx: 0,
    records: [],
    choices: [],
    value: '',
    limitMs: 15000,
    deadline: 0,
    remaining: 15000,
    raf: 0
  };

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------- 工具 */

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function same(a, b) {
    return VH.data.normalize(a) === VH.data.normalize(b);
  }

  function showPane(name) {
    dom.panes.forEach(function (p) {
      p.classList.toggle('is-active', p.dataset.pane === name);
    });
  }

  /* 可考的题：有答案，且所在行没有勾「不考」 */
  function examPool() {
    if (VH.learn && VH.learn.examPool) return VH.learn.examPool();
    return VH.data.examinable();
  }

  /* ---------------------------------------------------------- 待机 */

  function refreshIdle() {
    if (!st.built) return;

    settings = VH.store.settings();

    var all = VH.data.examinable();
    var pool = examPool();
    var skipped = all.length - pool.length;
    var total = VH.data.total;
    var off = total - pool.length;
    var n = Math.min(settings.count, pool.length || 0);

    dom.count.textContent = n;
    dom.limit.textContent = settings.limit + ' 秒';
    dom.allow.textContent = settings.allow + ' 张';

    if (pool.length === 0) {
      dom.warn.hidden = false;
      dom.warn.textContent = all.length
        ? '有答案的图都在勾了「不考」的行里了，把行左侧的勾去掉再来考试。'
        : '题库里还没有任何答案，无法开始考试。请在学习页填写答案，或编辑 js/data.js。';
      dom.startBtn.disabled = true;
    } else if (off > 0) {
      var parts = [];
      if (total - all.length > 0) parts.push((total - all.length) + ' 张还没有答案');
      if (skipped > 0) parts.push(skipped + ' 张所在行勾了「不考」');

      dom.warn.hidden = false;
      dom.warn.textContent = '题库共 ' + total + ' 张，其中 ' + parts.join('、') +
        '，不参与本次考试。';
      dom.startBtn.disabled = false;
    } else {
      dom.warn.hidden = true;
      dom.startBtn.disabled = false;
    }
  }

  /* ---------------------------------------------------------- 开始 */

  function start() {
    settings = VH.store.settings();

    var pool = examPool();
    if (!pool.length) return;

    var n = Math.min(settings.count, pool.length);
    st.queue = shuffle(pool.slice()).slice(0, n);
    st.idx = 0;
    st.records = [];
    st.running = true;
    st.lastPane = 'running';
    st.limitMs = settings.limit * 1000;

    showPane('running');
    nextQuestion();
  }

  /* ---------------------------------------------------------- 候选 */

  /* 正确答案 + 3 个干扰项 */
  function buildChoices(p) {
    var answer = VH.data.answerOf(p);

    // 按相似度出题：干扰项来自和这张图最像的若干张
    // （similarity.json 是按原书图版算的，换成自备图版后不再适用）
    if (settings.sim && VH.sim && VH.sim.isReady() && !VH.store.customPlates()) {
      var picked = VH.sim.pickOptions(p, answer, 4);
      if (picked) return shuffle(picked);
    }

    // 回退：全库随机，同类型、同位数优先
    var pools = VH.data.answerPools();
    var isNumber = /^[0-9]+$/.test(VH.data.normalize(answer));
    var src = isNumber ? pools.numbers : pools.figures;

    // 数字题优先用同样位数的数字当干扰项，否则看长度就能排除
    if (isNumber) {
      var len = String(answer).length;
      var sameLen = src.filter(function (x) { return String(x).length === len; });
      if (sameLen.length >= 4) src = sameLen;
    }

    var opts = [answer];
    var guard = 0;

    while (opts.length < 4 && guard++ < 400) {
      var cand = src[Math.floor(Math.random() * src.length)];
      if (!cand || same(cand, answer)) continue;
      if (opts.some(function (o) { return same(o, cand); })) continue;
      opts.push(cand);
    }

    return shuffle(opts);
  }

  function renderChoices(p) {
    st.choices = buildChoices(p);
    dom.choices.innerHTML = '';

    st.choices.forEach(function (text, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice-btn';
      b.dataset.i = String(i);

      var tag = document.createElement('span');
      tag.className = 'choice-tag';
      tag.textContent = String(i + 1);

      var label = document.createElement('span');
      label.className = 'choice-label';
      label.textContent = text;

      b.appendChild(tag);
      b.appendChild(label);
      dom.choices.appendChild(b);
    });
  }

  /* ---------------------------------------------------------- 出题 */

  function nextQuestion() {
    if (st.idx >= st.queue.length) { finish(); return; }

    var p = st.queue[st.idx];
    st.value = '';

    dom.idx.textContent = (st.idx + 1) + ' / ' + st.queue.length;

    dom.missing.hidden = true;
    dom.img.style.visibility = 'hidden';
    VH.data.applyImage(dom.img, p, function (isMissing) {
      dom.missing.hidden = !isMissing;
      dom.img.style.visibility = isMissing ? 'hidden' : 'visible';
    });

    renderChoices(p);
    animatePlate();
    startTimer();
  }

  function animatePlate() {
    if (!dom.plate) return;
    dom.plate.classList.remove('plate-in');
    void dom.plate.offsetWidth;
    dom.plate.classList.add('plate-in');
  }

  /* ---------------------------------------------------------- 计时 */

  function startTimer() {
    stopTimer();
    st.remaining = st.limitMs;
    st.deadline = performance.now() + st.limitMs;
    dom.bar.classList.remove('is-urgent');
    dom.time.classList.remove('is-urgent');
    dom.bar.style.transform = 'scaleX(1)';
    dom.time.textContent = (st.limitMs / 1000).toFixed(1);
    tick();
  }

  function stopTimer() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
  }

  function tick() {
    if (!st.running) return;

    var remain = st.deadline - performance.now();
    var ratio = Math.max(0, remain / st.limitMs);

    dom.bar.style.transform = 'scaleX(' + ratio + ')';
    dom.time.textContent = Math.max(0, remain / 1000).toFixed(1);

    var urgent = ratio <= 0.3;
    dom.bar.classList.toggle('is-urgent', urgent);
    dom.time.classList.toggle('is-urgent', urgent);

    if (remain <= 0) { submit(true); return; }
    st.raf = requestAnimationFrame(tick);
  }

  function pauseTimer() {
    if (!st.running || !st.raf) return;
    st.remaining = Math.max(0, st.deadline - performance.now());
    stopTimer();
  }

  function resumeTimer() {
    if (!st.running || st.raf) return;
    st.deadline = performance.now() + st.remaining;
    tick();
  }

  /* ---------------------------------------------------------- 作答 */

  function pick(i) {
    if (!st.running) return;
    var text = st.choices[i];
    if (text == null) return;
    st.value = text;
    submit(false);
  }

  function submit(auto) {
    if (!st.running) return;
    stopTimer();

    var p = st.queue[st.idx];
    var expected = VH.data.answerOf(p);
    var given = st.value;
    var ok = given !== '' && same(given, expected);

    st.records.push({
      plate: p,
      given: given,
      expected: expected,
      ok: ok,
      auto: !!auto
    });

    st.idx++;

    if (st.idx >= st.queue.length) finish();
    else nextQuestion();
  }

  /* ---------------------------------------------------------- 交卷 */

  function finish() {
    st.running = false;
    st.lastPane = 'result';
    stopTimer();

    var total = st.records.length;
    var right = st.records.filter(function (r) { return r.ok; }).length;
    var pass = right >= total - settings.allow;

    dom.verdict.textContent = pass ? '通过' : '未通过';
    dom.verdict.className = 'verdict ' + (pass ? 'is-pass' : 'is-fail');
    dom.scoreMain.textContent = right + ' / ' + total;
    dom.scoreSub.textContent = '允许错 ' + settings.allow + ' 张 · ' +
      (pass ? '在容错范围内' : '超出容错范围');

    renderWrong();
    showPane('result');
  }

  function renderWrong() {
    dom.wrongList.innerHTML = '';

    var wrongs = st.records.filter(function (r) { return !r.ok; });

    if (!wrongs.length) {
      var ok = document.createElement('div');
      ok.className = 'empty-note';
      ok.textContent = '全部答对，没有错题。';
      dom.wrongList.appendChild(ok);
      return;
    }

    var title = document.createElement('div');
    title.className = 'empty-note';
    title.style.textAlign = 'left';
    title.style.paddingTop = '0';
    title.textContent = '错题 ' + wrongs.length + ' 张';
    dom.wrongList.appendChild(title);

    wrongs.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'wrong-item';

      var thumb = document.createElement('div');
      thumb.className = 'wrong-thumb';
      var img = document.createElement('img');
      img.alt = '';
      thumb.appendChild(img);
      VH.data.applyImage(img, r.plate, function (isMissing) {
        if (isMissing) thumb.style.background = '#1a2230';
      });

      var meta = document.createElement('div');
      meta.className = 'wrong-meta';

      var no = document.createElement('div');
      no.className = 'wrong-no';
      no.textContent = '第 ' + r.plate.idx + ' 张';

      var ans = document.createElement('div');
      ans.className = 'wrong-ans';

      var mine = document.createElement('span');
      mine.className = 'yours';
      mine.appendChild(document.createTextNode('你的答案'));
      var b1 = document.createElement('b');
      b1.textContent = r.given || (r.auto ? '超时' : '未作答');
      mine.appendChild(b1);

      var right = document.createElement('span');
      right.className = 'right';
      right.appendChild(document.createTextNode('正确答案'));
      var b2 = document.createElement('b');
      b2.textContent = r.expected;
      right.appendChild(b2);

      ans.appendChild(mine);
      ans.appendChild(right);
      meta.appendChild(no);
      meta.appendChild(ans);

      item.appendChild(thumb);
      item.appendChild(meta);
      dom.wrongList.appendChild(item);
    });
  }

  function backToIdle() {
    st.running = false;
    st.quitOpen = false;
    st.lastPane = 'idle';
    stopTimer();
    hideQuitModal();
    showPane('idle');
    refreshIdle();
  }

  /* ---------------------------------------------------------- 放弃考试 */

  function showQuitModal() {
    if (!st.running || st.quitOpen) return;

    st.quitOpen = true;

    // 确认框开着的时候不能继续倒计时，否则想一下就被判超时
    pauseTimer();

    var answered = st.records.length;
    dom.quitDesc.textContent = answered
      ? '已经答了 ' + answered + ' 张。放弃后这些答案直接作废，本次不生成成绩，也不会写入错题。'
      : '还没有作答。放弃后会回到准备页，随时可以重新开始。';

    dom.quitModal.hidden = false;
    dom.quitCancel.focus();
  }

  function hideQuitModal() {
    st.quitOpen = false;
    dom.quitModal.hidden = true;
  }

  /* keep：关掉之后要不要接着计时 */
  function closeQuitModal(keep) {
    if (!st.quitOpen) return;
    hideQuitModal();
    if (keep && st.running) resumeTimer();
  }

  function abandon() {
    hideQuitModal();
    st.records = [];
    st.value = '';
    backToIdle();
  }

  /* ---------------------------------------------------------- 事件 */

  function bind() {
    dom.startBtn.addEventListener('click', start);

    dom.choices.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      pick(Number(btn.dataset.i));
    });

    dom.cant.addEventListener('click', function () {
      if (!st.running) return;
      st.value = '';
      submit(false);
    });

    dom.retry.addEventListener('click', start);
    dom.back.addEventListener('click', function () {
      if (global.VH.app) global.VH.app.switchView('learn');
    });

    dom.quit.addEventListener('click', showQuitModal);
    dom.quitOk.addEventListener('click', abandon);
    dom.quitCancel.addEventListener('click', function () { closeQuitModal(true); });

    dom.quitModal.addEventListener('click', function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute('data-quit-close')) {
        closeQuitModal(true);
      }
    });

    document.addEventListener('keydown', function (e) {
      // 确认框优先：Esc 只关弹层，不退出考试
      if (st.quitOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeQuitModal(true);
        }
        return;
      }

      if (!st.running) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        backToIdle();
        return;
      }

      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        pick(Number(e.key) - 1);
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (st.quitOpen) return;
      if (document.hidden) pauseTimer();
      else resumeTimer();
    });
  }

  /* ---------------------------------------------------------- 对外 */

  function mount() {
    if (st.built) { refreshIdle(); return; }
    st.built = true;

    dom = {
      panes: Array.prototype.slice.call(document.querySelectorAll('.exam-pane')),
      count: $('idle-count'),
      limit: $('idle-limit'),
      allow: $('idle-allow'),
      warn: $('idle-warn'),
      startBtn: $('btn-exam-start'),
      bar: $('run-bar'),
      idx: $('run-idx'),
      time: $('run-time'),
      img: $('run-img'),
      plate: document.querySelector('.run-plate'),
      missing: $('run-missing'),
      choices: $('choices'),
      cant: $('btn-cant'),
      verdict: $('verdict'),
      scoreMain: $('score-main'),
      scoreSub: $('score-sub'),
      wrongList: $('wrong-list'),
      retry: $('btn-retry'),
      back: $('btn-back-learn'),
      quit: $('btn-quit'),
      quitModal: $('quit-modal'),
      quitDesc: $('quit-desc'),
      quitOk: $('btn-quit-ok'),
      quitCancel: $('btn-quit-cancel')
    };

    bind();
    refreshIdle();
  }

  function onShow() {
    if (!st.built) mount();
    if (st.running) { resumeTimer(); return; }
    if (st.lastPane === 'result') { showPane('result'); return; }
    showPane('idle');
    refreshIdle();
  }

  function onHide() {
    pauseTimer();
  }

  VH.exam = {
    mount: mount,
    onShow: onShow,
    onHide: onHide,
    refreshIdle: refreshIdle
  };

})(window);
