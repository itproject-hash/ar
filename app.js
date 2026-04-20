"use strict";

(function () {

  /* ═══════════════════════════════════════════════════════════
     DOM
  ═══════════════════════════════════════════════════════════ */
  const $ = id => document.getElementById(id);
  const DOM = {
    startCameraBtn : $("startCameraBtn"),
    freezeFrameBtn : $("freezeFrameBtn"),
    textureInput   : $("textureInput"),
    resetPointsBtn : $("resetPointsBtn"),
    screenshotBtn  : $("screenshotBtn"),
    scaleRange     : $("scaleRange"),
    scaleInput     : $("scaleInput"),
    opacityRange   : $("opacityRange"),
    opacityInput   : $("opacityInput"),
    cameraFeed     : $("cameraFeed"),
    frozenImage    : $("frozenImage"),
    overlayCanvas  : $("overlayCanvas"),
    cameraEmpty    : $("cameraEmpty"),
    statusTitle    : $("statusTitle"),
    statusText     : $("statusText"),
    cameraWrap     : $("cameraWrap"),
    textureName    : $("textureName"),
    textureNameRow : $("textureNameRow"),
    backBtn        : $("backBtn"),
    confirmBtn     : $("confirmBtn"),
    controlPanel   : $("controlPanel"),
  };

  const overlayCtx = DOM.overlayCanvas.getContext("2d");

  const state = {
    stream         : null,
    textureImage   : null,
    points         : [],
    scalePercent   : 100,
    opacityPercent : 85,
    frameFrozen    : false,
    frozenSource   : null,  // offscreen canvas of the raw snapshot
    dragIndex      : -1,
    lastTouchId    : null,
    // UI phases: "idle" | "live" | "adjusting" | "preview"
    phase          : "idle",
  };

  /* ═══════════════════════════════════════════════════════════
     STATUS
  ═══════════════════════════════════════════════════════════ */
  function setStatus(title, text) {
    DOM.statusTitle.textContent = title;
    DOM.statusText.textContent  = text;
  }

  /* ═══════════════════════════════════════════════════════════
     UI PHASES
     idle      — nothing started
     live      — camera on, viewfinder fullscreen, panel hidden
     adjusting — frame frozen, points visible, panel hidden, confirm shown
     preview   — panel visible, texture overlay visible
  ═══════════════════════════════════════════════════════════ */
  function applyPhase(phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;

    // Camera feed visibility
    DOM.cameraFeed.style.display   = (phase === "live")      ? "block" : "none";
    DOM.frozenImage.style.display  = (phase === "adjusting" || phase === "preview") ? "block" : "none";

    // Shutter button
    DOM.freezeFrameBtn.style.display = phase === "live" ? "block" : "none";

    // Back button (top-left)
    DOM.backBtn.style.display = (phase === "live" || phase === "adjusting") ? "flex" : "none";

    // Confirm (✓) button
    DOM.confirmBtn.style.display = phase === "adjusting" ? "flex" : "none";

    // Bottom panel — visible in idle and preview
    DOM.controlPanel.style.display = (phase === "idle" || phase === "preview") ? "flex" : "none";

    // Empty placeholder
    DOM.cameraEmpty.hidden = phase !== "idle";

    // Resize canvas every time layout changes
    requestAnimationFrame(resizeCanvas);
  }

  /* ═══════════════════════════════════════════════════════════
     CANVAS
  ═══════════════════════════════════════════════════════════ */
  function resizeCanvas() {
    const r   = DOM.cameraWrap.getBoundingClientRect();
    const w   = Math.max(1, r.width);
    const h   = Math.max(1, r.height);
    const dpr = window.devicePixelRatio || 1;

    DOM.overlayCanvas.width  = Math.round(w * dpr);
    DOM.overlayCanvas.height = Math.round(h * dpr);
    DOM.overlayCanvas.style.width  = w + "px";
    DOM.overlayCanvas.style.height = h + "px";
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawOverlay();
  }

  function getSize() {
    const r = DOM.cameraWrap.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  /* ═══════════════════════════════════════════════════════════
     CAMERA  —  no aspectRatio constraint = true 1× zoom
  ═══════════════════════════════════════════════════════════ */
  async function startCamera() {
    try {
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode : { ideal: "environment" },
          width      : { ideal: 1920 },
          height     : { ideal: 1080 },
        },
        audio: false,
      });

      state.stream      = stream;
      state.frameFrozen = false;
      state.points      = [];
      state.dragIndex   = -1;

      DOM.cameraFeed.srcObject = stream;
      applyPhase("live");

      DOM.cameraFeed.onloadedmetadata = () => {
        DOM.cameraFeed.play().catch(() => {});
        DOM.cameraEmpty.hidden = true;
        resizeCanvas();
        setStatus("კამერა მზადაა", "კედელი კადრში მოარგე და დააჭირე მრგვალ ღილაკს.");
      };
    } catch (err) {
      console.error(err);
      applyPhase("idle");
      setStatus("კამერა ვერ გაიხსნა", "გამოიყენე HTTPS ან localhost და დაუშვი კამერის ნებართვა.");
    }
  }

  /* ═══════════════════════════════════════════════════════════
     FREEZE / UNFREEZE
  ═══════════════════════════════════════════════════════════ */
  function suggestQuad() {
    const { w, h } = getSize();
    const mx = w * 0.12;
    const my = h * 0.12;
    return [
      { x: mx,     y: my     },
      { x: w - mx, y: my     },
      { x: w - mx, y: h - my },
      { x: mx,     y: h - my },
    ];
  }

  function freezeFrame() {
    if (!state.stream || !DOM.cameraFeed.videoWidth) {
      setStatus("ჯერ გახსენი კამერა", "კამერა ჯერ არ არის ჩართული.");
      return;
    }

    // Capture raw video frame at full video resolution
    const snap = document.createElement("canvas");
    snap.width  = DOM.cameraFeed.videoWidth;
    snap.height = DOM.cameraFeed.videoHeight;
    snap.getContext("2d").drawImage(DOM.cameraFeed, 0, 0);

    state.frozenSource = snap;
    state.frameFrozen  = true;
    state.points       = suggestQuad();
    state.dragIndex    = -1;

    DOM.frozenImage.src = snap.toDataURL("image/jpeg", 0.92);
    applyPhase("adjusting");
    requestAnimationFrame(() => { resizeCanvas(); drawOverlay(); });

    setStatus("კუთხეები გადაათრიე კედლის კიდეებზე",
      "4 წერტილი კედლის კუთხეებზე მოარგე, შემდეგ დააჭირე ✓");
  }

  function confirmPoints() {
    // Move to preview phase (panel becomes visible)
    applyPhase("preview");
    requestAnimationFrame(() => { resizeCanvas(); drawOverlay(); });
    setStatus("კედელი მონიშნულია ✓",
      state.textureImage
        ? "ტექსტურა ჩანს. Scale-ით მოარგე ზომა."
        : "ახლა ატვირთე ტექსტურა.");
  }

  function unfreezeFrame() {
    // Go back to live camera
    state.frameFrozen  = false;
    state.frozenSource = null;
    state.points       = [];
    state.dragIndex    = -1;
    DOM.frozenImage.removeAttribute("src");
    applyPhase("live");
    drawOverlay();
    setStatus("ახალი კადრი", "კედელი მოარგე კადრში და ისევ დააჭირე ღილაკს.");
  }

  function goToLive() {
    // From preview → live camera again (keep stream)
    state.frameFrozen  = false;
    state.frozenSource = null;
    state.points       = [];
    state.dragIndex    = -1;
    DOM.frozenImage.removeAttribute("src");
    applyPhase("live");
    drawOverlay();
    setStatus("კამერა მზადაა", "კედელი კადრში მოარგე და დააჭირე მრგვალ ღილაკს.");
  }

  /* ═══════════════════════════════════════════════════════════
     HOMOGRAPHY  —  Direct Linear Transform
     Maps unit square [0,1]² onto an arbitrary quad.
     quad order: [TL, TR, BR, BL]
  ═══════════════════════════════════════════════════════════ */
  function solveH(dst) {
    const srcX = [0, 1, 1, 0];
    const srcY = [0, 0, 1, 1];
    const M = [];
    for (let i = 0; i < 4; i++) {
      const sx = srcX[i], sy = srcY[i], dx = dst[i].x, dy = dst[i].y;
      M.push([ sx, sy, 1,  0,  0, 0, -dx*sx, -dx*sy, -dx ]);
      M.push([  0,  0, 0, sx, sy, 1, -dy*sx, -dy*sy, -dy ]);
    }
    const n = 8;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col+1; r < n; r++)
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      const d = M[col][col];
      if (Math.abs(d) < 1e-10) return null;
      for (let j = col; j <= n; j++) M[col][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
      }
    }
    return M.map(r => r[n]);
  }

  // Forward homography: unit-square (sx,sy) → screen (x,y)
  function proj(h, sx, sy) {
    const w = h[6]*sx + h[7]*sy + 1;
    return { x: (h[0]*sx + h[1]*sy + h[2])/w,
             y: (h[3]*sx + h[4]*sy + h[5])/w };
  }

  /* ═══════════════════════════════════════════════════════════
     DRAW TEXTURE via perspective-correct scanline strips
     The texture is tiled relative to the quad's own coordinate
     system — scalePct=100 → one tile equals the quad's width.
  ═══════════════════════════════════════════════════════════ */
  function drawTexture(ctx, img, quad, scalePct, opacity) {
    if (!img || quad.length !== 4) return;

    const H = solveH(quad);
    if (!H) return;

    // Physical size of the quad in screen pixels
    const qw = Math.max(
      Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y),
      Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y), 1);
    const qh = Math.max(
      Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y),
      Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y), 1);

    // Tile dimensions in quad-local pixels
    // scalePct=100 → tile width = qw (one repeat across the wall)
    const tileW = Math.max(4, qw * (scalePct / 100));
    const tileH = Math.max(4, tileW * (img.naturalHeight / Math.max(img.naturalWidth, 1)));

    // Render a pattern canvas that covers the entire quad bbox
    // We work in the quad's normalised space (0..1) so the pattern
    // exactly fills the quad regardless of perspective.
    const patW = Math.round(Math.max(64, qw));
    const patH = Math.round(Math.max(64, qh));
    const patC = document.createElement("canvas");
    patC.width  = patW;
    patC.height = patH;
    const pc   = patC.getContext("2d");
    const tw   = Math.round(tileW);
    const th   = Math.round(tileH);
    for (let py = 0; py < patH + th; py += th)
      for (let px = 0; px < patW + tw; px += tw)
        pc.drawImage(img, px, py, tw, th);

    // Number of vertical strips for perspective correctness
    const SLICES = Math.min(800, Math.max(80, Math.round(Math.max(qw, qh) / 1)));

    ctx.save();
    ctx.globalAlpha = opacity;

    // Clip to quad shape so texture never bleeds outside
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    ctx.lineTo(quad[1].x, quad[1].y);
    ctx.lineTo(quad[2].x, quad[2].y);
    ctx.lineTo(quad[3].x, quad[3].y);
    ctx.closePath();
    ctx.clip();

    for (let i = 0; i < SLICES; i++) {
      const t0 = i / SLICES, t1 = (i + 1) / SLICES;
      // Four corners of this thin vertical strip in screen space
      const d00 = proj(H, t0, 0); // top-left of strip
      const d10 = proj(H, t1, 0); // top-right
      const d11 = proj(H, t1, 1); // bottom-right
      const d01 = proj(H, t0, 1); // bottom-left

      // Corresponding x range in the pattern canvas
      const sx0 = t0 * patW;
      const sw  = (t1 - t0) * patW;

      ctx.save();
      // Clip to this strip
      ctx.beginPath();
      ctx.moveTo(d00.x, d00.y);
      ctx.lineTo(d10.x, d10.y);
      ctx.lineTo(d11.x, d11.y);
      ctx.lineTo(d01.x, d01.y);
      ctx.closePath();
      ctx.clip();

      // Build affine transform that maps patC → this strip
      const dxH = d10.x - d00.x, dyH = d10.y - d00.y; // horizontal direction
      const dxV = d01.x - d00.x, dyV = d01.y - d00.y; // vertical direction

      ctx.transform(
        dxH / sw,   dyH / sw,
        dxV / patH, dyV / patH,
        d00.x - sx0 * dxH / sw,
        d00.y - sx0 * dyH / sw
      );
      ctx.drawImage(patC, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════
     DRAW OVERLAY
  ═══════════════════════════════════════════════════════════ */
  function drawOverlay() {
    const { w, h } = getSize();
    overlayCtx.clearRect(0, 0, w, h);

    if (state.textureImage && state.points.length === 4)
      drawTexture(overlayCtx, state.textureImage, state.points,
        state.scalePercent, state.opacityPercent / 100);

    // Quad outline
    if (state.points.length >= 2) {
      overlayCtx.save();
      overlayCtx.beginPath();
      overlayCtx.moveTo(state.points[0].x, state.points[0].y);
      for (let i = 1; i < state.points.length; i++)
        overlayCtx.lineTo(state.points[i].x, state.points[i].y);
      if (state.points.length === 4) {
        overlayCtx.closePath();
        if (!state.textureImage) {
          overlayCtx.fillStyle = "rgba(22,196,181,0.10)";
          overlayCtx.fill();
        }
      }
      overlayCtx.strokeStyle = "rgba(22,196,181,0.85)";
      overlayCtx.lineWidth   = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    // Corner handles (only when adjusting or preview)
    if (state.phase === "adjusting" || state.phase === "preview") {
      const LABELS = ["↖","↗","↘","↙"];
      state.points.forEach((pt, i) => {
        const act = i === state.dragIndex;
        overlayCtx.save();
        overlayCtx.shadowColor = "rgba(0,0,0,0.7)";
        overlayCtx.shadowBlur  = 10;

        overlayCtx.beginPath();
        overlayCtx.arc(pt.x, pt.y, 20, 0, Math.PI * 2);
        overlayCtx.fillStyle   = act ? "rgba(249,115,22,0.3)" : "rgba(8,17,31,0.55)";
        overlayCtx.fill();
        overlayCtx.strokeStyle = act ? "#ffffff" : "#f97316";
        overlayCtx.lineWidth   = 3;
        overlayCtx.shadowBlur  = 0;
        overlayCtx.stroke();

        overlayCtx.beginPath();
        overlayCtx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
        overlayCtx.fillStyle = act ? "#ffffff" : "#f97316";
        overlayCtx.fill();

        overlayCtx.fillStyle    = "rgba(255,255,255,0.9)";
        overlayCtx.font         = "bold 13px JetBrains Mono, monospace";
        overlayCtx.textAlign    = "center";
        overlayCtx.textBaseline = "bottom";
        overlayCtx.fillText(LABELS[i], pt.x, pt.y - 24);
        overlayCtx.restore();
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     POINTER / TOUCH
  ═══════════════════════════════════════════════════════════ */
  function canvasPt(cx, cy) {
    const r = DOM.overlayCanvas.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }
  function clamp(pt) {
    const { w, h } = getSize();
    return { x: Math.max(0, Math.min(w, pt.x)), y: Math.max(0, Math.min(h, pt.y)) };
  }
  function nearest(pt) {
    const HIT = 44;
    let best = -1, bestD = HIT;
    state.points.forEach((p, i) => {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function afterDrag() {
    state.dragIndex = -1;
    drawOverlay();
  }

  const interactivePhases = new Set(["adjusting", "preview"]);

  DOM.overlayCanvas.addEventListener("mousedown", e => {
    if (!interactivePhases.has(state.phase)) return;
    state.dragIndex = nearest(canvasPt(e.clientX, e.clientY));
    drawOverlay();
  });
  DOM.overlayCanvas.addEventListener("mousemove", e => {
    if (!interactivePhases.has(state.phase) || state.dragIndex < 0) return;
    state.points[state.dragIndex] = clamp(canvasPt(e.clientX, e.clientY));
    drawOverlay();
  });
  ["mouseup","mouseleave"].forEach(ev =>
    DOM.overlayCanvas.addEventListener(ev, () => { if (state.dragIndex >= 0) afterDrag(); }));

  DOM.overlayCanvas.addEventListener("touchstart", e => {
    if (!interactivePhases.has(state.phase)) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    state.lastTouchId = t.identifier;
    state.dragIndex   = nearest(canvasPt(t.clientX, t.clientY));
    drawOverlay();
  }, { passive: false });

  DOM.overlayCanvas.addEventListener("touchmove", e => {
    if (!interactivePhases.has(state.phase) || state.dragIndex < 0) return;
    e.preventDefault();
    let touch = null;
    for (const t of e.changedTouches)
      if (t.identifier === state.lastTouchId) { touch = t; break; }
    if (!touch) return;
    state.points[state.dragIndex] = clamp(canvasPt(touch.clientX, touch.clientY));
    drawOverlay();
  }, { passive: false });

  ["touchend","touchcancel"].forEach(ev =>
    DOM.overlayCanvas.addEventListener(ev, () => {
      state.lastTouchId = null;
      if (state.dragIndex >= 0) afterDrag();
    }));

  /* ═══════════════════════════════════════════════════════════
     TEXTURE UPLOAD
  ═══════════════════════════════════════════════════════════ */
  DOM.textureInput.addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (DOM.textureName)    DOM.textureName.textContent = file.name;
    if (DOM.textureNameRow) DOM.textureNameRow.hidden   = false;
    const img = new Image();
    img.onload = () => {
      state.textureImage = img;
      setStatus("ტექსტურა ჩაიტვირთა ✓",
        state.points.length === 4
          ? "Overlay განახლდა. Scale-ით მოარგე ზომა."
          : "ახლა გაყინე კადრი და კუთხეები კედელზე გადაათრიე.");
      drawOverlay();
    };
    img.src = URL.createObjectURL(file);
  });

  /* ═══════════════════════════════════════════════════════════
     RESET
  ═══════════════════════════════════════════════════════════ */
  DOM.resetPointsBtn.addEventListener("click", () => {
    state.points = (state.phase === "adjusting" || state.phase === "preview")
      ? suggestQuad() : [];
    drawOverlay();
    setStatus("ჩარჩო განახლდა", "კუთხეები კედლის კიდეებზე გადაათრიე.");
  });

  /* ═══════════════════════════════════════════════════════════
     SCALE / OPACITY
  ═══════════════════════════════════════════════════════════ */
  function syncScale(v) {
    v = Math.max(5, Math.min(300, Number(v) || 100));
    state.scalePercent   = v;
    DOM.scaleRange.value = String(v);
    DOM.scaleInput.value = String(v);
    drawOverlay();
  }
  function syncOpacity(v) {
    v = Math.max(10, Math.min(100, Number(v) || 85));
    state.opacityPercent   = v;
    DOM.opacityRange.value = String(v);
    DOM.opacityInput.value = String(v);
    drawOverlay();
  }
  DOM.scaleRange.addEventListener("input",   () => syncScale(DOM.scaleRange.value));
  DOM.scaleInput.addEventListener("input",   () => syncScale(DOM.scaleInput.value));
  DOM.opacityRange.addEventListener("input", () => syncOpacity(DOM.opacityRange.value));
  DOM.opacityInput.addEventListener("input", () => syncOpacity(DOM.opacityInput.value));

  /* ═══════════════════════════════════════════════════════════
     SCREENSHOT
  ═══════════════════════════════════════════════════════════ */
  DOM.screenshotBtn.addEventListener("click", () => {
    if (!state.frozenSource) {
      setStatus("სქრინშოტი ვერ შეიქმნა", "ჯერ გახსენი კამერა და გაყინე კადრი.");
      return;
    }
    const { w, h } = getSize();
    const exp = document.createElement("canvas");
    exp.width  = Math.round(w);
    exp.height = Math.round(h);
    const ec  = exp.getContext("2d");

    const src = state.frozenSource;
    const sw  = src.width  || 1;
    const sh  = src.height || 1;
    const sc  = Math.max(w / sw, h / sh);
    ec.drawImage(src, (w - sw * sc) / 2, (h - sh * sc) / 2, sw * sc, sh * sc);

    if (state.textureImage && state.points.length === 4)
      drawTexture(ec, state.textureImage, state.points,
        state.scalePercent, state.opacityPercent / 100);

    const a = document.createElement("a");
    a.href = exp.toDataURL("image/png");
    a.download = "wall-preview.png";
    a.click();
    setStatus("სქრინშოტი მზადაა ✓", "ფაილი ჩამოიტვირთა.");
  });

  /* ═══════════════════════════════════════════════════════════
     BUTTON BINDINGS
  ═══════════════════════════════════════════════════════════ */

  // "კამერა" button in the panel
  DOM.startCameraBtn.addEventListener("click", () => {
    if (state.stream && !state.frameFrozen) return; // already live
    if (state.phase === "preview") { goToLive(); return; }
    startCamera();
  });

  // Shutter
  DOM.freezeFrameBtn.addEventListener("click", freezeFrame);

  // Back button (top-left): context-sensitive
  DOM.backBtn.addEventListener("click", () => {
    if (state.phase === "live")      { unfreezeFrame(); return; }
    if (state.phase === "adjusting") { unfreezeFrame(); return; }
  });

  // ✓ Confirm button
  DOM.confirmBtn.addEventListener("click", confirmPoints);

  window.addEventListener("resize", resizeCanvas);

  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */
  applyPhase("idle");

})();