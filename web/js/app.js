/**
 * App.js: Điều phối toàn bộ luồng ứng dụng:
 * 1. Màn hình sảnh (Lobby) & Màn hình gọi (In-call)
 * 2. Agora RTC Web SDK cho cuộc gọi P2P 1-1
 * 3. WebSocket Proxy (/ws/speech) kết nối Soniox STT & Live Translation
 * 4. AudioRecorder thu âm PCM 16kHz
 * 5. Hiển thị phụ đề song ngữ trực tiếp
 */

document.addEventListener("DOMContentLoaded", () => {
  // === DOM ELEMENTS ===
  const lobbyScreen = document.getElementById("lobby-screen");
  const inCallScreen = document.getElementById("incall-screen");

  // Lobby Inputs & Buttons
  const roomIdInput = document.getElementById("room-id");
  const myLangSelect = document.getElementById("my-lang");
  const partnerLangSelect = document.getElementById("partner-lang");
  const btnRandomRoom = document.getElementById("btn-random-room");
  const btnStartCall = document.getElementById("btn-start-call");

  // In-Call Elements
  const incallRoomName = document.getElementById("incall-room-name");
  const callTimerElem = document.getElementById("call-timer");
  const p2pBadge = document.getElementById("p2p-badge");
  const sonioxBadge = document.getElementById("soniox-badge");
  const soundWave = document.getElementById("sound-wave");

  // Subtitle Containers
  const mySpeechContainer = document.getElementById("my-speech-container");
  const mySpeechText = document.getElementById("my-speech-text");
  const mySpeechInterim = document.getElementById("my-speech-interim");

  const partnerSpeechContainer = document.getElementById("partner-speech-container");
  const partnerSpeechText = document.getElementById("partner-speech-text");
  const partnerSpeechInterim = document.getElementById("partner-speech-interim");
  const partnerStatusNote = document.getElementById("partner-status-note");

  // Controls
  const btnToggleMic = document.getElementById("btn-toggle-mic");
  const micIconOn = document.getElementById("mic-icon-on");
  const micIconOff = document.getElementById("mic-icon-off");
  const btnEndCall = document.getElementById("btn-end-call");

  // === STATE VARIABLES ===
  let isMuted = false;
  let callStartTime = null;
  let timerInterval = null;
  let wsSpeech = null;
  let audioRecorder = null;
  let agoraManager = null;
  let myUID = Math.floor(100000 + Math.random() * 900000); // 6 chữ số ngẫu nhiên
  let peerJoined = false;

  // Khởi tạo phòng ngẫu nhiên nếu trống
  if (!roomIdInput.value) {
    roomIdInput.value = "room-" + Math.floor(1000 + Math.random() * 9000);
  }

  btnRandomRoom.addEventListener("click", () => {
    roomIdInput.value = "room-" + Math.floor(1000 + Math.random() * 9000);
  });

  // === BẮT ĐẦU CUỘC GỌI ===
  btnStartCall.addEventListener("click", async () => {
    const roomId = roomIdInput.value.trim();
    const myLang = myLangSelect.value;
    const partnerLang = partnerLangSelect.value;

    if (!roomId) {
      alert("Vui lòng nhập tên phòng (Room ID)!");
      return;
    }

    try {
      btnStartCall.disabled = true;
      btnStartCall.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg> Đang kết nối...
      `;

      // 1. Chuyển sang màn hình Gọi thoại In-Call
      lobbyScreen.classList.add("hidden");
      inCallScreen.classList.remove("hidden");
      incallRoomName.textContent = roomId;
      resetSubtitleViews();
      startTimer();

      // 2. Kết nối WebSocket tới Backend Go (/ws/speech)
      await initSpeechWebSocket(myLang, partnerLang);

      // 3. Khởi tạo AudioRecorder để thu âm PCM 16kHz
      await initAudioRecorder();

      // 4. Kết nối Agora Web SDK (P2P Audio Call & DataStream)
      await initAgora(roomId, myUID);

    } catch (err) {
      console.error("[App] Lỗi khi bắt đầu cuộc gọi:", err);
      alert("Không thể bắt đầu cuộc gọi: " + (err.message || err));
      endCall();
    } finally {
      btnStartCall.disabled = false;
      btnStartCall.innerHTML = `
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
        </svg> Bắt đầu cuộc gọi
      `;
    }
  });

  // === WEBSOCKET SONIOX PROXY ===
  async function initSpeechWebSocket(sourceLang, targetLang) {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/speech`;

      console.log("[WS Client] Đang kết nối tới:", wsUrl);
      wsSpeech = new WebSocket(wsUrl);

      wsSpeech.onopen = () => {
        console.log("[WS Client] Đã mở kết nối tới Go speech proxy. Gửi init config...");
        setSonioxBadge(true);

        // Gửi gói cấu hình ban đầu
        const initMsg = {
          source_lang: sourceLang,
          target_lang: targetLang
        };
        wsSpeech.send(JSON.stringify(initMsg));
        resolve();
      };

      wsSpeech.onmessage = (event) => {
        handleSonioxMessage(event.data);
      };

      wsSpeech.onerror = (err) => {
        console.error("[WS Client] Lỗi kết nối WebSocket:", err);
        setSonioxBadge(false);
        reject(new Error("Lỗi kết nối tới dịch vụ phiên dịch"));
      };

      wsSpeech.onclose = () => {
        console.log("[WS Client] WebSocket đã đóng.");
        setSonioxBadge(false);
      };
    });
  }

  // === XỬ LÝ PHẢN HỒI TỪ SONIOX ===
  function handleSonioxMessage(rawJson) {
    try {
      const data = JSON.parse(rawJson);
      if (data.error || data.error_code) {
        console.warn("[Soniox Warning]:", data.error || data.error_code);
        return;
      }

      // Xử lý danh sách tokens trả về
      if (Array.isArray(data.tokens) && data.tokens.length > 0) {
        let originalFinalText = "";
        let originalInterimText = "";
        let translatedFinalText = "";
        let translatedInterimText = "";

        for (const token of data.tokens) {
          const text = token.text || "";
          const isFinal = token.is_final;
          const status = token.translation_status || "original";

          if (status === "translation") {
            if (isFinal) {
              translatedFinalText += text;
            } else {
              translatedInterimText += text;
            }
          } else {
            // "original"
            if (isFinal) {
              originalFinalText += text;
            } else {
              originalInterimText += text;
            }
          }
        }

        // Cập nhật phần hiển thị lời nói gốc của tôi (My Speech)
        if (originalFinalText) {
          appendSpeech(mySpeechText, originalFinalText);
          mySpeechInterim.textContent = "";
        }
        if (originalInterimText) {
          mySpeechInterim.textContent = originalInterimText;
        }

        // Nếu có bản dịch từ tiếng nói của tôi
        if (translatedFinalText || translatedInterimText) {
          const translatedContent = (translatedFinalText || translatedInterimText).trim();

          // 1. Gửi bản dịch sang máy đối phương qua Agora DataStream
          if (agoraManager && peerJoined) {
            agoraManager.broadcastSubtitle({
              type: "subtitle",
              original: (originalFinalText || originalInterimText).trim(),
              translation: translatedContent,
              isFinal: !!translatedFinalText
            });
          }

          // 2. Khi đang thử nghiệm 1 mình (chưa có peer), hiển thị chế độ xem trước ở khung đối phương
          if (!peerJoined && translatedContent) {
            partnerStatusNote.textContent = "(Bản dịch đối phương sẽ thấy - Chế độ xem trước)";
            if (translatedFinalText) {
              appendSpeech(partnerSpeechText, translatedFinalText);
              partnerSpeechInterim.textContent = "";
            } else {
              partnerSpeechInterim.textContent = translatedInterimText;
            }
          }
        }

        // Tự động cuộn xuống cuối
        scrollToBottom(mySpeechContainer);
        scrollToBottom(partnerSpeechContainer);
      }
    } catch (e) {
      console.error("[App] Lỗi parse phản hồi Soniox:", e);
    }
  }

  // === THU ÂM MICRO VÀ GỬI SANG WEBSOCKET ===
  async function initAudioRecorder() {
    audioRecorder = new AudioRecorder({
      sampleRate: 16000,
      onAudioChunk: (pcmBuffer) => {
        // Gửi dữ liệu nhị phân (Binary) sang Go WebSocket
        if (wsSpeech && wsSpeech.readyState === WebSocket.OPEN && !isMuted) {
          wsSpeech.send(pcmBuffer);
        }
      },
      onVolumeChange: (vol) => {
        if (!isMuted && vol > 0.05) {
          soundWave.classList.remove("opacity-20");
          soundWave.classList.add("opacity-100");
        } else {
          soundWave.classList.remove("opacity-100");
          soundWave.classList.add("opacity-20");
        }
      }
    });

    await audioRecorder.start();
  }

  // === AGORA RTC (CALL 1-1 + DATASTREAM) ===
  async function initAgora(channelName, uid) {
    agoraManager = new AgoraCallManager({
      onConnectionStateChange: (state) => {
        setP2PBadge(state === "CONNECTED");
      },
      onPeerJoined: (user) => {
        peerJoined = true;
        partnerStatusNote.textContent = `Đối phương (UID: ${user.uid}) đã kết nối`;
        partnerStatusNote.classList.remove("text-amber-400");
        partnerStatusNote.classList.add("text-emerald-400");
      },
      onPeerLeft: (user) => {
        peerJoined = false;
        partnerStatusNote.textContent = "Đối phương đã ngắt kết nối";
        partnerStatusNote.classList.remove("text-emerald-400");
        partnerStatusNote.classList.add("text-rose-400");
      },
      onPeerSubtitle: (payload) => {
        // Nhận phụ đề tiếng Việt dịch từ giọng nói đối phương
        if (payload && payload.translation) {
          partnerStatusNote.textContent = "Đối phương đang nói...";
          if (payload.isFinal) {
            appendSpeech(partnerSpeechText, payload.translation);
            partnerSpeechInterim.textContent = "";
          } else {
            partnerSpeechInterim.textContent = payload.translation;
          }
          scrollToBottom(partnerSpeechContainer);
        }
      }
    });

    await agoraManager.joinCall(channelName, uid);
  }

  // === ĐIỀU KHIỂN NÚT BẤM (MIC & END CALL) ===
  btnToggleMic.addEventListener("click", () => {
    isMuted = !isMuted;

    if (audioRecorder) {
      audioRecorder.setMute(isMuted);
    }
    if (agoraManager) {
      agoraManager.setMute(isMuted);
    }

    if (isMuted) {
      micIconOn.classList.add("hidden");
      micIconOff.classList.remove("hidden");
      btnToggleMic.classList.remove("bg-slate-700", "text-white");
      btnToggleMic.classList.add("bg-rose-500", "text-white", "shadow-rose-500/50");
      soundWave.classList.add("hidden");
    } else {
      micIconOff.classList.add("hidden");
      micIconOn.classList.remove("hidden");
      btnToggleMic.classList.remove("bg-rose-500", "text-white", "shadow-rose-500/50");
      btnToggleMic.classList.add("bg-slate-700", "text-white");
      soundWave.classList.remove("hidden");
    }
  });

  btnEndCall.addEventListener("click", () => {
    endCall();
  });

  // === KẾT THÚC CUỘC GỌI VÀ CLEANUP TÀI NGUYÊN ===
  function endCall() {
    stopTimer();

    // Dừng AudioRecorder
    if (audioRecorder) {
      audioRecorder.stop();
      audioRecorder = null;
    }

    // Đóng WebSocket
    if (wsSpeech) {
      wsSpeech.close();
      wsSpeech = null;
    }

    // Rời Agora RTC
    if (agoraManager) {
      agoraManager.leaveCall();
      agoraManager = null;
    }

    // Reset trạng thái
    peerJoined = false;
    isMuted = false;
    setP2PBadge(false);
    setSonioxBadge(false);

    // Chuyển về màn hình sảnh
    inCallScreen.classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
  }

  // === TIỆN ÍCH HỖ TRỢ ===
  function appendSpeech(elem, text) {
    if (!text) return;
    const current = elem.textContent.trim();
    if (current) {
      elem.textContent = current + " " + text.trim();
    } else {
      elem.textContent = text.trim();
    }
  }

  function resetSubtitleViews() {
    mySpeechText.textContent = "";
    mySpeechInterim.textContent = "Hãy nói vào micro...";
    partnerSpeechText.textContent = "";
    partnerSpeechInterim.textContent = "Đang chờ đối phương nói...";
    partnerStatusNote.textContent = "Đang kết nối vào phòng...";
  }

  function scrollToBottom(container) {
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function startTimer() {
    callStartTime = Date.now();
    callTimerElem.textContent = "00:00";
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      callTimerElem.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    callTimerElem.textContent = "00:00";
  }

  function setP2PBadge(active) {
    if (active) {
      p2pBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 status-active-pulse mr-1.5"></span> Thoại P2P Trực Tuyến`;
      p2pBadge.className = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800";
    } else {
      p2pBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500 mr-1.5"></span> Đang kết nối P2P`;
      p2pBadge.className = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700";
    }
  }

  function setSonioxBadge(active) {
    if (active) {
      sonioxBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-indigo-400 status-active-pulse mr-1.5"></span> AI Dịch Thuật`;
      sonioxBadge.className = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800";
    } else {
      sonioxBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500 mr-1.5"></span> AI Sẵn sàng`;
      sonioxBadge.className = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700";
    }
  }
});
