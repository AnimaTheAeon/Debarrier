// DeBarrier: a FlareSolverr-compatible endpoint for Synology DSM.
//
// Modes:
//
//	debarrier daemon   the background service (started by DSM)
//	debarrier cgi      api.cgi: forwards the DSM window's requests to the service
//	debarrier update   installs a new release from GitHub (root, from DSM Task Scheduler)
//	debarrier version  prints the version
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

var version = "dev"

func main() {
	mode := "daemon"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	switch mode {
	case "daemon":
		runDaemon()
		os.Exit(exitCode)
	case "cgi":
		runCGI()
	case "update":
		os.Exit(runUpdate(os.Args[2:]))
	case "version":
		fmt.Println(version)
	default:
		fmt.Fprintln(os.Stderr, "usage: debarrier daemon|cgi|update [--force]|version")
		os.Exit(2)
	}
}

// dataDir is where settings, history and the log live.
func dataDir() string {
	if d := os.Getenv("DEBARRIER_DATA"); d != "" {
		return d
	}
	if d := os.Getenv("SYNOPKG_PKGVAR"); d != "" {
		return d
	}
	return "/var/packages/DeBarrier/var"
}

func dataPath(name string) string { return filepath.Join(dataDir(), name) }

// ctlPort is the loopback-only port api.cgi talks to.
func ctlPort() int {
	if p, err := strconv.Atoi(os.Getenv("DEBARRIER_CTL_PORT")); err == nil && p > 0 {
		return p
	}
	return 18191
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
