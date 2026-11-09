/**
 * SlideQuest - Main Application Orchestrator
 * Connects Game Engine, Camera, Hand Tracking, Gesture Controller, Audio, and UI.
 */

import { SlideQuestGame } from './game.js';
import { AudioManager } from './audio.js';
import { CameraManager } from './cameraManager.js';
import { HandTracker } from './handTracker.js';
import { GestureController } from './gestureController.js';
import { GestureUI } from './gestureUI.js';

// Pre-packaged adventure artwork themes (SVG data URIs for crisp vector rendering)
const THEMES = [
  {
    id: 'castle',
    name: 'Dragon Citadel',
    generate: () => createCastleThemeSvg()
  },
  {
    id: 'forest',
    name: 'Enchanted Forest',
    generate: () => createForestThemeSvg()
  },
  {
    id: 'cyber',
    name: 'Cyber Nexus',
    generate: () => createCyberThemeSvg()
  }
];

class SlideQuestApp {
  constructor() {
    this.currentThemeIndex = 0;
    this.currentThemeUrl = '';
    this.showNumbers = true;

    this.audio = new AudioManager();
    this.game = new SlideQuestGame({
      gridSize: 3,
      onStateChange: (state) => this.renderBoard(state),
      onMove: (moveInfo) => this.handleMove(moveInfo),
      onWin: (winInfo) => this.handleWin(winInfo),
      onInvalidMove: (err) => this.handleInvalidMove(err)
    });

    this.cameraManager = new CameraManager({
      facingMode: 'user',
      width: 640,
      height: 480
    });

    this.handTracker = new HandTracker({
      mirrorCanvas: true
    });

    this.gestureController = new GestureController(this.game, {
      initialMode: 'OFF',
      mirrorX: true
    });

    this.gestureUI = new GestureUI({
      cameraManager: this.cameraManager,
      handTracker: this.handTracker,
      gestureController: this.gestureController,
      audioManager: this.audio,
      game: this.game
    });

    this.initUI();
    this.setupStandardInputs();
    this.setTheme(0);
    this.game.startNewGame();
  }

  initUI() {
    // Header controls
    this.btnNewGame = document.getElementById('btn-new-game');
    this.selectDifficulty = document.getElementById('select-difficulty');
    this.selectTheme = document.getElementById('select-theme');
    this.btnToggleNumbers = document.getElementById('btn-toggle-numbers');
    this.btnToggleMute = document.getElementById('btn-toggle-mute');
    this.fileUpload = document.getElementById('image-upload');

    // Stats
    this.statMoves = document.getElementById('stat-moves');
    this.statTime = document.getElementById('stat-time');
    this.statBest = document.getElementById('stat-best');
    this.victoryModal = document.getElementById('victory-modal');
    this.btnPlayAgain = document.getElementById('btn-play-again');
    this.victoryMoves = document.getElementById('victory-moves');
    this.victoryTime = document.getElementById('victory-time');

    this.updateBestScoreDisplay();

    if (this.btnNewGame) {
      this.btnNewGame.addEventListener('click', () => {
        this.game.startNewGame();
        this.audio.playSlide();
      });
    }

    if (this.selectDifficulty) {
      this.selectDifficulty.addEventListener('change', (e) => {
        const size = parseInt(e.target.value, 10);
        this.game.setGridSize(size);
        this.updateBestScoreDisplay();
        this.audio.playSlide();
      });
    }

    if (this.selectTheme) {
      this.selectTheme.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          this.fileUpload.click();
        } else {
          const idx = parseInt(val, 10);
          this.setTheme(idx);
        }
      });
    }

    if (this.fileUpload) {
      this.fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.currentThemeUrl = evt.target.result;
            this.renderBoard(this.game);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (this.btnToggleNumbers) {
      this.btnToggleNumbers.addEventListener('click', () => {
        this.showNumbers = !this.showNumbers;
        this.btnToggleNumbers.classList.toggle('active', this.showNumbers);
        this.renderBoard(this.game);
      });
    }

    if (this.btnToggleMute) {
      this.btnToggleMute.addEventListener('click', () => {
        const isMuted = this.audio.toggleMute();
        this.btnToggleMute.innerHTML = isMuted ? '🔇 Unmute' : '🔊 Sound';
      });
    }

    if (this.btnPlayAgain) {
      this.btnPlayAgain.addEventListener('click', () => {
        this.victoryModal.classList.remove('open');
        this.game.startNewGame();
      });
    }
  }

  setTheme(index) {
    this.currentThemeIndex = index;
    const theme = THEMES[index] || THEMES[0];
    this.currentThemeUrl = theme.generate();
    this.renderBoard(this.game);
  }

  setupStandardInputs() {
    // Keyboard controls: Arrow Keys and WASD
    window.addEventListener('keydown', (e) => {
      // Don't intercept if an input or modal is active
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      let direction = null;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          direction = 'UP';
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          direction = 'DOWN';
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          direction = 'LEFT';
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          direction = 'RIGHT';
          break;
      }

      if (direction) {
        e.preventDefault();
        const success = this.game.moveInDirection(direction);
        if (success) {
          this.audio.playSlide();
        } else {
          this.audio.playError();
        }
      }
    });
  }

  renderBoard(state) {
    const boardEl = document.getElementById('puzzle-board');
    if (!boardEl) return;

    const { board, gridSize, moveCount, elapsedTime } = state;

    if (this.statMoves) this.statMoves.textContent = moveCount;
    if (this.statTime) {
      const mins = Math.floor(elapsedTime / 60).toString().padStart(2, '0');
      const secs = (elapsedTime % 60).toString().padStart(2, '0');
      this.statTime.textContent = `${mins}:${secs}`;
    }

    // Set CSS grid template columns
    boardEl.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    boardEl.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;

    boardEl.innerHTML = '';

    board.forEach((val, index) => {
      const cell = document.createElement('div');
      cell.setAttribute('data-index', index);

      if (val === 0) {
        // Empty space
        cell.className = 'puzzle-empty-cell';
      } else {
        cell.className = 'puzzle-tile';
        cell.setAttribute('data-value', val);

        // Calculate background position for image tile
        // val is 1-indexed solved number (1 to gridSize*gridSize - 1)
        const solvedIndex = val - 1;
        const originRow = Math.floor(solvedIndex / gridSize);
        const originCol = solvedIndex % gridSize;

        const percentX = (originCol / (gridSize - 1)) * 100;
        const percentY = (originRow / (gridSize - 1)) * 100;

        cell.style.backgroundImage = `url("${this.currentThemeUrl}")`;
        cell.style.backgroundSize = `${gridSize * 100}% ${gridSize * 100}%`;
        cell.style.backgroundPosition = `${percentX}% ${percentY}%`;

        // Tile number badge
        if (this.showNumbers) {
          const numBadge = document.createElement('span');
          numBadge.className = 'tile-number';
          numBadge.textContent = val;
          cell.appendChild(numBadge);
        }

        // Standard Mouse Click and Touch Tap handlers
        cell.addEventListener('click', () => {
          const moved = this.game.moveTile(index);
          if (moved) {
            this.audio.playSlide();
          } else {
            this.audio.playError();
          }
        });
      }

      boardEl.appendChild(cell);
    });
  }

  handleMove(moveInfo) {
    // Temporarily trigger animation lock for ~160ms for silky smooth sliding transitions
    this.game.isAnimating = true;
    setTimeout(() => {
      this.game.isAnimating = false;
    }, 160);
  }

  updateBestScoreDisplay() {
    if (!this.statBest) return;
    try {
      const best = localStorage.getItem(`slidequest_best_${this.game.gridSize}`);
      this.statBest.textContent = best ? `${best} moves` : '--';
    } catch (e) {
      this.statBest.textContent = '--';
    }
  }

  handleWin(winInfo) {
    this.audio.playSuccess();

    try {
      const bestKey = `slidequest_best_${this.game.gridSize}`;
      const currentBest = localStorage.getItem(bestKey);
      if (!currentBest || winInfo.moveCount < parseInt(currentBest, 10)) {
        localStorage.setItem(bestKey, winInfo.moveCount);
        this.updateBestScoreDisplay();
      }
    } catch (e) {}

    if (this.victoryModal) {
      if (this.victoryMoves) this.victoryMoves.textContent = winInfo.moveCount;
      if (this.victoryTime) {
        const mins = Math.floor(winInfo.elapsedTime / 60).toString().padStart(2, '0');
        const secs = (winInfo.elapsedTime % 60).toString().padStart(2, '0');
        this.victoryTime.textContent = `${mins}:${secs}`;
      }
      this.victoryModal.classList.add('open');
    }
  }

  handleInvalidMove(err) {
    // Subtle shake animation on the invalid tile or board
    const boardEl = document.getElementById('puzzle-board');
    if (boardEl) {
      boardEl.classList.add('shake');
      setTimeout(() => boardEl.classList.remove('shake'), 280);
    }
  }
}

// Procedural SVG artwork generators for stunning high-res offline themes
function createCastleThemeSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <defs>
      <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="40%" stop-color="#312e81"/>
        <stop offset="70%" stop-color="#701a75"/>
        <stop offset="100%" stop-color="#f97316"/>
      </linearGradient>
      <linearGradient id="castleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#334155"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.9"/>
        <stop offset="60%" stop-color="#fef08a" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#fef08a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="800" height="800" fill="url(#skyGrad)"/>
    <!-- Giant Glowing Moon -->
    <circle cx="620" cy="220" r="140" fill="url(#moonGlow)"/>
    <circle cx="620" cy="220" r="75" fill="#fef9c3"/>
    <!-- Stars -->
    <circle cx="100" cy="120" r="2" fill="#ffffff" opacity="0.8"/>
    <circle cx="240" cy="80" r="3" fill="#ffffff" opacity="0.9"/>
    <circle cx="380" cy="190" r="2" fill="#ffffff" opacity="0.7"/>
    <circle cx="480" cy="90" r="2.5" fill="#ffffff" opacity="0.9"/>
    <circle cx="180" cy="260" r="2" fill="#ffffff" opacity="0.6"/>
    <!-- Distant Mountains -->
    <polygon points="0,580 160,420 340,560 520,380 720,530 800,480 800,800 0,800" fill="#1e1b4b" opacity="0.85"/>
    <polygon points="60,620 280,480 440,610 650,470 800,580 800,800 0,800" fill="#0f172a" opacity="0.95"/>
    <!-- Citadel Silhouette -->
    <!-- Central Tower -->
    <rect x="340" y="320" width="120" height="420" fill="url(#castleGrad)"/>
    <polygon points="320,320 400,210 480,320" fill="#e11d48"/>
    <!-- Left Turret -->
    <rect x="210" y="380" width="80" height="360" fill="url(#castleGrad)"/>
    <polygon points="200,380 250,290 300,380" fill="#be123c"/>
    <!-- Right Turret -->
    <rect x="510" y="380" width="80" height="360" fill="url(#castleGrad)"/>
    <polygon points="500,380 550,290 600,380" fill="#be123c"/>
    <!-- Glowing Windows -->
    <rect x="385" y="360" width="30" height="45" rx="15" fill="#fef08a" opacity="0.9"/>
    <rect x="385" y="440" width="30" height="45" rx="15" fill="#fef08a" opacity="0.9"/>
    <rect x="235" y="420" width="25" height="35" rx="12" fill="#fef08a" opacity="0.8"/>
    <rect x="535" y="420" width="25" height="35" rx="12" fill="#fef08a" opacity="0.8"/>
    <!-- Grand Gate -->
    <path d="M370,740 L370,640 Q400,590 430,640 L430,740 Z" fill="#f59e0b"/>
    <!-- Embers and Dragon Wings Silhouette in Sky -->
    <path d="M120,240 Q160,210 200,230 Q220,180 260,200 Q200,220 180,260 Q150,240 120,240 Z" fill="#020617" opacity="0.9"/>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function createForestThemeSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <defs>
      <linearGradient id="forestSky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#064e3b"/>
        <stop offset="50%" stop-color="#022c22"/>
        <stop offset="100%" stop-color="#047857"/>
      </linearGradient>
      <radialGradient id="spiritGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#6ee7b7" stop-opacity="1"/>
        <stop offset="70%" stop-color="#10b981" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#047857" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="800" height="800" fill="url(#forestSky)"/>
    <!-- Ancient Mystic Tree -->
    <path d="M360,800 Q380,550 330,420 Q310,360 220,290 L240,280 Q320,330 360,380 Q380,260 400,180 Q420,260 440,380 Q480,330 560,280 L580,290 Q490,360 470,420 Q420,550 440,800 Z" fill="#0f172a"/>
    <!-- Canopy Glows -->
    <circle cx="400" cy="220" r="130" fill="url(#spiritGlow)"/>
    <circle cx="260" cy="310" r="100" fill="url(#spiritGlow)"/>
    <circle cx="540" cy="310" r="100" fill="url(#spiritGlow)"/>
    <!-- Glowing Fireflies -->
    <circle cx="200" cy="480" r="6" fill="#a7f3d0"/>
    <circle cx="610" cy="520" r="8" fill="#a7f3d0"/>
    <circle cx="310" cy="610" r="5" fill="#fef08a"/>
    <circle cx="490" cy="590" r="7" fill="#fef08a"/>
    <circle cx="400" cy="460" r="9" fill="#67e8f9"/>
    <!-- Glowing Runes on Trunk -->
    <circle cx="400" cy="540" r="12" fill="#34d399" opacity="0.8"/>
    <polygon points="390,620 410,620 400,600" fill="#34d399" opacity="0.85"/>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function createCyberThemeSvg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <defs>
      <linearGradient id="cyberBg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#09090b"/>
        <stop offset="60%" stop-color="#18181b"/>
        <stop offset="100%" stop-color="#3b0764"/>
      </linearGradient>
    </defs>
    <rect width="800" height="800" fill="url(#cyberBg)"/>
    <!-- Perspective Grid Lines -->
    <path d="M0,500 L800,500 M0,550 L800,550 M0,620 L800,620 M0,710 L800,710" stroke="#d946ef" stroke-width="2" opacity="0.5"/>
    <path d="M400,480 L0,800 M400,480 L160,800 M400,480 L320,800 M400,480 L480,800 M400,480 L640,800 M400,480 L800,800" stroke="#06b6d4" stroke-width="2" opacity="0.6"/>
    <!-- Synth Sun -->
    <circle cx="400" cy="380" r="150" fill="#f43f5e"/>
    <rect x="220" y="370" width="360" height="10" fill="#09090b"/>
    <rect x="220" y="395" width="360" height="14" fill="#09090b"/>
    <rect x="220" y="425" width="360" height="18" fill="#09090b"/>
    <rect x="220" y="460" width="360" height="24" fill="#09090b"/>
    <!-- Neon Skyscrapers -->
    <rect x="80" y="280" width="60" height="200" fill="#18181b" stroke="#06b6d4" stroke-width="2"/>
    <rect x="180" y="220" width="80" height="260" fill="#09090b" stroke="#ec4899" stroke-width="2"/>
    <rect x="540" y="240" width="75" height="240" fill="#09090b" stroke="#06b6d4" stroke-width="2"/>
    <rect x="660" y="300" width="60" height="180" fill="#18181b" stroke="#a855f7" stroke-width="2"/>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Bootstrap application on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.slideQuestApp = new SlideQuestApp();
});
