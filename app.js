"use strict";

(function () {
  const DOM = {
    startCameraBtn: document.getElementById("startCameraBtn"),
    textureInput: document.getElementById("textureInput"),
    resetPointsBtn: document.getElementById("resetPointsBtn"),
    screenshotBtn: document.getElementById("screenshotBtn"),
    scaleRange: document.getElementById("scaleRange"),
    scaleInput: document.getElementById("scaleInput"),
    cameraFeed: document.getElementById("cameraFeed"),
    overlayCanvas: document.getElementById("overlayCanvas"),
    cameraEmpty: document.getElementById("cameraEmpty"),
    statusTitle: document.getElementById("statusTitle"),
    statusText: document.getElementById("statusText"),
    cameraWrap: document.getElementById("cameraWrap")
  };

  const ctx = DOM.overlayCanvas.getContext("2d");
  const state = {
    stream: null,
    textureImage: null,
    points: [],
    scalePercent: 100
  };

  function setStatus(title, text) {
    DOM.statusTitle.textContent = title;
    DOM.statusText.textContent = text;
  }

  async function startCamera() {
    try {
      if (state.stream) {
        state.stream.getTracks().forEach(function (track) { track.stop(); });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });

      state.stream = stream;
      DOM.cameraFeed.srcObject = stream;
      DOM.cameraFeed.onloadedmetadata = function () {
        DOM.cameraFeed.play().catch(function () {});
        resizeCanvas();
        DOM.cameraEmpty.hidden = true;
        setStatus("კამერა ჩაირთო", "ახლა მონიშნე 4 წერტილი კედელზე. ჯერ ზედა მარცხენა, შემდეგ ზედა მარჯვენა, ქვედა მარჯვენა და ბოლოს ქვედა მარცხენა.");
        drawOverlay();
      };
    } catch (error) {
      console.error(error);
      setStatus("კამერა ვერ გაიხსნა", "თუ ტელეფონზე ტესტავ, გამოიყენე HTTPS ან localhost და დაუშვი კამერის ნებართვა.");
    }
  }

  function resizeCanvas() {
    const rect = DOM.cameraFeed.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    DOM.overlayCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    DOM.overlayCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    DOM.overlayCanvas.style.width = rect.width + "px";
    DOM.overlayCanvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay();
  }

  function getPointerPosition(event) {
    const rect = DOM.overlayCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function lerpPoint(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  function drawTextureToQuad(image, quad, scalePercent) {
    if (!image || quad.length !== 4) return;

    const strips = 96;
    const topLength = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    const bottomLength = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
    const leftLength = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    const approxWidth = Math.max(topLength, bottomLength, 1);
    const approxHeight = Math.max(leftLength, 1);
    const scale = Math.max(0.2, scalePercent / 100);

    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = Math.max(64, Math.round((approxWidth / scale) || 256));
    patternCanvas.height = Math.max(64, Math.round((approxHeight / scale) || 256));
    const pctx = patternCanvas.getContext("2d");
    const pattern = pctx.createPattern(image, "repeat");
    pctx.save();
    pctx.scale(scale, scale);
    pctx.fillStyle = pattern;
    pctx.fillRect(0, 0, patternCanvas.width / scale, patternCanvas.height / scale);
    pctx.restore();

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
    const width = DOM.overlayCanvas.clientWidth || DOM.cameraWrap.clientWidth;
    const height = DOM.overlayCanvas.clientHeight || DOM.cameraWrap.clientHeight;
    ctx.clearRect(0, 0, width, height);

    if (state.textureImage && state.points.length === 4) {
      drawTextureToQuad(state.textureImage, state.points, state.scalePercent);
    }

    if (state.points.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(22,196,181,0.95)";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(22,196,181,0.18)";
      ctx.beginPath();
      ctx.moveTo(state.points[0].x, state.points[0].y);
      for (let i = 1; i < state.points.length; i += 1) {
        ctx.lineTo(state.points[i].x, state.points[i].y);
      }
      if (state.points.length === 4) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    }

    state.points.forEach(function (point, index) {
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = "#f97316";
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 12px JetBrains Mono, monospace";
      ctx.fillText(String(index + 1), point.x + 10, point.y - 10);
      ctx.restore();
    });
  }

  function handleCanvasTap(event) {
    if (!state.stream) {
      setStatus("ჯერ კამერა გაუშვი", "პირველ რიგში დააჭირე კამერის გახსნას.");
      return;
    }

    if (state.points.length >= 4) {
      state.points = [];
    }

    state.points.push(getPointerPosition(event));

    if (state.points.length < 4) {
      const labels = ["ზედა მარცხენა", "ზედა მარჯვენა", "ქვედა მარჯვენა", "ქვედა მარცხენა"];
      setStatus("წერტილი დაემატა", "შემდეგი წერტილი: " + labels[state.points.length] + ".");
    } else {
      setStatus("კედელი მონიშნულია", state.textureImage
        ? "ტექსტურა უკვე ჩანს. შეგიძლია scale შეცვალო ან სქრინშოტი გადაიღო."
        : "ახლა ატვირთე ტექსტურა, რომ კედელზე დაინახო.");
    }

    drawOverlay();
  }

  function handleTextureUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const image = new Image();
    image.onload = function () {
      state.textureImage = image;
      setStatus("ტექსტურა ჩაიტვირთა", state.points.length === 4
        ? "overlay განახლდა. შეგიძლია scale შეცვალო ან სქრინშოტი გადაიღო."
        : "ახლა მონიშნე 4 წერტილი, რომ ტექსტურა კედელზე დაჯდეს.");
      drawOverlay();
    };
    image.src = URL.createObjectURL(file);
  }

  function resetPoints() {
    state.points = [];
    drawOverlay();
    setStatus("წერტილები გასუფთავდა", "ახლა თავიდან მონიშნე 4 წერტილი კედელზე.");
  }

  function syncScale(value) {
    const numeric = Math.max(20, Math.min(240, Number(value) || 100));
    state.scalePercent = numeric;
    DOM.scaleRange.value = String(numeric);
    DOM.scaleInput.value = String(numeric);
    drawOverlay();
  }

  function takeScreenshot() {
    if (!state.stream) {
      setStatus("სქრინშოტი ვერ შეიქმნა", "ჯერ კამერა გაუშვი.");
      return;
    }

    const exportCanvas = document.createElement("canvas");
    const videoWidth = DOM.cameraFeed.videoWidth || 720;
    const videoHeight = DOM.cameraFeed.videoHeight || 1280;
    exportCanvas.width = videoWidth;
    exportCanvas.height = videoHeight;
    const exportCtx = exportCanvas.getContext("2d");

    exportCtx.drawImage(DOM.cameraFeed, 0, 0, videoWidth, videoHeight);

    const scaleX = videoWidth / DOM.overlayCanvas.clientWidth;
    const scaleY = videoHeight / DOM.overlayCanvas.clientHeight;
    exportCtx.scale(scaleX, scaleY);

    if (state.textureImage && state.points.length === 4) {
      drawTextureToQuad(state.textureImage, state.points, state.scalePercent, exportCtx);
    }

    const dataUrl = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "wall-preview-mvp.png";
    link.click();
    setStatus("სქრინშოტი შეიქმნა", "ფაილი ჩამოიტვირთა.");
  }

  const originalDrawTextureToQuad = drawTextureToQuad;
  drawTextureToQuad = function (image, quad, scalePercent, customCtx) {
    if (!customCtx) return originalDrawTextureToQuad(image, quad, scalePercent);
    const previousCtx = ctx;
    const temp = customCtx;
    const strips = 96;
    const topLength = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    const bottomLength = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
    const leftLength = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    const approxWidth = Math.max(topLength, bottomLength, 1);
    const approxHeight = Math.max(leftLength, 1);
    const scale = Math.max(0.2, scalePercent / 100);

    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = Math.max(64, Math.round((approxWidth / scale) || 256));
    patternCanvas.height = Math.max(64, Math.round((approxHeight / scale) || 256));
    const pctx = patternCanvas.getContext("2d");
    const pattern = pctx.createPattern(image, "repeat");
    pctx.save();
    pctx.scale(scale, scale);
    pctx.fillStyle = pattern;
    pctx.fillRect(0, 0, patternCanvas.width / scale, patternCanvas.height / scale);
    pctx.restore();

    for (let i = 0; i < strips; i += 1) {
      const t0 = i / strips;
      const t1 = (i + 1) / strips;
      const p0 = lerpPoint(quad[0], quad[1], t0);
      const p1 = lerpPoint(quad[0], quad[1], t1);
      const p3 = lerpPoint(quad[3], quad[2], t0);
      const p2 = lerpPoint(quad[3], quad[2], t1);
      const sx = t0 * patternCanvas.width;
      const sw = (t1 - t0) * patternCanvas.width;

      temp.save();
      temp.beginPath();
      temp.moveTo(p0.x, p0.y);
      temp.lineTo(p1.x, p1.y);
      temp.lineTo(p2.x, p2.y);
      temp.lineTo(p3.x, p3.y);
      temp.closePath();
      temp.clip();

      const dx1 = p1.x - p0.x;
      const dy1 = p1.y - p0.y;
      const dx2 = p3.x - p0.x;
      const dy2 = p3.y - p0.y;

      temp.transform(
        dx1 / sw,
        dy1 / sw,
        dx2 / patternCanvas.height,
        dy2 / patternCanvas.height,
        p0.x - (sx * dx1) / sw,
        p0.y - (sx * dy1) / sw
      );

      temp.drawImage(patternCanvas, 0, 0);
      temp.restore();
    }
    return previousCtx;
  };

  DOM.startCameraBtn.addEventListener("click", startCamera);
  DOM.textureInput.addEventListener("change", handleTextureUpload);
  DOM.resetPointsBtn.addEventListener("click", resetPoints);
  DOM.screenshotBtn.addEventListener("click", takeScreenshot);
  DOM.scaleRange.addEventListener("input", function () { syncScale(DOM.scaleRange.value); });
  DOM.scaleInput.addEventListener("input", function () { syncScale(DOM.scaleInput.value); });
  DOM.overlayCanvas.addEventListener("pointerdown", handleCanvasTap);
  window.addEventListener("resize", resizeCanvas);
})();
