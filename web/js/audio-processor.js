/**
 * AudioRecorder: Thu âm Micro và chuyển đổi trực tiếp sang PCM 16kHz, 16-bit Mono Little-Endian
 * Hỗ trợ tối ưu cho Safari iOS, Android Chrome và Desktop.
 */
class AudioRecorder {
  constructor(options = {}) {
    this.targetSampleRate = options.sampleRate || 16000;
    this.onAudioChunk = options.onAudioChunk || (() => {});
    this.onVolumeChange = options.onVolumeChange || (() => {});
    
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.isRecording = false;
    this.isMuted = false;
  }

  /**
   * Bắt đầu thu âm micro
   */
  async start() {
    if (this.isRecording) return;

    try {
      // 1. Yêu cầu quyền Micro với các bộ lọc giảm ồn và khử vọng của trình duyệt
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false
      });

      // 2. Khởi tạo AudioContext (hỗ trợ cả webkitAudioContext trên iOS cũ)
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      // Mở lại AudioContext nếu bị suspended (chính sách Autoplay của trình duyệt)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const inputSampleRate = this.audioContext.sampleRate;
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 3. Sử dụng ScriptProcessorNode (bộ đệm 4096 mẫu, 1 kênh vào, 1 kênh ra)
      // Đảm bảo tương thích tối đa trên mọi trình duyệt di động iOS / Android
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRecording || this.isMuted) return;

        const inputChannelData = e.inputBuffer.getChannelData(0);

        // Tính toán âm lượng (RMS) để hiển thị visualizer
        let sum = 0;
        for (let i = 0; i < inputChannelData.length; i++) {
          sum += inputChannelData[i] * inputChannelData[i];
        }
        const rms = Math.sqrt(sum / inputChannelData.length);
        this.onVolumeChange(Math.min(1, rms * 5));

        // Downsample và chuyển đổi sang PCM 16-bit Int16 Little-Endian
        const pcmBuffer = this.downsampleAndConvertToPCM(
          inputChannelData,
          inputSampleRate,
          this.targetSampleRate
        );

        if (pcmBuffer && pcmBuffer.byteLength > 0) {
          this.onAudioChunk(pcmBuffer);
        }
      };

      // Nối các node âm thanh
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isRecording = true;
      console.log(`[AudioRecorder] Bắt đầu thu âm. Input: ${inputSampleRate}Hz -> Target: ${this.targetSampleRate}Hz`);
    } catch (err) {
      console.error("[AudioRecorder] Lỗi truy cập Micro:", err);
      throw err;
    }
  }

  /**
   * Tạm dừng gửi audio (Mute)
   */
  setMute(mute) {
    this.isMuted = mute;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = !mute;
      });
    }
  }

  /**
   * Dừng thu âm và dọn dẹp tài nguyên
   */
  stop() {
    this.isRecording = false;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.onVolumeChange(0);
    console.log("[AudioRecorder] Đã dừng và giải phóng Micro.");
  }

  /**
   * Thuật toán Downsample từ bất kỳ Sample Rate nào về 16,000Hz và mã hóa sang Int16 PCM
   */
  downsampleAndConvertToPCM(inputData, inSampleRate, outSampleRate) {
    if (inSampleRate === outSampleRate) {
      const output = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return output.buffer;
    }

    const ratio = inSampleRate / outSampleRate;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Int16Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < newLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;

      for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
        accum += inputData[i];
        count++;
      }

      let sample = count > 0 ? accum / count : 0;
      // Clamp giá trị trong khoảng [-1.0, 1.0]
      sample = Math.max(-1, Math.min(1, sample));
      // Chuyển đổi sang signed 16-bit integer
      result[offsetResult] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return result.buffer;
  }
}

window.AudioRecorder = AudioRecorder;
