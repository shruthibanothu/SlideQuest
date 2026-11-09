/**
 * SlideQuest - Gesture Controller
 * Implements Mode A (Directional Index-Finger Movement) and Mode B (Virtual Pinch-and-Drag)
 * with full safeguards, hysteresis, velocity filtering, multi-frame stability,
 * neutral reset, cooldowns, and animation locks.
 *
 * Privacy & Security Guarantee:
 * - Landmark analysis is performed purely in volatile memory.
 * - No motion vectors or biometric data are stored or transmitted.
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
      swipeThreshold: options.swipeThreshold || 0.11, // Minimum normalized displacement
      velocityThreshold: options.velocityThreshold || 0.00035, // Minimum normalized units per ms
      neutralRadius: options.neutralRadius || 0.08, // Radius to return to before next swipe
      maxGestureDurationMs: 800, // Maximum duration for a quick deliberate swipe stroke
      cooldownMs: 320, // Lockout duration after executing a move
      minStableFrames: 3, // Consecutive frames required before evaluating motion
      axisDominanceRatio: 1.45, // Ratio of primary to secondary axis to reject diagonals

      // Mode B: Pinch & Drag Settings
      pinchThreshold: options.pinchThreshold || 0.065, // Distance threshold to trigger pinch
      releaseThreshold: options.releaseThreshold || 0.095, // Hysteresis threshold to release pinch
      cursorSmoothing: options.cursorSmoothing || 0.65, // EMA alpha for cursor smoothing

      minConfidence: 0.55
    };

    // State Tracking
    this.isCoolingDown = false;
    this.cooldownTimer = null;

    // Mode A internal state machine
    this.modeAState = 'NEUTRAL'; // 'NEUTRAL' | 'SWIPING' | 'TRIGGERED' | 'AWAITING_NEUTRAL'
    this.modeAAnchor = null;
    this.stableFrameCount = 0;

    // Mode B internal state machine
    this.modeBState = 'IDLE'; // 'IDLE' | 'DRAGGING'
    this.isPinched = false;
    this.draggedTileIndex = null;
    this.isCursorInitialized = false;
    this.smoothedCursor = { x: 0.5, y: 0.5 };
    this.rawNormalizedCursor = { x: 0.5, y: 0.5 };

    // Reference to DOM element or mock bounds for board coordinate mapping
    this.boardElement = null;
    this.boardBounds = options.boardBounds || null;

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

  setBoardBounds(bounds) {
    this.boardBounds = bounds;
  }

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /**
   * Resets all internal gesture states (e.g. when mode switches, hand disappears, or new game starts)
   */
  resetState() {
    this.modeAState = 'NEUTRAL';
    this.modeAAnchor = null;
    this.stableFrameCount = 0;

    if (this.draggedTileIndex !== null) {
      this.cancelDrag('hand_reset');
    }
    this.isPinched = false;
    this.modeBState = 'IDLE';
    this.draggedTileIndex = null;
    this.isCursorInitialized = false;

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.isCoolingDown = false;
  }

  /**
   * Called by HandTracker when a hand is detected in a frame.
   * Accepts optional custom timestamp for deterministic automated testing.
   */
  processLandmarks(landmarks, timestamp) {
    if (this.mode === 'OFF' || !landmarks || landmarks.length < 21) {
      return;
    }

    const now = typeof timestamp === 'number'
      ? timestamp
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Key Landmarks:
    // Landmark 0: Wrist, 4: Thumb Tip, 8: Index Tip
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    if (!indexTip) return;

    // Coordinate mapping with mirror support
    const currentX = this.config.mirrorX ? (1 - indexTip.x) : indexTip.x;
    const currentY = indexTip.y;

    // Exponential Moving Average cursor smoothing (prevent jump on first frame)
    if (!this.isCursorInitialized) {
      this.smoothedCursor.x = currentX;
      this.smoothedCursor.y = currentY;
      this.isCursorInitialized = true;
    } else {
      const alpha = this.config.cursorSmoothing;
      this.smoothedCursor.x = (this.smoothedCursor.x * (1 - alpha)) + (currentX * alpha);
      this.smoothedCursor.y = (this.smoothedCursor.y * (1 - alpha)) + (currentY * alpha);
    }
    this.rawNormalizedCursor = { x: currentX, y: currentY };

    this.onCursorUpdate({
      normalizedX: this.smoothedCursor.x,
      normalizedY: this.smoothedCursor.y,
      isPinched: this.isPinched,
      mode: this.mode
    });

    // Safeguard: Lock gesture execution during active tile animation or cooldown
    if (this.game && this.game.isAnimating) {
      return;
    }
    if (this.isCoolingDown) {
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
      this.cancelDrag('hand_lost');
    }
    this.resetState();
  }

  /* =========================================================================
   * MODE A: Directional Index-Finger Movement (Swipe)
   * ========================================================================= */

  processModeA(currentX, currentY, now) {
    if (this.modeAState === 'AWAITING_NEUTRAL') {
      if (this.modeAAnchor) {
        const dx = currentX - this.modeAAnchor.x;
        const dy = currentY - this.modeAAnchor.y;
        const distFromAnchor = Math.hypot(dx, dy);

        if (distFromAnchor <= this.config.neutralRadius) {
          this.modeAState = 'NEUTRAL';
          this.modeAAnchor = { x: currentX, y: currentY, time: now };
          this.stableFrameCount = 1;
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
      this.stableFrameCount = 1;
      return;
    }

    if (this.modeAState === 'SWIPING') {
      this.stableFrameCount++;
      const dt = now - this.modeAAnchor.time;

      if (dt > this.config.maxGestureDurationMs) {
        this.modeAAnchor = { x: currentX, y: currentY, time: now };
        this.stableFrameCount = 1;
        return;
      }

      if (this.stableFrameCount < this.config.minStableFrames) {
        return;
      }

      const dx = currentX - this.modeAAnchor.x;
      const dy = currentY - this.modeAAnchor.y;
      const displacement = Math.hypot(dx, dy);
      const velocity = dt > 0 ? (displacement / dt) : 0;

      if (displacement < this.config.swipeThreshold) {
        return;
      }

      if (velocity < this.config.velocityThreshold) {
        return;
      }

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const maxAxis = Math.max(absDx, absDy);
      const minAxis = Math.min(absDx, absDy);

      if (minAxis > 0 && (maxAxis / minAxis) < this.config.axisDominanceRatio) {
        this.onStatusNotification({
          type: 'diagonal_rejected',
          message: 'Ambiguous diagonal motion rejected'
        });
        this.modeAAnchor = { x: currentX, y: currentY, time: now };
        return;
      }

      let direction = null;
      if (absDx > absDy) {
        direction = dx > 0 ? 'RIGHT' : 'LEFT';
      } else {
        direction = dy > 0 ? 'DOWN' : 'UP';
      }

      this.executeModeAGesture(direction);
    }
  }

  executeModeAGesture(direction) {
    this.modeAState = 'AWAITING_NEUTRAL';
    this.startCooldown();

    this.onGestureDetected({
      type: 'swipe',
      direction,
      timestamp: performance.now()
    });

    const moveSuccess = this.game ? this.game.moveInDirection(direction) : false;

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
    if (!thumbTip || !indexTip) return;

    // Calculate normalized Euclidean distance between thumb and index tips
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const dz = (thumbTip.z || 0) - (indexTip.z || 0);
    const pinchDistance = Math.hypot(dx, dy, dz);

    const wasPinched = this.isPinched;

    // Pinch Hysteresis:
    // If not pinched: distance must be <= pinchThreshold (0.065) to begin pinch
    // If pinched: distance must be >= releaseThreshold (0.095) to release pinch
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

    // Locate board target under the smoothed virtual cursor
    const boardTarget = this.getBoardTargetAt(this.smoothedCursor.x, this.smoothedCursor.y);

    // Event 1: Pinch Started (Grab attempt)
    if (!wasPinched && this.isPinched) {
      // Must be hovering over a valid numbered puzzle tile (empty cell cannot be selected)
      if (boardTarget && boardTarget.type === 'tile') {
        const tileIndex = boardTarget.index;
        this.draggedTileIndex = tileIndex;
        this.modeBState = 'DRAGGING';

        this.onDragStart({
          tileIndex,
          tileValue: this.game.board[tileIndex],
          cursor: { ...this.smoothedCursor },
          isAdjacent: this.game ? this.game.canMoveTile(tileIndex) : false
        });
      }
    }

    // Event 2: Actively Dragging
    if (this.isPinched && this.modeBState === 'DRAGGING' && this.draggedTileIndex !== null) {
      this.onDragMove({
        tileIndex: this.draggedTileIndex,
        cursor: { ...this.smoothedCursor },
        target: boardTarget,
        isOverEmpty: Boolean(boardTarget && boardTarget.type === 'empty')
      });
    }

    // Event 3: Pinch Released (Drop attempt)
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

    // Movement validation:
    // Move is valid ONLY if player released pinch over the empty cell
    // AND the selected tile is directly adjacent horizontally or vertically to the empty cell.
    const isOverEmpty = Boolean(boardTarget && boardTarget.type === 'empty');
    const isAdjacent = this.game ? this.game.canMoveTile(tileIndex) : false;

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
      // Invalid drop: cancel drag, restore original tile position, do not increment move count
      const reason = !isOverEmpty ? 'not_over_empty' : 'not_adjacent';

      this.onDragEnd({
        tileIndex,
        success: false,
        reason
      });

      if (this.game && typeof this.game.onInvalidMove === 'function') {
        this.game.onInvalidMove({
          tileIndex,
          emptyIndex: this.game.emptyIndex,
          reason
        });
      }

      this.onStatusNotification({
        type: 'drag_cancelled',
        success: false,
        message: 'Drop cancelled'
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
    if (!this.game) return null;

    let rect = null;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 1000;

    if (this.boardElement && typeof this.boardElement.getBoundingClientRect === 'function') {
      rect = this.boardElement.getBoundingClientRect();
    } else if (this.boardBounds) {
      rect = this.boardBounds;
    }

    if (!rect) return null;

    const screenX = normX * screenWidth;
    const screenY = normY * screenHeight;

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

    const boardWidth = rect.width || (rect.right - rect.left);
    const boardHeight = rect.height || (rect.bottom - rect.top);

    if (boardWidth <= 0 || boardHeight <= 0) return null;

    const cellWidth = boardWidth / this.game.gridSize;
    const cellHeight = boardHeight / this.game.gridSize;

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
