/**
 * SlideQuest - Camera Manager
 * Manages webcam lifecycle, MediaDevices getUserMedia permissions,
 * video stream attachment, track disposal, concurrency protection, and camera state notifications.
 *
 * Privacy & Security Guarantee:
 * - Camera access is ONLY requested upon explicit user interaction.
 * - Video streams are processed purely client-side in volatile memory.
 * - No video frames, biometric data, or landmarks are ever recorded, persisted, or transmitted.
 */

export class CameraManager {
  constructor(options = {}) {
    this.videoElement = null;
    this.mediaStream = null;
    this.isActive = false;
    this.isRequesting = false;
    this.facingMode = options.facingMode || 'user'; // 'user' (front) or 'environment'
    this.idealWidth = options.width || 640;
    this.idealHeight = options.height || 480;

    // Callbacks
    this.onStreamReady = options.onStreamReady || (() => {});
    this.onStreamStopped = options.onStreamStopped || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    // Bound listeners for precise cleanup
    this.boundHandleTrackEnded = this.handleTrackEnded.bind(this);
    this.boundHandleDeviceChange = this.handleDeviceChange.bind(this);
    this.boundHandlePageUnload = this.handlePageUnload.bind(this);

    this.setupGlobalListeners();
  }

  setupGlobalListeners() {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', this.boundHandleDeviceChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.boundHandlePageUnload);
      window.addEventListener('pagehide', this.boundHandlePageUnload);
    }
  }

  /**
   * Starts the camera stream and binds it to the video element.
   * Only called after explicit user consent (e.g. clicking "Enable Camera").
   * Protected against concurrent invocations and duplicate stream leaks.
   */
  async startCamera(videoElement) {
    if (!videoElement) {
      const err = new Error('No video element provided to CameraManager.');
      this.onError(err, 'Configuration Error');
      return false;
    }

    // Concurrency lock: Prevent duplicate requests from rapid clicks
    if (this.isRequesting) {
      return false;
    }

    // If stream is already active on this video element, avoid redundant restart
    if (this.isActive && this.mediaStream && this.videoElement === videoElement) {
      return true;
    }

    // Stop any existing stream before starting a new one
    if (this.isActive || this.mediaStream) {
      this.stopCamera();
    }

    this.videoElement = videoElement;
    this.isRequesting = true;
    this.onStatusChange('Requesting Permission');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      this.isRequesting = false;
      const err = new Error('Camera access is not supported by this browser or environment.');
      this.onStatusChange('Camera unavailable');
      this.onError(err, 'Browser Not Supported');
      return false;
    }

    const optimalConstraints = {
      audio: false,
      video: {
        facingMode: this.facingMode,
        width: { ideal: this.idealWidth },
        height: { ideal: this.idealHeight },
        frameRate: { ideal: 30, max: 30 }
      }
    };

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(optimalConstraints);
      } catch (primaryError) {
        // Fallback for OverconstrainedError: Retry with relaxed constraints
        if (primaryError.name === 'OverconstrainedError') {
          console.warn('OverconstrainedError encountered; falling back to basic video constraints.');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: this.facingMode }
          });
        } else {
          throw primaryError;
        }
      }

      this.mediaStream = stream;
      this.isActive = true;
      this.isRequesting = false;

      // Monitor stream tracks for unexpected disconnection
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', this.boundHandleTrackEnded);
      });

      this.videoElement.srcObject = stream;
      this.videoElement.setAttribute('playsinline', 'true');
      this.videoElement.muted = true;

      // Ensure video element has loaded its first frame
      await new Promise((resolve) => {
        if (this.videoElement.readyState >= 2) {
          resolve();
        } else {
          const onLoaded = () => {
            this.videoElement.removeEventListener('loadeddata', onLoaded);
            resolve();
          };
          this.videoElement.addEventListener('loadeddata', onLoaded);
          // Fallback timeout in case loadeddata event is delayed in some environments
          setTimeout(resolve, 500);
        }
      });

      if (typeof this.videoElement.play === 'function') {
        try {
          await this.videoElement.play();
        } catch (playErr) {
          // Handled gracefully if autoplay policy delays play
          console.warn('Video play delayed:', playErr);
        }
      }

      this.onStatusChange('Active');
      this.onStreamReady(this.videoElement, stream);
      return true;
    } catch (error) {
      this.isActive = false;
      this.isRequesting = false;
      this.mediaStream = null;

      let userFriendlyMessage = 'Failed to access camera.';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        userFriendlyMessage = 'Camera permission was denied. Please allow camera access in browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        userFriendlyMessage = 'No camera device found on this system.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        userFriendlyMessage = 'Camera is already in use by another application or tab.';
      } else if (error.name === 'OverconstrainedError') {
        userFriendlyMessage = 'The requested camera resolution is not supported by your camera.';
      }

      this.onStatusChange('Camera unavailable');
      this.onError(error, userFriendlyMessage);
      return false;
    }
  }

  /**
   * Stops all active camera tracks and detaches the stream from the video element.
   * Completely releases hardware resources.
   */
  stopCamera() {
    this.isRequesting = false;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.removeEventListener('ended', this.boundHandleTrackEnded);
        if (typeof track.stop === 'function') {
          track.stop();
        }
      });
      this.mediaStream = null;
    }

    if (this.videoElement) {
      if (typeof this.videoElement.pause === 'function') {
        this.videoElement.pause();
      }
      this.videoElement.srcObject = null;
    }

    const wasActive = this.isActive;
    this.isActive = false;

    if (wasActive) {
      this.onStatusChange('Disabled');
      this.onStreamStopped();
    }
  }

  handleTrackEnded() {
    this.stopCamera();
    this.onStatusChange('Camera unavailable');
    this.onError(new Error('Camera track was ended or disconnected.'), 'Camera disconnected.');
  }

  handleDeviceChange() {
    if (this.isActive && navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const hasVideo = devices.some(d => d.kind === 'videoinput');
        if (!hasVideo) {
          this.handleTrackEnded();
        }
      }).catch(() => {});
    }
  }

  handlePageUnload() {
    this.stopCamera();
  }

  getVideoDimensions() {
    if (this.videoElement && this.videoElement.videoWidth) {
      return {
        width: this.videoElement.videoWidth,
        height: this.videoElement.videoHeight
      };
    }
    return { width: this.idealWidth, height: this.idealHeight };
  }

  destroy() {
    this.stopCamera();
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener('devicechange', this.boundHandleDeviceChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.boundHandlePageUnload);
      window.removeEventListener('pagehide', this.boundHandlePageUnload);
    }
    this.videoElement = null;
  }
}
