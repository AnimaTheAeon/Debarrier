package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// ---------- log ----------

const logMax = 1 << 20

var logMu sync.Mutex

func logf(format string, args ...any) {
	line := time.Now().Format("2006-01-02 15:04:05") + " " + fmt.Sprintf(format, args...)
	line = strings.ReplaceAll(line, "\n", " ")
	logMu.Lock()
	defer logMu.Unlock()
	fmt.Fprintln(os.Stderr, line)
	p := dataPath("debarrier.log")
	if st, err := os.Stat(p); err == nil && st.Size() > logMax {
		_ = os.Rename(p, p+".1")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	shareWithService(p) // the update task runs as root
	defer f.Close()
	fmt.Fprintln(f, line)
}

func recentLog(n int) []string {
	logMu.Lock()
	defer logMu.Unlock()
	data, _ := os.ReadFile(dataPath("debarrier.log"))
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return []string{}
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}

// ---------- settings ----------

const (
	engineFS     = "flaresolverr"
	engineByparr = "byparr"
)

type Settings struct {
	Engine     string `json:"engine"`
	Fallback   bool   `json:"fallback"`
	Port       int    `json:"port"`
	Theme      string `json:"theme"`
	AutoUpdate bool   `json:"auto_update"`
}

func defaultSettings() Settings {
	return Settings{Engine: engineFS, Fallback: true, Port: 8191, Theme: "ff", AutoUpdate: true}
}

func (s *Settings) clean() {
	if s.Engine != engineByparr {
		s.Engine = engineFS
	}
	if s.Port < 1024 || s.Port > 65535 || s.Port == ctlPort() || s.Port == 8192 || s.Port == 8193 {
		s.Port = 8191
	}
	if s.Theme != "green" && s.Theme != "blades" {
		s.Theme = "ff"
	}
}

// ---------- history ----------

type Entry struct {
	Time    int64    `json:"time"`
	Site    string   `json:"site"`
	Cmd     string   `json:"cmd"`
	Engine  string   `json:"engine"`
	Tried   []string `json:"tried"`
	OK      bool     `json:"ok"`
	Ms      int64    `json:"ms"`
	Message string   `json:"message,omitempty"`
	Test    bool     `json:"test,omitempty"`
}

type DayCount struct {
	Solved int `json:"solved"`
	Failed int `json:"failed"`
}

type saved struct {
	Activity []Entry              `json:"activity"`
	Sites    map[string]string    `json:"sites"`
	Days     map[string]*DayCount `json:"days"`
	PerEng   map[string]*DayCount `json:"per_engine_today"`
	PerDay   string               `json:"per_engine_day"`
}

const maxActivity = 300

func readJSON(name string, v any) bool {
	data, err := os.ReadFile(dataPath(name))
	if err != nil {
		return false
	}
	return json.Unmarshal(data, v) == nil
}

func writeJSON(name string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := dataPath(name + ".tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dataPath(name))
}

func today() string { return time.Now().Format("2006-01-02") }
