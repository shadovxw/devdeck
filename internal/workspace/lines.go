package workspace

import (
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

// lineIndex maps a JSON pointer (/repos/0/id) to the line where that setting
// is written, so a problem can be shown at the right place in the file.
type lineIndex map[string]int

func buildIndex(n *yaml.Node) lineIndex {
	idx := lineIndex{}
	if n.Kind == yaml.DocumentNode && len(n.Content) > 0 {
		n = n.Content[0]
	}
	walk(n, "", idx)
	return idx
}

func walk(n *yaml.Node, ptr string, idx lineIndex) {
	switch n.Kind {
	case yaml.MappingNode:
		idx[ptr] = n.Line
		for i := 0; i+1 < len(n.Content); i += 2 {
			key, val := n.Content[i], n.Content[i+1]
			child := ptr + "/" + escape(key.Value)
			walk(val, child, idx)
			idx[child] = key.Line // point at the key, which is where people look
		}
	case yaml.SequenceNode:
		idx[ptr] = n.Line
		for i, item := range n.Content {
			walk(item, ptr+"/"+strconv.Itoa(i), idx)
		}
	default:
		idx[ptr] = n.Line
	}
}

// escape follows RFC 6901 for the two characters that need it.
func escape(key string) string {
	key = strings.ReplaceAll(key, "~", "~0")
	return strings.ReplaceAll(key, "/", "~1")
}

// lineFor finds the line for a pointer, falling back to the nearest parent.
func (idx lineIndex) lineFor(ptr string) int {
	for {
		if line, ok := idx[ptr]; ok {
			return line
		}
		cut := strings.LastIndex(ptr, "/")
		if cut < 0 {
			return 0
		}
		ptr = ptr[:cut]
	}
}
