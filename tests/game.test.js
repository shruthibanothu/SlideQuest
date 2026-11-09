/**
 * Automated Test Suite for SlideQuest Core Engine
 * Uses Node.js built-in test runner ('node:test') and strict assertions ('node:assert/strict').
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SlideQuestGame } from '../src/game.js';

describe('SlideQuest Engine - Board Initialization & State', () => {
  test('Initializes solved 3x3 board with numbers 1..8 and 0 as empty cell at end', () => {
    const game = new SlideQuestGame({ gridSize: 3 });
    assert.equal(game.board.length, 9);
    assert.deepEqual(game.board, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
    assert.equal(game.emptyIndex, 8);
    assert.equal(game.moveCount, 0);
    assert.equal(game.isSolved(), true);
  });

  test('Initializes solved 4x4 and 5x5 boards correctly', () => {
    const game4 = new SlideQuestGame({ gridSize: 4 });
    assert.equal(game4.board.length, 16);
    assert.equal(game4.emptyIndex, 15);
    assert.equal(game4.board[15], 0);
    assert.equal(game4.isSolved(), true);

    const game5 = new SlideQuestGame({ gridSize: 5 });
    assert.equal(game5.board.length, 25);
    assert.equal(game5.emptyIndex, 24);
    assert.equal(game5.board[24], 0);
    assert.equal(game5.isSolved(), true);
  });

  test('Guarantees exactly one empty cell (value 0) in the board', () => {
    const game = new SlideQuestGame({ gridSize: 3 });
    game.startNewGame();
    const zeros = game.board.filter(x => x === 0);
    assert.equal(zeros.length, 1);
    assert.equal(game.board[game.emptyIndex], 0);
  });
});

describe('SlideQuest Engine - Adjacency & Movement Validation', () => {
  let game;

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    // Manually place empty cell at center (index 4) for precise adjacency testing
    // [1, 2, 3]
    // [4, 0, 5]  <- 0 is at index 4
    // [6, 7, 8]
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';
  });

  test('Allows valid horizontal movements (left and right adjacent neighbors)', () => {
    // Tile 4 is at index 3 (left of empty)
    assert.equal(game.canMoveTile(3), true);
    // Tile 5 is at index 5 (right of empty)
    assert.equal(game.canMoveTile(5), true);
  });

  test('Allows valid vertical movements (up and down adjacent neighbors)', () => {
    // Tile 2 is at index 1 (above empty)
    assert.equal(game.canMoveTile(1), true);
    // Tile 7 is at index 7 (below empty)
    assert.equal(game.canMoveTile(7), true);
  });

  test('Rejects invalid diagonal movements', () => {
    // Corner tiles relative to center (indices 0, 2, 6, 8)
    assert.equal(game.canMoveTile(0), false, 'Top-left diagonal must be rejected');
    assert.equal(game.canMoveTile(2), false, 'Top-right diagonal must be rejected');
    assert.equal(game.canMoveTile(6), false, 'Bottom-left diagonal must be rejected');
    assert.equal(game.canMoveTile(8), false, 'Bottom-right diagonal must be rejected');
  });

  test('Rejects moving the empty cell into itself', () => {
    assert.equal(game.canMoveTile(4), false);
  });

  test('Rejects out-of-bounds indices and negative indices', () => {
    assert.equal(game.canMoveTile(-1), false);
    assert.equal(game.canMoveTile(9), false);
    assert.equal(game.canMoveTile(100), false);
  });

  test('Rejects moves blocked by board boundaries', () => {
    // Place empty cell in top-left corner (index 0)
    // [0, 1, 2]
    // [3, 4, 5]
    // [6, 7, 8]
    game.board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    game.emptyIndex = 0;

    // Adjacent: 1 (right) and 3 (down)
    assert.equal(game.canMoveTile(1), true);
    assert.equal(game.canMoveTile(3), true);

    // Tiles far away cannot move
    assert.equal(game.canMoveTile(2), false);
    assert.equal(game.canMoveTile(4), false);
    assert.equal(game.canMoveTile(8), false);
  });
});

describe('SlideQuest Engine - Move Execution, Empty Position & Move Counter', () => {
  let game;

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    // [1, 2, 3]
    // [4, 5, 6]
    // [7, 8, 0]
    game.gameState = 'PLAYING';
  });

  test('Successfully executes move: updates board, emptyIndex, and increments moveCount', () => {
    // Tile 8 is at index 7, adjacent to empty index 8
    assert.equal(game.emptyIndex, 8);
    assert.equal(game.moveCount, 0);

    const success = game.moveTile(7);
    assert.equal(success, true);
    assert.equal(game.emptyIndex, 7);
    assert.equal(game.board[7], 0);
    assert.equal(game.board[8], 8);
    assert.equal(game.moveCount, 1);
  });

  test('Move counter increments only for valid moves', () => {
    // Attempt invalid moves
    const invalid1 = game.moveTile(0); // Top-left corner
    assert.equal(invalid1, false);
    assert.equal(game.moveCount, 0);

    const invalid2 = game.moveTile(4); // Center tile
    assert.equal(invalid2, false);
    assert.equal(game.moveCount, 0);

    // Now valid move (index 5, directly above empty cell 8)
    const valid1 = game.moveTile(5);
    assert.equal(valid1, true);
    assert.equal(game.moveCount, 1);
  });

  test('Enforces animation lock: rejects moves while isAnimating is true', () => {
    game.isAnimating = true;
    const moved = game.moveTile(7);
    assert.equal(moved, false);
    assert.equal(game.moveCount, 0);

    game.isAnimating = false;
    const movedAfterUnlock = game.moveTile(7);
    assert.equal(movedAfterUnlock, true);
    assert.equal(game.moveCount, 1);
  });

  test('Fires onMove and onInvalidMove callbacks', () => {
    let moveEvent = null;
    let invalidEvent = null;

    game.onMove = (evt) => { moveEvent = evt; };
    game.onInvalidMove = (evt) => { invalidEvent = evt; };

    // Valid move
    game.moveTile(7);
    assert.ok(moveEvent);
    assert.equal(moveEvent.fromIndex, 7);
    assert.equal(moveEvent.toIndex, 8);
    assert.equal(moveEvent.value, 8);
    assert.equal(moveEvent.moveCount, 1);

    // Invalid move
    game.moveTile(0);
    assert.ok(invalidEvent);
    assert.equal(invalidEvent.tileIndex, 0);
    assert.equal(invalidEvent.reason, 'not_adjacent');
  });
});

describe('SlideQuest Engine - Directional Movement Mapping', () => {
  let game;

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
    // Place empty cell in center (index 4)
    // [1, 2, 3]
    // [4, 0, 5]  <- empty at row 1, col 1
    // [6, 7, 8]
    game.board = [1, 2, 3, 4, 0, 5, 6, 7, 8];
    game.emptyIndex = 4;
    game.gameState = 'PLAYING';
  });

  test('UP gesture moves the tile below the empty cell upwards into the empty space', () => {
    // Tile below center (row 2, col 1) is at index 7 (value 7)
    const tileIdx = game.getAdjacentTileInDirection('UP');
    assert.equal(tileIdx, 7);

    const moved = game.moveInDirection('UP');
    assert.equal(moved, true);
    assert.equal(game.emptyIndex, 7);
    assert.equal(game.board[4], 7);
  });

  test('DOWN gesture moves the tile above the empty cell downwards into the empty space', () => {
    // Tile above center (row 0, col 1) is at index 1 (value 2)
    const tileIdx = game.getAdjacentTileInDirection('DOWN');
    assert.equal(tileIdx, 1);

    const moved = game.moveInDirection('DOWN');
    assert.equal(moved, true);
    assert.equal(game.emptyIndex, 1);
    assert.equal(game.board[4], 2);
  });

  test('LEFT gesture moves the tile to the right of empty cell leftwards into empty space', () => {
    // Tile to right of center (row 1, col 2) is at index 5 (value 5)
    const tileIdx = game.getAdjacentTileInDirection('LEFT');
    assert.equal(tileIdx, 5);

    const moved = game.moveInDirection('LEFT');
    assert.equal(moved, true);
    assert.equal(game.emptyIndex, 5);
    assert.equal(game.board[4], 5);
  });

  test('RIGHT gesture moves the tile to the left of empty cell rightwards into empty space', () => {
    // Tile to left of center (row 1, col 0) is at index 3 (value 4)
    const tileIdx = game.getAdjacentTileInDirection('RIGHT');
    assert.equal(tileIdx, 3);

    const moved = game.moveInDirection('RIGHT');
    assert.equal(moved, true);
    assert.equal(game.emptyIndex, 3);
    assert.equal(game.board[4], 4);
  });

  test('Rejects directional movement when blocked by boundary', () => {
    // Empty cell in top-left (row 0, col 0)
    game.board = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    game.emptyIndex = 0;

    // Moving DOWN requires a tile ABOVE empty cell (which does not exist at top row)
    assert.equal(game.getAdjacentTileInDirection('DOWN'), null);
    assert.equal(game.moveInDirection('DOWN'), false);

    // Moving RIGHT requires a tile to the LEFT of empty cell (which does not exist at col 0)
    assert.equal(game.getAdjacentTileInDirection('RIGHT'), null);
    assert.equal(game.moveInDirection('RIGHT'), false);

    // Moving UP (tile below at index 3) and LEFT (tile right at index 1) are valid
    assert.equal(game.getAdjacentTileInDirection('UP'), 3);
    assert.equal(game.getAdjacentTileInDirection('LEFT'), 1);
  });

  test('Handles lowercase and invalid direction strings gracefully', () => {
    assert.equal(game.getAdjacentTileInDirection('up'), 7);
    assert.equal(game.getAdjacentTileInDirection('DIAGONAL'), null);
    assert.equal(game.getAdjacentTileInDirection(''), null);
    assert.equal(game.getAdjacentTileInDirection(null), null);
  });
});

describe('SlideQuest Engine - Win Detection & Solved State', () => {
  test('Detects win when final move places last tile in solved sequence', () => {
    const game = new SlideQuestGame({ gridSize: 3 });
    // One move away from win:
    // [1, 2, 3]
    // [4, 5, 6]
    // [7, 0, 8]  <- swap tile 8 (at index 8) with empty 7
    game.board = [1, 2, 3, 4, 5, 6, 7, 0, 8];
    game.emptyIndex = 7;
    game.gameState = 'PLAYING';

    let winFired = false;
    let winData = null;
    game.onWin = (data) => {
      winFired = true;
      winData = data;
    };

    assert.equal(game.isSolved(), false);
    assert.equal(game.gameState, 'PLAYING');

    // Move tile 8 (index 8) left into empty cell 7
    const moved = game.moveTile(8);
    assert.equal(moved, true);
    assert.equal(game.isSolved(), true);
    assert.equal(game.gameState, 'WON');
    assert.equal(winFired, true);
    assert.equal(winData.moveCount, 1);
  });
});

describe('SlideQuest Engine - Mathematical Solvability & Parity Verification', () => {
  let game;

  beforeEach(() => {
    game = new SlideQuestGame({ gridSize: 3 });
  });

  test('Solvability for Odd-width (3x3): solvable iff inversion count is even', () => {
    // Solved 3x3: Inversions = 0 (even) -> Solvable
    assert.equal(game.isSolvable([1, 2, 3, 4, 5, 6, 7, 8, 0], 3), true);

    // Swap two adjacent tiles (1 and 2): Inversions = 1 (odd) -> Unsolvable!
    assert.equal(game.isSolvable([2, 1, 3, 4, 5, 6, 7, 8, 0], 3), false);

    // Two swaps: Inversions = 2 (even) -> Solvable
    assert.equal(game.isSolvable([3, 1, 2, 4, 5, 6, 7, 8, 0], 3), true);
  });

  test('Solvability for Even-width (4x4): considers inversion count AND blank row from bottom', () => {
    // Solved 4x4:
    // Inversions = 0 (even).
    // Blank is at index 15: row 3 (0-indexed). Row from bottom = 4 - 3 = 1 (odd).
    // When row from bottom is odd, inversions must be even -> SOLVABLE
    const solved4x4 = [
      1,  2,  3,  4,
      5,  6,  7,  8,
      9, 10, 11, 12,
      13, 14, 15,  0
    ];
    assert.equal(game.isSolvable(solved4x4, 4), true);

    // Unsolvable 15-puzzle (Sam Loyd's classic paradox): swap 14 and 15
    // Inversions = 1 (odd), row from bottom = 1 (odd) -> UNSOLVABLE
    const unsolvable4x4 = [
      1,  2,  3,  4,
      5,  6,  7,  8,
      9, 10, 11, 12,
      13, 15, 14,  0
    ];
    assert.equal(game.isSolvable(unsolvable4x4, 4), false);

    // Blank on row 2 from bottom (e.g., row 2 from top):
    // Blank at index 11. Row from bottom = 4 - 2 = 2 (even).
    // For blank row even, inversions must be odd.
    // Let's create by moving tile 12 down into empty 15 (1 valid vertical move from solved)
    const validOneMove4x4 = [
      1,  2,  3,  4,
      5,  6,  7,  8,
      9, 10, 11,  0,
      13, 14, 15, 12
    ];
    // Inversions: 12 is after 13, 14, 15 -> 3 inversions (odd). Row from bottom = 2 (even).
    assert.equal(game.isSolvable(validOneMove4x4, 4), true);
  });

  test('Solvability for 5x5 boards: odd width inversion parity holds', () => {
    const solved5x5 = [];
    for (let i = 1; i <= 24; i++) solved5x5.push(i);
    solved5x5.push(0);
    assert.equal(game.isSolvable(solved5x5, 5), true);

    // Swap first two tiles: 1 inversion -> Unsolvable
    const unsolvable5x5 = [...solved5x5];
    unsolvable5x5[0] = 2;
    unsolvable5x5[1] = 1;
    assert.equal(game.isSolvable(unsolvable5x5, 5), false);
  });

  test('Generated shuffle configurations are 100% solvable across 3x3, 4x4, and 5x5', () => {
    // Test 3x3 shuffles
    const g3 = new SlideQuestGame({ gridSize: 3 });
    for (let i = 0; i < 20; i++) {
      g3.startNewGame();
      assert.equal(g3.isSolvable(g3.board, 3), true, `3x3 shuffle #${i} must be solvable`);
      assert.equal(g3.board.length, 9);
      assert.equal(g3.board.filter(x => x === 0).length, 1);
    }

    // Test 4x4 shuffles
    const g4 = new SlideQuestGame({ gridSize: 4 });
    for (let i = 0; i < 20; i++) {
      g4.startNewGame();
      assert.equal(g4.isSolvable(g4.board, 4), true, `4x4 shuffle #${i} must be solvable`);
      assert.equal(g4.board.length, 16);
      assert.equal(g4.board.filter(x => x === 0).length, 1);
    }

    // Test 5x5 shuffles
    const g5 = new SlideQuestGame({ gridSize: 5 });
    for (let i = 0; i < 10; i++) {
      g5.startNewGame();
      assert.equal(g5.isSolvable(g5.board, 5), true, `5x5 shuffle #${i} must be solvable`);
      assert.equal(g5.board.length, 25);
      assert.equal(g5.board.filter(x => x === 0).length, 1);
    }
  });
});
