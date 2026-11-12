package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxBody = 4 << 20

// handlePublic serves the FlareSolverr API on the public port.
func (d *Daemon) handlePublic(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == "POST" && (r.URL.Path == "/v1" || r.URL.Path == "/v1/"):
		d.handleV1(w, r)
	case r.Method == "GET" && r.URL.Path == "/health":
		writeJSONResp(w, 200, map[string]any{"status": "ok"})
	case r.Method == "GET" && r.URL.Path == "/":
		if strings.Contains(r.Header.Get("Accept"), "text/html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<!DOCTYPE html><meta charset="utf-8"><title>DeBarrier</title><body style="background:#06083a;color:#f4f4f8;font:16px system-ui;padding:40px"><h1>DeBarrier is running</h1><p>This address is for Materia (Config &rarr; Proxies &rarr; FlareSolverr). To see DeBarrier itself, open it from the DSM main menu.</p></body>`)
			return
		}
		writeJSONResp(w, 200, map[string]any{"msg": "DeBarrier is ready!", "version": version, "userAgent": ""})
	default:
		writeJSONResp(w, 404, map[string]any{"status": "error", "message": "Not found. Send FlareSolverr requests to POST /v1"})
	}
}

type v1Request struct {
	Cmd        string `json:"cmd"`
	URL        string `json:"url"`
	MaxTimeout int64  `json:"maxTimeout"`
}

type attempt struct {
	status int
	body   []byte
	ok     bool
	msg    string
	local  bool // the engine itself couldn't be reached or ran out of time
}

type outcome struct {
	body   []byte
	status int
	engine string
	tried  []string
	ok     bool
	msg    string
	ms     int64
}

func (d *Daemon) handleV1(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		writeJSONResp(w, 400, errorBody("Couldn't read the request", time.Now()))
		return
	}
	var req v1Request
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSONResp(w, 400, errorBody("The request isn't valid JSON", time.Now()))
		return
	}
	out := d.solve(r.Context(), body, req, false)
	if out.engine != "" {
		w.Header().Set("X-DeBarrier-Engine", out.engine)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(out.status)
	_, _ = w.Write(out.body)
}

// order picks which engines to try, in order.
func (d *Daemon) order(cmd, host string) ([]string, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	// Byparr only does plain page loads; sessions and POSTs need FlareSolverr.
	if strings.HasPrefix(cmd, "sessions.") || cmd == "request.post" {
		return []string{engineFS}, ""
	}
	primary := d.settings.Engine
	other := engineByparr
	if primary == engineByparr {
		other = engineFS
	}
	if !d.settings.Fallback {
		return []string{primary}, ""
	}
	note := ""
	if remembered, ok := d.sites[host]; ok && host != "" && remembered != primary {
		primary, other = remembered, primary
		note = "remembered"
	}
	// Try a running engine before one that's down.
	if d.engines[primary].State == "offline" && d.engines[other].State == "ready" {
		primary, other = other, primary
	}
	return []string{primary, other}, note
}

// solve runs a FlareSolverr request through the chosen engine(s).
func (d *Daemon) solve(ctx context.Context, body []byte, req v1Request, test bool) outcome {
	start := time.Now()
	cmd := req.Cmd
	if cmd == "" {
		cmd = "request.get"
	}
	host, site := siteOf(req.URL)
	order, _ := d.order(cmd, host)
	timeout := time.Duration(req.MaxTimeout) * time.Millisecond
	if req.MaxTimeout <= 0 {
		timeout = 60 * time.Second
	} else if req.MaxTimeout < 1000 { // seconds, Byparr-style
		timeout = time.Duration(req.MaxTimeout) * time.Second
	}

	out := outcome{}
	var msgs []string
	var last attempt
	for i, id := range order {
		if ctx.Err() != nil {
			break
		}
		if i > 0 {
			logf("%s: %s didn't get through (%s), trying %s", site, d.engineName(order[i-1]), last.msg, d.engineName(id))
		}
		out.tried = append(out.tried, id)
		a := d.try(ctx, id, body, timeout+15*time.Second)
		last = a
		if a.ok {
			out.body, out.status, out.engine, out.ok = a.body, 200, id, true
			break
		}
		if a.local {
			msgs = append(msgs, d.engineName(id)+" "+a.msg)
		} else {
			msgs = append(msgs, d.engineName(id)+": "+a.msg)
		}
	}
	out.ms = time.Since(start).Milliseconds()
	if !out.ok {
		out.msg = strings.Join(msgs, " · ")
		if out.msg == "" {
			out.msg = "The request was cancelled"
		}
		if len(order) == 1 && last.status == 500 && last.body != nil && json.Valid(last.body) {
			// One engine, FlareSolverr-style error: pass it through as is.
			out.body, out.status = last.body, 500
		} else {
			out.body, out.status = mustJSON(errorBody(out.msg, start)), 500
		}
		if len(order) > 0 {
			out.engine = order[len(order)-1]
		}
	}

	// Remember which engine works for this site.
	if out.ok && host != "" && len(order) > 1 {
		d.mu.Lock()
		if out.engine == d.settings.Engine {
			delete(d.sites, host)
		} else if len(d.sites) < 1000 {
			d.sites[host] = out.engine
		}
		d.mu.Unlock()
	}

	en := Entry{Time: start.Unix(), Site: site, Cmd: cmd, Engine: out.engine, Tried: out.tried, OK: out.ok, Ms: out.ms, Test: test}
	if !out.ok {
		en.Message = out.msg
		logf("%s: failed after %.1fs (%s)", site, float64(out.ms)/1000, out.msg)
	} else {
		via := d.engineName(out.engine)
		logf("%s: solved by %s in %.1fs", site, via, float64(out.ms)/1000)
	}
	d.record(en)
	return out
}

func (d *Daemon) try(ctx context.Context, id string, body []byte, timeout time.Duration) attempt {
	d.mu.Lock()
	e := d.engines[id]
	base := e.URL
	e.Busy++
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		e.Busy--
		d.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", base+"/v1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			return attempt{msg: "timed out", local: true}
		case errors.Is(err, context.Canceled):
			return attempt{msg: "was cancelled", local: true}
		case strings.Contains(err.Error(), "connection refused"):
			return attempt{msg: "isn't running", local: true}
		}
		return attempt{msg: err.Error()}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return attempt{status: resp.StatusCode, msg: "the answer was cut off"}
	}
	var parsed struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Detail  any    `json:"detail"`
		Version string `json:"version"`
	}
	_ = json.Unmarshal(data, &parsed)
	if parsed.Version != "" {
		d.mu.Lock()
		e.Version = strings.TrimPrefix(parsed.Version, "v")
		d.mu.Unlock()
	}
	if resp.StatusCode == 200 && parsed.Status == "ok" {
		return attempt{status: 200, body: data, ok: true}
	}
	msg := parsed.Message
	if msg == "" && parsed.Detail != nil {
		if s, ok := parsed.Detail.(string); ok {
			msg = s
		} else {
			msg = "the request was refused"
		}
	}
	if msg == "" {
		msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	msg = strings.TrimPrefix(msg, "Error: ")
	if len(msg) > 220 {
		msg = msg[:220] + "…"
	}
	return attempt{status: resp.StatusCode, body: data, msg: msg}
}

// siteOf returns the host and a display form without the query string,
// which can hold passkeys.
func siteOf(raw string) (string, string) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "(no address)"
	}
	host := strings.ToLower(u.Hostname())
	path := u.EscapedPath()
	if len(path) > 60 {
		path = path[:60] + "…"
	}
	if path == "/" {
		path = ""
	}
	return host, host + path
}

func errorBody(msg string, start time.Time) map[string]any {
	return map[string]any{
		"status":         "error",
		"message":        "Error: " + msg,
		"startTimestamp": start.UnixMilli(),
		"endTimestamp":   time.Now().UnixMilli(),
		"version":        "DeBarrier " + version,
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func writeJSONResp(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

// runTest tries a page from the DSM window in the background.
func (d *Daemon) runTest(raw string) {
	start := time.Now()
	body := mustJSON(map[string]any{"cmd": "request.get", "url": raw, "maxTimeout": 60000})
	out := d.solve(context.Background(), body, v1Request{Cmd: "request.get", URL: raw, MaxTimeout: 60000}, true)
	res := TestResult{State: "done", URL: raw, OK: out.ok, Engine: out.engine, Tried: out.tried, Ms: out.ms, Message: out.msg, Started: start.Unix()}
	if out.ok {
		var parsed struct {
			Solution struct {
				Status   int    `json:"status"`
				Response string `json:"response"`
				Cookies  []any  `json:"cookies"`
			} `json:"solution"`
		}
		_ = json.Unmarshal(out.body, &parsed)
		res.Status = parsed.Solution.Status
		res.Cookies = len(parsed.Solution.Cookies)
		if m := titleRe.FindStringSubmatch(parsed.Solution.Response); m != nil {
			t := strings.Join(strings.Fields(m[1]), " ")
			if len(t) > 120 {
				t = t[:120] + "…"
			}
			res.Title = t
		}
	}
	d.mu.Lock()
	d.test = res
	d.mu.Unlock()
}
