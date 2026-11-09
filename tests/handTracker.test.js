/**
 * Automated Test Suite for SlideQuest MediaPipe Hand Tracker
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 * Validates initialization, GPU-to-CPU delegate fallback, landmark detection, key landmark extraction,
 * frame gating, duplicate loop prevention, and resource cleanup.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker, HAND_CONNECTIONS } from '../src/handTracker.js';

// Helper to generate 21 normalized dummy landmarks
function createMock21Landmarks(offset = 0) {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({
      x: 0.1 + (i * 0.03) + offset,
      y: 0.2 + (i * 0.02) + offset,
      z: 0.01 * i
    });
  }
  return landmarks;
}

// Mock helper for Canvas and Canvas2DContext
function createMockCanvas() {
  const operations = [];
  const ctx = {
    save() { operations.push('save'); },
    restore() { operations.push('restore'); },
    beginPath() { operations.push('beginPath'); },
    moveTo(x, y) { operations.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`); },
    lineTo(x, y) { operations.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`); },
    arc(x, y, r) { operations.push(`arc(${x.toFixed(1)},${y.toFixed(1)},${r})`); },
    fill() { operations.push('fill'); },
    stroke() { operations.push('stroke'); },
    clearRect(x, y, w, h) { operations.push(`clearRect(${x},${y},${w},${h})`); },
    setLineDash() {},
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: ''
  };

  return {
    width: 640,
    height: 480,
    ctx,
    operations,
    getContext(type) {
      if (type === '2d') return this.ctx;
      return null;
    }
  };
}

// Mock helper for VideoElement
function createMockVideo(currentTime = 1.0) {
  return {
    currentTime,
    videoWidth: 640,
    videoHeight: 480,
    readyState: 4,
    paused: false
  };
}

// Factory helper for mocked MediaPipe tasks-vision loader
function createMockVisionLoader(options = {}) {
  const shouldFailGpu = options.shouldFailGpu || false;
  const shouldFailCompletely = options.shouldFailCompletely || false;
  const mockDetections = options.mockDetections !== undefined ? options.mockDetections : [createMock21Landmarks()];

  return async () => {
    if (shouldFailCompletely) {
      throw new Error('Network failure loading MediaPipe WASM');
    }

    return {
      FilesetResolver: {
        forVisionTasks: async (path) => ({ path })
      },
      HandLandmarker: {
        createFromOptions: async (vision, opts) => {
          if (opts.baseOptions.delegate === 'GPU' && shouldFailGpu) {
            throw new Error('WebGL context unavailable for GPU delegate');
          }

          let detectCalls = 0;
          return {
            options: opts,
            closed: false,
            detectForVideo: (video, timestamp) => {
              detectCalls++;
              return {
                landmarks: mockDetections
              };
            },
            getDetectCalls: () => detectCalls,
            close() {
              this.closed = true;
            }
          };
        }
      }
    };
  };
}

describe('SlideQuest HandTracker - Initialization & Delegate Fallback', () => {
  test('Initializes HandLandmarker with GPU delegate when available', async () => {
    const statuses = [];
    const visionLoader = createMockVisionLoader();
    const tracker = new HandTracker({ visionLoader });
    tracker.onStatusChange = (s) => statuses.push(s);

    const readyEvent = await new Promise(async (resolve) => {
      tracker.onReady = (info) => resolve(info);
      await tracker.initialize();
    });

    assert.equal(readyEvent.delegate, 'GPU');
    assert.equal(tracker.activeDelegate, 'GPU');
    assert.ok(tracker.handLandmarker);
    assert.ok(statuses.includes('Loading model'));
    assert.equal(statuses[statuses.length - 1], 'Waiting for hand');

    tracker.destroy();
  });

  test('Gracefully falls back to CPU delegate when GPU/WebGL fails', async () => {
    const statuses = [];
    const visionLoader = createMockVisionLoader({ shouldFailGpu: true });
    const tracker = new HandTracker({ visionLoader });
    tracker.onStatusChange = (s) => statuses.push(s);

    const readyEvent = await new Promise(async (resolve) => {
      tracker.onReady = (info) => resolve(info);
      await tracker.initialize();
    });

    assert.equal(readyEvent.delegate, 'CPU', 'Should fall back to CPU delegate');
    assert.equal(tracker.activeDelegate, 'CPU');
    assert.ok(tracker.handLandmarker);
    assert.equal(statuses[statuses.length - 1], 'Waiting for hand');

    tracker.destroy();
  });

  test('Handles complete initialization failure and transitions out of loading state', async () => {
    const statuses = [];
    let errorReceived = null;
    const visionLoader = createMockVisionLoader({ shouldFailCompletely: true });
    const tracker = new HandTracker({ visionLoader });
    tracker.onStatusChange = (s) => statuses.push(s);
    tracker.onError = (err) => { errorReceived = err; };

    const success = await tracker.initialize();
    assert.equal(success, false);
    assert.equal(tracker.handLandmarker, null);
    assert.ok(errorReceived);
    assert.ok(statuses.includes('Loading model'));
    assert.equal(statuses[statuses.length - 1], 'Tracking unavailable', 'Must not remain in Loading state');

    tracker.destroy();
  });
});

describe('SlideQuest HandTracker - Landmark Detection & Skeleton Visualization', () => {
  test('Detects 21 landmarks and extracts key landmarks (wrist #0, thumbTip #4, indexTip #8)', async () => {
    const dummyLandmarks = createMock21Landmarks();
    const visionLoader = createMockVisionLoader({ mockDetections: [dummyLandmarks] });
    const tracker = new HandTracker({ visionLoader });

    await tracker.initialize();

    const video = createMockVideo(1.0);
    const canvas = createMockCanvas();

    let detectedLandmarks = null;
    let detectedMeta = null;

    tracker.onHandDetected = (landmarks, meta) => {
      detectedLandmarks = landmarks;
      detectedMeta = meta;
    };

    tracker.videoElement = video;
    tracker.canvasElement = canvas;
    tracker.canvasCtx = canvas.ctx;

    // Process a frame
    tracker.processFrame();

    assert.ok(detectedLandmarks);
    assert.equal(detectedLandmarks.length, 21);
    assert.equal(detectedMeta.hasHand, true);
    assert.ok(detectedMeta.keyLandmarks);
    assert.equal(detectedMeta.keyLandmarks.wrist, dummyLandmarks[0]);
    assert.equal(detectedMeta.keyLandmarks.thumbTip, dummyLandmarks[4]);
    assert.equal(detectedMeta.keyLandmarks.indexTip, dummyLandmarks[8]);

    // Verify canvas drew skeleton lines and clearRect was invoked
    assert.ok(canvas.operations.some(op => op.startsWith('clearRect')));
    assert.ok(canvas.operations.some(op => op === 'stroke'));

    tracker.destroy();
  });

  test('Fires onHandLost and clears canvas when hand disappears', async () => {
    // Frame 1: Hand present
    const dummyLandmarks = createMock21Landmarks();
    const visionLoader = createMockVisionLoader({ mockDetections: [dummyLandmarks] });
    const tracker = new HandTracker({ visionLoader });
    await tracker.initialize();

    const video = createMockVideo(1.0);
    const canvas = createMockCanvas();
    tracker.videoElement = video;
    tracker.canvasElement = canvas;
    tracker.canvasCtx = canvas.ctx;

    tracker.processFrame();
    assert.equal(tracker.hasHand, true);

    // Frame 2: Hand lost
    tracker.handLandmarker.detectForVideo = () => ({ landmarks: [] });
    let handLostFired = false;
    tracker.onHandLost = () => { handLostFired = true; };

    tracker.processFrame();
    assert.equal(tracker.hasHand, false);
    assert.equal(handLostFired, true);

    tracker.destroy();
  });
});

describe('SlideQuest HandTracker - Performance & Resource Safety', () => {
  test('Skips processing when video currentTime has not advanced (repeated frame prevention)', async () => {
    let detectCallCount = 0;
    const visionLoader = async () => ({
      FilesetResolver: { forVisionTasks: async () => ({}) },
      HandLandmarker: {
        createFromOptions: async () => ({
          detectForVideo: () => {
            detectCallCount++;
            return { landmarks: [] };
          },
          close: () => {}
        })
      }
    });

    const tracker = new HandTracker({ visionLoader });
    await tracker.initialize();

    const video = createMockVideo(2.5);
    tracker.videoElement = video;
    tracker.isRunning = true;

    // First loop pass: video.currentTime is 2.5 !== lastVideoTime (-1)
    tracker.loop();
    assert.equal(detectCallCount, 1);
    assert.equal(tracker.lastVideoTime, 2.5);

    // Second loop pass: video.currentTime is STILL 2.5 === lastVideoTime
    tracker.loop();
    assert.equal(detectCallCount, 1, 'detectForVideo must NOT be called again for duplicate frame');

    // Video advances to 2.6
    video.currentTime = 2.6;
    tracker.loop();
    assert.equal(detectCallCount, 2, 'detectForVideo should be called once timestamp advances');

    tracker.destroy();
  });

  test('Calling startTracking when already running does not spawn duplicate loops', async () => {
    const visionLoader = createMockVisionLoader();
    const tracker = new HandTracker({ visionLoader });
    const video = createMockVideo();
    const canvas = createMockCanvas();

    await tracker.startTracking(video, canvas);
    assert.equal(tracker.isRunning, true);

    // Second call while already running
    const res = await tracker.startTracking(video, canvas);
    assert.equal(res, true);
    assert.equal(tracker.isRunning, true);

    tracker.destroy();
  });

  test('stopTracking cleans up animation frames, clears canvas, and emits Camera disabled', async () => {
    const visionLoader = createMockVisionLoader();
    const tracker = new HandTracker({ visionLoader });
    const video = createMockVideo();
    const canvas = createMockCanvas();
    const statuses = [];
    tracker.onStatusChange = (s) => statuses.push(s);

    await tracker.startTracking(video, canvas);
    assert.equal(tracker.isRunning, true);

    tracker.stopTracking();
    assert.equal(tracker.isRunning, false);
    assert.equal(tracker.animationFrameId, null);
    assert.ok(canvas.operations.some(op => op.startsWith('clearRect')));
    assert.equal(statuses[statuses.length - 1], 'Camera disabled');

    tracker.destroy();
  });

  test('destroy marks tracker as disposed and closes HandLandmarker instance', async () => {
    const visionLoader = createMockVisionLoader();
    const tracker = new HandTracker({ visionLoader });
    await tracker.initialize();
    const modelRef = tracker.handLandmarker;

    tracker.destroy();
    assert.equal(tracker.isDisposed, true);
    assert.equal(tracker.handLandmarker, null);
    assert.equal(modelRef.closed, true);

    // Attempting to start tracking after disposal fails safely
    const startResult = await tracker.startTracking(createMockVideo(), createMockCanvas());
    assert.equal(startResult, false);
  });
});
