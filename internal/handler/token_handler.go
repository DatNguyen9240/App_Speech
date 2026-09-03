package handler

import (
	"net/http"
	"strconv"

	"speech-proxy/internal/config"
	"speech-proxy/pkg/agora"

	"github.com/gin-gonic/gin"
)

type TokenRequest struct {
	ChannelName string `json:"channelName" form:"channelName"`
	UID         uint32 `json:"uid" form:"uid"`
	Role        uint32 `json:"role" form:"role"` // 1: Publisher, 2: Subscriber
}

type TokenResponse struct {
	Code        int    `json:"code"`
	AppID       string `json:"appId"`
	Token       string `json:"token"`
	ChannelName string `json:"channelName"`
	UID         uint32 `json:"uid"`
	ExpiresIn   uint32 `json:"expiresIn"`
}

type TokenHandler struct {
	cfg *config.Config
}

func NewTokenHandler(cfg *config.Config) *TokenHandler {
	return &TokenHandler{cfg: cfg}
}

// GetToken cấp RTC Token tạm thời của Agora
func (h *TokenHandler) GetToken(c *gin.Context) {
	var req TokenRequest

	// Hỗ trợ cả GET Query params lẫn POST JSON body
	if c.Request.Method == http.MethodGet {
		req.ChannelName = c.Query("channelName")
		if req.ChannelName == "" {
			req.ChannelName = c.Query("channel")
		}
		if uidStr := c.Query("uid"); uidStr != "" {
			if u, err := strconv.ParseUint(uidStr, 10, 32); err == nil {
				req.UID = uint32(u)
			}
		}
		if roleStr := c.Query("role"); roleStr != "" {
			if r, err := strconv.ParseUint(roleStr, 10, 32); err == nil {
				req.Role = uint32(r)
			}
		}
	} else {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu yêu cầu không hợp lệ", "details": err.Error()})
			return
		}
	}

	if req.ChannelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Thiếu thông tin channelName"})
		return
	}

	if req.Role == 0 {
		req.Role = agora.RolePublisher // Mặc định có thể nói và nghe
	}

	// Tạo Token RTC thông qua pkg/agora
	token, err := agora.GenerateRtcToken(
		h.cfg.AgoraAppID,
		h.cfg.AgoraAppCertificate,
		req.ChannelName,
		req.UID,
		req.Role,
		h.cfg.TokenExpireSeconds,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Không thể tạo token Agora", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokenResponse{
		Code:        200,
		AppID:       h.cfg.AgoraAppID,
		Token:       token,
		ChannelName: req.ChannelName,
		UID:         req.UID,
		ExpiresIn:   h.cfg.TokenExpireSeconds,
	})
}
