/**
 * SlideQuest - Camera Manager
 * Manages webcam lifecycle, MediaDevices getUserMedia permissions,
 * video stream attachment, track disposal, and camera state notifications.
 */

export class CameraManager {
  constructor(options = {}) {
    this.videoElement = null;
    this.mediaStream = null;
    this.isActive = false;
    this.facingMode = options.facingMode || 'user'; // 'user' (front) or 'environment'
    this.idealWidth = options.width || 640;
    this.idealHeight = options.height || 480;

    // Callbacks
    this.onStreamReady = options.onStreamReady || (() => {});
    this.onStreamStopped = options.onStreamStopped || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    this.boundHandleTrackEnded = this.handleTrackEnded.bind(this);
    this.boundHandleDeviceChange = this.handleDeviceChange.bind(this);
    this.setupGlobalListeners();
  }

  setupGlobalListeners() {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', this.boundHandleDeviceChange);
    }
    // Clean up tracks when tab closes or refreshes
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.stopCamera());
    }
  }

  /**
   * Starts the camera stream and binds it to the video element.
   * Only called after explicit user consent (e.g. clicking "Enable Camera").
   */
  async startCamera(videoElement) {
    if (!videoElement) {
      const err = new Error('No video element provided to CameraManager.');
      this.onError(err, 'Configuration Error');
      return false;
    }

    this.videoElement = videoElement;

    // If already active, stop existing stream first
    if (this.isActive) {
      this.stopCamera();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('Camera access is not supported by this browser.');
      this.onError(err, 'Browser Not Supported');
      this.onStatusChange('Camera unavailable');
      return false;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: this.facingMode,
        width: { ideal: this.idealWidth },
        height: { ideal: this.idealHeight },
        frameRate: { ideal: 30, max: 30 }
      }
    };

    try {
      this.onStatusChange('Waiting');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaStream = stream;
      this.isActive = true;

      // Monitor stream tracks for disconnection
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', this.boundHandleTrackEnded);
      });

      this.videoElement.srcObject = stream;
      this.videoElement.setAttribute('playsinline', 'true');
      this.videoElement.muted = true;

      await new Promise((resolve) => {
        if (this.videoElement.readyState >= 2) {
          resolve();
        } else {
          this.videoElement.onloadeddata = () => resolve();
        }
      });

      await this.videoElement.play();

      this.onStatusChange('Tracking');
      this.onStreamReady(this.videoElement, stream);
      return true;
    } catch (error) {
      this.isActive = false;
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
   * Stops all active camera tracks and detaches stream
   */
  stopCamera() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.removeEventListener('ended', this.boundHandleTrackEnded);
        track.stop();
      });
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }

    const wasActive = this.isActive;
    this.isActive = false;

    if (wasActive) {
      this.onStatusChange('Camera off');
      this.onStreamStopped();
    }
  }

  handleTrackEnded() {
    this.stopCamera();
    this.onStatusChange('Camera unavailable');
    this.onError(new Error('Camera track was ended or disconnected.'), 'Camera disconnected.');
  }

  handleDeviceChange() {
    if (this.isActive) {
      // Validate that camera is still accessible
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const hasVideo = devices.some(d => d.kind === 'videoinput');
        if (!hasVideo) {
          this.handleTrackEnded();
        }
      }).catch(() => {});
    }
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
  }
}
