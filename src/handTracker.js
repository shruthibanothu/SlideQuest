/**
 * SlideQuest - MediaPipe Hand Tracker
 * Integrates @mediapipe/tasks-vision HandLandmarker (pinned version 0.10.14).
 * Handles landmark detection on video frames, overlay canvas rendering,
 * and duplicate frame prevention.
 */

// Pinned version of MediaPipe Tasks Vision CDN bundle
const MEDIAPIPE_VISION_VERSION = '0.10.14';
const VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/vision_bundle.mjs`;
const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/wasm`;
const MODEL_ASSET_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Standard 21 Hand Connections
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17]
];

export class HandTracker {
  constructor(options = {}) {
    this.handLandmarker = null;
    this.videoElement = null;
    this.canvasElement = null;
    this.canvasCtx = null;
    this.isRunning = false;
    this.animationFrameId = null;
    this.lastVideoTime = -1;
    this.isInitializing = false;
    this.hasHand = false;

    // Calibration & Display
    this.mirrorCanvas = options.mirrorCanvas !== undefined ? options.mirrorCanvas : true;

    // Callbacks
    this.onHandDetected = options.onHandDetected || (() => {});
    this.onHandLost = options.onHandLost || (() => {});
    this.onError = options.onError || (() => {});
    this.onReady = options.onReady || (() => {});
  }

  /**
   * Initializes the MediaPipe HandLandmarker model
   */
  async initialize() {
    if (this.handLandmarker) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    try {
      // Dynamic import of pinned Tasks Vision bundle
      const visionModule = await import(VISION_BUNDLE_URL);
      const { FilesetResolver, HandLandmarker } = visionModule;

      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_PATH,
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
      });

      this.isInitializing = false;
      this.onReady();
      return true;
    } catch (err) {
      this.isInitializing = false;
      console.error('Failed to initialize MediaPipe HandLandmarker:', err);
      this.onError(err, 'Could not load hand tracking model.');
      return false;
    }
  }

  /**
   * Starts tracking loop on specified video and canvas elements
   */
  async startTracking(videoElement, canvasElement) {
    if (!this.handLandmarker) {
      const initialized = await this.initialize();
      if (!initialized) return false;
    }

    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    if (this.canvasElement) {
      this.canvasCtx = this.canvasElement.getContext('2d');
    }

    if (this.isRunning) {
      // Avoid duplicate loops
      return true;
    }

    this.isRunning = true;
    this.lastVideoTime = -1;
    this.hasHand = false;

    this.loop();
    return true;
  }

  /**
   * Stops tracking loop and clears overlay canvas
   */
  stopTracking() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.hasHand) {
      this.hasHand = false;
      this.onHandLost();
    }

    this.clearCanvas();
  }

  /**
   * Main requestAnimationFrame tracking loop
   */
  loop() {
    if (!this.isRunning) return;

    if (
      this.videoElement &&
      this.videoElement.readyState >= 2 &&
      !this.videoElement.paused
    ) {
      // Only process when video frame has advanced
      if (this.videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoElement.currentTime;
        this.processFrame();
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }

  /**
   * Performs landmark detection on current video frame
   */
  processFrame() {
    if (!this.handLandmarker || !this.videoElement) return;

    const startTimeMs = performance.now();
    try {
      const results = this.handLandmarker.detectForVideo(this.videoElement, startTimeMs);

      // Synchronize canvas size to video dimensions
      if (this.canvasElement) {
        const vWidth = this.videoElement.videoWidth || 640;
        const vHeight = this.videoElement.videoHeight || 480;
        if (this.canvasElement.width !== vWidth || this.canvasElement.height !== vHeight) {
          this.canvasElement.width = vWidth;
          this.canvasElement.height = vHeight;
        }
      }

      this.clearCanvas();

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0]; // First detected hand (numHands: 1)
        this.hasHand = true;

        this.drawLandmarks(landmarks);
        this.onHandDetected(landmarks, results);
      } else {
        if (this.hasHand) {
          this.hasHand = false;
          this.onHandLost();
        }
      }
    } catch (err) {
      console.warn('Frame processing error in HandLandmarker:', err);
    }
  }

  /**
   * Draws landmarks and connections onto overlay canvas
   */
  drawLandmarks(landmarks) {
    if (!this.canvasCtx || !this.canvasElement) return;
    const ctx = this.canvasCtx;
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;

    ctx.save();

    // If canvas is not mirrored via CSS, we can handle mirroring in drawing
    // However, typically video and canvas are mirrored via CSS: transform: scaleX(-1);
    // So normal (x, y) maps accurately.

    // Draw skeletal connections
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.75)'; // Golden quest aura
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [start, end] of HAND_CONNECTIONS) {
      const p1 = landmarks[start];
      const p2 = landmarks[end];
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    }

    // Draw joints
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const px = p.x * width;
      const py = p.y * height;

      ctx.beginPath();
      if (i === 8) {
        // Index fingertip - hero tracking point
        ctx.arc(px, py, 7, 0, 2 * Math.PI);
        ctx.fillStyle = '#38bdf8'; // Vibrant cyan
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else if (i === 4) {
        // Thumb tip - pinch companion
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#f43f5e'; // Vibrant rose
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();
      }
    }

    // Draw pinch indicator line between thumb tip (4) and index tip (8)
    const thumb = landmarks[4];
    const index = landmarks[8];
    if (thumb && index) {
      const dx = thumb.x - index.x;
      const dy = thumb.y - index.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(thumb.x * width, thumb.y * height);
      ctx.lineTo(index.x * width, index.y * height);
      ctx.strokeStyle = dist < 0.08 ? '#22c55e' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  clearCanvas() {
    if (this.canvasCtx && this.canvasElement) {
      this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
  }

  destroy() {
    this.stopTracking();
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }
}
