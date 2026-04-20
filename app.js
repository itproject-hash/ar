"use strict";

(function () {
  /* ─── DOM ───────────────────────────────────────────────────── */
  const DOM = {
    startCameraBtn:  document.getElementById("startCameraBtn"),
    freezeFrameBtn:  document.getElementById("freezeFrameBtn"),
    textureInput:    document.getElementById("textureInput"),
    resetPointsBtn:  document.getElementById("resetPointsBtn"),
    screenshotBtn:   document.getElementById("screenshotBtn"),
    scaleRange:      document.getElementById("scaleRange"),
    scaleInput:      document.getElementById("scaleInput"),
    opacityRange:    document.getElementById("opacityRange"),
    opacityInput:    document.getElementById("opacityInput"),
    cameraFeed:      document.getElementById("cameraFeed"),
    frozenImage:     document.getElementById("frozenImage"),
    frameCanvas:     document.getElementById("frameCanvas"),
    overlayCanvas:   document.getElementById("overlayCanvas"),
    cameraEmpty:     document.getElementById("cameraEmpty"),
    statusTitle:     document.getElementById("statusTitle"),
    statusText:      document.getElementById("statusText"),
    cameraWrap:      document.getElementById("cameraWrap"),
    textureName:     document.getElementById("textureName"),
  };

  const frameCtx   = DOM.frameCanvas.getContext("2d");
  const overlayCtx = DOM.overlayCanvas.getContext("2d");

  const state = {
    stream:           null,
    textureImage:     null,
    points:           [],          // 4 × {x,y} in canvas CSS pixels
    scalePercent:     100,
    opacityPercent:   85,
    frameFrozen:      false,
    frozenSource:     null,        // offscreen canvas snapshot
    dragPointIndex:   -1,
    lastTouchId:      null,
  };

  /* ─── STATUS ─────────────────────────────────────────────────── */
  function setStatus(title, text) {
    DOM.statusTitle.textContent = title;
    DOM.statusText.textContent  = text;
  }

  /* ─── UI MODES ───────────────────────────────────────────────── */
  function syncUiMode() {
    document.body.classList.toggle("camera-session", Boolean(state.stream));
    document.body.classList.toggle("camera-live",    Boolean(state.stream) && !state.frameFrozen);
  }

  function syncFreezeButton() {
    DOM.freezeFrameBtn.dataset.frozen = state.frameFrozen ? "true" : "false";
    DOM.freezeFrameBtn.hidden = state.frameFrozen;
  }

  function setPreviewMode() {
    DOM.cameraFeed.style.display   = state.frameFrozen ? "none"  : "block";
    DOM.frozenImage.style.display  = state.frameFrozen ? "block" : "none";
    DOM.frameCanvas.style.display  = "none";
    syncUiMode();
    syncFreezeButton();
  }

  /* ─── CANVAS SIZING ──────────────────────────────────────────── */
  function setCanvasSize(canvas, w, h, dpr) {
    canvas.width  = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width  = w + "px";
    canvas.style.height = h + "px";
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getStageSize() {
    const r = DOM.cameraWrap.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }

  function resizeStage() {
    const { width, height } = getStageSize();
    const dpr = window.devicePixelRatio || 1;
    setCanvasSize(DOM.frameCanvas,   width, height, dpr);
    setCanvasSize(DOM.overlayCanvas, width, height, dpr);
    if (state.frameFrozen) drawFrozenFrame();
    drawOverlay();
  }

  /* ─── SOURCE RENDERING ───────────────────────────────────────── */
  function isCoverMode() {
    return window.innerWidth <= 760 && Boolean(state.stream) && !state.frameFrozen;
  }

  function renderSourceContained(ctx, source, w, h) {
    if (!source) return;
    const sw = source.videoWidth  || source.width  || 1;
    const sh = source.videoHeight || source.height || 1;
    const scale = (isCoverMode() ? Math.max : Math.min)(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    const dx = (w - dw) / 2, dy = (h - dh) / 2;
    ctx.fillStyle = "#02040b";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  function drawFrozenFrame() {
    const { width, height } = getStageSize();
    frameCtx.clearRect(0, 0, width, height);
    if (state.frozenSource) renderSourceContained(frameCtx, state.frozenSource, width, height);
  }

  /* ═══════════════════════════════════════════════════════════════
     HOMOGRAPHY  –  true perspective-correct texture mapping
     Solves the 4×4 system of linear equations to find the 3×3
     projective transform matrix that maps unit-square → quad.
     This is the ONLY correct way to simulate wallpaper / tiles
     on an arbitrarily-shaped wall polygon.
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Compute the 3×3 homography matrix H such that
   *   [x', y', w']^T = H · [x, y, 1]^T
   * mapping the four unit-square corners (0,0)(1,0)(1,1)(0,1)
   * to the four destination points dst[0..3].
   */
  function computeHomography(dst) {
    // dst = [TL, TR, BR, BL]  (same order as state.points)
    const x1 = dst[0].x, y1 = dst[0].y;
    const x2 = dst[1].x, y2 = dst[1].y;
    const x3 = dst[2].x, y3 = dst[2].y;
    const x4 = dst[3].x, y4 = dst[3].y;

    const b = [x1, x2, x3, x4, y1, y2, y3, y4];

    // Build 8×8 matrix A for the DLT algorithm
    const A = [
      [0, 0, 1, 0, 0, 0, -x1*0, -x1*0],
      [1, 0, 1, 0, 0, 0, -x2*1, -x2*0],
      [1, 1, 1, 0, 0, 0, -x3*1, -x3*1],
      [0, 1, 1, 0, 0, 0, -x4*0, -x4*1],
      [0, 0, 0, 0, 0, 1, -y1*0, -y1*0],
      [1, 0, 0, 0, 1, 1, -y2*1, -y2*0],
      [1, 1, 0, 0, 1, 1, -y3*1, -y3*1],
      [0, 1, 0, 0, 1, 1, -y4*0, -y4*1],
    ];

    // Gaussian elimination
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const d = M[col][col];
      if (Math.abs(d) < 1e-12) return null;
      for (let j = col; j <= n; j++) M[col][j] /= d;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const f = M[row][col];
        for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
      }
    }

    const h = M.map(row => row[n]);
    // h = [h00,h01,h02, h10,h11,h12, h20,h21]  + h22=1
    return [
      h[0], h[1], h[2],
      h[3], h[4], h[5],
      h[6], h[7], 1,
    ];
  }

  /**
   * Apply the homography to a single source point.
   */
  function applyH(H, sx, sy) {
    const w  = H[6]*sx + H[7]*sy + H[8];
    const px = (H[0]*sx + H[1]*sy + H[2]) / w;
    const py = (H[3]*sx + H[4]*sy + H[5]) / w;
    return { x: px, y: py };
  }

  /**
   * Draw the texture onto the quad using a scanline approach driven
   * by the homography.  We render in horizontal scanlines, each
   * decomposed into a tiny trapezoid that we fill with the correctly
   * scaled portion of the source image.
   *
   * The number of horizontal slices is adaptive: more for larger quads.
   */
  function drawTextureHomography(ctx, image, quad, scalePercent, opacity) {
    if (!image || quad.length !== 4) return;

    const H = computeHomography(quad);
    if (!H) return;   // degenerate quad

    // ── Tile the source image into an offscreen pattern canvas ──────
    // The "scale" slider controls how many times the texture repeats
    // across the wall quad width.  scale=100 → texture fills the quad
    // once;  scale=50 → repeats 2×;  scale=200 → only half visible.
    const topLen    = Math.hypot(quad[1].x-quad[0].x, quad[1].y-quad[0].y);
    const leftLen   = Math.hypot(quad[3].x-quad[0].x, quad[3].y-quad[0].y);
    const quadW     = Math.max(topLen, 1);
    const quadH     = Math.max(leftLen, 1);

    const factor     = scalePercent / 100;          // 1 = fills wall once
    const tileW      = Math.max(32, quadW * factor);
    const tileH      = tileW * (image.naturalHeight / (image.naturalWidth || 1));

    // Build tiled pattern (power-of-2 is not required by modern browsers)
    const patW  = Math.round(Math.max(64, quadW));
    const patH  = Math.round(Math.max(64, quadH));
    const patC  = document.createElement("canvas");
    patC.width  = patW;
    patC.height = patH;
    const patCtx = patC.getContext("2d");
    const tw = Math.round(tileW), th = Math.round(tileH);
    for (let py = 0; py < patH + th; py += th) {
      for (let px = 0; px < patW + tw; px += tw) {
        patCtx.drawImage(image, px, py, tw, th);
      }
    }

    // ── Scanline render using homography ─────────────────────────
    const SLICES = Math.min(512, Math.max(64, Math.round(Math.max(quadW, quadH) / 2)));

    ctx.save();
    ctx.globalAlpha = opacity;

    for (let i = 0; i < SLICES; i++) {
      const t0 = i       / SLICES;
      const t1 = (i + 1) / SLICES;

      // Four corners of this horizontal strip in SOURCE (normalised) space
      // Source rectangle: x in [t0,t1], y in [0,1]
      const s00 = applyH(H, t0, 0);
      const s10 = applyH(H, t1, 0);
      const s11 = applyH(H, t1, 1);
      const s01 = applyH(H, t0, 1);

      // Source pixel coordinates inside the pattern canvas
      const sx0 = t0 * patW, sx1 = t1 * patW;
      const sw   = sx1 - sx0;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s00.x, s00.y);
      ctx.lineTo(s10.x, s10.y);
      ctx.lineTo(s11.x, s11.y);
      ctx.lineTo(s01.x, s01.y);
      ctx.closePath();
      ctx.clip();

      // Transform: map source strip [sx0..sx1, 0..patH] → dest strip
      const dxL = s01.x - s00.x;  // left edge vector (top→bottom in source)
      const dyL = s01.y - s00.y;
      const dxR = s10.x - s00.x;  // top edge vector
      const dyR = s10.y - s00.y;

      ctx.transform(
        dxR / sw,
        dyR / sw,
        dxL / patH,
        dyL / patH,
        s00.x - (sx0 * dxR) / sw,
        s00.y - (sx0 * dyR) / sw
      );

      ctx.drawImage(patC, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ─── OVERLAY DRAW ───────────────────────────────────────────── */
  function drawOverlay() {
    const { width, height } = getStageSize();
    overlayCtx.clearRect(0, 0, width, height);

    // Texture
    if (state.textureImage && state.points.length === 4) {
      const opacity = state.opacityPercent / 100;
      drawTextureHomography(overlayCtx, state.textureImage, state.points, state.scalePercent, opacity);
    }

    // Wall outline
    if (state.points.length >= 2) {
      overlayCtx.save();
      overlayCtx.beginPath();
      overlayCtx.moveTo(state.points[0].x, state.points[0].y);
      for (let i = 1; i < state.points.length; i++) {
        overlayCtx.lineTo(state.points[i].x, state.points[i].y);
      }
      if (state.points.length === 4) {
        overlayCtx.closePath();
        overlayCtx.fillStyle = state.textureImage ? "transparent" : "rgba(22,196,181,0.12)";
        overlayCtx.fill();
      }
      overlayCtx.strokeStyle = "rgba(22,196,181,0.9)";
      overlayCtx.lineWidth   = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    // Corner handles
    const LABELS = ["↖", "↗", "↘", "↙"];
    state.points.forEach(function (pt, i) {
      overlayCtx.save();

      // Outer ring
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
      overlayCtx.fillStyle = "rgba(8,17,31,0.65)";
      overlayCtx.fill();
      overlayCtx.strokeStyle = i === state.dragPointIndex ? "#ffffff" : "#f97316";
      overlayCtx.lineWidth = 2.5;
      overlayCtx.stroke();

      // Inner dot
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      overlayCtx.fillStyle = i === state.dragPointIndex ? "#ffffff" : "#f97316";
      overlayCtx.fill();

      // Label
      overlayCtx.fillStyle = "#ffffff";
      overlayCtx.font      = "bold 11px JetBrains Mono, monospace";
      overlayCtx.textAlign = "center";
      overlayCtx.textBaseline = "middle";
      overlayCtx.fillText(LABELS[i] || String(i + 1), pt.x, pt.y - 26);

      overlayCtx.restore();
    });
  }

  /* ─── CAMERA ─────────────────────────────────────────────────── */
  function getVideoConstraints() {
    const portrait = window.innerHeight >= window.innerWidth;
    return {
      facingMode: { ideal: "environment" },
      width:  { ideal: portrait ? 1080 : 1920 },
      height: { ideal: portrait ? 1920 : 1080 },
      aspectRatio: { ideal: portrait ? 9/16 : 16/9 },
    };
  }

  function updateAspectRatio(source) {
    const w = source && (source.videoWidth  || source.width);
    const h = source && (source.videoHeight || source.height);
    if (w && h) DOM.cameraWrap.style.aspectRatio = w + " / " + h;
  }

  async function startCamera() {
    try {
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(), audio: false,
      });

      state.stream       = stream;
      state.frameFrozen  = false;
      state.frozenSource = null;
      state.points       = [];
      state.dragPointIndex = -1;

      DOM.cameraFeed.srcObject = stream;
      setPreviewMode();

      DOM.cameraFeed.onloadedmetadata = function () {
        DOM.cameraFeed.play().catch(() => {});
        updateAspectRatio(DOM.cameraFeed);
        resizeStage();
        DOM.cameraEmpty.hidden = true;
        setStatus("კამერა მზადაა", "მოარგე კედელი კადრში და დააჭირე ქვედა მრგვალ ღილაკს.");
      };
    } catch (err) {
      console.error(err);
      setStatus("კამერა ვერ გაიხსნა", "გამოიყენე HTTPS ან localhost და დაუშვი კამერის ნებართვა.");
    }
  }

  /* ─── FREEZE ─────────────────────────────────────────────────── */
  function suggestWallQuad() {
    const { width, height } = getStageSize();
    const px = width  * 0.10;
    const py = height * 0.08;
    const pb = height * 0.12;
    const sk = width  * 0.04;
    return [
      { x: px + sk,         y: py },
      { x: width - px - sk, y: py },
      { x: width - px,      y: height - pb },
      { x: px,              y: height - pb },
    ];
  }

  function freezeCurrentFrame() {
    if (!state.stream || !DOM.cameraFeed.videoWidth) {
      setStatus("ჯერ გახსენი კამერა", "სანამ კადრს გაყინავ, კამერა უნდა ჩაირთოს.");
      return;
    }

    const snap = document.createElement("canvas");
    snap.width  = DOM.cameraFeed.videoWidth;
    snap.height = DOM.cameraFeed.videoHeight;
    snap.getContext("2d").drawImage(DOM.cameraFeed, 0, 0);

    state.frozenSource = snap;
    state.frameFrozen  = true;
    state.points       = suggestWallQuad();
    state.dragPointIndex = -1;

    DOM.frozenImage.src = snap.toDataURL("image/jpeg", 0.9);
    updateAspectRatio(snap);
    setPreviewMode();
    drawOverlay();
    setStatus("კადრი გაყინულია ✓",
      state.textureImage
        ? "ტექსტურა გამოჩნდა. გადაათრიე კუთხეები კედელზე სწორად."
        : "ახლა ატვირთე ტექსტურა — overlay მაშინვე გამოჩნდება.");
  }

  function unfreezeFrame() {
    state.frameFrozen  = false;
    state.frozenSource = null;
    state.points       = [];
    state.dragPointIndex = -1;
    DOM.frozenImage.removeAttribute("src");
    setPreviewMode();
    drawOverlay();
    setStatus("ახალი კადრი", "გადაამოწმე კედელი და ისევ დააჭირე მრგვალ ღილაკს.");
  }

  function toggleFreeze() {
    state.frameFrozen ? unfreezeFrame() : freezeCurrentFrame();
  }

  /* ─── POINTER / TOUCH ────────────────────────────────────────── */
  function getCanvasPoint(clientX, clientY) {
    const r = DOM.overlayCanvas.getBoundingClientRect();
    return {
      x: clientX - r.left,
      y: clientY - r.top,
    };
  }

  function clampPoint(pt) {
    const { width, height } = getStageSize();
    return {
      x: Math.max(0, Math.min(width,  pt.x)),
      y: Math.max(0, Math.min(height, pt.y)),
    };
  }

  function closestPointIndex(pt) {
    const HIT = 36;   // px hit radius
    let best = -1, bestD = HIT;
    state.points.forEach(function (p, i) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // ─── Mouse ────────────────────────────────────────────────────
  DOM.overlayCanvas.addEventListener("mousedown", function (e) {
    if (!state.frameFrozen) return;
    state.dragPointIndex = closestPointIndex(getCanvasPoint(e.clientX, e.clientY));
    drawOverlay();
  });

  DOM.overlayCanvas.addEventListener("mousemove", function (e) {
    if (!state.frameFrozen || state.dragPointIndex === -1) return;
    state.points[state.dragPointIndex] = clampPoint(getCanvasPoint(e.clientX, e.clientY));
    drawOverlay();
  });

  ["mouseup", "mouseleave"].forEach(function (evt) {
    DOM.overlayCanvas.addEventListener(evt, function () {
      if (state.dragPointIndex === -1) return;
      state.dragPointIndex = -1;
      updateStatusAfterDrag();
      drawOverlay();
    });
  });

  // ─── Touch ────────────────────────────────────────────────────
  DOM.overlayCanvas.addEventListener("touchstart", function (e) {
    if (!state.frameFrozen) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    state.lastTouchId    = touch.identifier;
    state.dragPointIndex = closestPointIndex(getCanvasPoint(touch.clientX, touch.clientY));
    drawOverlay();
  }, { passive: false });

  DOM.overlayCanvas.addEventListener("touchmove", function (e) {
    if (!state.frameFrozen || state.dragPointIndex === -1) return;
    e.preventDefault();
    let touch = null;
    for (let t of e.changedTouches) {
      if (t.identifier === state.lastTouchId) { touch = t; break; }
    }
    if (!touch) return;
    state.points[state.dragPointIndex] = clampPoint(getCanvasPoint(touch.clientX, touch.clientY));
    drawOverlay();
  }, { passive: false });

  ["touchend", "touchcancel"].forEach(function (evt) {
    DOM.overlayCanvas.addEventListener(evt, function () {
      state.dragPointIndex = -1;
      state.lastTouchId    = null;
      updateStatusAfterDrag();
      drawOverlay();
    });
  });

  function updateStatusAfterDrag() {
    setStatus(
      "კედელი მონიშნულია ✓",
      state.textureImage
        ? "ტექსტურა ჩანს. Scale ან Opacity შეცვალე, ან გადაიღე სქრინშოტი."
        : "ახლა ატვირთე ტექსტურა."
    );
  }

  /* ─── TEXTURE UPLOAD ─────────────────────────────────────────── */
  function handleTextureUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = function () {
      state.textureImage = img;
      if (DOM.textureName) DOM.textureName.textContent = file.name;
      setStatus(
        "ტექსტურა ჩაიტვირთა ✓",
        state.points.length === 4
          ? "Overlay განახლდა — Scale და Opacity-ით მოარგე."
          : "ახლა გაყინე კადრი და კუთხეები კედელზე დაადე."
      );
      drawOverlay();
    };
    img.src = URL.createObjectURL(file);
  }

  /* ─── RESET ──────────────────────────────────────────────────── */
  function resetPoints() {
    state.points = state.frameFrozen ? suggestWallQuad() : [];
    drawOverlay();
    setStatus("ჩარჩო განახლდა",
      state.frameFrozen
        ? "ავტომატური ჩარჩო. გადაასწორე კუთხეები."
        : "ჯერ გახსენი კამერა და გაყინე კადრი.");
  }

  /* ─── SCALE / OPACITY ────────────────────────────────────────── */
  function syncScale(val) {
    const v = Math.max(5, Math.min(300, Number(val) || 100));
    state.scalePercent = v;
    DOM.scaleRange.value = String(v);
    DOM.scaleInput.value = String(v);
    drawOverlay();
  }

  function syncOpacity(val) {
    const v = Math.max(10, Math.min(100, Number(val) || 85));
    state.opacityPercent = v;
    if (DOM.opacityRange) DOM.opacityRange.value = String(v);
    if (DOM.opacityInput) DOM.opacityInput.value = String(v);
    drawOverlay();
  }

  /* ─── SCREENSHOT ─────────────────────────────────────────────── */
  function takeScreenshot() {
    if (!state.stream && !state.frozenSource) {
      setStatus("სქრინშოტი ვერ შეიქმნა", "ჯერ გახსენი კამერა.");
      return;
    }

    const { width, height } = getStageSize();
    const exp = document.createElement("canvas");
    exp.width  = Math.round(width);
    exp.height = Math.round(height);
    const ectx = exp.getContext("2d");

    renderSourceContained(
      ectx,
      state.frameFrozen ? state.frozenSource : DOM.cameraFeed,
      exp.width, exp.height
    );

    if (state.textureImage && state.points.length === 4) {
      drawTextureHomography(ectx, state.textureImage, state.points,
        state.scalePercent, state.opacityPercent / 100);
    }

    const link      = document.createElement("a");
    link.href       = exp.toDataURL("image/png");
    link.download   = "wall-preview.png";
    link.click();
    setStatus("სქრინშოტი მზადაა ✓", "ფაილი ჩამოიტვირთა.");
  }

  /* ─── EVENT BINDINGS ─────────────────────────────────────────── */
  DOM.startCameraBtn.addEventListener("click",  startCamera);
  DOM.freezeFrameBtn.addEventListener("click",  toggleFreeze);
  DOM.textureInput.addEventListener("change",   handleTextureUpload);
  DOM.resetPointsBtn.addEventListener("click",  resetPoints);
  DOM.screenshotBtn.addEventListener("click",   takeScreenshot);

  DOM.scaleRange.addEventListener("input",  function () { syncScale(DOM.scaleRange.value); });
  DOM.scaleInput.addEventListener("input",  function () { syncScale(DOM.scaleInput.value); });

  if (DOM.opacityRange) {
    DOM.opacityRange.addEventListener("input", function () { syncOpacity(DOM.opacityRange.value); });
  }
  if (DOM.opacityInput) {
    DOM.opacityInput.addEventListener("input", function () { syncOpacity(DOM.opacityInput.value); });
  }

  window.addEventListener("resize", resizeStage);

  syncFreezeButton();
})();
