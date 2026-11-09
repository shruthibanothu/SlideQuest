/**
 * SlideQuest - Core Game Engine
 * Manages puzzle state, tile movement, adjacency validation, move counting,
 * timer, and guaranteed-solvable board generation.
 */

export class SlideQuestGame {
  constructor(options = {}) {
    this.gridSize = options.gridSize || 3; // 3x3 default
    this.board = [];
    this.emptyIndex = -1;
    this.moveCount = 0;
    this.startTime = null;
    this.elapsedTime = 0;
    this.timerInterval = null;
    this.gameState = 'IDLE'; // 'IDLE' | 'PLAYING' | 'PAUSED' | 'WON'
    this.isAnimating = false;

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onMove = options.onMove || (() => {});
    this.onWin = options.onWin || (() => {});
    this.onInvalidMove = options.onInvalidMove || (() => {});

    this.initBoard();
  }

  /**
   * Initializes the board in solved state
   */
  initBoard() {
    const totalTiles = this.gridSize * this.gridSize;
    this.board = [];
    for (let i = 1; i < totalTiles; i++) {
      this.board.push(i);
    }
    this.board.push(0); // 0 represents the empty cell
    this.emptyIndex = totalTiles - 1;
    this.moveCount = 0;
    this.elapsedTime = 0;
    this.gameState = 'IDLE';
    this.stopTimer();
    this.notifyState();
  }

  /**
   * Starts a new shuffled game
   */
  startNewGame() {
    this.initBoard();
    this.shuffle();
    this.moveCount = 0;
    this.elapsedTime = 0;
    this.gameState = 'PLAYING';
    this.startTimer();
    this.notifyState();
  }

  /**
   * Changes the grid size (e.g. 3, 4, 5)
   */
  setGridSize(size) {
    if (size < 2 || size > 6) return;
    this.gridSize = size;
    this.startNewGame();
  }

  /**
   * Shuffles the puzzle by performing a random walk of valid moves
   * from the solved state. This mathematically guarantees the puzzle is solvable.
   */
  shuffle(moveCount = 150) {
    let lastMove = -1;
    const totalTiles = this.gridSize * this.gridSize;

    // Perform valid random moves to shuffle
    for (let i = 0; i < moveCount; i++) {
      const neighbors = this.getAdjacentIndices(this.emptyIndex);
      // Filter out reverse of last move to prevent trivial oscillation
      const validNeighbors = neighbors.filter(idx => idx !== lastMove);
      const chosenIndex = validNeighbors.length > 0
        ? validNeighbors[Math.floor(Math.random() * validNeighbors.length)]
        : neighbors[Math.floor(Math.random() * neighbors.length)];

      lastMove = this.emptyIndex;
      this.swap(chosenIndex, this.emptyIndex);
      this.emptyIndex = chosenIndex;
    }

    // Ensure it is not accidentally already solved
    if (this.isSolved()) {
      const neighbors = this.getAdjacentIndices(this.emptyIndex);
      const chosen = neighbors[0];
      this.swap(chosen, this.emptyIndex);
      this.emptyIndex = chosen;
    }

    // Double-check mathematical solvability parity
    if (!this.isSolvable(this.board, this.gridSize)) {
      console.warn('Parity check failed, regenerating shuffle...');
      this.initBoard();
      return this.shuffle(moveCount);
    }
  }

  /**
   * Mathematical parity validation for an N x N sliding puzzle
   */
  isSolvable(board, size) {
    let inversions = 0;
    const flat = board.filter(n => n !== 0);

    for (let i = 0; i < flat.length - 1; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[i] > flat[j]) {
          inversions++;
        }
      }
    }

    // For odd grid width (e.g. 3x3, 5x5):
    // Puzzle is solvable if and only if inversions is even.
    if (size % 2 === 1) {
      return inversions % 2 === 0;
    }

    // For even grid width (e.g. 4x4):
    // Row of empty cell from bottom (1-indexed)
    const emptyRow = Math.floor(board.indexOf(0) / size);
    const rowFromBottom = size - emptyRow;

    if (rowFromBottom % 2 === 1) {
      return inversions % 2 === 0;
    } else {
      return inversions % 2 === 1;
    }
  }

  /**
   * Checks if a tile can move into the empty space
   */
  canMoveTile(tileIndex) {
    if (tileIndex < 0 || tileIndex >= this.board.length) return false;
    if (this.board[tileIndex] === 0) return false;

    const row = Math.floor(tileIndex / this.gridSize);
    const col = tileIndex % this.gridSize;

    const emptyRow = Math.floor(this.emptyIndex / this.gridSize);
    const emptyCol = this.emptyIndex % this.gridSize;

    const rowDiff = Math.abs(row - emptyRow);
    const colDiff = Math.abs(col - emptyCol);

    return (rowDiff + colDiff === 1);
  }

  /**
   * Returns valid adjacent tile indices (up, down, left, right) for a cell
   */
  getAdjacentIndices(index) {
    const row = Math.floor(index / this.gridSize);
    const col = index % this.gridSize;
    const neighbors = [];

    // Up
    if (row > 0) neighbors.push((row - 1) * this.gridSize + col);
    // Down
    if (row < this.gridSize - 1) neighbors.push((row + 1) * this.gridSize + col);
    // Left
    if (col > 0) neighbors.push(row * this.gridSize + (col - 1));
    // Right
    if (col < this.gridSize - 1) neighbors.push(row * this.gridSize + (col + 1));

    return neighbors;
  }

  /**
   * Identifies the adjacent tile that can legally move in a given direction
   * into the empty cell.
   *
   * Requirement:
   * "Treat the gesture direction as the direction in which a tile should move into the empty cell.
   * Use the existing game engine to identify the adjacent tile that can legally move in that direction."
   *
   * Directions: 'UP', 'DOWN', 'LEFT', 'RIGHT'
   * - UP: The tile moves UP into empty cell. Thus, the tile must be situated BELOW the empty cell.
   * - DOWN: The tile moves DOWN into empty cell. Thus, the tile must be situated ABOVE the empty cell.
   * - LEFT: The tile moves LEFT into empty cell. Thus, the tile must be situated to the RIGHT of empty cell.
   * - RIGHT: The tile moves RIGHT into empty cell. Thus, the tile must be situated to the LEFT of empty cell.
   */
  getAdjacentTileInDirection(direction) {
    const emptyRow = Math.floor(this.emptyIndex / this.gridSize);
    const emptyCol = this.emptyIndex % this.gridSize;

    let targetRow = -1;
    let targetCol = -1;

    switch (direction.toUpperCase()) {
      case 'UP':
        targetRow = emptyRow + 1; // Tile below moves up into empty cell
        targetCol = emptyCol;
        break;
      case 'DOWN':
        targetRow = emptyRow - 1; // Tile above moves down into empty cell
        targetCol = emptyCol;
        break;
      case 'LEFT':
        targetRow = emptyRow;
        targetCol = emptyCol + 1; // Tile to the right moves left into empty cell
        break;
      case 'RIGHT':
        targetRow = emptyRow;
        targetCol = emptyCol - 1; // Tile to the left moves right into empty cell
        break;
      default:
        return null;
    }

    if (
      targetRow >= 0 &&
      targetRow < this.gridSize &&
      targetCol >= 0 &&
      targetCol < this.gridSize
    ) {
      return targetRow * this.gridSize + targetCol;
    }

    return null;
  }

  /**
   * Central movement execution function.
   * All input methods (click, tap, keyboard, gesture swipe, pinch-and-drag)
   * must pass through this method.
   */
  moveTile(tileIndex) {
    if (this.gameState !== 'PLAYING') {
      if (this.gameState === 'IDLE') {
        this.startNewGame();
      } else {
        return false;
      }
    }

    if (this.isAnimating) {
      return false; // Lock movement during active animation
    }

    if (!this.canMoveTile(tileIndex)) {
      this.onInvalidMove({
        tileIndex,
        emptyIndex: this.emptyIndex,
        reason: 'not_adjacent'
      });
      return false;
    }

    const previousEmptyIndex = this.emptyIndex;
    const movedTileValue = this.board[tileIndex];

    // Swap tile and empty space
    this.swap(tileIndex, previousEmptyIndex);
    this.emptyIndex = tileIndex;
    this.moveCount++;

    // Fire onMove callback
    this.onMove({
      fromIndex: tileIndex,
      toIndex: previousEmptyIndex,
      value: movedTileValue,
      moveCount: this.moveCount
    });

    // Check win condition
    if (this.isSolved()) {
      this.gameState = 'WON';
      this.stopTimer();
      this.onWin({
        moveCount: this.moveCount,
        elapsedTime: this.elapsedTime
      });
    }

    this.notifyState();
    return true;
  }

  /**
   * Executes a directional movement
   */
  moveInDirection(direction) {
    const tileIndex = this.getAdjacentTileInDirection(direction);
    if (tileIndex === null) {
      this.onInvalidMove({
        direction,
        emptyIndex: this.emptyIndex,
        reason: 'boundary'
      });
      return false;
    }
    return this.moveTile(tileIndex);
  }

  /**
   * Checks whether the puzzle is solved
   */
  isSolved() {
    const totalTiles = this.gridSize * this.gridSize;
    for (let i = 0; i < totalTiles - 1; i++) {
      if (this.board[i] !== i + 1) {
        return false;
      }
    }
    return this.board[totalTiles - 1] === 0;
  }

  swap(i, j) {
    const temp = this.board[i];
    this.board[i] = this.board[j];
    this.board[j] = temp;
  }

  startTimer() {
    this.stopTimer();
    this.startTime = Date.now() - (this.elapsedTime * 1000);
    this.timerInterval = setInterval(() => {
      this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
      this.notifyState();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  notifyState() {
    this.onStateChange({
      board: [...this.board],
      emptyIndex: this.emptyIndex,
      gridSize: this.gridSize,
      moveCount: this.moveCount,
      elapsedTime: this.elapsedTime,
      gameState: this.gameState,
      isSolved: this.isSolved()
    });
  }

  destroy() {
    this.stopTimer();
  }
}
