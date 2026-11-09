/**
 * Automated Test Suite for SlideQuest Mode B: Virtual Pinch-and-Drag System
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 * Validates pinch detection, hysteresis, cursor mapping, tile selection, drag tracking,
 * valid/invalid drops, diagonal rejection, tracking loss, animation locks, and mode switching.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GestureController } from '../src/gestureController.js';
import { SlideQuestGame } from '../src/game.js';

// Helper to create 21 landmarks with specified index tip (8) and thumb tip (4) positions
function createHand(indexX, indexY, thumbX, thumbY) {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: indexX, y: indexY, z: 0 });
  }
  landmarks[8] = { x: indexX, y: indexY, z: 0 };
  landmarks[4] = { x: thumbX, y: thumbY, z: 0 };
  return landmarks;
}

describe('SlideQuest Mode B - Pinch Detection & Hysteresis', () => {
  let controller;
  let pinchEvents;

  beforeEach(() => {
    pinchEvents = [];
    controller = new GestureController(null, {
      initialMode: 'MODE_B',
      mirrorX: false,
      pinchThreshold: 0.065,
      releaseThreshold: 0.095
    });

    controller.onPinchStateChange = (evt) => pinchEvents.push(evt);
  });

  test('Triggers pinch when distance between thumb and index drops <= 0.065', () => {
    // Distance = 0.12 (Open hand)
    controller.processLandmarks(createHand(0.5, 0.5, 0.62, 0.5));
    assert.equal(controller.isPinched, false);

    // Distance = 0.04 (Pinched hand)
    controller.processLandmarks(createHand(0.5, 0.5, 0.54, 0.5));
    assert.equal(controller.isPinched, true);
    assert.equal(pinchEvents.length, 1);
    assert.equal(pinchEvents[0].isPinched, true);
  });

  test('Maintains pinch state within hysteresis gap (between 0.065 and 0.095)', () => {
    // 1. Initial pinch at distance = 0.04 (<= 0.065)
    controller.processLandmarks(createHand(0.5, 0.5, 0.54, 0.5));
    assert.equal(controller.isPinched, true);

    // 2. Distance widens to 0.08 (inside hysteresis gap > 0.065 and < 0.095)
    controller.processLandmarks(createHand(0.5, 0.5, 0.58, 0.5));
    assert.equal(controller.isPinched, true, 'Pinch must NOT release inside the hysteresis gap');
    assert.equal(pinchEvents.length, 1); // No toggle event
  });

  test('Releases pinch when distance exceeds release threshold >= 0.095', () => {
    // 1. Start in pinched state
    controller.processLandmarks(createHand(0.5, 0.5, 0.54, 0.5));
    assert.equal(controller.isPinched, true);

    // 2. Open hand: distance = 0.12 (>= 0.095)
    controller.processLandmarks(createHand(0.5, 0.5, 0.62, 0.5));
    assert.equal(controller.isPinched, false);
    assert.equal(pinchEvents.length, 2);
    assert.equal(pinchEvents[1].isPinched, false);
  });

  test('Does not re-trigger pinch in hysteresis gap when opening from pinched', () => {
    // Open hand distance = 0.14
    controller.processLandmarks(createHand(0.5, 0.5, 0.64, 0.5));
    assert.equal(controller.isPinched, false);

    // Hand narrows slightly to 0.08 (not yet <= 0.065)
    controller.processLandmarks(createHand(0.5, 0.5, 0.58, 0.5));
    assert.equal(controller.isPinched, false, 'Must not begin pinch in hysteresis gap');
  });
});

describe('SlideQuest Mode B - Virtual Cursor Coordinate Mapping & Smoothing', () => {
  let controller;
  let game;
  const mockBoardBounds = {
    left: 100,
    top: 100,
    right: 700,
    bottom: 700,
    width: 600,
    height: 600
  };

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    // [1, 2, 3]
    // [4, 0, 5]  <- 0 is center cell (index 4)
    // [6, 7, 8]
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';

    controller = new GestureController(game, {
      initialMode: 'MODE_B',
      mirrorX: false,
      boardBounds: mockBoardBounds,
      cursorSmoothing: 0.50
    });
  });

  test('Maps normalized camera coordinates to correct grid cell targets', () => {
    // With 1000x1000 viewport and 600x600 board at (100, 100):
    // Cell size = 200x200
    // Center of tile 0 (row 0, col 0): screenX = 200, screenY = 200 -> norm (0.20, 0.20)
    const target0 = controller.getBoardTargetAt(0.20, 0.20);
    assert.ok(target0);
    assert.equal(target0.index, 0);
    assert.equal(target0.type, 'tile');
    assert.equal(target0.value, 1);

    // Center of empty cell (row 1, col 1): screenX = 400, screenY = 400 -> norm (0.40, 0.40)
    const targetCenter = controller.getBoardTargetAt(0.40, 0.40);
    assert.ok(targetCenter);
    assert.equal(targetCenter.index, 4);
    assert.equal(targetCenter.type, 'empty');
    assert.equal(targetCenter.value, 0);

    // Center of tile 8 (row 2, col 2): screenX = 600, screenY = 600 -> norm (0.60, 0.60)
    const target8 = controller.getBoardTargetAt(0.60, 0.60);
    assert.ok(target8);
    assert.equal(target8.index, 8);
    assert.equal(target8.type, 'tile');
    assert.equal(target8.value, 8);
  });

  test('Returns null when cursor is outside puzzle board boundaries', () => {
    // Outside top-left: norm (0.05, 0.05) -> screenX = 50 < 100
    assert.equal(controller.getBoardTargetAt(0.05, 0.05), null);
    // Outside bottom-right: norm (0.85, 0.85) -> screenX = 850 > 700
    assert.equal(controller.getBoardTargetAt(0.85, 0.85), null);
  });

  test('Applies exponential moving average smoothing to reduce cursor jitter', () => {
    // Frame 1: Initial position at 0.40
    controller.processLandmarks(createHand(0.40, 0.40, 0.55, 0.40));
    assert.equal(controller.smoothedCursor.x, 0.40);

    // Frame 2: Jitter jump to 0.50
    // With alpha = 0.50, smoothedX = 0.40 * 0.5 + 0.50 * 0.5 = 0.45
    controller.processLandmarks(createHand(0.50, 0.40, 0.65, 0.40));
    assert.equal(controller.smoothedCursor.x, 0.45, 'Cursor position must be smoothed');
  });

  test('Supports camera mirroring (mirrorX: true)', () => {
    controller.updateConfig({ mirrorX: true });
    // In raw camera coordinates, index is at x=0.70
    // With mirrorX, screen x = 1 - 0.70 = 0.30
    controller.processLandmarks(createHand(0.70, 0.40, 0.75, 0.40));
    assert.equal(Math.round(controller.smoothedCursor.x * 100) / 100, 0.30);
  });
});

describe('SlideQuest Mode B - Drag & Drop Interactions & Safeguards', () => {
  let game;
  let controller;
  let dragStartEvents;
  let dragEndEvents;
  let invalidMoves;
  const mockBoardBounds = {
    left: 100,
    top: 100,
    right: 700,
    bottom: 700,
    width: 600,
    height: 600
  };

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    // Board:
    // [1, 2, 3]  (indices 0, 1, 2)
    // [4, 0, 5]  (indices 3, 4, 5) <- 0 is empty center at (0.40, 0.40)
    // [6, 7, 8]  (indices 6, 7, 8)
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';

    dragStartEvents = [];
    dragEndEvents = [];
    invalidMoves = [];

    game.onInvalidMove = (evt) => invalidMoves.push(evt);

    controller = new GestureController(game, {
      initialMode: 'MODE_B',
      mirrorX: false,
      boardBounds: mockBoardBounds,
      cursorSmoothing: 1.0 // 1.0 for instant position alignment in tests
    });

    controller.onDragStart = (e) => dragStartEvents.push(e);
    controller.onDragEnd = (e) => dragEndEvents.push(e);
  });

  test('Selects tile when pinching over a valid numbered tile', () => {
    // Hover over tile 1 (index 1, at norm 0.40, 0.20) with open hand (distance = 0.15)
    controller.processLandmarks(createHand(0.40, 0.20, 0.55, 0.20));
    assert.equal(controller.modeBState, 'IDLE');

    // Pinch down on tile 1 (distance = 0.03 <= 0.065)
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.modeBState, 'DRAGGING');
    assert.equal(controller.draggedTileIndex, 1);
    assert.equal(dragStartEvents.length, 1);
    assert.equal(dragStartEvents[0].tileIndex, 1);
    assert.equal(dragStartEvents[0].tileValue, 2);
  });

  test('Rejects selecting the empty cell as a draggable tile', () => {
    // Pinch over empty cell (index 4, at norm 0.40, 0.40)
    controller.processLandmarks(createHand(0.40, 0.40, 0.43, 0.40));
    assert.equal(controller.isPinched, true);
    assert.equal(controller.modeBState, 'IDLE', 'Empty cell must never be grabbed as a draggable tile');
    assert.equal(controller.draggedTileIndex, null);
    assert.equal(dragStartEvents.length, 0);
  });

  test('Completes valid move when adjacent tile is dragged and dropped onto empty cell', () => {
    // 1. Pinch on tile 1 (index 1, directly above empty cell 4)
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.modeBState, 'DRAGGING');
    assert.equal(controller.draggedTileIndex, 1);

    // 2. Drag pinched hand down to center empty cell (0.40, 0.40)
    controller.processLandmarks(createHand(0.40, 0.40, 0.43, 0.40));
    assert.equal(controller.modeBState, 'DRAGGING');

    // 3. Release pinch over empty cell (distance = 0.12 >= 0.095)
    controller.processLandmarks(createHand(0.40, 0.40, 0.52, 0.40));

    // Move completed!
    assert.equal(controller.modeBState, 'IDLE');
    assert.equal(controller.draggedTileIndex, null);
    assert.equal(dragEndEvents.length, 1);
    assert.equal(dragEndEvents[0].success, true);
    assert.equal(dragEndEvents[0].tileIndex, 1);

    // Game engine verified: tile 2 is now at center, empty cell is at index 1, moves incremented
    assert.equal(game.board[4], 2);
    assert.equal(game.board[1], 0);
    assert.equal(game.emptyIndex, 1);
    assert.equal(game.moveCount, 1);
  });

  test('Rejects dropping a non-adjacent tile into the empty cell', () => {
    // Tile 0 (top-left, index 0 at 0.20, 0.20) is diagonal/non-adjacent to center empty cell (index 4)
    // 1. Pinch on tile 0
    controller.processLandmarks(createHand(0.20, 0.20, 0.23, 0.20));
    assert.equal(controller.draggedTileIndex, 0);

    // 2. Drag into empty cell at (0.40, 0.40)
    controller.processLandmarks(createHand(0.40, 0.40, 0.43, 0.40));

    // 3. Release pinch
    controller.processLandmarks(createHand(0.40, 0.40, 0.52, 0.40));

    // Must be cancelled!
    assert.equal(controller.modeBState, 'IDLE');
    assert.equal(dragEndEvents.length, 1);
    assert.equal(dragEndEvents[0].success, false);
    assert.equal(dragEndEvents[0].reason, 'not_adjacent');

    // Game engine check: board unchanged, move count 0
    assert.equal(game.board[0], 1);
    assert.equal(game.board[4], 0);
    assert.equal(game.moveCount, 0);
    assert.ok(invalidMoves.length > 0);
  });

  test('Cancels drag if released outside the empty cell or outside the board', () => {
    // 1. Pinch tile 1 (index 1 at 0.40, 0.20)
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.draggedTileIndex, 1);

    // 2. Drag outside board to (0.05, 0.05) and release
    controller.processLandmarks(createHand(0.05, 0.05, 0.08, 0.05));
    controller.processLandmarks(createHand(0.05, 0.05, 0.20, 0.05)); // Release

    assert.equal(controller.modeBState, 'IDLE');
    assert.equal(dragEndEvents[0].success, false);
    assert.equal(dragEndEvents[0].reason, 'not_over_empty');
    assert.equal(game.moveCount, 0);
  });

  test('Safely cancels active drag if hand tracking is lost mid-drag', () => {
    // Pinch and drag tile 1
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.modeBState, 'DRAGGING');

    // Hand disappears from view
    controller.handleHandLost();

    assert.equal(controller.modeBState, 'IDLE');
    assert.equal(controller.draggedTileIndex, null);
    assert.equal(controller.isPinched, false);
    assert.equal(dragEndEvents.length, 1);
    assert.equal(dragEndEvents[0].reason, 'hand_lost');
    assert.equal(game.moveCount, 0);
  });

  test('Rejects drag start while animation lock is active', () => {
    game.isAnimating = true;

    // Pinch tile 1
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.modeBState, 'IDLE', 'Cannot start drag during active tile animation');
    assert.equal(controller.draggedTileIndex, null);
  });

  test('Switching modes cleanly cancels active drag without corrupting puzzle state', () => {
    // Pinch and drag in Mode B
    controller.processLandmarks(createHand(0.40, 0.20, 0.43, 0.20));
    assert.equal(controller.modeBState, 'DRAGGING');

    // Player switches to Mode A
    controller.setMode('MODE_A');

    assert.equal(controller.mode, 'MODE_A');
    assert.equal(controller.modeBState, 'IDLE');
    assert.equal(controller.draggedTileIndex, null);
    assert.equal(controller.isPinched, false);
    assert.equal(game.moveCount, 0);
    assert.equal(game.board[4], 0);
  });

  test('Does NOT modify puzzle array directly (guarantees engine authority)', () => {
    const originalBoard = [...game.board];

    // Attempt invalid drag-and-drop
    controller.processLandmarks(createHand(0.20, 0.20, 0.23, 0.20));
    controller.processLandmarks(createHand(0.40, 0.40, 0.52, 0.40));

    // Board must match original
    assert.deepEqual(game.board, originalBoard);
  });
});
