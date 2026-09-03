# Hệ Thống Gọi Thoại 1-1 & Phiên Dịch Giọng Nói Thời Gian Thực

Ứng dụng web gọi điện thoại thoại P2P 1-1 kiêm phiên dịch giọng nói trực tiếp thời gian thực, xây dựng bằng **Go (Golang)**, **Agora RTC Web SDK**, và **Soniox Speech AI WebSocket API**.

Giao diện được thiết kế theo tư duy **Mobile-First**, tối ưu hoàn hảo cho trình duyệt di động (**iOS Safari, Android Chrome**) cũng như máy tính để bàn.

---

## 🚀 Các Tính Năng Nổi Bật

1. **Backend Go Hiệu Năng Cao**:
   - **Gin-Gonic** phục vụ RESTful API, WebSocket và Static Web UI trên cùng một port duy nhất.
   - **Endpoint `/api/token`**: Tự động tạo Agora RTC Token tạm thời chuẩn **AccessToken2 (007)** dựa trên `channelName` và `uid`.
   - **WebSocket Proxy `/ws/speech`**:
     - Kết nối 2 chiều đồng thời tới **Soniox API** (`wss://api.soniox.com/transcribe-websocket`).
     - Tiếp nhận các gói tin nhị phân (Binary PCM 16kHz) từ client và pipe tức thì sang Soniox.
     - Lắng nghe phản hồi JSON (text gốc & text dịch) và streaming về client ngay lập tức.
     - **Quản lý tài nguyên đa luồng (Goroutines & Buffered Channel)**: Chống nghẽn luồng mạng, tự động thu hồi tài nguyên (graceful cleanup) khi một trong hai đầu ngắt kết nối để không rò rỉ RAM hay lãng phí chi phí API Soniox.

2. **Frontend Web Responsive (Mobile-First)**:
   - **Màn hình sảnh (Lobby)**: Nhập tên phòng (Room ID), chọn ngôn ngữ của bạn (mặc định: Tiếng Việt `vi`), chọn ngôn ngữ đối phương (mặc định: Tiếng Trung `zh`), nút bắt đầu cuộc gọi với micro-interactions.
   - **Màn hình gọi (In-Call)**:
     - **Phần trên**: Hiển thị phụ đề gốc tôi vừa nói (để tự kiểm tra độ chính xác của giọng nói).
     - **Phần giữa/dưới nổi bật**: Hiển thị phụ đề tiếng Việt dịch từ giọng nói của đối phương (chữ to, rõ ràng, dễ đọc).
     - **Thanh điều khiển đáy màn hình (Bottom Control Bar)**: Nút bật/tắt Micro, Nút kết thúc cuộc gọi màu đỏ nổi bật.
   - **Xử lý âm thanh Web Audio API**:
     - Tự động downsample từ tần số mẫu thiết bị (44.1kHz / 48kHz) về chuẩn **PCM 16,000Hz, 16-bit Mono Little-Endian**.
     - Tương thích 100% với iOS WebKit và Android Chrome.
   - **Agora RTC DataStream**: Đồng bộ phụ đề dịch 2 chiều giữa 2 máy tức thì thông qua kênh dữ liệu ngầm của Agora, đảm bảo độ trễ thấp nhất.

---

## 📁 Cấu Trúc Thư Mục

```
App_Speech/
├── .env.example              # Mẫu biến môi trường
├── go.mod                    # Quản lý Golang modules
├── main.go                   # Điểm khởi chạy server Gin & WebSocket
├── pkg/
│   └── agora/
│       └── token.go          # Thuật toán tự sinh Agora RTC Token v2 (AccessToken2)
├── internal/
│   ├── config/
│   │   └── config.go         # Đọc và quản lý cấu hình môi trường
│   └── handler/
│       ├── token_handler.go  # Endpoint API /api/token
│       └── speech_proxy.go   # WebSocket Proxy Soniox (Goroutines + Channel)
└── web/
    ├── index.html            # Giao diện chính Mobile-First
    ├── css/
    │   └── style.css         # Glassmorphism, animations, safe-area
    └── js/
        ├── audio-processor.js # Thu âm Micro & Downsampler PCM 16kHz
        ├── agora-manager.js  # Tích hợp Agora Web SDK P2P & DataStream
        └── app.js            # Điều phối logic cuộc gọi và phụ đề
```

---

## ⚙️ Cài Đặt & Chạy Hệ Thống

### 1. Cấu hình biến môi trường
Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Điền các thông tin của bạn vào `.env`:
- `SONIOX_API_KEY`: Lấy tại [Soniox Console](https://soniox.com)
- `AGORA_APP_ID`: Lấy tại [Agora Console](https://console.agora.io)
- `AGORA_APP_CERTIFICATE`: App Certificate của project trên Agora Console (nếu project ở chế độ App ID-only để test, có thể để trống).
- `PORT`: Mặc định `8080`.

### 2. Chạy trên Windows (PowerShell)

```powershell
# Thiết lập biến môi trường
$env:SONIOX_API_KEY="your_soniox_key"
$env:AGORA_APP_ID="your_agora_app_id"
$env:AGORA_APP_CERTIFICATE="your_agora_certificate"
$env:PORT="8080"

# Tải dependencies và chạy server
go mod tidy
go run main.go
```

### 3. Chạy trên macOS / Linux

```bash
export SONIOX_API_KEY="your_soniox_key"
export AGORA_APP_ID="your_agora_app_id"
export AGORA_APP_CERTIFICATE="your_agora_certificate"
export PORT=8080

go mod tidy
go run main.go
```

Truy cập giao diện ứng dụng tại: `http://localhost:8080`

---

## 📱 Thử Nghiệm Trên Thiết Bị Di Động (iOS & Android)

> [!IMPORTANT]
> Trình duyệt di động (iOS Safari và Android Chrome) **bắt buộc** phải sử dụng kết nối bảo mật **HTTPS** (hoặc địa chỉ `localhost`) mới cấp quyền truy cập Micro (`getUserMedia`).

Để test từ điện thoại trong cùng mạng LAN hoặc từ xa, bạn có thể:
1. Sử dụng **ngrok** để tạo tunnel HTTPS miễn phí:
   ```bash
   ngrok http 8080
   ```
   Mở đường dẫn `https://xxxx.ngrok-free.app` trên Safari (iPhone) hoặc Chrome (Android).
2. Hoặc sử dụng **Cloudflare Tunnel**:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

---

## 🔄 Cơ Chế Hoạt Động Của Luồng Âm Thanh & Phụ Đề

1. **Người dùng A (Nói Tiếng Việt)**:
   - Micro thu tín hiệu âm thanh -> `AudioRecorder` downsample về PCM 16kHz 16-bit.
   - Gửi các gói byte nhị phân qua WebSocket `/ws/speech`.
   - Backend Go chuyển tiếp sang Soniox API.
   - Soniox trả về:
     - Văn bản gốc: Hiển thị ngay tại **"Lời nói của tôi (Gốc)"** trên máy A.
     - Văn bản dịch (Tiếng Trung): Client A tự động gửi qua **Agora DataStream** sang máy B.
2. **Người dùng B (Nhận tiếng Trung & Nói Tiếng Trung)**:
   - Nhận bản dịch qua Agora DataStream -> Hiển thị nổi bật tại **"Phụ đề dịch từ đối phương"** trên máy B.
   - Khi B nói tiếng Trung, chu trình tương tự diễn ra theo chiều ngược lại, máy A sẽ nhận được phụ đề tiếng Việt!
