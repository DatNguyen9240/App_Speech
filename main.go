package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"speech-proxy/internal/config"
	"speech-proxy/internal/handler"

	"github.com/gin-gonic/gin"
)

// CORSMiddleware cấu hình Header CORS cho phép trình duyệt di động và web client kết nối
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func main() {
	cfg := config.LoadConfig()

	// Khởi tạo Gin
	if os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	r.Use(CORSMiddleware())

	// Khởi tạo các handler
	tokenHandler := handler.NewTokenHandler(cfg)
	speechProxyHandler := handler.NewSpeechProxyHandler(cfg)

	// API Endpoints
	api := r.Group("/api")
	{
		// Health check
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status":  "ok",
				"service": "speech-translation-backend",
			})
		})

		// Endpoint cấp Agora RTC Token (hỗ trợ cả GET & POST)
		api.GET("/token", tokenHandler.GetToken)
		api.POST("/token", tokenHandler.GetToken)
	}

	// WebSocket Endpoint chuyển tiếp âm thanh sang Soniox
	r.GET("/ws/speech", speechProxyHandler.HandleSpeechWS)

	// Phục vụ giao diện Web tĩnh từ thư mục ./web
	if _, err := os.Stat("./web"); err == nil {
		r.Static("/static", "./web")
		r.StaticFile("/", "./web/index.html")
	}

	serverAddr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("================================================================")
	log.Printf("🚀 Speech Translation & Voice Call Backend khởi chạy thành công!")
	log.Printf("📡 HTTP Server & Web UI : http://localhost:%s", cfg.Port)
	log.Printf("🔑 Agora Token Endpoint : http://localhost:%s/api/token", cfg.Port)
	log.Printf("🎙️ Soniox WebSocket Proxy: ws://localhost:%s/ws/speech", cfg.Port)
	log.Printf("================================================================")

	if err := r.Run(serverAddr); err != nil {
		log.Fatalf("Không thể khởi động server: %v", err)
	}
}
