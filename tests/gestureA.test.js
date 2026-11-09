/**
 * Automated Test Suite for SlideQuest Mode A: Directional Swipe Recognition
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 * Validates vector classification, thresholding, diagonal rejection, neutral reset,
 * cooldowns, animation locks, and game engine integration.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GestureController } from '../src/gestureController.js';
import { SlideQuestGame } from '../src/game.js';

// Helper to create 21 landmarks with index tip (landmark 8) positioned at (x, y)
function createLandmarksWithIndex(x, y) {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0 });
  }
  landmarks[8] = { x, y, z: 0 };
  return landmarks;
}

describe('SlideQuest Mode A - Directional Gesture Classification', () => {
  let game;
  let controller;
  let detectedGestures;

  beforeEach(() => {
    // 3x3 game with empty cell in center (index 4)
    game = new SlideQuestGame({ gridSize: 3 });
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';

    detectedGestures = [];
    controller = new GestureController(game, {
      initialMode: 'MODE_A',
      mirrorX: false, // Set false for direct coordinate intuition in test
      swipeThreshold: 0.10,
      velocityThreshold: 0.0003,
      neutralRadius: 0.07,
      cooldownMs: 200,
      minStableFrames: 3,
      axisDominanceRatio: 1.45
    });

    controller.onGestureDetected = (g) => detectedGestures.push(g);
  });

  test('Classifies deliberate UP swipe and moves tile below empty cell upwards', () => {
    // Start at center (0.5, 0.5) at t=0
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    // Intermediate frame at t=30
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.42), 30);
    // Rapid upward flick (y decreases from 0.5 to 0.35, dy = -0.15) at t=60
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 60);

    assert.equal(detectedGestures.length, 1);
    assert.equal(detectedGestures[0].direction, 'UP');
    // Tile 7 (index 7) moved up into center empty cell (index 4)
    assert.equal(game.board[4], 7);
    assert.equal(game.emptyIndex, 7);
  });

  test('Classifies deliberate DOWN swipe and moves tile above empty cell downwards', () => {
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.58), 30);
    // Rapid downward flick (y increases from 0.5 to 0.66, dy = +0.16) at t=60
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.66), 60);

    assert.equal(detectedGestures.length, 1);
    assert.equal(detectedGestures[0].direction, 'DOWN');
    // Tile 2 (index 1) moved down into center empty cell (index 4)
    assert.equal(game.board[4], 2);
    assert.equal(game.emptyIndex, 1);
  });

  test('Classifies deliberate LEFT swipe and moves tile to the right into empty space', () => {
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.42, 0.5), 30);
    // Rapid leftward flick (x decreases from 0.5 to 0.35, dx = -0.15) at t=60
    controller.processLandmarks(createLandmarksWithIndex(0.35, 0.5), 60);

    assert.equal(detectedGestures.length, 1);
    assert.equal(detectedGestures[0].direction, 'LEFT');
    // Tile 5 (index 5) moved left into center empty cell (index 4)
    assert.equal(game.board[4], 5);
    assert.equal(game.emptyIndex, 5);
  });

  test('Classifies deliberate RIGHT swipe and moves tile to the left into empty space', () => {
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.58, 0.5), 30);
    // Rapid rightward flick (x increases from 0.5 to 0.66, dx = +0.16) at t=60
    controller.processLandmarks(createLandmarksWithIndex(0.66, 0.5), 60);

    assert.equal(detectedGestures.length, 1);
    assert.equal(detectedGestures[0].direction, 'RIGHT');
    // Tile 4 (index 3) moved right into center empty cell (index 4)
    assert.equal(game.board[4], 4);
    assert.equal(game.emptyIndex, 3);
  });
});

describe('SlideQuest Mode A - Accidental Movement & Noise Safeguards', () => {
  let game;
  let controller;
  let detectedGestures;
  let notifications;

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';

    detectedGestures = [];
    notifications = [];
    controller = new GestureController(game, {
      initialMode: 'MODE_A',
      mirrorX: false,
      swipeThreshold: 0.10,
      velocityThreshold: 0.0003,
      neutralRadius: 0.07,
      cooldownMs: 200,
      minStableFrames: 3,
      axisDominanceRatio: 1.45
    });

    controller.onGestureDetected = (g) => detectedGestures.push(g);
    controller.onStatusNotification = (n) => notifications.push(n);
  });

  test('Rejects stationary finger pointing in place', () => {
    // 10 consecutive frames with zero movement
    for (let t = 0; t <= 300; t += 30) {
      controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), t);
    }

    assert.equal(detectedGestures.length, 0, 'Stationary finger must never trigger swipe');
    assert.equal(game.moveCount, 0);
  });

  test('Rejects small sub-threshold finger jitter', () => {
    // Tremor within 0.03 normalized units (< 0.10 threshold)
    controller.processLandmarks(createLandmarksWithIndex(0.50, 0.50), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.52, 0.51), 30);
    controller.processLandmarks(createLandmarksWithIndex(0.53, 0.50), 60);

    assert.equal(detectedGestures.length, 0, 'Sub-threshold movement must be rejected');
    assert.equal(game.moveCount, 0);
  });

  test('Rejects slow drifting movement below velocity threshold', () => {
    // Moves 0.12 units over 700ms (velocity = 0.12 / 700 = 0.00017 < 0.0003 threshold)
    controller.processLandmarks(createLandmarksWithIndex(0.50, 0.50), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.54, 0.50), 250);
    controller.processLandmarks(createLandmarksWithIndex(0.58, 0.50), 500);
    controller.processLandmarks(createLandmarksWithIndex(0.62, 0.50), 750);

    assert.equal(detectedGestures.length, 0, 'Slow movement must be rejected');
    assert.equal(game.moveCount, 0);
  });

  test('Rejects ambiguous diagonal movements', () => {
    // Moving diagonally: dx = +0.13, dy = +0.12. (Ratio 0.13/0.12 = 1.08 < 1.45 ratio)
    controller.processLandmarks(createLandmarksWithIndex(0.50, 0.50), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.56, 0.56), 30);
    controller.processLandmarks(createLandmarksWithIndex(0.63, 0.62), 60);

    assert.equal(detectedGestures.length, 0, 'Diagonal movement must not trigger directional move');
    assert.ok(notifications.some(n => n.type === 'diagonal_rejected'));
    assert.equal(game.moveCount, 0);
  });

  test('Enforces neutral reset before accepting another gesture', () => {
    // Swipe 1: Quick UP swipe
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.42), 30);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 60);
    assert.equal(detectedGestures.length, 1);
    assert.equal(controller.modeAState, 'AWAITING_NEUTRAL');

    // Simulate time passing beyond cooldown (at t=400)
    controller.isCoolingDown = false;

    // While still displaced at y=0.35, attempt another swipe upwards to y=0.20
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 400);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.28), 430);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.20), 460);

    assert.equal(detectedGestures.length, 1, 'Must NOT trigger second swipe before returning to neutral');

    // Now return finger back to origin (0.5, 0.5) inside neutralRadius (<= 0.08)
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.51), 550);
    assert.equal(controller.modeAState, 'NEUTRAL');
    assert.ok(notifications.some(n => n.type === 'gesture_ready'));

    // Now Swipe 2: Downward swipe
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.51), 580);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.59), 610);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.68), 640);

    assert.equal(detectedGestures.length, 2, 'Second swipe triggers cleanly after neutral reset');
  });

  test('Enforces exactly one move per deliberate gesture stroke', () => {
    // Continued follow-through after initial trigger does not generate multiple moves
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.42), 30);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 60); // Triggers UP
    assert.equal(detectedGestures.length, 1);

    // Follow-through stroke continues moving up
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.25), 80);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.15), 100);

    assert.equal(detectedGestures.length, 1, 'Follow-through must not create additional moves');
  });

  test('Enforces animation lock: blocks gestures while game.isAnimating is true', () => {
    game.isAnimating = true;

    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.42), 30);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 60);

    assert.equal(detectedGestures.length, 0, 'Movement must be blocked during tile animation');
    assert.equal(game.moveCount, 0);

    // Unlock animation
    game.isAnimating = false;
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 100);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.42), 130);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.35), 160);

    assert.equal(detectedGestures.length, 1, 'Movement allowed once animation unlocks');
  });

  test('Handles hand disappearance: resets state safely without exceptions', () => {
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 0);
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.45), 30);

    // Hand leaves camera view
    controller.handleHandLost();
    assert.equal(controller.modeAState, 'NEUTRAL');
    assert.equal(controller.modeAAnchor, null);

    // New hand enters later
    controller.processLandmarks(createLandmarksWithIndex(0.5, 0.5), 1000);
    assert.equal(controller.modeAState, 'SWIPING');
  });

  test('Correctly applies camera mirroring (mirrorX: true)', () => {
    const mirroredController = new GestureController(game, {
      initialMode: 'MODE_A',
      mirrorX: true, // Selfie mirror mode
      swipeThreshold: 0.10,
      velocityThreshold: 0.0003,
      minStableFrames: 3
    });

    const mirroredGestures = [];
    mirroredController.onGestureDetected = (g) => mirroredGestures.push(g);

    // In raw camera coordinates, moving user hand to their right moves raw landmark leftwards:
    // raw x: 0.70 -> 0.62 -> 0.52 (decreasing raw x)
    // In mirrored coordinates: x_vis = 1 - x_raw:
    // x_vis: 0.30 -> 0.38 -> 0.48 (increasing, moving RIGHT visually)
    mirroredController.processLandmarks(createLandmarksWithIndex(0.70, 0.5), 0);
    mirroredController.processLandmarks(createLandmarksWithIndex(0.62, 0.5), 30);
    mirroredController.processLandmarks(createLandmarksWithIndex(0.52, 0.5), 60);

    assert.equal(mirroredGestures.length, 1);
    assert.equal(mirroredGestures[0].direction, 'RIGHT', 'Physical right movement must classify as RIGHT in mirrored mode');
  });
});
