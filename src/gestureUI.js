/**
 * SlideQuest - Gesture UI & Interaction Presenter
 * Manages the camera preview side-panel, virtual cursor, visual highlights,
 * status badge, interactive calibration drawer, LocalStorage persistence,
 * and first-time gesture tutorial modal.
 */

const DEFAULT_CALIBRATION = {
  swipeThreshold: 0.11,
  pinchThreshold: 0.065,
  releaseThreshold: 0.095,
  mirrorX: true,
  mode: 'OFF'
};

const STORAGE_KEY_CALIBRATION = 'slidequest_calibration_v1';
const STORAGE_KEY_TUTORIAL_SEEN = 'slidequest_tutorial_dismissed_v1';

export class GestureUI {
  constructor(options = {}) {
    this.cameraManager = options.cameraManager;
    this.handTracker = options.handTracker;
    this.gestureController = options.gestureController;
    this.audioManager = options.audioManager;
    this.game = options.game;

    // DOM Elements cache
    this.elements = {};
    this.cachedTiles = [];
    this.toastTimeout = null;

    this.initDOMElements();
    this.loadCalibration();
    this.setupEventListeners();
    this.checkFirstTimeTutorial();
  }

  initDOMElements() {
    this.elements = {
      // Panel & Camera
      gesturePanel: document.getElementById('gesture-panel'),
      video: document.getElementById('camera-video'),
      canvas: document.getElementById('camera-canvas'),
      statusBadge: document.getElementById('tracking-status-badge'),
      statusText: document.getElementById('tracking-status-text'),
      cameraToggleBtn: document.getElementById('btn-toggle-camera'),

      // Mode Selector buttons
      modeOffBtn: document.getElementById('btn-mode-off'),
      modeABtn: document.getElementById('btn-mode-a'),
      modeBBtn: document.getElementById('btn-mode-b'),

      // Interactive Elements
      board: document.getElementById('puzzle-board'),
      virtualCursor: document.getElementById('virtual-cursor'),
      cursorRing: document.getElementById('virtual-cursor-ring'),
      toastBanner: document.getElementById('gesture-toast'),
      toastMessage: document.getElementById('gesture-toast-msg'),

      // Calibration Modal
      calibrationBtn: document.getElementById('btn-open-calibration'),
      calibrationModal: document.getElementById('calibration-modal'),
      closeCalibrationBtn: document.getElementById('btn-close-calibration'),
      selectCalibMode: document.getElementById('select-calib-mode'),
      sliderSwipeSens: document.getElementById('slider-swipe-sens'),
      valSwipeSens: document.getElementById('val-swipe-sens'),
      sliderPinchSens: document.getElementById('slider-pinch-sens'),
      valPinchSens: document.getElementById('val-pinch-sens'),
      sliderReleaseSens: document.getElementById('slider-release-sens'),
      valReleaseSens: document.getElementById('val-release-sens'),
      chkMirror: document.getElementById('chk-camera-mirror'),
      btnResetCalibration: document.getElementById('btn-reset-calibration'),
      btnSaveCalibration: document.getElementById('btn-save-calibration'),

      // Tutorial Modal
      tutorialBtn: document.getElementById('btn-open-tutorial'),
      tutorialModal: document.getElementById('tutorial-modal'),
      closeTutorialBtn: document.getElementById('btn-close-tutorial'),
      tutorialSkipBtn: document.getElementById('btn-tutorial-skip'),
      startPlayingBtn: document.getElementById('btn-tutorial-start'),
      chkDontShowTutorial: document.getElementById('chk-dont-show-tutorial')
    };

    if (this.elements.board && this.gestureController) {
      this.gestureController.setBoardElement(this.elements.board);
    }
  }

  loadCalibration() {
    let saved = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY_CALIBRATION);
        if (raw) saved = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Could not read calibration from localStorage:', e);
    }

    const config = Object.assign({}, DEFAULT_CALIBRATION, saved || {});

    // Apply values to UI elements
    if (this.elements.sliderSwipeSens) {
      this.elements.sliderSwipeSens.value = config.swipeThreshold;
      if (this.elements.valSwipeSens) this.elements.valSwipeSens.textContent = Number(config.swipeThreshold).toFixed(2);
    }
    if (this.elements.sliderPinchSens) {
      this.elements.sliderPinchSens.value = config.pinchThreshold;
      if (this.elements.valPinchSens) this.elements.valPinchSens.textContent = Number(config.pinchThreshold).toFixed(3);
    }
    if (this.elements.sliderReleaseSens) {
      this.elements.sliderReleaseSens.value = config.releaseThreshold;
      if (this.elements.valReleaseSens) this.elements.valReleaseSens.textContent = Number(config.releaseThreshold).toFixed(3);
    }
    if (this.elements.chkMirror) {
      this.elements.chkMirror.checked = config.mirrorX;
    }
    if (this.elements.selectCalibMode) {
      this.elements.selectCalibMode.value = config.mode || 'OFF';
    }

    // Apply immediately to gesture controller
    if (this.gestureController) {
      this.gestureController.updateConfig({
        swipeThreshold: parseFloat(config.swipeThreshold),
        pinchThreshold: parseFloat(config.pinchThreshold),
        releaseThreshold: parseFloat(config.releaseThreshold),
        mirrorX: Boolean(config.mirrorX)
      });
    }

    // Apply mirror styling to video and canvas
    const isMirrored = Boolean(config.mirrorX);
    if (this.elements.video) this.elements.video.style.transform = isMirrored ? 'scaleX(-1)' : 'none';
    if (this.elements.canvas) this.elements.canvas.style.transform = isMirrored ? 'scaleX(-1)' : 'none';
  }

  saveCalibration() {
    try {
      if (typeof localStorage !== 'undefined') {
        const payload = {
          swipeThreshold: parseFloat(this.elements.sliderSwipeSens ? this.elements.sliderSwipeSens.value : DEFAULT_CALIBRATION.swipeThreshold),
          pinchThreshold: parseFloat(this.elements.sliderPinchSens ? this.elements.sliderPinchSens.value : DEFAULT_CALIBRATION.pinchThreshold),
          releaseThreshold: parseFloat(this.elements.sliderReleaseSens ? this.elements.sliderReleaseSens.value : DEFAULT_CALIBRATION.releaseThreshold),
          mirrorX: this.elements.chkMirror ? this.elements.chkMirror.checked : true,
          mode: this.gestureController ? this.gestureController.mode : 'OFF'
        };
        localStorage.setItem(STORAGE_KEY_CALIBRATION, JSON.stringify(payload));
      }
    } catch (e) {
      console.warn('Could not save calibration to localStorage:', e);
    }
  }

  resetCalibrationToDefaults() {
    if (this.elements.sliderSwipeSens) {
      this.elements.sliderSwipeSens.value = DEFAULT_CALIBRATION.swipeThreshold;
      if (this.elements.valSwipeSens) this.elements.valSwipeSens.textContent = DEFAULT_CALIBRATION.swipeThreshold.toFixed(2);
    }
    if (this.elements.sliderPinchSens) {
      this.elements.sliderPinchSens.value = DEFAULT_CALIBRATION.pinchThreshold;
      if (this.elements.valPinchSens) this.elements.valPinchSens.textContent = DEFAULT_CALIBRATION.pinchThreshold.toFixed(3);
    }
    if (this.elements.sliderReleaseSens) {
      this.elements.sliderReleaseSens.value = DEFAULT_CALIBRATION.releaseThreshold;
      if (this.elements.valReleaseSens) this.elements.valReleaseSens.textContent = DEFAULT_CALIBRATION.releaseThreshold.toFixed(3);
    }
    if (this.elements.chkMirror) {
      this.elements.chkMirror.checked = DEFAULT_CALIBRATION.mirrorX;
    }
    if (this.elements.selectCalibMode) {
      this.elements.selectCalibMode.value = 'OFF';
    }

    if (this.gestureController) {
      this.gestureController.updateConfig({
        swipeThreshold: DEFAULT_CALIBRATION.swipeThreshold,
        pinchThreshold: DEFAULT_CALIBRATION.pinchThreshold,
        releaseThreshold: DEFAULT_CALIBRATION.releaseThreshold,
        mirrorX: DEFAULT_CALIBRATION.mirrorX
      });
    }

    if (this.elements.video) this.elements.video.style.transform = 'scaleX(-1)';
    if (this.elements.canvas) this.elements.canvas.style.transform = 'scaleX(-1)';

    this.switchMode('OFF');
    this.saveCalibration();
    this.showToast('Calibration reset to defaults.', 'info');
  }

  checkFirstTimeTutorial() {
    try {
      if (typeof localStorage !== 'undefined') {
        const seen = localStorage.getItem(STORAGE_KEY_TUTORIAL_SEEN);
        if (!seen) {
          // Open tutorial on first visit
          setTimeout(() => this.openTutorial(), 600);
        }
      }
    } catch (e) {}
  }

  setupEventListeners() {
    // Camera on/off toggle
    if (this.elements.cameraToggleBtn) {
      this.elements.cameraToggleBtn.addEventListener('click', () => {
        this.toggleCamera();
      });
    }

    // Mode toggles
    if (this.elements.modeOffBtn) {
      this.elements.modeOffBtn.addEventListener('click', () => this.switchMode('OFF'));
    }
    if (this.elements.modeABtn) {
      this.elements.modeABtn.addEventListener('click', () => this.switchMode('MODE_A'));
    }
    if (this.elements.modeBBtn) {
      this.elements.modeBBtn.addEventListener('click', () => this.switchMode('MODE_B'));
    }

    // Calibration modal triggers
    if (this.elements.calibrationBtn) {
      this.elements.calibrationBtn.addEventListener('click', () => this.openCalibration());
    }
    if (this.elements.closeCalibrationBtn) {
      this.elements.closeCalibrationBtn.addEventListener('click', () => this.closeCalibration());
    }
    if (this.elements.btnSaveCalibration) {
      this.elements.btnSaveCalibration.addEventListener('click', () => {
        this.saveCalibration();
        this.closeCalibration();
        this.showToast('Calibration saved!', 'success');
      });
    }
    if (this.elements.btnResetCalibration) {
      this.elements.btnResetCalibration.addEventListener('click', () => {
        this.resetCalibrationToDefaults();
      });
    }
    if (this.elements.selectCalibMode) {
      this.elements.selectCalibMode.addEventListener('change', (e) => {
        this.switchMode(e.target.value);
      });
    }

    // Tutorial modal triggers
    if (this.elements.tutorialBtn) {
      this.elements.tutorialBtn.addEventListener('click', () => this.openTutorial());
    }
    if (this.elements.closeTutorialBtn) {
      this.elements.closeTutorialBtn.addEventListener('click', () => this.closeTutorial());
    }
    if (this.elements.tutorialSkipBtn) {
      this.elements.tutorialSkipBtn.addEventListener('click', () => this.closeTutorial());
    }
    if (this.elements.startPlayingBtn) {
      this.elements.startPlayingBtn.addEventListener('click', () => this.closeTutorial());
    }

    // Calibration sliders (take effect immediately)
    if (this.elements.sliderSwipeSens) {
      this.elements.sliderSwipeSens.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.elements.valSwipeSens) this.elements.valSwipeSens.textContent = val.toFixed(2);
        this.gestureController.updateConfig({ swipeThreshold: val });
        this.saveCalibration();
      });
    }

    if (this.elements.sliderPinchSens) {
      this.elements.sliderPinchSens.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.elements.valPinchSens) this.elements.valPinchSens.textContent = val.toFixed(3);
        this.gestureController.updateConfig({ pinchThreshold: val });
        this.saveCalibration();
      });
    }

    if (this.elements.sliderReleaseSens) {
      this.elements.sliderReleaseSens.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.elements.valReleaseSens) this.elements.valReleaseSens.textContent = val.toFixed(3);
        this.gestureController.updateConfig({ releaseThreshold: val });
        this.saveCalibration();
      });
    }

    if (this.elements.chkMirror) {
      this.elements.chkMirror.addEventListener('change', (e) => {
        const mirrored = e.target.checked;
        this.gestureController.updateConfig({ mirrorX: mirrored });
        if (this.elements.video) {
          this.elements.video.style.transform = mirrored ? 'scaleX(-1)' : 'none';
        }
        if (this.elements.canvas) {
          this.elements.canvas.style.transform = mirrored ? 'scaleX(-1)' : 'none';
        }
        this.saveCalibration();
      });
    }

    // Wire GestureController Callbacks
    this.gestureController.onCursorUpdate = (data) => this.updateVirtualCursor(data);
    this.gestureController.onDragStart = (data) => this.handleDragStart(data);
    this.gestureController.onDragMove = (data) => this.handleDragMove(data);
    this.gestureController.onDragEnd = (data) => this.handleDragEnd(data);
    this.gestureController.onPinchStateChange = (data) => this.handlePinchStateChange(data);
    this.gestureController.onGestureDetected = (data) => this.handleGestureDetected(data);
    this.gestureController.onStatusNotification = (data) => this.handleStatusNotification(data);

    // Wire CameraManager Callbacks
    this.cameraManager.onStatusChange = (status) => this.updateTrackingStatus(status);
    this.cameraManager.onError = (err, friendlyMsg) => {
      this.showToast(friendlyMsg, 'error');
      this.updateTrackingStatus('Camera unavailable');
    };

    // Wire HandTracker Callbacks
    this.handTracker.onStatusChange = (status) => this.updateTrackingStatus(status);
    this.handTracker.onHandDetected = (landmarks) => {
      this.gestureController.processLandmarks(landmarks);
      if (this.cameraManager.isActive) {
        this.updateTrackingStatus('Hand detected');
      }
    };

    this.handTracker.onHandLost = () => {
      this.gestureController.handleHandLost();
      if (this.cameraManager.isActive) {
        this.updateTrackingStatus('Waiting for hand');
      }
      this.hideVirtualCursor();
    };

    // Window resize event to keep board target coordinate mapping crisp
    window.addEventListener('resize', () => {
      if (this.elements.board) {
        this.gestureController.setBoardElement(this.elements.board);
      }
    });
  }

  async toggleCamera() {
    if (this.cameraManager.isActive) {
      this.handTracker.stopTracking();
      this.cameraManager.stopCamera();
      this.elements.cameraToggleBtn.innerHTML = '<span>📷</span> Enable Camera';
      this.elements.cameraToggleBtn.classList.remove('active-btn');
      this.updateTrackingStatus('Camera disabled');
      this.hideVirtualCursor();
      this.showToast('Camera turned off.', 'info');
    } else {
      this.elements.cameraToggleBtn.innerHTML = '<span>⏳</span> Starting...';
      const success = await this.cameraManager.startCamera(this.elements.video);
      if (success) {
        this.elements.cameraToggleBtn.innerHTML = '<span>🛑</span> Disable Camera';
        this.elements.cameraToggleBtn.classList.add('active-btn');
        this.updateTrackingStatus('Waiting for hand');
        this.showToast('Camera active. Hold hand in view.', 'success');

        // Start HandTracker
        await this.handTracker.startTracking(this.elements.video, this.elements.canvas);
      } else {
        this.elements.cameraToggleBtn.innerHTML = '<span>📷</span> Enable Camera';
        this.elements.cameraToggleBtn.classList.remove('active-btn');
      }
    }
  }

  switchMode(mode) {
    this.gestureController.setMode(mode);

    // Update buttons in side panel
    [this.elements.modeOffBtn, this.elements.modeABtn, this.elements.modeBBtn].forEach(b => {
      if (b) b.classList.remove('active-mode');
    });

    // Sync calibration select dropdown
    if (this.elements.selectCalibMode && this.elements.selectCalibMode.value !== mode) {
      this.elements.selectCalibMode.value = mode;
    }

    if (mode === 'OFF') {
      if (this.elements.modeOffBtn) this.elements.modeOffBtn.classList.add('active-mode');
      this.hideVirtualCursor();
    } else if (mode === 'MODE_A') {
      if (this.elements.modeABtn) this.elements.modeABtn.classList.add('active-mode');
      this.showToast('Mode A Active: Point & swipe index finger to move tiles.', 'info');
      this.checkCameraPrompt();
    } else if (mode === 'MODE_B') {
      if (this.elements.modeBBtn) this.elements.modeBBtn.classList.add('active-mode');
      this.showToast('Mode B Active: Pinch tile and drag to empty cell.', 'info');
      this.checkCameraPrompt();
    }

    this.saveCalibration();
  }

  checkCameraPrompt() {
    if (!this.cameraManager.isActive) {
      this.showToast('Please enable the camera above to use gestures!', 'warning');
    }
  }

  updateTrackingStatus(status) {
    if (!this.elements.statusBadge || !this.elements.statusText) return;

    this.elements.statusText.textContent = status;
    this.elements.statusBadge.className = 'status-badge';

    switch (status) {
      case 'Tracking':
      case 'Hand detected':
        this.elements.statusBadge.classList.add('status-tracking');
        break;
      case 'Gesture detected':
        this.elements.statusBadge.classList.add('status-gesture');
        break;
      case 'Waiting':
      case 'Waiting for hand':
      case 'Loading model':
        this.elements.statusBadge.classList.add('status-waiting');
        break;
      case 'Camera unavailable':
      case 'Tracking unavailable':
        this.elements.statusBadge.classList.add('status-unavailable');
        break;
      case 'Camera off':
      case 'Camera disabled':
      case 'Disabled':
      default:
        this.elements.statusBadge.classList.add('status-off');
        break;
    }
  }

  updateVirtualCursor(data) {
    if (!this.elements.virtualCursor || this.gestureController.mode === 'OFF') {
      this.hideVirtualCursor();
      return;
    }

    const { normalizedX, normalizedY, isPinched, mode } = data;
    const screenX = normalizedX * window.innerWidth;
    const screenY = normalizedY * window.innerHeight;

    this.elements.virtualCursor.style.display = 'flex';
    this.elements.virtualCursor.style.transform = `translate(${screenX}px, ${screenY}px)`;

    if (isPinched) {
      this.elements.virtualCursor.classList.add('cursor-pinched');
    } else {
      this.elements.virtualCursor.classList.remove('cursor-pinched');
    }

    if (mode === 'MODE_A') {
      this.elements.virtualCursor.setAttribute('data-mode', 'swipe');
    } else {
      this.elements.virtualCursor.setAttribute('data-mode', 'pinch');
    }
  }

  hideVirtualCursor() {
    if (this.elements.virtualCursor) {
      this.elements.virtualCursor.style.display = 'none';
    }
    this.clearBoardHighlights();
  }

  handlePinchStateChange(data) {
    if (data.isPinched) {
      this.audioManager.playPinch();
    } else {
      this.audioManager.playRelease();
    }
  }

  handleGestureDetected(data) {
    this.updateTrackingStatus('Gesture detected');
    this.showGestureArrow(data.direction);
    this.audioManager.playSlide();

    setTimeout(() => {
      if (this.cameraManager.isActive && this.handTracker.hasHand) {
        this.updateTrackingStatus('Hand detected');
      }
    }, 450);
  }

  showGestureArrow(direction) {
    const arrow = document.getElementById('gesture-arrow-indicator');
    if (!arrow) return;

    arrow.className = `gesture-arrow arrow-${direction.toLowerCase()} visible`;
    setTimeout(() => {
      arrow.className = 'gesture-arrow';
    }, 500);
  }

  handleDragStart(data) {
    this.updateTrackingStatus('Gesture detected');
    this.highlightTile(data.tileIndex, 'selected');

    if (data.isAdjacent) {
      this.highlightEmptyCell(true);
    }
  }

  handleDragMove(data) {
    if (data.isOverEmpty && data.target) {
      this.highlightEmptyCell(true, 'ready-drop');
    } else {
      this.highlightEmptyCell(true, 'active-target');
    }
  }

  handleDragEnd(data) {
    this.clearBoardHighlights();

    if (data.success) {
      this.audioManager.playSlide();
      this.showToast('Tile moved!', 'success');
    } else if (data.reason !== 'hand_lost' && data.reason !== 'hand_reset') {
      this.audioManager.playError();
      this.showToast('Drop cancelled', 'warning');
    }

    setTimeout(() => {
      if (this.cameraManager.isActive && this.handTracker.hasHand) {
        this.updateTrackingStatus('Hand detected');
      }
    }, 350);
  }

  handleStatusNotification(data) {
    if (data.type === 'swipe_executed') {
      if (data.success) {
        this.showToast(`Swiped ${data.direction}: Move successful!`, 'success');
      } else {
        this.audioManager.playError();
        this.showToast(`Swiped ${data.direction}: Blocked by boundary`, 'warning');
      }
    } else if (data.type === 'diagonal_rejected') {
      this.audioManager.playError();
      this.showToast('Diagonal swipe rejected — swipe vertically or horizontally', 'warning');
    }
  }

  highlightTile(tileIndex, state) {
    const tileElements = document.querySelectorAll('.puzzle-tile');
    tileElements.forEach(el => {
      if (parseInt(el.getAttribute('data-index'), 10) === tileIndex) {
        el.classList.add('tile-drag-selected');
      }
    });
  }

  highlightEmptyCell(show, customClass = '') {
    const emptyEl = document.querySelector('.puzzle-empty-cell');
    if (emptyEl) {
      if (show) {
        emptyEl.className = `puzzle-empty-cell empty-cell-highlight ${customClass}`;
      } else {
        emptyEl.className = 'puzzle-empty-cell';
      }
    }
  }

  clearBoardHighlights() {
    const tileElements = document.querySelectorAll('.puzzle-tile');
    tileElements.forEach(el => el.classList.remove('tile-drag-selected'));
    this.highlightEmptyCell(false);
  }

  showToast(message, type = 'info') {
    if (!this.elements.toastBanner || !this.elements.toastMessage) return;

    this.elements.toastMessage.textContent = message;
    this.elements.toastBanner.className = `toast-banner toast-${type} show`;

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.elements.toastBanner.classList.remove('show');
    }, 2800);
  }

  openCalibration() {
    if (this.elements.calibrationModal) {
      this.elements.calibrationModal.classList.add('open');
    }
  }

  closeCalibration() {
    if (this.elements.calibrationModal) {
      this.elements.calibrationModal.classList.remove('open');
    }
  }

  openTutorial() {
    if (this.elements.tutorialModal) {
      this.elements.tutorialModal.classList.add('open');
    }
  }

  closeTutorial() {
    if (this.elements.tutorialModal) {
      this.elements.tutorialModal.classList.remove('open');
    }
    // Save dismissal preference
    if (this.elements.chkDontShowTutorial && this.elements.chkDontShowTutorial.checked) {
      try {
        localStorage.setItem(STORAGE_KEY_TUTORIAL_SEEN, 'true');
      } catch (e) {}
    }
  }
}
