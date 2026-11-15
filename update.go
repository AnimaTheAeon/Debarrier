package main

// Updates from GitHub Releases.
//
// The service (running as the DeBarrier user) checks GitHub every 6 hours so
// the window can show what's out. Installing needs root, which DSM only gives
// packages through a Task Scheduler task. That task runs `debarrier update`
// every 5 minutes; it does nothing unless there's an update to install
// (automatic updates are on, or someone pressed Update now).
//
// "Update now" needs no task when the service was started by debarrier-run.sh
// (it sets DEBARRIER_UPDATE_DIR): the service downloads the package itself,
// unpacks the program into <dir>/next and exits with restartCode, and the
// script swaps it in and starts it again. The scheduled task stays for
// hands-off updates, and it also refreshes the window's own files, which only
// a real package install can replace.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	repo        = "AnimaTheAeon/DeBarrier"
	packageName = "DeBarrier"
	synopkg     = "/usr/syno/bin/synopkg"
	checkEvery  = 6 * time.Hour
	retryAfter  = 6 * time.Hour // after a failed install, unless asked again
)

type Release struct {
	Version string `json:"version"`
	Page    string `json:"page"`
	SpkURL  string `json:"spk_url"`
	SpkName string `json:"spk_name"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	Notes   string `json:"notes"`
}

// Files in the data folder.
const (
	fileCheck   = "update_check.json"   // service: what GitHub had last time
	fileRequest = "update_request.json" // service: "Update now" was pressed
	fileResult  = "update_result.json"  // task: how the last install went
	fileTaskRun = "update_task.json"    // task: when it last ran
)

type checkFile struct {
	CheckedAt int64    `json:"checked_at"`
	Latest    *Release `json:"latest"`
	Error     string   `json:"error"`
}

type requestFile struct {
	Version string `json:"version"`
	Time    int64  `json:"time"`
}

type resultFile struct {
	Time    int64  `json:"time"`
	OK      bool   `json:"ok"`
	From    string `json:"from"`
	To      string `json:"to"`
	Message string `json:"message"`
}

type taskFile struct {
	Time int64 `json:"time"`
}

// isNewer is true when latest is a higher x.y.z than current.
func isNewer(latest, current string) bool {
	parts := func(v string) []int {
		v = strings.TrimLeft(strings.TrimSpace(v), "vV")
		v = strings.SplitN(strings.SplitN(v, "-", 2)[0], "+", 2)[0]
		var out []int
		for _, p := range strings.Split(v, ".") {
			n, _ := strconv.Atoi(p)
			out = append(out, n)
		}
		return out
	}
	a, b := parts(latest), parts(current)
	for i := 0; i < len(a) || i < len(b); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func curl(args ...string) ([]byte, error) {
	base := []string{"-fsSL", "--retry", "2", "--connect-timeout", "20", "-A", "DeBarrier/" + version}
	cmd := exec.Command("curl", append(base, args...)...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = "Couldn't reach GitHub"
		}
		return nil, errors.New(msg)
	}
	return out, nil
}

func parseRelease(data []byte) (*Release, error) {
	var j struct {
		Tag    string `json:"tag_name"`
		URL    string `json:"html_url"`
		Body   string `json:"body"`
		Assets []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Digest string `json:"digest"`
			Size   int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(data, &j); err != nil {
		return nil, fmt.Errorf("Unexpected answer from GitHub: %v", err)
	}
	if j.Tag == "" {
		return nil, errors.New("GitHub's answer had no version")
	}
	for _, a := range j.Assets {
		if strings.HasSuffix(a.Name, "-x86_64.spk") && a.URL != "" {
			r := &Release{Version: strings.TrimLeft(j.Tag, "vV"), Page: j.URL, SpkURL: a.URL, SpkName: filepath.Base(a.Name), Notes: j.Body, Size: a.Size}
			if d, ok := strings.CutPrefix(a.Digest, "sha256:"); ok {
				r.SHA256 = strings.ToLower(d)
			}
			return r, nil
		}
	}
	return nil, errors.New("The latest release has no .spk for this NAS")
}

func latestRelease() (*Release, error) {
	url := envOr("DEBARRIER_RELEASE_URL", "https://api.github.com/repos/"+repo+"/releases/latest")
	data, err := curl("--max-time", "60", "-H", "Accept: application/vnd.github+json", url)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, errors.New("No releases on GitHub yet")
		}
		return nil, err
	}
	return parseRelease(data)
}

// ---------- the service's side ----------

type updater struct {
	mu         sync.Mutex
	checking   bool
	installing bool
	progress   *Progress
	kick       chan struct{}
}

var upd = &updater{kick: make(chan struct{}, 1)}

func (u *updater) loop() {
	timer := time.NewTimer(45 * time.Second) // let the service settle first
	for {
		select {
		case <-timer.C:
		case <-u.kick:
		}
		u.checkNow()
		timer.Reset(checkEvery)
	}
}

func (u *updater) requestCheck() {
	u.mu.Lock()
	u.checking = true
	u.mu.Unlock()
	select {
	case u.kick <- struct{}{}:
	default:
	}
}

func (u *updater) checkNow() {
	u.mu.Lock()
	u.checking = true
	u.mu.Unlock()
	var prev checkFile
	readJSON(fileCheck, &prev)
	r, err := latestRelease()
	c := checkFile{CheckedAt: time.Now().Unix(), Latest: prev.Latest}
	if err != nil {
		c.Error = err.Error()
		logf("Update check failed: %v", err)
	} else {
		if isNewer(r.Version, version) && (prev.Latest == nil || prev.Latest.Version != r.Version) {
			logf("Update available: DeBarrier %s", r.Version)
		}
		c.Latest = r
	}
	_ = writeJSON(fileCheck, c)
	u.mu.Lock()
	u.checking = false
	u.mu.Unlock()
}

func updateStatus(auto bool) map[string]any {
	var c checkFile
	var req requestFile
	var res resultFile
	var task taskFile
	readJSON(fileCheck, &c)
	hasReq := readJSON(fileRequest, &req)
	hasRes := readJSON(fileResult, &res)
	readJSON(fileTaskRun, &task)
	upd.mu.Lock()
	checking := upd.checking
	upd.mu.Unlock()
	now := time.Now().Unix()
	out := map[string]any{
		"current":    version,
		"checking":   checking,
		"checked_at": c.CheckedAt,
		"error":      c.Error,
		"now":        now,
		"auto":       auto,
		"command":    updateCommand(),
		"task_seen":  task.Time,
		// The task runs every 5 minutes; 30 minutes of silence means it isn't set up (or is off).
		"task_ok":         task.Time > 0 && now-task.Time < 30*60,
		"can_install_now": canInstallNow(),
	}
	if p := upd.progressNow(); p != nil {
		out["progress"] = p
	}
	if c.Latest != nil {
		out["latest"] = c.Latest.Version
		out["page"] = c.Latest.Page
		out["available"] = isNewer(c.Latest.Version, version)
	} else {
		out["available"] = false
	}
	if hasReq && isNewer(req.Version, version) {
		out["requested"] = req.Version
		out["requested_at"] = req.Time
	}
	if hasRes {
		out["last_install"] = res
	}
	return out
}

// requestInstall is the Update now button.
func requestInstall() (map[string]any, string) {
	var c checkFile
	readJSON(fileCheck, &c)
	if c.Latest == nil || !isNewer(c.Latest.Version, version) {
		return nil, "You already have the newest version"
	}
	if canInstallNow() {
		if msg := startInstallNow(c.Latest); msg != "" {
			return nil, msg
		}
		return map[string]any{"ok": true}, ""
	}
	if err := writeJSON(fileRequest, requestFile{Version: c.Latest.Version, Time: time.Now().Unix()}); err != nil {
		return nil, "Couldn't save the request: " + err.Error()
	}
	logf("Update to %s requested; the DeBarrier update task installs it within 5 minutes", c.Latest.Version)
	return map[string]any{"ok": true}, ""
}

func updateCommand() string {
	dest := os.Getenv("SYNOPKG_PKGDEST")
	if dest == "" {
		dest = "/var/packages/" + packageName + "/target"
	}
	return dest + "/bin/debarrier update"
}

// ---------- the root task's side ----------

// runUpdate is `debarrier update [--force]`, run as root by Task Scheduler.
func runUpdate(args []string) int {
	force := false
	for _, a := range args {
		if a == "--force" {
			force = true
		}
	}
	if os.Geteuid() != 0 && os.Getenv("DEBARRIER_UPDATE_TEST") != "1" {
		fmt.Fprintln(os.Stderr, "DeBarrier update: this task must run as root. In Task Scheduler, edit the task and set General → User to root.")
		return 1
	}
	writeShared(fileTaskRun, taskFile{Time: time.Now().Unix()})

	installed := installedVersion()
	var settings Settings = defaultSettings()
	readJSON("settings.json", &settings)
	var c checkFile
	readJSON(fileCheck, &c)
	var req requestFile
	hasReq := readJSON(fileRequest, &req)
	var last resultFile
	hasLast := readJSON(fileResult, &last)

	asked := hasReq && isNewer(req.Version, installed)
	if hasReq && !asked {
		_ = os.Remove(dataPath(fileRequest)) // already there
	}
	// The service's last check is only a hint; GitHub is asked again below.
	cachedNewer := c.Latest != nil && isNewer(c.Latest.Version, installed)
	auto := settings.AutoUpdate && cachedNewer
	if auto && hasLast && !last.OK && last.To == c.Latest.Version && time.Now().Unix()-last.Time < int64(retryAfter.Seconds()) {
		auto = false // failed recently; wait, unless someone presses Update now
	}
	if !force && !asked && !auto {
		fmt.Printf("DeBarrier %s: nothing to install.\n", installed)
		return 0
	}

	r, err := latestRelease()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Update check failed:", err)
		if asked {
			recordResult(false, installed, req.Version, "Couldn't reach GitHub: "+err.Error())
			_ = os.Remove(dataPath(fileRequest))
		}
		return 1
	}
	if !isNewer(r.Version, installed) {
		fmt.Printf("DeBarrier %s is up to date.\n", installed)
		_ = os.Remove(dataPath(fileRequest))
		return 0
	}
	fmt.Printf("Updating DeBarrier %s -> %s\n", installed, r.Version)
	logf("Installing update %s (from %s)", r.Version, installed)
	_ = os.Remove(dataPath(fileRequest))
	if err := install(r); err != nil {
		fmt.Fprintln(os.Stderr, "Update failed:", err)
		recordResult(false, installed, r.Version, err.Error())
		return 1
	}
	recordResult(true, installed, r.Version, "Updated to "+r.Version)
	fmt.Println("Updated to", r.Version)
	return 0
}

// installedVersion is what DSM has installed, e.g. "1.0.2" from "1.0.2-0012".
func installedVersion() string {
	data, err := os.ReadFile("/var/packages/" + packageName + "/INFO")
	if err == nil {
		for _, l := range strings.Split(string(data), "\n") {
			if v, ok := strings.CutPrefix(l, "version="); ok {
				v = strings.SplitN(strings.Trim(v, `"`), "-", 2)[0]
				if v != "" {
					return v
				}
			}
		}
	}
	return version
}

// writeShared writes a file the service (a different user) can read.
func writeShared(name string, v any) {
	if err := writeJSON(name, v); err == nil {
		_ = os.Chmod(dataPath(name), 0o644)
		if st, err := os.Stat(dataDir()); err == nil {
			if uid, gid, ok := ownerOf(st); ok {
				_ = os.Chown(dataPath(name), uid, gid)
			}
		}
	}
}

func recordResult(ok bool, from, to, msg string) {
	writeShared(fileResult, resultFile{Time: time.Now().Unix(), OK: ok, From: from, To: to, Message: msg})
	if ok {
		logf("Update installed: %s", msg)
	} else {
		logf("Update to %s failed: %s", to, msg)
	}
}

func install(r *Release) error {
	dir, err := os.MkdirTemp("", "debarrier-update-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	spk := filepath.Join(dir, r.SpkName)
	if _, err := curl("--max-time", "600", "-o", spk, r.SpkURL); err != nil {
		return fmt.Errorf("Download failed: %v", err)
	}
	if r.SHA256 != "" {
		f, err := os.Open(spk)
		if err != nil {
			return err
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			return err
		}
		if hex.EncodeToString(h.Sum(nil)) != r.SHA256 {
			return errors.New("The download didn't match GitHub's checksum")
		}
	}
	if os.Getenv("DEBARRIER_UPDATE_TEST") == "1" {
		return nil // tests stop before touching DSM
	}
	wasRunning := true
	if out, err := exec.Command(synopkg, "is_onoff", packageName).CombinedOutput(); err == nil && strings.Contains(strings.ToLower(string(out)), "not") {
		wasRunning = false
	}
	out, err := exec.Command(synopkg, "install", spk).CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil || strings.Contains(text, `"success":false`) {
		if text == "" {
			text = "synopkg install failed"
		}
		if len(text) > 400 {
			text = text[:400] + "…"
		}
		return fmt.Errorf("synopkg: %s", text)
	}
	if wasRunning {
		_ = exec.Command(synopkg, "start", packageName).Run()
	}
	return nil
}

// ---------- installing from the window (no root) ----------

// restartCode tells debarrier-run.sh "start me again".
const restartCode = 75

// restartReq is closed-over by the daemon's main loop: an update is unpacked.
var restartReq = make(chan struct{}, 1)

// exitCode is what main exits with after the daemon has stopped.
var exitCode = 0

// Progress is what Update now is doing, for the window.
type Progress struct {
	To      string `json:"to"`
	Phase   string `json:"phase"` // download, verify, restart, failed
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Message string `json:"message,omitempty"`
}

func (u *updater) setProgress(p *Progress) {
	u.mu.Lock()
	u.progress = p
	u.mu.Unlock()
}

func (u *updater) progressNow() *Progress {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.progress == nil {
		return nil
	}
	p := *u.progress
	return &p
}

func updateDir() string { return strings.TrimSpace(os.Getenv("DEBARRIER_UPDATE_DIR")) }

// canInstallNow is true when debarrier-run.sh started this service.
func canInstallNow() bool { return updateDir() != "" }

// startInstallNow downloads and unpacks the release in the background, then
// asks the daemon to exit so debarrier-run.sh can swap it in. It returns a
// message when it can't start.
func startInstallNow(r *Release) string {
	upd.mu.Lock()
	if upd.installing {
		upd.mu.Unlock()
		return "An update is already running"
	}
	upd.installing = true
	upd.progress = &Progress{To: r.Version, Phase: "download", Total: r.Size}
	upd.mu.Unlock()
	go func() {
		from := version
		logf("Updating DeBarrier %s -> %s", from, r.Version)
		if err := installInto(r, updateDir()); err != nil {
			logf("Update to %s failed: %v", r.Version, err)
			recordResult(false, from, r.Version, err.Error())
			upd.mu.Lock()
			upd.installing = false
			upd.progress = &Progress{To: r.Version, Phase: "failed", Message: err.Error()}
			upd.mu.Unlock()
			return
		}
		recordResult(true, from, r.Version, "Updated to "+r.Version)
		upd.setProgress(&Progress{To: r.Version, Phase: "restart", Done: 1, Total: 1})
		time.Sleep(2 * time.Second) // let the window see "restart"
		select {
		case restartReq <- struct{}{}:
		default:
		}
	}()
	return ""
}

func runTar(args ...string) error {
	out, err := exec.Command("tar", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("Couldn't unpack the download: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// installInto downloads the package, checks it and leaves the new program in dir/next.
func installInto(r *Release, dir string) error {
	work := filepath.Join(dir, "work")
	_ = os.RemoveAll(work)
	if err := os.MkdirAll(work, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(work)
	spk := filepath.Join(work, "download.spk")
	cmd := exec.Command("curl", "-fsSL", "--retry", "2", "--connect-timeout", "20", "--max-time", "900", "-A", "DeBarrier/"+version, "-o", spk, r.SpkURL)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Download failed: couldn't run curl: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	tick := time.NewTicker(400 * time.Millisecond)
	defer tick.Stop()
wait:
	for {
		select {
		case err := <-done:
			if err != nil {
				msg := strings.TrimSpace(stderr.String())
				if msg == "" {
					msg = "couldn't reach GitHub"
				}
				return fmt.Errorf("Download failed: %s", msg)
			}
			break wait
		case <-tick.C:
			var got int64
			if st, err := os.Stat(spk); err == nil {
				got = st.Size()
			}
			upd.setProgress(&Progress{To: r.Version, Phase: "download", Done: got, Total: r.Size})
		}
	}
	st, err := os.Stat(spk)
	if err != nil {
		return err
	}
	upd.setProgress(&Progress{To: r.Version, Phase: "verify", Done: st.Size(), Total: st.Size()})
	if r.SHA256 != "" {
		f, err := os.Open(spk)
		if err != nil {
			return err
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			return err
		}
		if hex.EncodeToString(h.Sum(nil)) != r.SHA256 {
			return errors.New("The download didn't match GitHub's checksum. Nothing was changed.")
		}
	}
	outer := filepath.Join(work, "outer")
	staged := filepath.Join(work, "staged")
	for _, d := range []string{outer, staged} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	if err := runTar("-xf", spk, "-C", outer); err != nil {
		return err
	}
	if err := runTar("-xzf", filepath.Join(outer, "package.tgz"), "-C", staged); err != nil {
		return err
	}
	exe := filepath.Join(staged, "bin", "debarrier")
	if fi, err := os.Stat(exe); err != nil || fi.IsDir() {
		return errors.New("The download has no DeBarrier program in it. Nothing was changed.")
	}
	_ = os.Chmod(exe, 0o755)
	// The new program must start and be the version GitHub listed.
	said, err := exec.Command(exe, "version").Output()
	if err != nil {
		return fmt.Errorf("The new program won't start: %v", err)
	}
	if strings.TrimSpace(string(said)) != r.Version {
		return errors.New("The downloaded program isn't the version GitHub listed. Nothing was changed.")
	}
	next := filepath.Join(dir, "next")
	_ = os.RemoveAll(next)
	if err := os.Rename(staged, next); err != nil {
		return fmt.Errorf("Couldn't put the update in place: %v", err)
	}
	return nil
}
