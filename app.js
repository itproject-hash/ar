"use strict";

(function () {
  const DOM = {
    startCameraBtn: document.getElementById("startCameraBtn"),
    freezeFrameBtn: document.getElementById("freezeFrameBtn"),
    textureInput: document.getElementById("textureInput"),
    resetPointsBtn: document.getElementById("resetPointsBtn"),
    screenshotBtn: document.getElementById("screenshotBtn"),
    scaleRange: document.getElementById("scaleRange"),
    scaleInput: document.getElementById("scaleInput"),
    cameraFeed: document.getElementById("cameraFeed"),
    frameCanvas: document.getElementById("frameCanvas"),
    overlayCanvas: document.getElementById("overlayCanvas"),
    cameraEmpty: document.getElementById("cameraEmpty"),
    statusTitle: document.getElementById("statusTitle"),
    statusText: document.getElementById("statusText"),
    cameraWrap: document.getElementById("cameraWrap")
  };

  const frameCtx = DOM.frameCanvas.getContext("2d");
  const overlayCtx = DOM.overlayCanvas.getContext("2d");
  const state = {
    stream: null,
    textureImage: null,
    points: [],
    scalePercent: 100,
    frameFrozen: false,
    frozenFrameSource: null,
    dragPointIndex: -1
  };

  function setStatus(title, text) {
    DOM.statusTitle.textContent = title;
    DOM.statusText.textContent = text;
  }

  function syncFreezeButton() {
    DOM.freezeFrameBtn.dataset.frozen = state.frameFrozen ? "true" : "false";
  }

  function getViewportOrientation() {
    return window.innerHeight >= window.innerWidth ? "portrait" : "landscape";
  }

  function getPreferredVideoConstraints() {
    if (getViewportOrientation() === "portrait") {
      return {
        facingMode: { ideal: "environment" },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        aspectRatio: { ideal: 9 / 16 }
      };
    }

    return {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 }
    };
  }

  function updateStageAspectRatio(source) {
    const sourceWidth = source && (source.videoWidth || source.width);
    const sourceHeight = source && (source.videoHeight || source.height);
    if (!sourceWidth || !sourceHeight) return;
    DOM.cameraWrap.style.aspectRatio = sourceWidth + " / " + sourceHeight;
  }

  function setCanvasSize(canvas, width, height, dpr) {
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getStageSize() {
    const rect = DOM.cameraWrap.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
  }

  function renderSourceContained(targetCtx, source, width, height) {
    if (!source) return;

    const sourceWidth = source.videoWidth || source.width || 1;
    const sourceHeight = source.videoHeight || source.height || 1;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const dx = (width - drawWidth) / 2;
    const dy = (height - drawHeight) / 2;

    targetCtx.fillStyle = "#02040b";
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.drawImage(source, dx, dy, drawWidth, drawHeight);
  }

  function drawFrozenFrame() {
    const size = getStageSize();
    frameCtx.clearRect(0, 0, size.width, size.height);

    if (state.frozenFrameSource) {
      updateStageAspectRatio(state.frozenFrameSource);
      renderSourceContained(frameCtx, state.frozenFrameSource, size.width, size.height);
    }
  }

  function drawPoints(targetCtx) {
    state.points.forEach(function (point, index) {
      targetCtx.save();
      targetCtx.beginPath();
      targetCtx.fillStyle = "#f97316";
      targetCtx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.fillStyle = "#ffffff";
      targetCtx.font = "600 12px JetBrains Mono, monospace";
      targetCtx.fillText(String(index + 1), point.x + 10, point.y - 10);
      targetCtx.restore();
    });
  }

  function lerpPoint(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  function drawTextureToQuad(image, quad, scalePercent, targetCtx) {
    if (!image || quad.length !== 4) return;

    const ctx = targetCtx || overlayCtx;
    const strips = 96;
    const topLength = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    const bottomLength = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
    const leftLength = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    const approxWidth = Math.max(topLength, bottomLength, 1);
    const approxHeight = Math.max(leftLength, 1);
    const scale = Math.max(0.35, scalePercent / 100);
    const baseTileWidth = Math.max(72, approxWidth / 3.5);
    const tileWidth = Math.min(approxWidth, baseTileWidth * scale);
    const tileHeight = Math.max(72, tileWidth * ((image.height || 1) / (image.width || 1)));

    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = Math.max(64, Math.round(tileWidth));
    tileCanvas.height = Math.max(64, Math.round(tileHeight));
    tileCanvas.getContext("2d").drawImage(image, 0, 0, tileCanvas.width, tileCanvas.height);

    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = Math.max(64, Math.round(approxWidth || 256));
    patternCanvas.height = Math.max(64, Math.round(approxHeight || 256));
    const pctx = patternCanvas.getContext("2d");
    pctx.fillStyle = pctx.createPattern(tileCanvas, "repeat");
    pctx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

    for (let i = 0; i < strips; i += 1) {
      const t0 = i / strips;
      const t1 = (i + 1) / strips;
      const p0 = lerpPoint(quad[0], quad[1], t0);
      const p1 = lerpPoint(quad[0], quad[1], t1);
      const p3 = lerpPoint(quad[3], quad[2], t0);
      const p2 = lerpPoint(quad[3], quad[2], t1);
      const sx = t0 * patternCanvas.width;
      const sw = (t1 - t0) * patternCanvas.width;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.clip();

      const dx1 = p1.x - p0.x;
      const dy1 = p1.y - p0.y;
      const dx2 = p3.x - p0.x;
      const dy2 = p3.y - p0.y;

      ctx.transform(
        dx1 / sw,
        dy1 / sw,
        dx2 / patternCanvas.height,
        dy2 / patternCanvas.height,
        p0.x - (sx * dx1) / sw,
        p0.y - (sx * dy1) / sw
      );

      ctx.drawImage(patternCanvas, 0, 0);
      ctx.restore();
    }
  }

  function drawOverlay() {
    const size = getStageSize();
    overlayCtx.clearRect(0, 0, size.width, size.height);

    if (state.textureImage && state.points.length === 4) {
      drawTextureToQuad(state.textureImage, state.points, state.scalePercent, overlayCtx);
    }

    if (state.points.length) {
      overlayCtx.save();
      overlayCtx.strokeStyle = "rgba(22,196,181,0.95)";
      overlayCtx.lineWidth = 2;
      overlayCtx.fillStyle = "rgba(22,196,181,0.18)";
      overlayCtx.beginPath();
      overlayCtx.moveTo(state.points[0].x, state.points[0].y);
      for (let i = 1; i < state.points.length; i += 1) {
        overlayCtx.lineTo(state.points[i].x, state.points[i].y);
      }
      if (state.points.length === 4) {
        overlayCtx.closePath();
        overlayCtx.fill();
      }
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    drawPoints(overlayCtx);
  }

  function resizeStage() {
    const size = getStageSize();
    const dpr = window.devicePixelRatio || 1;
    setCanvasSize(DOM.frameCanvas, size.width, size.height, dpr);
    setCanvasSize(DOM.overlayCanvas, size.width, size.height, dpr);

    if (state.frameFrozen) {
      drawFrozenFrame();
    }

    drawOverlay();
  }

  function setPreviewMode() {
    DOM.cameraFeed.style.display = state.frameFrozen ? "none" : "block";
    DOM.frameCanvas.style.display = state.frameFrozen ? "block" : "none";
    syncFreezeButton();
  }

  async function startCamera() {
    try {
      if (state.stream) {
        state.stream.getTracks().forEach(function (track) { track.stop(); });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: getPreferredVideoConstraints(),
        audio: false
      });

      state.stream = stream;
      state.frameFrozen = false;
      state.frozenFrameSource = null;
      state.dragPointIndex = -1;
      DOM.cameraFeed.srcObject = stream;
      setPreviewMode();

      DOM.cameraFeed.onloadedmetadata = function () {
        DOM.cameraFeed.play().catch(function () {});
        updateStageAspectRatio(DOM.cameraFeed);
        resizeStage();
        DOM.cameraEmpty.hidden = true;
        setStatus("კამერა მზადაა", "მოარგე კედელი კადრში და დააჭირე ქვედა მრგვალ ღილაკს.");
      };
    } catch (error) {
      console.error(error);
      setStatus("კამერა ვერ გაიხსნა", "ტელეფონზე გამოიყენე HTTPS ან localhost და დაუშვი კამერის ნებართვა.");
    }
  }

  function suggestWallQuad() {
    const size = getStageSize();
    const insetX = size.width * 0.1;
    const insetTop = size.height * 0.08;
    const insetBottom = size.height * 0.12;
    const skew = size.width * 0.05;

    return [
      { x: insetX + skew, y: insetTop },
      { x: size.width - insetX - skew, y: insetTop },
      { x: size.width - insetX, y: size.height - insetBottom },
      { x: insetX, y: size.height - insetBottom }
    ];
  }

  function freezeCurrentFrame() {
    if (!state.stream || !DOM.cameraFeed.videoWidth) {
      setStatus("ჯერ გახსენი კამერა", "სანამ კადრს გაყინავ, კამერა უნდა ჩაირთოს.");
      return;
    }

    const frozenSource = document.createElement("canvas");
    frozenSource.width = DOM.cameraFeed.videoWidth;
    frozenSource.height = DOM.cameraFeed.videoHeight;
    frozenSource.getContext("2d").drawImage(DOM.cameraFeed, 0, 0, frozenSource.width, frozenSource.height);

    state.frozenFrameSource = frozenSource;
    state.frameFrozen = true;
    state.points = suggestWallQuad();
    state.dragPointIndex = -1;
    setPreviewMode();
    drawFrozenFrame();
    drawOverlay();
    setStatus("კადრი გაყინულია", "საწყისი ჩარჩო დაემატა. თუ საჭიროა, წერტილები თითით გადაათრიე.");
  }

  function unfreezeFrame() {
    state.frameFrozen = false;
    state.points = [];
    state.frozenFrameSource = null;
    state.dragPointIndex = -1;
    setPreviewMode();
    drawOverlay();
    setStatus("ახალი კადრი", "გადაამოწმე კედელი და ისევ დააჭირე მრგვალ ღილაკს.");
  }

  function toggleFreezeFrame() {
    if (state.frameFrozen) {
      unfreezeFrame();
      return;
    }

    freezeCurrentFrame();
  }

  function getPointerPosition(event) {
    const rect = DOM.overlayCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function clampPoint(point) {
    const size = getStageSize();
    return {
      x: Math.max(0, Math.min(size.width, point.x)),
      y: Math.max(0, Math.min(size.height, point.y))
    };
  }

  function getClosestPointIndex(point) {
    let bestIndex = -1;
    let bestDistance = 28;

    state.points.forEach(function (candidate, index) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function handleCanvasTap(event) {
    if (!state.stream) {
      setStatus("ჯერ გახსენი კამერა", "პირველ რიგში ჩართე კამერა.");
      return;
    }

    if (!state.frameFrozen) {
      setStatus("ჯერ გაყინე კადრი", "წერტილების გასასწორებლად ჯერ დააჭირე ქვედა მრგვალ ღილაკს.");
      return;
    }

    const pointer = getPointerPosition(event);
    const closestIndex = getClosestPointIndex(pointer);
    if (closestIndex !== -1) {
      state.dragPointIndex = closestIndex;
    }

    drawOverlay();
  }

  function handleCanvasDrag(event) {
    if (!state.frameFrozen || state.dragPointIndex === -1) return;
    state.points[state.dragPointIndex] = clampPoint(getPointerPosition(event));
    drawOverlay();
  }

  function stopCanvasDrag() {
    if (state.dragPointIndex === -1) return;
    state.dragPointIndex = -1;
    setStatus(
      "კედელი მონიშნულია",
      state.textureImage
        ? "ტექსტურა უკვე ჩანს. შეგიძლია scale შეცვალო ან სქრინშოტი გადაიღო."
        : "ახლა ატვირთე ტექსტურა და შედეგი მაშინვე გამოჩნდება."
    );
  }

  function handleTextureUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const image = new Image();
    image.onload = function () {
      state.textureImage = image;
      setStatus(
        "ტექსტურა ჩაიტვირთა",
        state.points.length === 4
          ? "overlay განახლდა. შეგიძლია scale შეცვალო ან სქრინშოტი გადაიღო."
          : "ახლა გაყინე კადრი და საჭიროებისას გადაასწორე კუთხეები."
      );
      drawOverlay();
    };
    image.src = URL.createObjectURL(file);
  }

  function resetPoints() {
    state.points = state.frameFrozen ? suggestWallQuad() : [];
    drawOverlay();
    setStatus("ჩარჩო განახლდა", state.frameFrozen
      ? "ავტომატური ჩარჩო თავიდან დაემატა. გადაასწორე კუთხეები თუ საჭიროა."
      : "ჯერ გახსენი კამერა და გაყინე კადრი.");
  }

  function syncScale(value) {
    const numeric = Math.max(20, Math.min(240, Number(value) || 100));
    state.scalePercent = numeric;
    DOM.scaleRange.value = String(numeric);
    DOM.scaleInput.value = String(numeric);
    drawOverlay();
  }

  function takeScreenshot() {
    if (!state.stream && !state.frozenFrameSource) {
      setStatus("სქრინშოტი ვერ შეიქმნა", "ჯერ გახსენი კამერა.");
      return;
    }

    const size = getStageSize();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(size.width));
    exportCanvas.height = Math.max(1, Math.round(size.height));
    const exportCtx = exportCanvas.getContext("2d");

    renderSourceContained(
      exportCtx,
      state.frameFrozen ? state.frozenFrameSource : DOM.cameraFeed,
      exportCanvas.width,
      exportCanvas.height
    );

    if (state.textureImage && state.points.length === 4) {
      drawTextureToQuad(state.textureImage, state.points, state.scalePercent, exportCtx);
    }

    drawPoints(exportCtx);

    const link = document.createElement("a");
    link.href = exportCanvas.toDataURL("image/png");
    link.download = "wall-preview-mvp.png";
    link.click();
    setStatus("სქრინშოტი მზადაა", "ფაილი ჩამოიტვირთა.");
  }

  DOM.startCameraBtn.addEventListener("click", startCamera);
  DOM.freezeFrameBtn.addEventListener("click", toggleFreezeFrame);
  DOM.textureInput.addEventListener("change", handleTextureUpload);
  DOM.resetPointsBtn.addEventListener("click", resetPoints);
  DOM.screenshotBtn.addEventListener("click", takeScreenshot);
  DOM.scaleRange.addEventListener("input", function () { syncScale(DOM.scaleRange.value); });
  DOM.scaleInput.addEventListener("input", function () { syncScale(DOM.scaleInput.value); });
  DOM.overlayCanvas.addEventListener("pointerdown", handleCanvasTap);
  DOM.overlayCanvas.addEventListener("pointermove", handleCanvasDrag);
  DOM.overlayCanvas.addEventListener("pointerup", stopCanvasDrag);
  DOM.overlayCanvas.addEventListener("pointercancel", stopCanvasDrag);
  DOM.overlayCanvas.addEventListener("pointerleave", stopCanvasDrag);
  window.addEventListener("resize", resizeStage);

  syncFreezeButton();
})();
