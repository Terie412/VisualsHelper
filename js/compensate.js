/* ============================================================
   红绿补偿：把「红绿轴上的差异」搬到明度上
   ------------------------------------------------------------
   色觉检查图的信息几乎全在红绿轴上，且数字和背景被刻意做成等亮度，
   所以红绿色弱看到的就是一片均匀噪点。
   这里把每个像素的红绿分量（R-G）相对全图均值的偏差，
   按比例叠加到亮度上：0% 是原图，100% 时形状完全由红绿差异决定。
   ============================================================ */

(function (global) {
  'use strict';

  var MAX_W = 640;

  var state = {
    base: null,
    data: null,
    w: 0,
    h: 0,
    mean: 0,
    gain: 1,
    k: 0,
    raf: 0
  };

  var canvas, img, slider, out;

  function init() {
    canvas = document.getElementById('lb-canvas');
    img = document.getElementById('lb-img');
    slider = document.getElementById('lb-sim');
    out = document.getElementById('lb-sim-val');

    if (!slider || !canvas || !img) return;

    slider.addEventListener('input', function () {
      out.textContent = this.value + '%';
      schedule(Number(this.value) / 100);
    });
  }

  /* 把图片画进 canvas，取像素，算红绿轴的均值与平均偏差 */
  function prepare() {
    if (!img || !img.naturalWidth) return false;

    var ratio = Math.min(1, MAX_W / img.naturalWidth);
    var w = Math.max(1, Math.round(img.naturalWidth * ratio));
    var h = Math.max(1, Math.round(img.naturalHeight * ratio));

    canvas.width = w;
    canvas.height = h;

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    var id = ctx.getImageData(0, 0, w, h);
    var d = id.data;
    var n = d.length / 4;
    var i;

    var sum = 0;
    for (i = 0; i < d.length; i += 4) sum += d[i] - d[i + 1];
    var mean = sum / n;

    var mad = 0;
    for (i = 0; i < d.length; i += 4) mad += Math.abs((d[i] - d[i + 1]) - mean);
    mad = mad / n;
    if (mad < 1) mad = 1;

    state.base = new Uint8ClampedArray(d);
    state.data = d;
    state.w = w;
    state.h = h;
    state.mean = mean;
    state.gain = 110 / mad;
    state.k = 0;

    return true;
  }

  function render(k) {
    if (!state.base) return;

    var src = state.base;
    var d = state.data;
    var mean = state.mean;
    var gain = state.gain * 1.6;

    for (var i = 0; i < d.length; i += 4) {
      var r = src[i];
      var g = src[i + 1];
      var b = src[i + 2];

      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      var diff = (r - g) - mean;

      var target = 128 + diff * gain;
      if (target < 0) target = 0;
      else if (target > 255) target = 255;

      var nl = lum * (1 - k) + target * k;

      // 补偿越强越去色，免得色相干扰形状判断
      var keep = 1 - k * 0.9;
      var nr = lum + (r - lum) * keep;
      var ng = lum + (g - lum) * keep;
      var nb = lum + (b - lum) * keep;

      var now = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      var f = now > 0.5 ? nl / now : 1;

      d[i] = nr * f;
      d[i + 1] = ng * f;
      d[i + 2] = nb * f;
      d[i + 3] = 255;
    }

    canvas.getContext('2d').putImageData(
      new ImageData(d, state.w, state.h), 0, 0
    );
  }

  function schedule(k) {
    state.k = k;
    if (state.raf) return;
    state.raf = requestAnimationFrame(function () {
      state.raf = 0;
      render(state.k);
    });
  }

  function toggleUI(ok) {
    if (slider) slider.hidden = !ok;
    if (out) out.hidden = !ok;

    var tip = document.getElementById('lb-sim-tip');
    if (tip) tip.hidden = ok;
  }

  function reset() {
    state.base = null;
    state.data = null;
    state.k = 0;

    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;

    if (slider) { slider.value = '0'; slider.hidden = false; }
    if (out) { out.textContent = '0%'; out.hidden = false; }
    if (canvas) canvas.hidden = true;
    if (img) img.style.visibility = '';

    var tip = document.getElementById('lb-sim-tip');
    if (tip) tip.hidden = true;
  }

  function attach() {
    if (!img || !img.naturalWidth) return false;

    try {
      if (!prepare()) return false;
    } catch (err) {
      // file:// 打开时 canvas 会被判定为跨域污染，读不到像素
      return false;
    }

    canvas.hidden = false;
    img.style.visibility = 'hidden';
    render(0);
    return true;
  }

  function setup() {
    reset();
    if (!img) return;

    if (img.complete && img.naturalWidth) {
      toggleUI(attach());
      return;
    }

    img.addEventListener('load', function onload() {
      img.removeEventListener('load', onload);
      toggleUI(attach());
    });
  }

  function mount() {
    init();
    global.VH = global.VH || {};
    global.VH.compensate = { setup: setup, reset: reset };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

})(window);
