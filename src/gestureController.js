/**
 * SlideQuest - Gesture Controller
 * Implements Mode A (Directional Index-Finger Movement) and
 * Mode B (Virtual Pinch-and-Drag) with full safeguards, hysteresis,
 * velocity filtering, neutral reset, and animation locks.
 */

export class GestureController {
  constructor(game, options = {}) {
    this.game = game;

    // Control Modes: 'OFF' | 'MODE_A' (Directional) | 'MODE_B' (Pinch & Drag)
    this.mode = options.initialMode || 'OFF';

    // Configurable thresholds & calibration
    this.config = {
      mirrorX: options.mirrorX !== undefined ? options.mirrorX : true,

      // Mode A: Directional Swipe Settings
      swipeThreshold: options.swipeThreshold || 0.11, // Normalized displacement (0.0 to 1.0)
      velocityThreshold: options.velocityThreshold || 0.00035, // Normalized units per ms
      neutralRadius: options.neutralRadius || 0.075, // Radius to return to before next swipe
      maxGestureDurationMs: 800, // Maximum time for a swipe stroke
      cooldownMs: 320, // Lockout period after executing a move

      // Mode B: Pinch & Drag Settings
      pinchThreshold: options.pinchThreshold || 0.065, // Distance threshold to trigger pinch
      releaseThreshold: options.releaseThreshold || 0.095, // Hysteresis threshold to release pinch
      cursorSmoothing: options.cursorSmoothing || 0.65, // EMA alpha for cursor smoothing

      // General safeguards
      minConfidence: 0.55
    };

    // State Tracking
    this.isCoolingDown = false;
    this.cooldownTimer = null;

    // Mode A internal state
    this.modeAState = 'NEUTRAL'; // 'NEUTRAL' | 'SWIPING' | 'TRIGGERED' | 'AWAITING_NEUTRAL'
    this.modeAAnchor = null; // { x, y, time }
    this.modeAHighestDisplacement = 0;

    // Mode B internal state
    this.modeBState = 'IDLE'; // 'IDLE' | 'PINCHING' | 'DRAGGING'
    this.isPinched = false;
    this.draggedTileIndex = null;
    this.smoothedCursor = { x: 0.5, y: 0.5 };
    this.rawNormalizedCursor = { x: 0.5, y: 0.5 };

    // Reference to DOM element for board coordinate mapping
    this.boardElement = null;

    // Event callbacks
    this.onGestureDetected = options.onGestureDetected || (() => {});
    this.onCursorUpdate = options.onCursorUpdate || (() => {});
    this.onDragStart = options.onDragStart || (() => {});
    this.onDragMove = options.onDragMove || (() => {});
    this.onDragEnd = options.onDragEnd || (() => {});
    this.onPinchStateChange = options.onPinchStateChange || (() => {});
    this.onStatusNotification = options.onStatusNotification || (() => {});
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.resetState();
    this.mode = mode;
    this.onStatusNotification({
      type: 'mode_change',
      mode: this.mode,
      message: `Gesture mode: ${this.mode}`
    });
  }

  setBoardElement(element) {
    this.boardElement = element;
  }

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /**
   * Resets all internal gesture states (e.g. when mode switches or hand disappears)
   */
  resetState() {
    // Mode A reset
    this.modeAState = 'NEUTRAL';
    this.modeAAnchor = null;
    this.modeAHighestDisplacement = 0;

    // Mode B reset
    if (this.draggedTileIndex !== null) {
      this.cancelDrag('hand_reset');
    }
    this.isPinched = false;
    this.modeBState = 'IDLE';
    this.draggedTileIndex = null;

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.isCoolingDown = false;
  }

  /**
   * Called by HandTracker when a hand is detected
   */
  processLandmarks(landmarks) {
    if (this.mode === 'OFF' || !landmarks || landmarks.length < 21) {
      return;
    }

    const now = performance.now();

    // Key Landmarks
    // 0: Wrist, 4: Thumb Tip, 8: Index Tip, 5: Index MCP
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const wrist = landmarks[0];

    // Compute normalized coordinates considering mirror preference
    const currentX = this.config.mirrorX ? (1 - indexTip.x) : indexTip.x;
    const currentY = indexTip.y;

    // Update smoothed cursor (for both modes and UI pointer)
    const alpha = this.config.cursorSmoothing;
    this.smoothedCursor.x = (this.smoothedCursor.x * (1 - alpha)) + (currentX * alpha);
    this.smoothedCursor.y = (this.smoothedCursor.y * (1 - alpha)) + (currentY * alpha);
    this.rawNormalizedCursor = { x: currentX, y: currentY };

    // Fire cursor update for UI tracking overlay
    this.onCursorUpdate({
      normalizedX: this.smoothedCursor.x,
      normalizedY: this.smoothedCursor.y,
      isPinched: this.isPinched,
      mode: this.mode
    });

    // Check if puzzle is currently animating or cooling down
    if (this.game.isAnimating || this.isCoolingDown) {
      return;
    }

    if (this.mode === 'MODE_A') {
      this.processModeA(currentX, currentY, now);
    } else if (this.mode === 'MODE_B') {
      this.processModeB(indexTip, thumbTip, currentX, currentY, now);
    }
  }

  /**
   * Called by HandTracker when hand tracking is lost
   */
  handleHandLost() {
    if (this.mode === 'MODE_B' && this.draggedTileIndex !== null) {
      // Safeguard: Gesture cancellation if tracking is lost during a drag
      this.cancelDrag('hand_lost');
    }
    this.resetState();
  }

  /* =========================================================================
   * MODE A: Directional Index-Finger Movement (Swipe)
   * ========================================================================= */
  processModeA(currentX, currentY, now) {
    if (this.modeAState === 'AWAITING_NEUTRAL') {
      // Finger must return within neutralRadius of anchor to reset
      if (this.modeAAnchor) {
        const dx = currentX - this.modeAAnchor.x;
        const dy = currentY - this.modeAAnchor.y;
        const distFromAnchor = Math.hypot(dx, dy);

        if (distFromAnchor <= this.config.neutralRadius) {
          this.modeAState = 'NEUTRAL';
          this.modeAAnchor = { x: currentX, y: currentY, time: now };
          this.onStatusNotification({
            type: 'gesture_ready',
            message: 'Ready for swipe'
          });
        }
      } else {
        this.modeAState = 'NEUTRAL';
      }
      return;
    }

    if (this.modeAState === 'NEUTRAL') {
      this.modeAAnchor = { x: currentX, y: currentY, time: now };
      this.modeAState = 'SWIPING';
      this.modeAHighestDisplacement = 0;
      return;
    }

    if (this.modeAState === 'SWIPING') {
      const dt = now - this.modeAAnchor.time;

      if (dt > this.config.maxGestureDurationMs) {
        // Slow ordinary movement, not a quick deliberate swipe: reset anchor
        this.modeAAnchor = { x: currentX, y: currentY, time: now };
        return;
      }

      const dx = currentX - this.modeAAnchor.x;
      const dy = currentY - this.modeAAnchor.y;
      const displacement = Math.hypot(dx, dy);
      const velocity = dt > 0 ? (displacement / dt) : 0;

      // Check if threshold is met
      if (
        displacement >= this.config.swipeThreshold &&
        velocity >= this.config.velocityThreshold
      ) {
        // Classify dominant direction: UP, DOWN, LEFT, RIGHT
        let direction = null;
        if (Math.abs(dx) > Math.abs(dy)) {
          direction = dx > 0 ? 'RIGHT' : 'LEFT';
        } else {
          direction = dy > 0 ? 'DOWN' : 'UP';
        }

        // Execute gesture move through game engine
        this.executeModeAGesture(direction);
      }
    }
  }

  executeModeAGesture(direction) {
    // Transition to triggered state
    this.modeAState = 'AWAITING_NEUTRAL';
    this.startCooldown();

    this.onGestureDetected({
      type: 'swipe',
      direction,
      timestamp: performance.now()
    });

    // Pass gesture direction directly to central game engine
    const moveSuccess = this.game.moveInDirection(direction);

    this.onStatusNotification({
      type: 'swipe_executed',
      direction,
      success: moveSuccess,
      message: moveSuccess ? `Move ${direction}` : `Blocked (${direction})`
    });
  }

  /* =========================================================================
   * MODE B: Virtual Pinch-and-Drag System
   * ========================================================================= */
  processModeB(indexTip, thumbTip, currentX, currentY, now) {
    // Calculate normalized Euclidean distance between thumb and index tips
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const dz = (thumbTip.z || 0) - (indexTip.z || 0);
    const pinchDistance = Math.hypot(dx, dy, dz);

    const wasPinched = this.isPinched;

    // Pinch Hysteresis check
    if (!this.isPinched) {
      if (pinchDistance <= this.config.pinchThreshold) {
        this.isPinched = true;
      }
    } else {
      if (pinchDistance >= this.config.releaseThreshold) {
        this.isPinched = false;
      }
    }

    if (this.isPinched !== wasPinched) {
      this.onPinchStateChange({
        isPinched: this.isPinched,
        distance: pinchDistance
      });
    }

    // Map virtual cursor to puzzle board tile
    const boardTarget = this.getBoardTargetAt(this.smoothedCursor.x, this.smoothedCursor.y);

    // State 1: Fresh Pinch started
    if (!wasPinched && this.isPinched) {
      if (boardTarget && boardTarget.type === 'tile') {
        const tileIndex = boardTarget.index;
        // Verify tile can actually move or is adjacent
        this.draggedTileIndex = tileIndex;
        this.modeBState = 'DRAGGING';

        this.onDragStart({
          tileIndex,
          tileValue: this.game.board[tileIndex],
          cursor: { ...this.smoothedCursor },
          isAdjacent: this.game.canMoveTile(tileIndex)
        });
      }
    }

    // State 2: Currently Dragging
    if (this.isPinched && this.modeBState === 'DRAGGING') {
      this.onDragMove({
        tileIndex: this.draggedTileIndex,
        cursor: { ...this.smoothedCursor },
        target: boardTarget,
        isOverEmpty: boardTarget && boardTarget.type === 'empty'
      });
    }

    // State 3: Release detected
    if (wasPinched && !this.isPinched) {
      if (this.modeBState === 'DRAGGING' && this.draggedTileIndex !== null) {
        this.handleDragRelease(boardTarget);
      }
    }
  }

  handleDragRelease(boardTarget) {
    const tileIndex = this.draggedTileIndex;
    this.modeBState = 'IDLE';
    this.draggedTileIndex = null;

    // Complete the move only if player released pinch over the empty cell
    // and that tile was directly adjacent to the empty cell.
    const isOverEmpty = boardTarget && boardTarget.type === 'empty';
    const isAdjacent = this.game.canMoveTile(tileIndex);

    if (isOverEmpty && isAdjacent) {
      // Valid move! Execute through central game engine
      const moveSuccess = this.game.moveTile(tileIndex);
      this.startCooldown();

      this.onDragEnd({
        tileIndex,
        success: moveSuccess,
        reason: 'valid_move'
      });

      this.onStatusNotification({
        type: 'drag_success',
        success: true,
        message: 'Tile placed!'
      });
    } else {
      // Invalid drag release: cancel and restore original tile position
      const reason = !isOverEmpty ? 'not_over_empty' : 'not_adjacent';
      this.onDragEnd({
        tileIndex,
        success: false,
        reason
      });

      this.game.onInvalidMove({
        tileIndex,
        emptyIndex: this.game.emptyIndex,
        reason
      });

      this.onStatusNotification({
        type: 'drag_cancelled',
        success: false,
        message: 'Drag cancelled'
      });
    }
  }

  cancelDrag(reason = 'cancelled') {
    if (this.draggedTileIndex !== null) {
      const tileIndex = this.draggedTileIndex;
      this.draggedTileIndex = null;
      this.modeBState = 'IDLE';
      this.isPinched = false;

      this.onDragEnd({
        tileIndex,
        success: false,
        reason
      });

      this.onStatusNotification({
        type: 'drag_cancelled',
        success: false,
        message: 'Drag cancelled'
      });
    }
  }

  /**
   * Maps normalized camera coordinates (0.0 - 1.0) to puzzle board element and tile indices
   */
  getBoardTargetAt(normX, normY) {
    if (!this.boardElement) return null;

    const rect = this.boardElement.getBoundingClientRect();
    const screenX = normX * window.innerWidth;
    const screenY = normY * window.innerHeight;

    // Check if cursor is within board bounds
    if (
      screenX < rect.left ||
      screenX > rect.right ||
      screenY < rect.top ||
      screenY > rect.bottom
    ) {
      return null;
    }

    const relX = screenX - rect.left;
    const relY = screenY - rect.top;

    const cellWidth = rect.width / this.game.gridSize;
    const cellHeight = rect.height / this.game.gridSize;

    const col = Math.floor(relX / cellWidth);
    const row = Math.floor(relY / cellHeight);

    if (col < 0 || col >= this.game.gridSize || row < 0 || row >= this.game.gridSize) {
      return null;
    }

    const index = row * this.game.gridSize + col;
    const tileValue = this.game.board[index];

    return {
      index,
      row,
      col,
      value: tileValue,
      type: tileValue === 0 ? 'empty' : 'tile'
    };
  }

  startCooldown(duration = this.config.cooldownMs) {
    this.isCoolingDown = true;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      this.isCoolingDown = false;
      this.cooldownTimer = null;
    }, duration);
  }

  destroy() {
    this.resetState();
  }
}
