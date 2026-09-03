package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"speech-proxy/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		// Cho phép truy cập từ mọi origin (iOS, Android, localhost)
		return true
	},
}

// ConfigInitMsg chứa cấu hình ngôn ngữ do Client gửi lên trong frame đầu tiên
type ConfigInitMsg struct {
	SourceLang string `json:"source_lang"` // Ví dụ: "vi"
	TargetLang string `json:"target_lang"` // Ví dụ: "zh"
}

// SonioxTranslationConfig cấu hình dịch thuật thời gian thực của Soniox
type SonioxTranslationConfig struct {
	Type           string `json:"type"`            // "one_way"
	TargetLanguage string `json:"target_language"` // Ngôn ngữ đích
}

// SonioxConfigMsg cấu trúc gói tin gửi sang Soniox API để khởi tạo phiên
type SonioxConfigMsg struct {
	APIKey           string                   `json:"api_key"`
	App              string                   `json:"app,omitempty"`
	Model            string                   `json:"model"`
	SampleRateHertz  int                      `json:"sample_rate_hertz"`
	NumAudioChannels int                      `json:"num_audio_channels"`
	AudioFormat      string                   `json:"audio_format"`
	IncludeNonfinal  bool                     `json:"include_nonfinal"`
	SourceLanguage   string                   `json:"source_language,omitempty"`
	TargetLanguage   string                   `json:"target_language,omitempty"`
	Translation      *SonioxTranslationConfig `json:"translation,omitempty"`
}

type SpeechProxyHandler struct {
	cfg *config.Config
}

func NewSpeechProxyHandler(cfg *config.Config) *SpeechProxyHandler {
	return &SpeechProxyHandler{cfg: cfg}
}

// HandleSpeechWS quản lý kết nối WebSocket 2 chiều giữa Web Client và Soniox API
func (h *SpeechProxyHandler) HandleSpeechWS(c *gin.Context) {
	if h.cfg.SonioxAPIKey == "" {
		log.Println("[Lỗi] Biến môi trường SONIOX_API_KEY chưa được cấu hình!")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SONIOX_API_KEY is not configured on server"})
		return
	}

	// 1. Upgrade HTTP request thành kết nối WebSocket với Web Client
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[Lỗi Upgrade WS Client]: %v\n", err)
		return
	}

	// Đặt timeout đọc gói tin init từ Client trong 10 giây
	_ = clientConn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, initBytes, err := clientConn.ReadMessage()
	if err != nil {
		log.Printf("[Lỗi đọc gói tin init từ Client]: %v\n", err)
		_ = clientConn.Close()
		return
	}
	// Xóa bỏ deadline sau khi đã nhận init
	_ = clientConn.SetReadDeadline(time.Time{})

	var initData ConfigInitMsg
	if err := json.Unmarshal(initBytes, &initData); err != nil {
		log.Printf("[Lỗi parse JSON cấu hình từ Client]: %v\n", err)
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte(`{"error":"Invalid init JSON config"}`))
		_ = clientConn.Close()
		return
	}

	if initData.SourceLang == "" {
		initData.SourceLang = "vi"
	}
	if initData.TargetLang == "" {
		initData.TargetLang = "zh"
	}

	// 2. Mở kết nối WebSocket đồng thời từ Backend Go tới Soniox API
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	sonioxConn, _, err := dialer.Dial(h.cfg.SonioxWSURL, nil)
	if err != nil {
		log.Printf("[Lỗi kết nối Soniox API tại %s]: %v\n", h.cfg.SonioxWSURL, err)
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte(`{"error":"Failed to connect to Soniox speech service"}`))
		_ = clientConn.Close()
		return
	}

	// 3. Gửi gói tin cấu hình khởi tạo sang Soniox
	sonioxInit := SonioxConfigMsg{
		APIKey:           h.cfg.SonioxAPIKey,
		App:              "speech-translator-p2p",
		Model:            "stt-rt-v5", // Model nhận dạng & dịch thời gian thực chất lượng cao
		SampleRateHertz:  16000,
		NumAudioChannels: 1,
		AudioFormat:      "pcm_s16le", // 16-bit Mono Linear PCM 16kHz
		IncludeNonfinal:  true,        // Nhận kết quả dịch tạm thời để giao diện cập nhật tức thì
		SourceLanguage:   initData.SourceLang,
		TargetLanguage:   initData.TargetLang,
		Translation: &SonioxTranslationConfig{
			Type:           "one_way",
			TargetLanguage: initData.TargetLang,
		},
	}

	if err := sonioxConn.WriteJSON(sonioxInit); err != nil {
		log.Printf("[Lỗi gửi init sang Soniox]: %v\n", err)
		_ = sonioxConn.Close()
		_ = clientConn.Close()
		return
	}

	log.Printf("[Phiên dịch mở] Client <-> Go Proxy <-> Soniox | Lang: %s -> %s\n", initData.SourceLang, initData.TargetLang)

	// Context để đồng bộ hủy giữa các goroutine
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Quản lý đóng kết nối an toàn với sync.Once
	var closeOnce sync.Once
	cleanup := func(reason string) {
		closeOnce.Do(func() {
			log.Printf("[Cleanup] Đóng kết nối phiên dịch (%s)\n", reason)
			cancel()

			// Báo cho Soniox biết luồng audio đã dừng bằng gói byte rỗng
			_ = sonioxConn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
				time.Now().Add(time.Second),
			)

			_ = clientConn.Close()
			_ = sonioxConn.Close()
		})
	}

	// Channel đệm lưu trữ audio PCM chunks từ Client chuyển sang Soniox
	// Buffer 100 gói (~100ms * 100 = 10s audio) tránh nghẽn luồng
	audioChan := make(chan []byte, 100)

	var wg sync.WaitGroup

	// Luồng 1: Đọc Binary Audio từ Web Client -> Đẩy vào audioChan
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cleanup("Web Client ngắt kết nối hoặc lỗi mạng")

		for {
			select {
			case <-ctx.Done():
				return
			default:
				msgType, data, err := clientConn.ReadMessage()
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
						log.Printf("[Client Read Error]: %v\n", err)
					}
					return
				}

				if msgType == websocket.BinaryMessage && len(data) > 0 {
					select {
					case audioChan <- data:
					case <-ctx.Done():
						return
					default:
						// Nếu channel đầy vì mạng tới Soniox bị nghẽn, loại bỏ gói cũ nhất để ưu tiên thời gian thực
						select {
						case <-audioChan:
						default:
						}
						audioChan <- data
					}
				}
			}
		}
	}()

	// Luồng 2: Nhận dữ liệu từ audioChan -> Pipe sang WebSocket Soniox
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cleanup("Lỗi pipe audio sang Soniox")

		for {
			select {
			case <-ctx.Done():
				return
			case chunk, ok := <-audioChan:
				if !ok {
					return
				}
				if err := sonioxConn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
					log.Printf("[Lỗi ghi audio sang Soniox]: %v\n", err)
					return
				}
			}
		}
	}()

	// Luồng 3: Nhận phản hồi JSON từ Soniox (Transcript & Translation) -> Forward về Web Client
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cleanup("Soniox đóng kết nối hoặc kết thúc phiên")

		for {
			select {
			case <-ctx.Done():
				return
			default:
				msgType, data, err := sonioxConn.ReadMessage()
				if err != nil {
					log.Printf("[Soniox Read Error]: %v\n", err)
					return
				}

				// Chuyển tiếp ngay lập tức sang Web Client
				if err := clientConn.WriteMessage(msgType, data); err != nil {
					log.Printf("[Lỗi forward kết quả về Client]: %v\n", err)
					return
				}
			}
		}
	}()

	// Đợi cho đến khi một trong các luồng phát hiện ngắt kết nối
	wg.Wait()
	log.Println("[Phiên dịch kết thúc hoàn toàn]")
}
