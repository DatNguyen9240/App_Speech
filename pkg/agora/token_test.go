package agora

import (
	"strings"
	"testing"
)

func TestGenerateRtcToken(t *testing.T) {
	appID := "970ca35de60c44645bbae8a215061b33"
	appCertificate := "5cfd2fd1755d40ecb72977518be15d3b"
	channelName := "test-channel"
	uid := uint32(123456)
	role := RolePublisher
	expireSec := uint32(3600)

	token, err := GenerateRtcToken(appID, appCertificate, channelName, uid, role, expireSec)
	if err != nil {
		t.Fatalf("GenerateRtcToken thất bại: %v", err)
	}

	if token == "" {
		t.Fatal("Token trả về không được rỗng")
	}

	// Chuẩn AccessToken2 bắt đầu bằng "007" + appID
	if !strings.HasPrefix(token, "007"+appID) {
		t.Errorf("Token format không đúng định dạng AccessToken2. Token: %s", token)
	}
}

func TestGenerateRtcToken_EmptyCertificate(t *testing.T) {
	appID := "970ca35de60c44645bbae8a215061b33"
	appCertificate := "" // Test mode không bật certificate
	channelName := "test-channel"
	uid := uint32(123456)

	token, err := GenerateRtcToken(appID, appCertificate, channelName, uid, RolePublisher, 3600)
	if err != nil {
		t.Fatalf("Lỗi không mong muốn: %v", err)
	}

	if token != "" {
		t.Errorf("Kỳ vọng token rỗng khi không có AppCertificate, nhưng nhận được: %s", token)
	}
}
