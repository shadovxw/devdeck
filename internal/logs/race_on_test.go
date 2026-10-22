//go:build race

package logs

// raceEnabled is true when the tests run with the race detector, which makes code
// several times slower: timing gates scale for it.
const raceEnabled = true
