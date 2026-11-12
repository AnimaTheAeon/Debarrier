package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ---------- DSM sign-in check (admins only) ----------

type authEntry struct {
	user string
	at   time.Time
}

var (
	authMu    sync.Mutex
	authCache = map[string]authEntry{}
)

const authTTL = 60 * time.Second

func authenticate(cookie, token, remote string) (string, string) {
	if os.Getenv("DEBARRIER_NO_AUTH") == "1" {
		return "dev", ""
	}
	if cookie == "" {
		return "", "Not signed in to DSM"
	}
	key := cookie + "\x00" + token
	authMu.Lock()
	if e, ok := authCache[key]; ok && time.Since(e.at) < authTTL {
		authMu.Unlock()
		return e.user, ""
	}
	authMu.Unlock()
	script := ""
	for _, p := range []string{"/usr/syno/synoman/webman/authenticate.cgi", "/usr/syno/synoman/webman/modules/authenticate.cgi"} {
		if _, err := os.Stat(p); err == nil {
			script = p
			break
		}
	}
	if script == "" {
		return "", "DSM sign-in check isn't available"
	}
	if remote == "" {
		remote = "127.0.0.1"
	}
	cmd := exec.Command(script)
	cmd.Env = []string{"HTTP_COOKIE=" + cookie, "HTTP_X_SYNO_TOKEN=" + token, "REMOTE_ADDR=" + remote, "REQUEST_METHOD=GET", "QUERY_STRING=SynoToken=" + url.QueryEscape(token)}
	out, _ := cmd.Output()
	user := strings.TrimSpace(string(out))
	if user == "" {
		return "", "Your DSM session has expired. Sign in to DSM again."
	}
	if !isAdmin(user) {
		return "", "Only DSM administrators can use DeBarrier"
	}
	authMu.Lock()
	for k, e := range authCache {
		if time.Since(e.at) > authTTL {
			delete(authCache, k)
		}
	}
	authCache[key] = authEntry{user, time.Now()}
	authMu.Unlock()
	return user, ""
}

func isAdmin(user string) bool {
	if user == "root" {
		return true
	}
	out, err := exec.Command("id", "-Gn", user).Output()
	if err != nil {
		return false
	}
	for _, g := range strings.Fields(string(out)) {
		if g == "administrators" {
			return true
		}
	}
	return false
}

// ---------- control API ----------

func (d *Daemon) handleCtl(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api" {
		writeJSONResp(w, 404, map[string]any{"error": "not found"})
		return
	}
	if _, msg := authenticate(r.Header.Get("X-DeBarrier-Cookie"), r.Header.Get("X-DeBarrier-Token"), r.Header.Get("X-DeBarrier-Remote")); msg != "" {
		writeJSONResp(w, 401, map[string]any{"error": msg})
		return
	}
	route := r.URL.Query().Get("r")
	post := r.Method == "POST"
	var input map[string]any
	if post {
		data, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		_ = json.Unmarshal(data, &input)
	}
	var res any
	var errMsg string
	switch {
	case !post && route == "status":
		res = d.status()
	case !post && route == "config":
		res = d.configJSON()
	case post && route == "config":
		res, errMsg = d.saveConfig(input)
	case !post && route == "activity":
		res = d.activityJSON()
	case post && route == "activity/clear":
		d.mu.Lock()
		kept := d.activity[:0]
		d.activity = kept
		d.dirty = true
		d.mu.Unlock()
		res = map[string]any{"ok": true}
	case post && route == "sites/forget":
		d.mu.Lock()
		d.sites = map[string]string{}
		d.dirty = true
		d.mu.Unlock()
		logf("Forgot which engine works for each site")
		res = map[string]any{"ok": true}
	case post && route == "update/check":
		upd.requestCheck()
		res = map[string]any{"ok": true}
	case post && route == "update/install":
		res, errMsg = requestInstall()
	case !post && route == "log":
		res = map[string]any{"lines": recentLog(400)}
	case post && route == "test":
		raw, _ := input["url"].(string)
		raw = strings.TrimSpace(raw)
		if !strings.Contains(raw, "://") && raw != "" {
			raw = "https://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errMsg = "Type a web address, like https://example.com"
			break
		}
		d.mu.Lock()
		if d.test.State == "running" {
			d.mu.Unlock()
			errMsg = "A test is already running"
			break
		}
		d.test = TestResult{State: "running", URL: raw, Started: time.Now().Unix()}
		d.mu.Unlock()
		go d.runTest(raw)
		res = map[string]any{"ok": true}
	default:
		writeJSONResp(w, 404, map[string]any{"error": "Unknown request"})
		return
	}
	if errMsg != "" {
		writeJSONResp(w, 400, map[string]any{"error": errMsg})
		return
	}
	writeJSONResp(w, 200, res)
}

func (d *Daemon) status() map[string]any {
	d.pubMu.Lock()
	pubErr := d.pubErr
	d.pubMu.Unlock()
	d.mu.Lock()
	defer d.mu.Unlock()
	day := d.days[today()]
	if day == nil {
		day = &DayCount{}
	}
	engines := []map[string]any{}
	for _, id := range []string{engineFS, engineByparr} {
		e := d.engines[id]
		pe := &DayCount{}
		if d.perDay == today() && d.perEng[id] != nil {
			pe = d.perEng[id]
		}
		engines = append(engines, map[string]any{
			"id": e.ID, "name": e.Name, "state": e.State, "version": e.Version, "since": e.Since,
			"busy": e.Busy, "ever_up": e.everUp, "active": d.settings.Engine == id,
			"solved_today": pe.Solved, "failed_today": pe.Failed,
		})
	}
	return map[string]any{
		"version":    version,
		"now":        time.Now().Unix(),
		"uptime":     int64(time.Since(d.started).Seconds()),
		"engines":    engines,
		"engine":     d.settings.Engine,
		"fallback":   d.settings.Fallback,
		"port":       d.settings.Port,
		"port_error": pubErr,
		"solved":     day.Solved,
		"failed":     day.Failed,
		"remembered": len(d.sites),
		"test":       d.test,
		"update":     updateStatus(d.settings.AutoUpdate),
	}
}

func (d *Daemon) configJSON() Settings {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.settings
}

func (d *Daemon) saveConfig(in map[string]any) (any, string) {
	d.mu.Lock()
	s := d.settings
	old := s
	if v, ok := in["engine"].(string); ok {
		s.Engine = v
	}
	if v, ok := in["fallback"].(bool); ok {
		s.Fallback = v
	}
	if v, ok := in["port"].(float64); ok {
		p := int(v)
		if p < 1024 || p > 65535 || p == ctlPort() || p == 8192 || p == 8193 {
			d.mu.Unlock()
			return nil, "Pick a port from 1024 to 65535 (not 8192, 8193 or 18191, which DeBarrier uses itself)"
		}
		s.Port = p
	}
	if v, ok := in["auto_update"].(bool); ok {
		s.AutoUpdate = v
	}
	if v, ok := in["theme"].(string); ok {
		s.Theme = v
	}
	s.clean()
	d.settings = s
	d.mu.Unlock()
	if err := writeJSON("settings.json", s); err != nil {
		return nil, "Couldn't save settings: " + err.Error()
	}
	if s.Engine != old.Engine {
		logf("Engine switched to %s", d.engineName(s.Engine))
	}
	if s.Fallback != old.Fallback {
		if s.Fallback {
			logf("Falling back to the other engine is on")
		} else {
			logf("Falling back to the other engine is off")
		}
	}
	if s.AutoUpdate != old.AutoUpdate {
		if s.AutoUpdate {
			logf("Automatic updates are on")
		} else {
			logf("Automatic updates are off")
		}
	}
	if s.Port != old.Port {
		logf("Port changed from %d to %d", old.Port, s.Port)
		go d.bindPublic()
	}
	return s, ""
}

func (d *Daemon) activityJSON() map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	list := make([]Entry, 0, len(d.activity))
	for i := len(d.activity) - 1; i >= 0; i-- {
		list = append(list, d.activity[i])
	}
	return map[string]any{"entries": list, "now": time.Now().Unix()}
}
