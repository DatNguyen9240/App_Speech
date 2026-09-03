/**
 * AgoraCallManager: Quản lý cuộc gọi thoại P2P 1-1 và truyền dữ liệu phụ đề qua Agora RTC Web SDK
 */
class AgoraCallManager {
  constructor(options = {}) {
    this.client = null;
    this.localAudioTrack = null;
    this.remoteUsers = new Map();
    this.dataStreamId = null;

    this.onPeerJoined = options.onPeerJoined || (() => {});
    this.onPeerLeft = options.onPeerLeft || (() => {});
    this.onPeerSubtitle = options.onPeerSubtitle || (() => {});
    this.onConnectionStateChange = options.onConnectionStateChange || (() => {});
  }

  /**
   * Lấy RTC Token từ Backend Go
   */
  async fetchToken(channelName, uid) {
    try {
      const response = await fetch(`/api/token?channelName=${encodeURIComponent(channelName)}&uid=${uid}`);
      let data = {};
      try {
        data = await response.json();
      } catch (e) {}

      if (!response.ok) {
        const errorDetail = data.details || data.error || `Server trả về mã lỗi: ${response.status}`;
        throw new Error(errorDetail);
      }
      return data;
    } catch (err) {
      console.error("[AgoraCallManager] Không thể lấy token từ backend:", err);
      throw err;
    }
  }

  /**
   * Khởi tạo và tham gia phòng gọi Agora
   */
  async joinCall(channelName, uid) {
    if (typeof AgoraRTC === "undefined") {
      throw new Error("AgoraRTC Web SDK chưa được tải thành công!");
    }

    // 1. Lấy token và appId từ server Go
    const tokenInfo = await this.fetchToken(channelName, uid);
    const appId = tokenInfo.appId;
    const token = tokenInfo.token;

    // 2. Tạo Agora RTC Client
    this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    // Đăng ký các sự kiện mạng và người dùng
    this.client.on("connection-state-change", (curState, revState) => {
      console.log(`[AgoraRTC] Trạng thái kết nối: ${revState} -> ${curState}`);
      this.onConnectionStateChange(curState);
    });

    this.client.on("user-joined", (user) => {
      console.log("[AgoraRTC] Đối phương đã tham gia phòng:", user.uid);
      this.remoteUsers.set(user.uid, user);
      this.onPeerJoined(user);
    });

    this.client.on("user-left", (user, reason) => {
      console.log("[AgoraRTC] Đối phương đã rời phòng:", user.uid, reason);
      this.remoteUsers.delete(user.uid);
      this.onPeerLeft(user, reason);
    });

    // Lắng nghe luồng audio từ đối phương và phát âm thanh
    this.client.on("user-published", async (user, mediaType) => {
      await this.client.subscribe(user, mediaType);
      console.log("[AgoraRTC] Đã subscribe đối phương:", user.uid, mediaType);
      if (mediaType === "audio") {
        user.audioTrack.play();
      }
    });

    // Lắng nghe gói tin phụ đề DataStream từ đối phương
    this.client.on("stream-message", (uid, data) => {
      try {
        const decodedStr = new TextDecoder().decode(data);
        const payload = JSON.parse(decodedStr);
        this.onPeerSubtitle(payload);
      } catch (e) {
        console.error("[AgoraRTC] Lỗi giải mã phụ đề stream-message:", e);
      }
    });

    // 3. Gia nhập kênh Agora
    await this.client.join(appId || "", channelName, token || null, uid);
    console.log(`[AgoraRTC] Đã gia nhập channel: ${channelName} với UID: ${uid}`);

    // 4. Tạo luồng Micro cho cuộc gọi thoại đàm thoại 2 chiều
    this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: "speech_standard",
      AEC: true, // Khử tiếng vọng
      ANS: true, // Lọc tiếng ồn môi trường
      AGC: true, // Tự động tăng giảm âm lượng mic
    });

    // Xuất bản âm thanh lên Agora
    await this.client.publish([this.localAudioTrack]);

    // 5. Tạo DataStream để đồng bộ phụ đề dịch 2 chiều độ trễ siêu thấp
    try {
      this.dataStreamId = await this.client.createDataStream({
        syncWithAudio: true,
        ordered: true,
      });
      console.log("[AgoraRTC] Đã khởi tạo DataStream ID:", this.dataStreamId);
    } catch (e) {
      console.warn("[AgoraRTC] Không thể tạo DataStream (có thể do phiên bản Web SDK):", e);
    }

    return tokenInfo;
  }

  /**
   * Phát tán phụ đề đã dịch sang máy đối phương qua Agora DataStream
   */
  broadcastSubtitle(subtitleData) {
    if (!this.client || this.dataStreamId === null) return;

    try {
      const jsonStr = JSON.stringify(subtitleData);
      const encoded = new TextEncoder().encode(jsonStr);
      this.client.sendStreamMessage(this.dataStreamId, encoded);
    } catch (err) {
      console.error("[AgoraRTC] Lỗi gửi phụ đề qua DataStream:", err);
    }
  }

  /**
   * Bật / Tắt Micro thoại
   */
  setMute(mute) {
    if (this.localAudioTrack) {
      this.localAudioTrack.setEnabled(!mute);
    }
  }

  /**
   * Rời khỏi phòng gọi và dọn dẹp tài nguyên
   */
  async leaveCall() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack.close();
      this.localAudioTrack = null;
    }

    if (this.client) {
      this.client.removeAllListeners();
      await this.client.leave();
      this.client = null;
    }

    this.remoteUsers.clear();
    this.dataStreamId = null;
    console.log("[AgoraRTC] Đã rời phòng và đóng kết nối cuộc gọi.");
  }
}

window.AgoraCallManager = AgoraCallManager;
