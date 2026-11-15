package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"
)

type Engine struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"-"`
	State   string `json:"state"` // ready | offline | checking
	Version string `json:"version"`
	Since   int64  `json:"since"`
	Busy    int    `json:"busy"`
	everUp  bool
}

type TestResult struct {
	State   string   `json:"state"` // idle | running | done
	URL     string   `json:"url"`
	OK      bool     `json:"ok"`
	Engine  string   `json:"engine"`
	Tried   []string `json:"tried"`
	Ms      int64    `json:"ms"`
	Title   string   `json:"title"`
	Cookies int      `json:"cookies"`
	Status  int      `json:"status"`
	Message string   `json:"message"`
	Started int64    `json:"started"`
}

type Daemon struct {
	mu       sync.Mutex
	settings Settings
	engines  map[string]*Engine
	activity []Entry
	sites    map[string]string
	days     map[string]*DayCount
	perEng   map[string]*DayCount
	perDay   string
	test     TestResult
	dirty    bool
	started  time.Time

	pubMu   sync.Mutex
	pubSrv  *http.Server
	pubPort int
	pubErr  string

	client *http.Client
}

func runDaemon() {
	_ = os.MkdirAll(dataDir(), 0o755)
	d := &Daemon{
		settings: defaultSettings(),
		engines: map[string]*Engine{
			engineFS:     {ID: engineFS, Name: "FlareSolverr", URL: envOr("DEBARRIER_FS_URL", "http://127.0.0.1:8192"), State: "checking"},
			engineByparr: {ID: engineByparr, Name: "Byparr", URL: envOr("DEBARRIER_BYPARR_URL", "http://127.0.0.1:8193"), State: "checking"},
		},
		sites:   map[string]string{},
		days:    map[string]*DayCount{},
		perEng:  map[string]*DayCount{},
		started: time.Now(),
		client:  &http.Client{},
	}
	readJSON("settings.json", &d.settings)
	d.settings.clean()
	var s saved
	if readJSON("state.json", &s) {
		d.activity = s.Activity
		if s.Sites != nil {
			d.sites = s.Sites
		}
		if s.Days != nil {
			d.days = s.Days
		}
		if s.PerEng != nil && s.PerDay == today() {
			d.perEng = s.PerEng
			d.perDay = s.PerDay
		}
	}
	if err := writePID(); err != nil {
		logf("Couldn't write the PID file: %v", err)
	}
	logf("DeBarrier %s starting. Engine: %s, fall back to the other: %v", version, d.engineName(d.settings.Engine), d.settings.Fallback)

	// Control API for the DSM window (loopback only).
	ctl := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", ctlPort()), Handler: http.HandlerFunc(d.handleCtl)}
	go func() {
		if err := ctl.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logf("Control port %d failed: %v", ctlPort(), err)
			os.Exit(1)
		}
	}()

	d.bindPublic()
	go d.probeLoop()
	go d.saveLoop()
	go upd.loop()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	select {
	case <-sig:
		logf("Stopping")
	case <-restartReq:
		logf("Restarting to finish the update")
		exitCode = restartCode
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	d.pubMu.Lock()
	if d.pubSrv != nil {
		_ = d.pubSrv.Shutdown(ctx)
	}
	d.pubMu.Unlock()
	_ = ctl.Shutdown(ctx)
	d.save()
	_ = os.Remove(dataPath("debarrier.pid"))
}

func writePID() error {
	return os.WriteFile(dataPath("debarrier.pid"), []byte(fmt.Sprint(os.Getpid())), 0o644)
}

func (d *Daemon) engineName(id string) string {
	if e, ok := d.engines[id]; ok {
		return e.Name
	}
	return id
}

// ---------- public port (what Materia talks to) ----------

// bindPublic (re)opens the public port from the settings. If the port is
// taken (often an old FlareSolverr container), it keeps retrying.
func (d *Daemon) bindPublic() {
	d.pubMu.Lock()
	defer d.pubMu.Unlock()
	d.mu.Lock()
	port := d.settings.Port
	d.mu.Unlock()
	if d.pubSrv != nil && d.pubPort == port && d.pubErr == "" {
		return
	}
	if d.pubSrv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = d.pubSrv.Shutdown(ctx)
		cancel()
		d.pubSrv = nil
	}
	d.pubPort = port
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		if d.pubErr == "" {
			logf("Port %d is already in use, so Materia can't reach DeBarrier yet. Retrying every 30 seconds. (%v)", port, err)
		}
		d.pubErr = fmt.Sprintf("Port %d is already in use by something else on the NAS.", port)
		go func(p int) {
			time.Sleep(30 * time.Second)
			d.mu.Lock()
			same := d.settings.Port == p
			d.mu.Unlock()
			if same {
				d.bindPublic()
			}
		}(port)
		return
	}
	if d.pubErr != "" {
		logf("Port %d is free now", port)
	}
	d.pubErr = ""
	srv := &http.Server{Handler: http.HandlerFunc(d.handlePublic), ReadHeaderTimeout: 10 * time.Second}
	d.pubSrv = srv
	logf("Listening for Materia on port %d", port)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logf("Port %d stopped: %v", port, err)
		}
	}()
}

// ---------- engine health ----------

func (d *Daemon) probeLoop() {
	for {
		var wg sync.WaitGroup
		for _, id := range []string{engineFS, engineByparr} {
			wg.Add(1)
			go func(id string) { defer wg.Done(); d.probe(id) }(id)
		}
		wg.Wait()
		time.Sleep(10 * time.Second)
	}
}

func (d *Daemon) probe(id string) {
	d.mu.Lock()
	e := d.engines[id]
	url := e.URL
	d.mu.Unlock()
	// Cheap checks only: FlareSolverr's /health, Byparr's API description.
	// (Byparr's own /health loads google.com in a browser.)
	path := "/health"
	if id == engineByparr {
		path = "/openapi.json"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url+path, nil)
	resp, err := d.client.Do(req)
	up := err == nil && resp.StatusCode == 200
	if resp != nil {
		resp.Body.Close()
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	state := "offline"
	if up {
		state = "ready"
	}
	if state != e.State {
		if e.State != "checking" || up {
			if up {
				logf("%s is ready", e.Name)
			} else {
				logf("%s stopped answering", e.Name)
			}
		}
		e.State = state
		e.Since = time.Now().Unix()
	}
	if up {
		e.everUp = true
	}
}

// ---------- history ----------

func (d *Daemon) record(en Entry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.activity = append(d.activity, en)
	if len(d.activity) > maxActivity {
		d.activity = d.activity[len(d.activity)-maxActivity:]
	}
	if en.Test {
		d.dirty = true
		return
	}
	day := today()
	c := d.days[day]
	if c == nil {
		c = &DayCount{}
		d.days[day] = c
		// keep a week
		keys := make([]string, 0, len(d.days))
		for k := range d.days {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for len(keys) > 7 {
			delete(d.days, keys[0])
			keys = keys[1:]
		}
	}
	if d.perDay != day {
		d.perEng = map[string]*DayCount{}
		d.perDay = day
	}
	if en.OK {
		c.Solved++
	} else {
		c.Failed++
	}
	for _, t := range en.Tried {
		pe := d.perEng[t]
		if pe == nil {
			pe = &DayCount{}
			d.perEng[t] = pe
		}
		if en.OK && t == en.Engine {
			pe.Solved++
		} else {
			pe.Failed++
		}
	}
	d.dirty = true
}

func (d *Daemon) saveLoop() {
	for {
		time.Sleep(20 * time.Second)
		d.mu.Lock()
		dirty := d.dirty
		d.mu.Unlock()
		if dirty {
			d.save()
		}
	}
}

func (d *Daemon) save() {
	d.mu.Lock()
	s := saved{Activity: append([]Entry(nil), d.activity...), Sites: map[string]string{}, Days: map[string]*DayCount{}, PerEng: map[string]*DayCount{}, PerDay: d.perDay}
	for k, v := range d.sites {
		s.Sites[k] = v
	}
	for k, v := range d.days {
		c := *v
		s.Days[k] = &c
	}
	for k, v := range d.perEng {
		c := *v
		s.PerEng[k] = &c
	}
	d.dirty = false
	d.mu.Unlock()
	if err := writeJSON("state.json", s); err != nil {
		logf("Couldn't save history: %v", err)
	}
}
