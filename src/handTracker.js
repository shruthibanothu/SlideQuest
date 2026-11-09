/**
 * SlideQuest - MediaPipe Hand Tracker
 * Integrates @mediapipe/tasks-vision HandLandmarker (pinned version 0.10.14).
 * Handles landmark detection on video frames, overlay canvas rendering,
 * duplicate frame prevention, GPU-to-CPU delegate fallback, and key landmark extraction.
 *
 * Privacy & Security Guarantee:
 * - All landmark detection runs purely in-memory on the client machine.
 * - No biometric or landmark coordinate data is stored, cached, or transmitted.
 */

// Pinned version of MediaPipe Tasks Vision CDN bundle
export const MEDIAPIPE_VISION_VERSION = '0.10.14';
export const VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/vision_bundle.mjs`;
export const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VERSION}/wasm`;
export const MODEL_ASSET_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Standard 21 Hand Connections
export const HAND_CONNECTIONS = [
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
    this.isDisposed = false;
    this.animationFrameId = null;
    this.lastVideoTime = -1;
    this.isInitializing = false;
    this.hasHand = false;
    this.activeDelegate = 'GPU';

    // Injection option for unit testing environments
    this.visionLoader = options.visionLoader || null;

    // Callbacks
    this.onHandDetected = options.onHandDetected || (() => {});
    this.onHandLost = options.onHandLost || (() => {});
    this.onError = options.onError || (() => {});
    this.onReady = options.onReady || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  /**
   * Initializes the MediaPipe HandLandmarker model.
   * Emits 'Loading model' status, attempts GPU delegation first,
   * and gracefully falls back to CPU delegation on WebGL/GPU failure.
   */
  async initialize() {
    if (this.handLandmarker) return true;
    if (this.isInitializing) return false;
    if (this.isDisposed) return false;

    this.isInitializing = true;
    this.onStatusChange('Loading model');

    try {
      // Resolve vision module (injected mock or dynamic browser import)
      let visionModule;
      if (typeof this.visionLoader === 'function') {
        visionModule = await this.visionLoader();
      } else {
        visionModule = await import(VISION_BUNDLE_URL);
      }

      const { FilesetResolver, HandLandmarker } = visionModule;
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

      // Attempt 1: Try GPU delegate
      try {
        this.activeDelegate = 'GPU';
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
      } catch (gpuError) {
        console.warn('GPU delegation failed; attempting CPU fallback:', gpuError);
        // Attempt 2: Fallback to CPU delegate
        this.activeDelegate = 'CPU';
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_ASSET_PATH,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55
        });
      }

      this.isInitializing = false;
      this.onStatusChange('Waiting for hand');
      this.onReady({ delegate: this.activeDelegate });
      return true;
    } catch (err) {
      this.isInitializing = false;
      this.handLandmarker = null;
      console.error('Failed to initialize MediaPipe HandLandmarker:', err);
      this.onStatusChange('Tracking unavailable');
      this.onError(err, 'Could not load hand tracking model.');
      return false;
    }
  }

  /**
   * Starts tracking loop on specified video and canvas elements.
   * Gated against duplicate loops.
   */
  async startTracking(videoElement, canvasElement) {
    if (this.isDisposed) return false;

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
      // Prevent duplicate animation loops
      return true;
    }

    this.isRunning = true;
    this.lastVideoTime = -1;
    this.hasHand = false;
    this.onStatusChange('Waiting for hand');

    this.loop();
    return true;
  }

  /**
   * Stops tracking loop, releases frame scheduler, and clears overlay canvas.
   */
  stopTracking() {
    this.isRunning = false;

    if (this.animationFrameId) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }

    if (this.hasHand) {
      this.hasHand = false;
      this.onHandLost();
    }

    this.clearCanvas();
    this.onStatusChange('Camera disabled');
  }

  /**
   * Main requestAnimationFrame tracking loop.
   * Avoids duplicate frame processing and checks disposed state.
   */
  loop() {
    if (!this.isRunning || this.isDisposed) return;

    if (
      this.videoElement &&
      this.videoElement.readyState >= 2 &&
      !this.videoElement.paused
    ) {
      // Frame gate: Only process when the video timestamp has genuinely advanced
      if (this.videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoElement.currentTime;
        this.processFrame();
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      this.animationFrameId = requestAnimationFrame(() => this.loop());
    }
  }

  /**
   * Performs landmark detection on current video frame.
   * Synchronizes canvas dimensions and extracts primary key landmarks.
   */
  processFrame() {
    if (!this.handLandmarker || !this.videoElement || this.isDisposed) return;

    const startTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const results = this.handLandmarker.detectForVideo(this.videoElement, startTimeMs);

      // Keep overlay canvas aligned with live video dimensions
      if (this.canvasElement) {
        const vWidth = this.videoElement.videoWidth || 640;
        const vHeight = this.videoElement.videoHeight || 480;
        if (this.canvasElement.width !== vWidth || this.canvasElement.height !== vHeight) {
          this.canvasElement.width = vWidth;
          this.canvasElement.height = vHeight;
        }
      }

      this.clearCanvas();

      if (results && results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0]; // First detected hand (numHands: 1)
        this.hasHand = true;

        // Extract key landmarks (wrist #0, thumb tip #4, index tip #8)
        const keyLandmarks = {
          wrist: landmarks[0] || null,
          thumbTip: landmarks[4] || null,
          indexTip: landmarks[8] || null
        };

        this.drawLandmarks(landmarks);
        this.onStatusChange('Hand detected');
        this.onHandDetected(landmarks, {
          rawResults: results,
          keyLandmarks,
          hasHand: true
        });
      } else {
        if (this.hasHand) {
          this.hasHand = false;
          this.onStatusChange('Waiting for hand');
          this.onHandLost();
        }
      }
    } catch (err) {
      console.warn('Frame processing error in HandLandmarker:', err);
    }
  }

  /**
   * Draws 21 hand landmarks and connecting skeleton lines on the overlay canvas.
   */
  drawLandmarks(landmarks) {
    if (!this.canvasCtx || !this.canvasElement) return;
    const ctx = this.canvasCtx;
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;

    ctx.save();

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
      if (!p) continue;

      const px = p.x * width;
      const py = p.y * height;

      ctx.beginPath();
      if (i === 8) {
        // Landmark 8: Index fingertip - hero tracking point
        ctx.arc(px, py, 7, 0, 2 * Math.PI);
        ctx.fillStyle = '#38bdf8'; // Vibrant cyan
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else if (i === 4) {
        // Landmark 4: Thumb tip
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#f43f5e'; // Vibrant rose
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else if (i === 0) {
        // Landmark 0: Wrist anchor
        ctx.arc(px, py, 5.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#eab308'; // Amber anchor
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Clears the overlay canvas
   */
  clearCanvas() {
    if (this.canvasCtx && this.canvasElement) {
      this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
  }

  /**
   * Disposes of tracker resources, animation frames, and closed model instance.
   */
  destroy() {
    this.isDisposed = true;
    this.stopTracking();

    if (this.handLandmarker && typeof this.handLandmarker.close === 'function') {
      try {
        this.handLandmarker.close();
      } catch (e) {
        console.warn('Error closing handLandmarker:', e);
      }
      this.handLandmarker = null;
    }

    this.videoElement = null;
    this.canvasElement = null;
    this.canvasCtx = null;
  }
}
