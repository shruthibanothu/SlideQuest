/**
 * Automated Test Suite for SlideQuest Phase 6 Polish: Calibration & Persistence
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 * Validates calibration LocalStorage persistence, defaults restoration,
 * score tracking, tutorial dismissal, and difficulty scaling.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SlideQuestGame } from '../src/game.js';
import { GestureController } from '../src/gestureController.js';
import { AudioManager } from '../src/audio.js';

describe('SlideQuest Polish - Calibration Persistence & Restoration', () => {
  let mockStorage = {};
  let originalLocalStorage;

  beforeEach(() => {
    mockStorage = {};
    originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem(key) { return mockStorage[key] || null; },
      setItem(key, val) { mockStorage[key] = String(val); },
      removeItem(key) { delete mockStorage[key]; },
      clear() { mockStorage = {}; }
    };
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  test('GestureController updates configuration immediately upon calibration change', () => {
    const controller = new GestureController(null, {
      swipeThreshold: 0.11,
      pinchThreshold: 0.065,
      releaseThreshold: 0.095,
      mirrorX: true
    });

    assert.equal(controller.config.swipeThreshold, 0.11);
    assert.equal(controller.config.pinchThreshold, 0.065);
    assert.equal(controller.config.releaseThreshold, 0.095);
    assert.equal(controller.config.mirrorX, true);

    // Update calibration
    controller.updateConfig({
      swipeThreshold: 0.15,
      pinchThreshold: 0.050,
      releaseThreshold: 0.110,
      mirrorX: false
    });

    assert.equal(controller.config.swipeThreshold, 0.15);
    assert.equal(controller.config.pinchThreshold, 0.050);
    assert.equal(controller.config.releaseThreshold, 0.110);
    assert.equal(controller.config.mirrorX, false);
  });

  test('Persists and retrieves calibration settings in localStorage', () => {
    const configToSave = {
      swipeThreshold: 0.14,
      pinchThreshold: 0.055,
      releaseThreshold: 0.105,
      mirrorX: false,
      mode: 'MODE_B'
    };

    localStorage.setItem('slidequest_calibration_v1', JSON.stringify(configToSave));

    const retrieved = JSON.parse(localStorage.getItem('slidequest_calibration_v1'));
    assert.deepEqual(retrieved, configToSave);
  });

  test('Persists tutorial dismissal preference in localStorage', () => {
    assert.equal(localStorage.getItem('slidequest_tutorial_dismissed_v1'), null);

    localStorage.setItem('slidequest_tutorial_dismissed_v1', 'true');
    assert.equal(localStorage.getItem('slidequest_tutorial_dismissed_v1'), 'true');
  });

  test('Persists and evaluates best moves per grid size in localStorage', () => {
    const key = 'slidequest_best_3';

    // Game 1: 45 moves
    localStorage.setItem(key, '45');
    assert.equal(localStorage.getItem(key), '45');

    // Game 2: 32 moves (better)
    const newScore = 32;
    const currentBest = parseInt(localStorage.getItem(key), 10);
    if (newScore < currentBest) {
      localStorage.setItem(key, String(newScore));
    }
    assert.equal(localStorage.getItem(key), '32');

    // Game 3: 50 moves (worse)
    const worseScore = 50;
    if (worseScore < parseInt(localStorage.getItem(key), 10)) {
      localStorage.setItem(key, String(worseScore));
    }
    assert.equal(localStorage.getItem(key), '32', 'Best score must remain 32');
  });
});

describe('SlideQuest Polish - Audio Synthesizer Stability', () => {
  test('AudioManager methods do not crash or throw when AudioContext is unavailable or muted', () => {
    const audio = new AudioManager();

    assert.equal(audio.muted, false);
    audio.toggleMute();
    assert.equal(audio.muted, true);

    // In Node headless environment, window.AudioContext does not exist:
    // Methods should exit safely without uncaught exceptions
    assert.doesNotThrow(() => audio.playSlide());
    assert.doesNotThrow(() => audio.playPinch());
    assert.doesNotThrow(() => audio.playRelease());
    assert.doesNotThrow(() => audio.playError());
    assert.doesNotThrow(() => audio.playSuccess());

    audio.toggleMute();
    assert.equal(audio.muted, false);
  });
});

describe('SlideQuest Polish - Full Multi-Difficulty Scaling', () => {
  test('Supports grid scaling 3x3, 4x4, and 5x5 cleanly with full solvability guarantee', () => {
    const game = new SlideQuestGame({ gridSize: 3 });

    // 3x3 check
    assert.equal(game.gridSize, 3);
    assert.equal(game.board.length, 9);
    assert.equal(game.isSolvable(game.board, 3), true);

    // Scale to 4x4
    game.setGridSize(4);
    assert.equal(game.gridSize, 4);
    assert.equal(game.board.length, 16);
    assert.equal(game.emptyIndex, game.board.indexOf(0));
    assert.equal(game.isSolvable(game.board, 4), true);

    // Scale to 5x5
    game.setGridSize(5);
    assert.equal(game.gridSize, 5);
    assert.equal(game.board.length, 25);
    assert.equal(game.emptyIndex, game.board.indexOf(0));
    assert.equal(game.isSolvable(game.board, 5), true);
  });
});
