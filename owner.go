package main

import (
	"os"
	"syscall"
)

func ownerOf(st os.FileInfo) (int, int, bool) {
	if s, ok := st.Sys().(*syscall.Stat_t); ok {
		return int(s.Uid), int(s.Gid), true
	}
	return 0, 0, false
}

// shareWithService hands a file root created back to the data folder's owner.
func shareWithService(path string) {
	if os.Geteuid() != 0 {
		return
	}
	if st, err := os.Stat(dataDir()); err == nil {
		if uid, gid, ok := ownerOf(st); ok {
			_ = os.Chown(path, uid, gid)
		}
	}
}
