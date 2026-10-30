//go:build !windows

package agent

import (
	"os"
	"syscall"
)

// keepOwner gives path the owner and group of ref. The agent may run as root while the files
// it replaces belong to the people who edit them by hand; a replaced file must not lock them out.
// It is best effort: an agent that isn't allowed to chown simply writes as itself.
func keepOwner(path string, ref os.FileInfo) {
	if ref == nil {
		return
	}
	if st, ok := ref.Sys().(*syscall.Stat_t); ok {
		_ = os.Chown(path, int(st.Uid), int(st.Gid))
	}
}
