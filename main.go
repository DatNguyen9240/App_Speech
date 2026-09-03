package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"speech-proxy/internal/config"
	"speech-proxy/internal/handler"

	"github.com/gin-gonic/gin"
)

//go:embed web/*
var embeddedWebFS embed.FS

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

	// Đọc sẵn index.html từ embedded filesystem vào RAM để phục vụ trực tiếp (tránh mã chuyển hướng 301 của http.ServeFile)
	indexHTML, err := embeddedWebFS.ReadFile("web/index.html")
	if err != nil {
		log.Fatalf("Không thể đọc web/index.html từ embed: %v", err)
	}

	webSubFS, err := fs.Sub(embeddedWebFS, "web")
	if err == nil {
		r.StaticFS("/static", http.FS(webSubFS))
	} else {
		log.Printf("⚠️ Lỗi khởi tạo web static filesystem: %v", err)
	}

	serveIndex := func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	}
	r.GET("/", serveIndex)
	r.GET("/index.html", serveIndex)

	r.GET("/favicon.ico", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

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
