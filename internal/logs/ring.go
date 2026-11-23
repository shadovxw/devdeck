package logs

// ring is a fixed-size circular buffer of entries: pushing into a full ring
// overwrites the oldest, and nothing is ever shifted (plan D3). It is not safe
// for concurrent use; the Store locks around it.
type ring struct {
	buf   []Entry
	start int // index of the oldest entry
	n     int // number of entries held
}

func newRing(capacity int) *ring {
	if capacity < 1 {
		capacity = 1
	}
	return &ring{buf: make([]Entry, capacity)}
}

func (r *ring) len() int { return r.n }

func (r *ring) push(e Entry) {
	if r.n < len(r.buf) {
		r.buf[(r.start+r.n)%len(r.buf)] = e
		r.n++
		return
	}
	r.buf[r.start] = e
	r.start = (r.start + 1) % len(r.buf)
}

// at returns the i-th entry counting from the oldest (0).
func (r *ring) at(i int) Entry { return r.buf[(r.start+i)%len(r.buf)] }

// ptr is at without the copy: for scans that only read.
func (r *ring) ptr(i int) *Entry { return &r.buf[(r.start+i)%len(r.buf)] }

// each calls f for every entry, oldest first, until f returns false.
func (r *ring) each(f func(Entry) bool) {
	for i := 0; i < r.n; i++ {
		if !f(r.at(i)) {
			return
		}
	}
}
