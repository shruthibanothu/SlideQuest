/**
 * SlideQuest - Gesture Controller
 * Implements Mode A (Directional Index-Finger Movement) with full safeguards,
 * velocity filtering, multi-frame stability, diagonal rejection, neutral reset,
 * cooldowns, and animation locks.
 *
 * Privacy & Security Guarantee:
 * - Landmark analysis is performed purely in volatile memory.
 * - No motion vectors or biometric data are stored or transmitted.
 */

export class GestureController {
  constructor(game, options = {}) {
    this.game = game;

    // Control Modes: 'OFF' | 'MODE_A' (Directional) | 'MODE_B' (Pinch & Drag - Phase 5)
    this.mode = options.initialMode || 'OFF';

    // Configurable thresholds & calibration
    this.config = {
      mirrorX: options.mirrorX !== undefined ? options.mirrorX : true,

      // Mode A: Directional Swipe Settings
      swipeThreshold: options.swipeThreshold || 0.11, // Minimum normalized displacement (0.0 to 1.0)
      velocityThreshold: options.velocityThreshold || 0.00035, // Minimum normalized units per ms
      neutralRadius: options.neutralRadius || 0.08, // Radius to return to before next swipe can trigger
      maxGestureDurationMs: 800, // Maximum duration for a quick deliberate swipe stroke
      cooldownMs: 320, // Lockout duration after executing a move
      minStableFrames: 3, // Consecutive frames required before evaluating motion
      axisDominanceRatio: 1.45, // Ratio of primary to secondary axis displacement to reject diagonals

      // Mode B Settings (Phase 5 reserved)
      pinchThreshold: options.pinchThreshold || 0.065,
      releaseThreshold: options.releaseThreshold || 0.095,
      cursorSmoothing: options.cursorSmoothing || 0.65,

      minConfidence: 0.55
    };

    // State Tracking
    this.isCoolingDown = false;
    this.cooldownTimer = null;

    // Mode A internal state machine
    // 'NEUTRAL' -> 'TRACKING_SWIPE' -> 'TRIGGERED' -> 'AWAITING_NEUTRAL'
    this.modeAState = 'NEUTRAL';
    this.modeAAnchor = null; // { x, y, time }
    this.stableFrameCount = 0;

    // Mode B internal state (Phase 5)
    this.modeBState = 'IDLE';
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
    this.modeAState = 'NEUTRAL';
    this.modeAAnchor = null;
    this.stableFrameCount = 0;

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
    // In mirrored mode (standard selfie video), moving physical hand right moves screen finger right.
    const currentX = this.config.mirrorX ? (1 - indexTip.x) : indexTip.x;
    const currentY = indexTip.y;

    // Exponential Moving Average cursor smoothing
    const alpha = this.config.cursorSmoothing;
    this.smoothedCursor.x = (this.smoothedCursor.x * (1 - alpha)) + (currentX * alpha);
    this.smoothedCursor.y = (this.smoothedCursor.y * (1 - alpha)) + (currentY * alpha);
    this.rawNormalizedCursor = { x: currentX, y: currentY };

    this.onCursorUpdate({
      normalizedX: this.smoothedCursor.x,
      normalizedY: this.smoothedCursor.y,
      isPinched: this.isPinched,
      mode: this.mode
    });

    // Safeguard: Lock input during active tile animation or gesture cooldown
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
    // State 1: Awaiting return to neutral position
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

    // State 2: Neutral origin establish
    if (this.modeAState === 'NEUTRAL') {
      this.modeAAnchor = { x: currentX, y: currentY, time: now };
      this.modeAState = 'SWIPING';
      this.stableFrameCount = 1;
      return;
    }

    // State 3: Tracking active swipe
    if (this.modeAState === 'SWIPING') {
      this.stableFrameCount++;

      const dt = now - this.modeAAnchor.time;

      // Timeout check: Slow or stationary finger movement is NOT a deliberate swipe
      if (dt > this.config.maxGestureDurationMs) {
        // Reset anchor to current position to prevent slow drifting accumulations
        this.modeAAnchor = { x: currentX, y: currentY, time: now };
        this.stableFrameCount = 1;
        return;
      }

      // Safeguard: Require minimum consecutive stable frames before evaluating swipe
      if (this.stableFrameCount < this.config.minStableFrames) {
        return;
      }

      const dx = currentX - this.modeAAnchor.x;
      const dy = currentY - this.modeAAnchor.y;
      const displacement = Math.hypot(dx, dy);
      const velocity = dt > 0 ? (displacement / dt) : 0;

      // Stationary finger check: Discard small movements
      if (displacement < this.config.swipeThreshold) {
        return;
      }

      // Velocity check: Discard slow movements
      if (velocity < this.config.velocityThreshold) {
        return;
      }

      // Directional Classification with Diagonal Rejection:
      // A valid swipe must have a clear dominant primary axis over the secondary axis.
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      const maxAxis = Math.max(absDx, absDy);
      const minAxis = Math.min(absDx, absDy);

      // If motion is diagonal (ratio < axisDominanceRatio), reject as ambiguous diagonal command
      if (minAxis > 0 && (maxAxis / minAxis) < this.config.axisDominanceRatio) {
        this.onStatusNotification({
          type: 'diagonal_rejected',
          message: 'Ambiguous diagonal motion rejected'
        });
        // Reset anchor to prevent edge-case carryover
        this.modeAAnchor = { x: currentX, y: currentY, time: now };
        return;
      }

      let direction = null;
      if (absDx > absDy) {
        // Horizontal: moving right (dx > 0) or left (dx < 0)
        direction = dx > 0 ? 'RIGHT' : 'LEFT';
      } else {
        // Vertical: moving down (dy > 0) or up (dy < 0)
        direction = dy > 0 ? 'DOWN' : 'UP';
      }

      // Deliberate gesture confirmed: Execute move through central game engine
      this.executeModeAGesture(direction);
    }
  }

  executeModeAGesture(direction) {
    // Transition state: Require return to neutral before any subsequent gesture
    this.modeAState = 'AWAITING_NEUTRAL';
    this.startCooldown();

    this.onGestureDetected({
      type: 'swipe',
      direction,
      timestamp: performance.now()
    });

    // Pass gesture direction directly to central game engine
    const moveSuccess = this.game ? this.game.moveInDirection(direction) : false;

    this.onStatusNotification({
      type: 'swipe_executed',
      direction,
      success: moveSuccess,
      message: moveSuccess ? `Move ${direction}` : `Blocked (${direction})`
    });
  }

  startCooldown(duration = this.config.cooldownMs) {
    this.isCoolingDown = true;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      this.isCoolingDown = false;
      this.cooldownTimer = null;
    }, duration);
  }

  /* =========================================================================
   * MODE B: Virtual Pinch-and-Drag (Phase 5 Placeholder / Architecture)
   * ========================================================================= */
  processModeB(indexTip, thumbTip, currentX, currentY, now) {
    // Reserved for Phase 5 implementation
  }

  cancelDrag(reason = 'cancelled') {
    // Reserved for Phase 5 implementation
  }

  getBoardTargetAt(normX, normY) {
    if (!this.boardElement || !this.game) return null;

    const rect = this.boardElement.getBoundingClientRect();
    const screenX = normX * window.innerWidth;
    const screenY = normY * window.innerHeight;

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

  destroy() {
    this.resetState();
  }
}
