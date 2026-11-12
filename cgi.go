package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// runCGI: DSM runs api.cgi for requests from the DeBarrier window. It
// forwards them, with the caller's DSM session, to the service on loopback.
func runCGI() {
	method := os.Getenv("REQUEST_METHOD")
	if method != "POST" {
		method = "GET"
	}
	length, _ := strconv.Atoi(os.Getenv("CONTENT_LENGTH"))
	if length < 0 || length > 64<<10 {
		length = 64 << 10
	}
	body := make([]byte, length)
	if length > 0 {
		_, _ = io.ReadFull(os.Stdin, body)
	}
	clean := func(s string) string { return strings.NewReplacer("\r", "", "\n", "").Replace(s) }
	req, _ := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d/api?%s", ctlPort(), os.Getenv("QUERY_STRING")), bytes.NewReader(body))
	req.Header.Set("X-DeBarrier-Cookie", clean(os.Getenv("HTTP_COOKIE")))
	req.Header.Set("X-DeBarrier-Token", clean(os.Getenv("HTTP_X_SYNO_TOKEN")))
	req.Header.Set("X-DeBarrier-Remote", clean(os.Getenv("REMOTE_ADDR")))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	status, payload := 503, []byte(`{"error":"The DeBarrier service isn't running. Start it in Package Center."}`)
	if resp, err := client.Do(req); err == nil {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		status, payload = resp.StatusCode, data
	}
	fmt.Printf("Status: %d\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n", status)
	_, _ = os.Stdout.Write(payload)
}
