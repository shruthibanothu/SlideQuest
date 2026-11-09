/**
 * Automated Test Suite for SlideQuest Camera Lifecycle & Stream Management
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 * Validates permission handling, track disposal, concurrency protection, and lifecycle events.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager } from '../src/cameraManager.js';

// Mock helper to generate mock MediaStream and MediaStreamTrack
function createMockStream(trackCount = 1) {
  const tracks = [];
  for (let i = 0; i < trackCount; i++) {
    const listeners = {};
    const track = {
      kind: 'video',
      id: `track-${i}-${Math.random()}`,
      stopped: false,
      stop() {
        this.stopped = true;
      },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== fn);
      },
      simulateEnded() {
        this.stop();
        if (listeners['ended']) {
          listeners['ended'].forEach(fn => fn());
        }
      }
    };
    tracks.push(track);
  }

  return {
    tracks,
    getTracks() {
      return [...this.tracks];
    },
    getVideoTracks() {
      return this.tracks.filter(t => t.kind === 'video');
    }
  };
}

// Mock helper for HTMLVideoElement
function createMockVideoElement() {
  const listeners = {};
  return {
    srcObject: null,
    readyState: 4,
    paused: true,
    playsInline: false,
    muted: false,
    playCalled: false,
    pauseCalled: false,
    setAttribute(name, val) {
      if (name === 'playsinline') this.playsInline = val;
    },
    addEventListener(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(cb => cb !== fn);
    },
    async play() {
      this.playCalled = true;
      this.paused = false;
    },
    pause() {
      this.pauseCalled = true;
      this.paused = true;
    }
  };
}

describe('SlideQuest Camera Lifecycle - Consent & Permissions', () => {
  let originalNavigatorDescriptor;
  let getUserMediaCalls = 0;

  beforeEach(() => {
    getUserMediaCalls = 0;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    const mockNav = {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalls++;
          return createMockStream(1);
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      }
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: mockNav,
      configurable: true,
      writable: true
    });
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
  });

  test('Camera permission is NOT requested automatically on instantiation', () => {
    const manager = new CameraManager({ facingMode: 'user' });
    assert.equal(getUserMediaCalls, 0, 'getUserMedia must not be called upon instantiation');
    assert.equal(manager.isActive, false);
    assert.equal(manager.isRequesting, false);
    assert.equal(manager.mediaStream, null);
    manager.destroy();
  });

  test('Camera initializes successfully on explicit startCamera call', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();
    const statuses = [];
    manager.onStatusChange = (s) => statuses.push(s);

    const success = await manager.startCamera(video);
    assert.equal(success, true);
    assert.equal(getUserMediaCalls, 1);
    assert.equal(manager.isActive, true);
    assert.ok(manager.mediaStream);
    assert.equal(video.srcObject, manager.mediaStream);
    assert.equal(video.muted, true);
    assert.equal(video.playCalled, true);

    // Status transition: Requesting Permission -> Active
    assert.ok(statuses.includes('Requesting Permission'));
    assert.equal(statuses[statuses.length - 1], 'Active');

    manager.destroy();
  });

  test('Handles NotAllowedError (permission denied)', async () => {
    globalThis.navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };

    const manager = new CameraManager();
    const video = createMockVideoElement();
    let capturedError = null;
    let friendlyMessage = null;

    manager.onError = (err, msg) => {
      capturedError = err;
      friendlyMessage = msg;
    };

    const success = await manager.startCamera(video);
    assert.equal(success, false);
    assert.equal(manager.isActive, false);
    assert.equal(manager.mediaStream, null);
    assert.ok(capturedError);
    assert.equal(capturedError.name, 'NotAllowedError');
    assert.match(friendlyMessage, /permission was denied/i);

    manager.destroy();
  });

  test('Handles NotFoundError (no camera device found)', async () => {
    globalThis.navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('No devices found');
      err.name = 'NotFoundError';
      throw err;
    };

    const manager = new CameraManager();
    const video = createMockVideoElement();
    let friendlyMessage = null;
    manager.onError = (err, msg) => { friendlyMessage = msg; };

    const success = await manager.startCamera(video);
    assert.equal(success, false);
    assert.match(friendlyMessage, /no camera device found/i);

    manager.destroy();
  });

  test('Handles NotReadableError (camera already in use)', async () => {
    globalThis.navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('Device in use');
      err.name = 'NotReadableError';
      throw err;
    };

    const manager = new CameraManager();
    const video = createMockVideoElement();
    let friendlyMessage = null;
    manager.onError = (err, msg) => { friendlyMessage = msg; };

    const success = await manager.startCamera(video);
    assert.equal(success, false);
    assert.match(friendlyMessage, /already in use/i);

    manager.destroy();
  });

  test('Handles OverconstrainedError with automatic fallback constraints', async () => {
    let callCount = 0;
    const requestedConstraints = [];

    globalThis.navigator.mediaDevices.getUserMedia = async (constraints) => {
      callCount++;
      requestedConstraints.push(constraints);
      if (callCount === 1) {
        const err = new Error('Resolution not supported');
        err.name = 'OverconstrainedError';
        throw err;
      }
      return createMockStream(1);
    };

    const manager = new CameraManager({ width: 1920, height: 1080 });
    const video = createMockVideoElement();

    const success = await manager.startCamera(video);
    assert.equal(success, true, 'Must succeed on fallback attempt');
    assert.equal(callCount, 2, 'Should have retried with relaxed constraints');
    assert.equal(manager.isActive, true);

    manager.destroy();
  });
});

describe('SlideQuest Camera Lifecycle - Concurrency, Cleanup & Resource Release', () => {
  let originalNavigatorDescriptor;
  let originalWindowDescriptor;

  beforeEach(() => {
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    const mockNav = {
      mediaDevices: {
        getUserMedia: async () => {
          // Add small delay to simulate real async camera initialization
          await new Promise(r => setTimeout(r, 20));
          return createMockStream(2);
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      }
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: mockNav,
      configurable: true,
      writable: true
    });
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    }
  });

  test('Prevents duplicate stream creation from rapid concurrent Enable Camera clicks', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();

    // Trigger two startCamera promises simultaneously
    const p1 = manager.startCamera(video);
    const p2 = manager.startCamera(video);

    const [res1, res2] = await Promise.all([p1, p2]);

    // One succeeds, second is rejected by concurrency lock
    assert.equal(res1, true);
    assert.equal(res2, false);
    assert.equal(manager.isActive, true);
    assert.ok(manager.mediaStream);

    manager.destroy();
  });

  test('Calling startCamera when already active returns true without leaking new streams', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();

    const firstSuccess = await manager.startCamera(video);
    assert.equal(firstSuccess, true);
    const streamRef = manager.mediaStream;

    // Call startCamera again when already running
    const secondSuccess = await manager.startCamera(video);
    assert.equal(secondSuccess, true);
    assert.equal(manager.mediaStream, streamRef, 'Must retain existing active stream without re-requesting');

    manager.destroy();
  });

  test('stopCamera stops every media track and clears video srcObject', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();
    const statuses = [];
    manager.onStatusChange = (s) => statuses.push(s);

    await manager.startCamera(video);
    assert.equal(manager.isActive, true);
    const tracks = manager.mediaStream.getTracks();
    assert.equal(tracks.length, 2);

    // Now disable camera
    manager.stopCamera();
    assert.equal(manager.isActive, false);
    assert.equal(manager.mediaStream, null);
    assert.equal(video.srcObject, null);
    assert.equal(video.pauseCalled, true);

    // Verify all tracks were stopped
    tracks.forEach(track => {
      assert.equal(track.stopped, true, `Track ${track.id} must be stopped`);
    });

    assert.equal(statuses[statuses.length - 1], 'Disabled');

    manager.destroy();
  });

  test('Handles unexpected track termination (e.g. camera unplugged or system revoked)', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();
    let errorFired = false;
    let lastStatus = null;

    manager.onError = () => { errorFired = true; };
    manager.onStatusChange = (s) => { lastStatus = s; };

    await manager.startCamera(video);
    assert.equal(manager.isActive, true);

    const track = manager.mediaStream.getVideoTracks()[0];
    // Simulate camera disconnection event from browser media track
    track.simulateEnded();

    assert.equal(manager.isActive, false);
    assert.equal(errorFired, true);
    assert.equal(lastStatus, 'Camera unavailable');

    manager.destroy();
  });

  test('handlePageUnload stops all active tracks on navigation or tab closure', async () => {
    const manager = new CameraManager();
    const video = createMockVideoElement();

    await manager.startCamera(video);
    assert.equal(manager.isActive, true);
    const tracks = manager.mediaStream.getTracks();

    // Trigger page unload simulation
    manager.handlePageUnload();

    assert.equal(manager.isActive, false);
    tracks.forEach(t => assert.equal(t.stopped, true));

    manager.destroy();
  });
});
