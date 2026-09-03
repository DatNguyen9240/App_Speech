package agora

import (
	"bytes"
	"compress/zlib"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand"
	"time"
)

const (
	// Version2 là định dạng AccessToken2 hiện đại (bắt đầu bằng 007)
	Version2 = "007"

	// Service types
	ServiceTypeRTC = 1

	// Privilege keys cho Service RTC
	PrivilegeJoinChannel        uint16 = 1
	PrivilegePublishAudioStream uint16 = 2
	PrivilegePublishVideoStream uint16 = 3
	PrivilegePublishDataStream  uint16 = 4

	// Vai trò người dùng (Roles)
	RolePublisher  uint32 = 1 // Có thể nói và nghe
	RoleSubscriber uint32 = 2 // Chỉ nghe
)

// GenerateRtcToken sinh mã RTC Token chuẩn AccessToken2 cho Agora RTC SDK
// appID: App ID trên Agora Console
// appCertificate: App Certificate trên Agora Console (nếu để trống, trả về token rỗng cho App ID-only mode)
// channelName: Tên phòng / kênh RTC
// uid: ID người dùng dạng số nguyên (0 nếu muốn wildcard)
// role: RolePublisher (1) hoặc RoleSubscriber (2)
// expireSec: Thời hạn hiệu lực của token tính bằng giây (ví dụ: 86400s = 24h)
func GenerateRtcToken(appID, appCertificate, channelName string, uid uint32, role uint32, expireSec uint32) (string, error) {
	uidStr := ""
	if uid != 0 {
		uidStr = fmt.Sprintf("%d", uid)
	}
	return GenerateRtcTokenWithUserAccount(appID, appCertificate, channelName, uidStr, role, expireSec)
}

// GenerateRtcTokenWithUserAccount sinh token cho User Account dạng chuỗi (hoặc UID số dạng string)
func GenerateRtcTokenWithUserAccount(appID, appCertificate, channelName string, userAccount string, role uint32, expireSec uint32) (string, error) {
	if appID == "" {
		return "", errors.New("agora appID không được để trống")
	}

	// Nếu project Agora không bật App Certificate (chế độ Test không cần token)
	if appCertificate == "" {
		return "", nil
	}

	if channelName == "" {
		return "", errors.New("channelName không được để trống")
	}

	if expireSec == 0 {
		expireSec = 86400 // Mặc định 24h
	}

	now := uint32(time.Now().Unix())
	expireTs := now + expireSec

	// Khởi tạo privileges cho Service RTC
	privileges := make(map[uint16]uint32)
	privileges[PrivilegeJoinChannel] = expireTs

	if role == RolePublisher {
		privileges[PrivilegePublishAudioStream] = expireTs
		privileges[PrivilegePublishVideoStream] = expireTs
		privileges[PrivilegePublishDataStream] = expireTs
	}

	// Đóng gói RTC Service
	serviceRtcBuf := new(bytes.Buffer)
	packString(serviceRtcBuf, channelName)
	packString(serviceRtcBuf, userAccount)
	packUint16(serviceRtcBuf, uint16(len(privileges)))
	for k, v := range privileges {
		packUint16(serviceRtcBuf, k)
		packUint32(serviceRtcBuf, v)
	}
	serviceRtcBytes := serviceRtcBuf.Bytes()

	// Đóng gói Message chính
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	salt := r.Uint32()

	msgBuf := new(bytes.Buffer)
	packUint32(msgBuf, salt)
	packUint32(msgBuf, now)
	packUint16(msgBuf, 1) // Số lượng services = 1 (RTC)

	// Ghi ServiceTypeRTC và nội dung
	packUint16(msgBuf, ServiceTypeRTC)
	packUint16(msgBuf, uint16(len(serviceRtcBytes)))
	msgBuf.Write(serviceRtcBytes)

	messageBytes := msgBuf.Bytes()

	// Ký HMAC-SHA256
	mac := hmac.New(sha256.New, []byte(appCertificate))
	mac.Write(messageBytes)
	signature := mac.Sum(nil)

	// Ghép Signature + Message
	contentBuf := new(bytes.Buffer)
	contentBuf.Write(signature)
	contentBuf.Write(messageBytes)

	// Nén zlib
	var compressedBuf bytes.Buffer
	zw := zlib.NewWriter(&compressedBuf)
	if _, err := zw.Write(contentBuf.Bytes()); err != nil {
		return "", fmt.Errorf("lỗi nén token zlib: %w", err)
	}
	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng zlib writer: %w", err)
	}

	// Chuẩn hóa token: "007" + appID + base64(compressed_content)
	token := fmt.Sprintf("%s%s%s", Version2, appID, base64.StdEncoding.EncodeToString(compressedBuf.Bytes()))
	return token, nil
}

func packUint16(buf *bytes.Buffer, v uint16) {
	_ = binary.Write(buf, binary.LittleEndian, v)
}

func packUint32(buf *bytes.Buffer, v uint32) {
	_ = binary.Write(buf, binary.LittleEndian, v)
}

func packString(buf *bytes.Buffer, s string) {
	b := []byte(s)
	packUint16(buf, uint16(len(b)))
	buf.Write(b)
}
