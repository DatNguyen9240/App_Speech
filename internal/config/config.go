package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port                string
	SonioxAPIKey        string
	SonioxWSURL         string
	AgoraAppID          string
	AgoraAppCertificate string
	TokenExpireSeconds  uint32
}

func LoadConfig() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	sonioxWS := os.Getenv("SONIOX_WS_URL")
	if sonioxWS == "" {
		sonioxWS = "wss://api.soniox.com/transcribe-websocket"
	}

	expireSec := uint32(86400)
	if s := os.Getenv("AGORA_TOKEN_EXPIRE_SECONDS"); s != "" {
		if val, err := strconv.ParseUint(s, 10, 32); err == nil {
			expireSec = uint32(val)
		}
	}

	return &Config{
		Port:                port,
		SonioxAPIKey:        os.Getenv("SONIOX_API_KEY"),
		SonioxWSURL:         sonioxWS,
		AgoraAppID:          os.Getenv("AGORA_APP_ID"),
		AgoraAppCertificate: os.Getenv("AGORA_APP_CERTIFICATE"),
		TokenExpireSeconds:  expireSec,
	}
}
